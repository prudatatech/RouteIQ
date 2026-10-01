#!/usr/bin/env node
/**
 * One API call for the UAT scenario scripts (local stack only).
 *
 *   node e2e/scenarios/call.mjs <who|anon> <METHOD> <path> [json] [--idem KEY|none] [--hdr name:value] [--token T]
 *
 * Prints "HTTP <status>" and then the body on one line (JSON compacted; a non-JSON body is summarised as
 * {"_nonjson":true,"ct":..,"len":..,"head":..}). Non-GET calls carry a fresh Idempotency-Key unless --idem is given
 * (--idem none sends none). Exit code is always 0 so a scenario script keeps going.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const env = Object.fromEntries(fs.readFileSync(path.join(E2E, '.env.local'), 'utf8').split('\n')
  .map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
const API = (process.env.E2E_API || 'http://localhost:8011/api/v1').replace(/\/+$/, '');
if (!LOCAL.has(new URL(API).hostname)) { console.log('HTTP 000\n{"error":"REFUSING non-local API"}'); process.exit(0); }

const argv = process.argv.slice(2);
const pos = []; const hdrs = {}; let idem; let token;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--idem') idem = argv[++i];
  else if (argv[i] === '--hdr') { const [k, ...v] = argv[++i].split(':'); hdrs[k] = v.join(':'); }
  else if (argv[i] === '--token') token = argv[++i];
  else pos.push(argv[i]);
}
const [who, method = 'GET', p = '/', raw] = pos;
const headers = { 'content-type': 'application/json', ...hdrs };
if (token) headers.authorization = `Bearer ${token}`;
else if (who !== 'anon') {
  const acct = JSON.parse(fs.readFileSync(path.join(E2E, 'accounts.json'), 'utf8'))[who];
  if (!acct) { console.log(`HTTP 000\n{"error":"unknown account ${who}"}`); process.exit(0); }
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: acct.id, role: acct.role, aud: 'authenticated', user_metadata: { role: acct.role }, type: 'access', iss: 'margix-backend', iat: now, exp: now + 3600 });
  headers.authorization = `Bearer ${head}.${body}.${crypto.createHmac('sha256', env.SUPABASE_JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
const verb = method.toUpperCase();
if (verb !== 'GET' && idem !== 'none') headers['Idempotency-Key'] = idem ?? crypto.randomUUID();
try {
  const res = await fetch(`${API}${p.startsWith('/') ? p : `/${p}`}`, { method: verb, headers, body: raw === undefined || raw === '' ? undefined : raw });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  let out;
  if (/json/.test(ct) || buf.length === 0) {
    try { out = JSON.stringify(JSON.parse(buf.toString('utf8') || 'null')); } catch { out = JSON.stringify({ _nonjson: true, ct, len: buf.length, head: buf.toString('utf8', 0, 200) }); }
  } else {
    out = JSON.stringify({ _nonjson: true, ct, len: buf.length, head: buf.toString('latin1', 0, 12), cd: res.headers.get('content-disposition') });
  }
  console.log(`HTTP ${res.status}\n${out}`);
} catch (e) {
  console.log(`HTTP 000\n${JSON.stringify({ error: String(e).slice(0, 200) })}`);
}
