#!/usr/bin/env node
/**
 * Adds another vendor account to e2e/accounts.json (local stack only), for permission tests.
 *   node e2e/scenarios/mkvendor.mjs <key> "<Company>" approved|none
 * `approved` also gives it an approved company profile in Delhi; `none` leaves it a fresh sign-up (no profile, no KYC).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(E2E, '.env.local'), 'utf8').split('\n')
  .map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
const SB = env.SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SB)) { console.error('REFUSING non-local Supabase'); process.exit(2); }
const [key, company, mode] = process.argv.slice(2);
const svc = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' };
const email = `e2e-${key.toLowerCase()}@example.test`;
const phone = `+9199000${String(crypto.randomInt(10000, 99999))}`;
const r = await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: svc, body: JSON.stringify({
  email, password: 'E2e-Local-Pass-1', email_confirm: true, app_metadata: { role: 'vendor' }, user_metadata: { full_name: company, phone, role: 'vendor' } }) });
const u = await r.json();
if (!u.id) { console.error('create failed', JSON.stringify(u)); process.exit(1); }
if (mode === 'approved') {
  const p = await fetch(`${SB}/rest/v1/vendor_profiles`, { method: 'POST', headers: svc, body: JSON.stringify({
    id: u.id, company_name: company, gst_number: '07AAACR5055K1Z7', city: 'Delhi', address: 'Nehru Place, Delhi', latitude: 28.55, longitude: 77.25, is_verified: true, kyc_status: 'approved' }) });
  if (p.status >= 300) { console.error('profile failed', p.status, await p.text()); process.exit(1); }
}
const file = path.join(E2E, 'accounts.json');
const accounts = JSON.parse(fs.readFileSync(file, 'utf8'));
accounts[key] = { id: u.id, email, role: 'vendor' };
fs.writeFileSync(file, JSON.stringify(accounts, null, 2));
console.log(u.id);
