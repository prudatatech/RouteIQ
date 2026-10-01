#!/usr/bin/env node
/**
 * Calls the LOCAL backend as one of the seeded accounts, for manual UAT.
 *
 *   node e2e/uat.mjs <who> <METHOD> <path> [json-body]
 *   node e2e/uat.mjs customer GET /customer/bookings
 *   node e2e/uat.mjs superadmin POST /shipments '{"..."}'
 *   node e2e/uat.mjs anon GET /shipments/track/<id>
 *   node e2e/uat.mjs sql "select status, count(*) from shipments group by 1"
 *
 * <who> is a key of e2e/accounts.json (written by `node e2e/run.mjs --reset`), or `anon`.
 * `sql` runs a read or write against the LOCAL database container only.
 * Prints the HTTP status and the JSON body. Same safety rules as run.mjs: local addresses only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const fail = (msg, code = 2) => { console.error(msg); process.exit(code); };

const envFile = path.join(HERE, '.env.local');
if (!fs.existsSync(envFile)) fail('Missing e2e/.env.local. Run: bash e2e/setup-local.sh');
const ENV = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n')
  .map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
const API = (process.env.E2E_API || 'http://localhost:8011/api/v1').replace(/\/+$/, '');
for (const url of [API, ENV.SUPABASE_URL]) {
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) fail(`REFUSING: ${url} is not a local address`);
}

const [who, method, p, raw] = process.argv.slice(2);
if (!who) fail('usage: node e2e/uat.mjs <who|anon|sql> <METHOD|query> <path> [json-body]', 1);

if (who === 'sql') {
  process.stdout.write(execFileSync('docker', ['exec', '-i', 'supabase_db_margix-e2e', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: method, encoding: 'utf8' }));
  process.exit(0);
}

const headers = { 'content-type': 'application/json' };
if (who !== 'anon') {
  const accounts = JSON.parse(fs.readFileSync(path.join(HERE, 'accounts.json'), 'utf8'));
  const acct = accounts[who] ?? fail(`unknown account "${who}"; have: anon, ${Object.keys(accounts).join(', ')}`);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: acct.id, role: acct.role, aud: 'authenticated', user_metadata: { role: acct.role }, type: 'access', iss: 'margix-backend', iat: now, exp: now + 3600 });
  headers.authorization = `Bearer ${head}.${body}.${crypto.createHmac('sha256', ENV.SUPABASE_JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
const verb = (method || 'GET').toUpperCase();
if (verb !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();

const res = await fetch(`${API}${p.startsWith('/') ? p : `/${p}`}`, { method: verb, headers, body: raw === undefined ? undefined : raw });
const text = await res.text();
let out = text;
try { out = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
console.log(`HTTP ${res.status}`);
console.log(out.length > 20000 ? `${out.slice(0, 20000)}\n… (${out.length} chars, truncated)` : out);
process.exit(res.status >= 500 ? 1 : 0);
