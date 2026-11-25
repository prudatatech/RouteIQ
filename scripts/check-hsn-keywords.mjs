#!/usr/bin/env node
/**
 * HSN keyword check: finds a curated keyword that points at more than one code.
 *
 * A keyword on two headings makes the search result a coin flip and was the root cause of the
 * wrong-product hits fixed in `20261124090000_hsn_keyword_fixes.sql` and
 * `20261125090000_hsn_keyword_cleanup.sql`. Most of the remaining duplicates are legitimate
 * (a chapter and its heading, or a word that really names two products); those are listed with a
 * reason in `scripts/hsn-keyword-allowlist.json`. Anything else fails the check.
 *
 * Usage:
 *   node scripts/check-hsn-keywords.mjs [--stage test|live]
 *
 * Reads the stage credentials from `infra/secrets.<stage>.env` (or from SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY when they are already exported). It only reads the table and never
 * prints a secret. The check needs database access, so it runs where the credentials are (this
 * machine or Azure), not in GitHub Actions, whose runners cannot reach Postgres.
 *
 * Exits 1 when a keyword duplicates a code set the allowlist does not name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_FILE = path.join(ROOT, 'scripts', 'hsn-keyword-allowlist.json');
const PAGE = 1000;

function parseArgs(argv) {
  const out = { stage: 'test' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--stage') out.stage = argv[++i];
    else if (arg.startsWith('--stage=')) out.stage = arg.slice('--stage='.length);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

/** KEY=VALUE lines from the stage secrets file; exported values win, and no value is ever logged. */
function readEnv(stage) {
  const env = { ...process.env };
  const file = path.join(ROOT, 'infra', `secrets.${stage}.env`);
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) env[m[1]] = value;
  }
  return env;
}

async function fetchAll(base, key, table, select) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = new URL(`${base}/rest/v1/${table}`);
    url.search = new URLSearchParams({ select, order: 'hsn_code', limit: String(PAGE), offset: String(offset) });
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

const key = (s) => s.trim().toLowerCase();

function duplicates(rows) {
  const byKeyword = new Map();
  for (const row of rows) {
    for (const word of row.keywords ?? []) {
      const k = key(word);
      if (!k) continue;
      if (!byKeyword.has(k)) byKeyword.set(k, []);
      byKeyword.get(k).push(row.hsn_code);
    }
  }
  const dups = new Map();
  for (const [k, codes] of byKeyword) {
    const unique = [...new Set(codes)].sort();
    if (unique.length > 1) dups.set(k, unique);
  }
  return { byKeyword, dups };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node scripts/check-hsn-keywords.mjs [--stage test|live]');
    return 0;
  }
  if (!['test', 'live'].includes(args.stage)) throw new Error(`unknown stage: ${args.stage}`);

  const env = readEnv(args.stage);
  const base = (env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!base || !serviceKey) {
    throw new Error(`no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for stage ${args.stage} (see infra/secrets.${args.stage}.env)`);
  }

  const allowlistRaw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
  const allowlist = new Map(
    Object.entries(allowlistRaw)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => [key(k), { codes: [...v.codes].sort(), why: v.why ?? '' }]),
  );

  const rows = await fetchAll(base, serviceKey, 'hsn_codes', 'hsn_code,keywords');
  const curated = rows.filter((r) => (r.keywords ?? []).length > 0);
  const { byKeyword, dups } = duplicates(curated);

  console.log(`stage ${args.stage}: ${rows.length} codes, ${curated.length} curated, ${byKeyword.size} distinct keywords`);
  console.log(`duplicated: ${dups.size} (allowlisted: ${dups.size - [...dups.keys()].filter((k) => !allowlist.has(k)).length})`);

  const problems = [];
  for (const [k, codes] of [...dups].sort(([a], [b]) => a.localeCompare(b))) {
    const allowed = allowlist.get(k);
    if (!allowed) {
      problems.push(`new duplicate "${k}" -> ${codes.join(', ')}`);
    } else if (allowed.codes.join(',') !== codes.join(',')) {
      problems.push(`"${k}" now -> ${codes.join(', ')}, allowlist says ${allowed.codes.join(', ')} (${allowed.why})`);
    }
  }
  for (const [k, allowed] of allowlist) {
    if (!dups.has(k)) {
      console.log(`note: allowlist entry "${k}" is no longer duplicated (${allowed.codes.join(', ')}); remove it`);
    }
  }

  if (problems.length) {
    console.error('\nunexpected duplicate keywords:');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nMove the word to the heading that covers the goods, or add it to scripts/hsn-keyword-allowlist.json with a reason.');
    return 1;
  }
  console.log('ok: every duplicated keyword is allowlisted with a reason');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`check-hsn-keywords: ${err.message}`);
    process.exit(1);
  },
);
