#!/usr/bin/env node
/**
 * End-to-end run of the whole shipment story on a LOCAL stack.
 *
 *   node e2e/run.mjs --reset [--api http://localhost:8011/api/v1] [--only B,C]
 *
 * Sections: S seed, A booking, B assign and send, C pickup, D accident, E transfer, F delivery,
 * G receipt and claim, H invoices, I driver pay, J vendor load, K return trip, L permissions.
 * Every step prints PASS or FAIL; the run exits 1 if any step fails.
 *
 * SAFETY: the script refuses to run unless every URL it uses is 127.0.0.1, localhost or [::1].
 * It reads only e2e/.env.local (written by e2e/setup-local.sh). It never reads ~/.routeiq or any
 * hosted project's settings. --reset empties the LOCAL database (containers named *_margix-e2e).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

// ── Safety guard ────────────────────────────────────────────────────────────
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
function assertLocal(url, label) {
  let host;
  try { host = new URL(url).hostname; } catch { console.error(`REFUSING: ${label} is not a URL: ${url}`); process.exit(2); }
  if (!LOCAL_HOSTS.has(host)) { console.error(`REFUSING: ${label} ${url} is not a local address (127.0.0.1 or localhost only)`); process.exit(2); }
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) { console.error(`Missing ${file}. Run: bash e2e/setup-local.sh`); process.exit(2); }
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const ENV = readEnvFile(path.join(HERE, '.env.local'));
const API = (opt('--api', process.env.E2E_API || 'http://localhost:8011/api/v1')).replace(/\/+$/, '');
const SB = ENV.SUPABASE_URL;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = ENV.SUPABASE_ANON_KEY;
const JWT_SECRET = ENV.SUPABASE_JWT_SECRET;
for (const [label, url] of [['--api', API], ['SUPABASE_URL', SB], ['REDIS_URL', ENV.REDIS_URL || 'redis://127.0.0.1:6380/0'.replace('redis://', 'http://')]]) assertLocal(url.replace(/^redis:\/\//, 'http://'), label);
const DB_CONTAINER = 'supabase_db_margix-e2e';
const REDIS_CONTAINER = 'margix-e2e-redis';
const ONLY = opt('--only', '') ? new Set(opt('--only', '').split(',').map(s => s.trim().toUpperCase())) : null;

// ── Tiny helpers ────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signBackendToken(sub, role) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub, role, aud: 'authenticated', user_metadata: { role }, type: 'access', iss: 'margix-backend', iat: now, exp: now + 6 * 3600 });
  return `${head}.${body}.${crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}

async function http(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers, text };
}

const tokens = {};
const idem = () => crypto.randomUUID();
/** Calls the API as `who` (a key of `tokens`). Mutating calls carry an Idempotency-Key. */
async function call(who, method, p, body, extra = {}) {
  const headers = { ...(tokens[who] ? { authorization: `Bearer ${tokens[who]}` } : {}), ...extra };
  if (method !== 'GET' && !headers['Idempotency-Key']) headers['Idempotency-Key'] = idem();
  return http(`${API}${p}`, { method, headers, body });
}
const get = (who, p) => call(who, 'GET', p);
const post = (who, p, b = {}) => call(who, 'POST', p, b);
const put = (who, p, b = {}) => call(who, 'PUT', p, b);
const patch = (who, p, b = {}) => call(who, 'PATCH', p, b);

/** Service-role PostgREST on the LOCAL database, for seeding and for reading what the API does not show. */
const svcHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, prefer: 'return=representation' };
async function rest(table, { method = 'GET', query = '', body } = {}) {
  const res = await http(`${SB}/rest/v1/${table}${query ? `?${query}` : ''}`, { method, headers: svcHeaders, body });
  if (res.status >= 300) throw new Error(`${method} ${table}${query ? `?${query}` : ''} -> ${res.status} ${res.text.slice(0, 300)}`);
  return res.body;
}
const rows = (table, query) => rest(table, { query });
const one = async (table, query) => (await rows(table, `${query}&limit=1`))[0] ?? null;

function psql(sql) {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql, encoding: 'utf8' });
}

// ── Steps ───────────────────────────────────────────────────────────────────
const results = [];
let currentSection = '';
let skipSection = false;
const ctx = {};

function section(id, title) {
  currentSection = id;
  skipSection = ONLY ? !ONLY.has(id) && id !== 'S' : false;
  console.log(`\n== ${id}. ${title}`);
}

class Check extends Error {}
function ok(cond, message) { if (!cond) throw new Check(message); }
function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Check(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function status(res, expected, what) {
  const list = Array.isArray(expected) ? expected : [expected];
  if (!list.includes(res.status)) throw new Check(`${what}: expected HTTP ${list.join('/')}, got ${res.status} ${res.text.slice(0, 240)}`);
  return res.body;
}

async function step(name, fn) {
  const id = `${currentSection}${results.filter(r => r.section === currentSection).length + 1}`;
  if (skipSection) return;
  try {
    const note = await fn();
    results.push({ id, section: currentSection, name, pass: true, note: typeof note === 'string' ? note : '' });
    console.log(`  PASS ${id.padEnd(4)} ${name}${typeof note === 'string' && note ? `  (${note})` : ''}`);
  } catch (e) {
    const msg = e instanceof Check ? e.message : `${e?.stack ?? e}`.split('\n').slice(0, 3).join(' | ');
    results.push({ id, section: currentSection, name, pass: false, note: msg });
    console.log(`  FAIL ${id.padEnd(4)} ${name}\n       ${msg}`);
  }
}

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const notesOf = async (userId, type) => rows('notifications', `user_id=eq.${userId}${type ? `&type=eq.${type}` : ''}&order=created_at.asc`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PHOTO = (id) => `cargo/${id}/photo_1.jpg`;

// Places (India): a Bhiwandi warehouse sending to three drops in Patna; Delhi for the vendor.
const ORIGIN = { name: 'Bhiwandi warehouse', address: 'Bhiwandi, Thane, Maharashtra', lat: 19.30, lng: 73.06 };
const DROPS = [
  { name: 'Sharma Traders', address: 'Gandhi Maidan, Patna', lat: 25.61, lng: 85.14, consignee_name: 'Sharma Traders', consignee_phone: '9876500001', pieces: 50 },
  { name: 'Gupta Stores', address: 'Boring Road, Patna', lat: 25.62, lng: 85.11, consignee_name: 'Gupta Stores', consignee_phone: '9876500002', pieces: 25 },
  { name: 'Verma Agencies', address: 'Bypass Road, Patna', lat: 25.58, lng: 85.18, consignee_name: 'Verma Agencies', consignee_phone: '9876500003', pieces: 25 },
];

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`E2E against ${API}\nlocal Supabase ${SB}`);
  const health = await http(API.replace(/\/api\/v1$/, '/health')).catch(() => null);
  if (!health || health.status !== 200) { console.error(`The backend is not answering at ${API}. Start it: bash e2e/start-backend.sh`); process.exit(2); }

  // ── S. Seed ────────────────────────────────────────────────────────────────
  section('S', 'Seed');

  await step('Reset the local database and cache', async () => {
    if (!flag('--reset')) return 'skipped (no --reset)';
    psql(`SET client_min_messages = warning; DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', r.tablename); END LOOP; END $$; DELETE FROM auth.users;`);
    execFileSync('docker', ['exec', REDIS_CONTAINER, 'redis-cli', 'FLUSHALL']);
    eq(Number(psql('SELECT count(*) FROM public.users;').trim()), 0, 'users left after reset');
    return 'public tables truncated, auth.users and Redis emptied';
  });

  const accounts = {};
  await step('Create the seven accounts through the local GoTrue admin API', async () => {
    const specs = [
      ['superadmin', 'superadmin', 'Sue Superadmin', '+919900000001'],
      ['manager', 'manager', 'Mona Manager', '+919900000002'],
      ['driverA', 'driver', 'Ravi Driver', '+919900000003'],
      ['driverB', 'driver', 'Sunil Driver', '+919900000004'],
      ['vendor', 'vendor', 'Acme Logistics', '+919900000005'],
      ['customer', 'customer', 'Meera Customer', '+919900000006'],
      ['customer2', 'customer', 'Other Customer', '+919900000007'],
    ];
    for (const [key, role, name, phone] of specs) {
      const email = `e2e-${key.toLowerCase()}@example.test`;
      const res = await http(`${SB}/auth/v1/admin/users`, {
        method: 'POST', headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
        body: { email, password: 'E2e-Local-Pass-1', email_confirm: true, app_metadata: { role }, user_metadata: { full_name: name, phone, role } },
      });
      status(res, [200, 201], `create ${key}`);
      accounts[key] = { id: res.body.id, email, role, name, phone, password: 'E2e-Local-Pass-1' };
    }
    // The signup trigger gives everyone but a vendor the driver role: set the real roles, and give customers
    // their own row instead of a users row (as /customer/verify-otp does).
    for (const key of ['superadmin', 'manager', 'driverA', 'driverB']) {
      await rest('users', { method: 'PATCH', query: `id=eq.${accounts[key].id}`, body: { role: accounts[key].role, phone: accounts[key].phone } });
    }
    for (const key of ['customer', 'customer2']) {
      await rest('users', { method: 'DELETE', query: `id=eq.${accounts[key].id}` });
      await rest('customers', { method: 'POST', body: { id: accounts[key].id, phone: accounts[key].phone, full_name: accounts[key].name } });
    }
    ctx.accounts = accounts;
    fs.writeFileSync(path.join(HERE, 'accounts.json'), JSON.stringify(Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, { id: a.id, email: a.email, role: a.role }])), null, 2));
    eq(Object.keys(accounts).length, 7, 'accounts');
  });

  await step('Sign in the staff through GoTrue; sign driver and customer tokens like /verify-otp does', async () => {
    for (const key of ['superadmin', 'manager', 'vendor']) {
      const a = accounts[key];
      const res = await http(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY }, body: { email: a.email, password: a.password } });
      status(res, 200, `sign in ${key}`);
      tokens[key] = res.body.access_token;
    }
    for (const key of ['driverA', 'driverB']) tokens[key] = signBackendToken(accounts[key].id, 'driver');
    for (const key of ['customer', 'customer2']) tokens[key] = signBackendToken(accounts[key].id, 'customer');
    const today = await get('superadmin', '/ops/today');
    status(today, 200, 'the superadmin token is accepted with a staff role');
    status(await get('manager', '/ops/today'), 200, 'the manager token is accepted');
    status(await get('driverA', '/driver/pay'), 200, 'the driver token is accepted');
    status(await get('customer', '/customer/bookings'), 200, 'the customer token is accepted');
  });

  await step('Seed a depot, two trucks with their drivers, and the approved vendor with Delhi coordinates', async () => {
    const [depot] = await rest('depots', { method: 'POST', body: { id: crypto.randomUUID(), name: 'Chakan hub', address: 'Chakan MIDC, Pune', latitude: 18.76, longitude: 73.86 } });
    ctx.depot = depot;
    const truck = (plate, who, lat, lng) => ({
      id: crypto.randomUUID(), plate_number: plate, vehicle_type: 'truck', status: 'available', capacity_kg: 8000, available_capacity_kg: 8000, current_load_kg: 0,
      driver_id: accounts[who].id, driver_name: accounts[who].name, driver_phone: accounts[who].phone, latitude: lat, longitude: lng,
      cargo_types: ['general'], review_decision: 'approved', reviewed_at: new Date().toISOString(),
    });
    const [t1, t2] = await rest('vehicles', { method: 'POST', body: [truck('MH04E2E0001', 'driverA', 19.31, 73.07), truck('MH04E2E0002', 'driverB', 19.35, 73.1)] });
    ctx.truck1 = t1; ctx.truck2 = t2;
    await rest('vendor_profiles', {
      method: 'POST',
      body: { id: accounts.vendor.id, company_name: 'Acme Logistics', gst_number: '07AAACR5055K1Z7', city: 'Delhi', address: 'Okhla Industrial Area, Delhi', latitude: 28.53, longitude: 77.27, is_verified: true, kyc_status: 'approved' },
    });
    const vendorProfile = await get('vendor', '/vendor/profile');
    status(vendorProfile, 200, 'vendor profile');
    return `${t1.plate_number}, ${t2.plate_number}`;
  });

  await step('Set the driver pay rate for trucks and the company profile', async () => {
    const rate = await post('superadmin', '/driver-pay/rates', { vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10, effective_from: '2026-01-01' });
    status(rate, [200, 201], 'driver pay rate');
    const company = await put('superadmin', '/finance/company', {
      legal_name: 'Margix Logistics Pvt Ltd', gstin: '27AAPFU0939F1ZV', address: 'Plot 4, Bhiwandi', city: 'Thane', state: 'Maharashtra',
      sac_code: '996511', bank_name: 'HDFC Bank', bank_account_no: '50200012345678', bank_ifsc: 'HDFC0000123', payment_terms_days: 15,
    });
    status(company, 200, 'company profile');
  });

  // The other sections are added below.
  await runScenario();

  // ── Report ─────────────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.pass);
  console.log('\n──────── Result ────────');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(4)} ${r.name}`);
  console.log(`\n${results.length - failed.length} of ${results.length} steps passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
  fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}

async function runScenario() {
  const { accounts, truck1, truck2 } = ctx;

  // ── A. Booking ─────────────────────────────────────────────────────────────
  section('A', 'Multi-drop booking');
  await step('The customer gets a quote for the farthest drop', async () => {
    const quote = await post('customer', '/customer/quote', {
      pickup_lat: ORIGIN.lat, pickup_lng: ORIGIN.lng, drop_lat: DROPS[0].lat, drop_lng: DROPS[0].lng, weight_kg: 1000, load_type: 'full', date: today(),
    });
    status(quote, 200, 'quote');
    ctx.quote = quote.body;
  });
  await step('The customer books 100 pieces for three drops (50 / 25 / 25)', async () => {
    const res = await post('customer', '/customer/bookings', {
      pickup_lat: ORIGIN.lat, pickup_lng: ORIGIN.lng, pickup_name: ORIGIN.name, pickup_address: ORIGIN.address,
      drop_lat: DROPS[0].lat, drop_lng: DROPS[0].lng, drop_name: DROPS[0].name, drop_address: DROPS[0].address,
      weight_kg: 1000, load_type: 'full', date: today(), drops: DROPS,
    });
    status(res, 201, 'book');
    ctx.booking = res.body;
    eq(res.body.status, 'requested', 'booking status');
  });
  await step('The new booking shows in the Today counts', async () => {
    const res = await get('superadmin', '/ops/today');
    status(res, 200, 'ops today');
    ok(res.body.queues.requests.bookings >= 1, `requests.bookings is ${res.body.queues.requests.bookings}`);
    return `bookings=${res.body.queues.requests.bookings}`;
  });
  await step('Staff accept it with a price, which creates a master with three lots', async () => {
    const res = await post('superadmin', `/bookings/${ctx.booking.id}/confirm`, { price: 10000 });
    status(res, 200, 'confirm');
    eq(res.body.status, 'confirmed', 'booking status');
    ctx.masterId = res.body.shipment_id;
    const master = await one('shipments', `id=eq.${ctx.masterId}`);
    ok(master.is_master === true, 'the shipment is a master');
    const lots = await rows('shipments', `parent_shipment_id=eq.${ctx.masterId}&order=lot_seq.asc`);
    eq(lots.map(l => l.pieces_total), [50, 25, 25], 'lot pieces');
    eq(lots.map(l => Number(l.freight_share)), [5000, 2500, 2500], 'lot freight shares');
    ctx.lots = { A: lots[0], B: lots[1], C: lots[2] };
  });
  await step('The customer sees the booking confirmed', async () => {
    const res = await get('customer', `/customer/bookings/${ctx.booking.id}`);
    status(res, 200, 'booking');
    eq(res.body.booking.status, 'confirmed', 'status');
  });

  await assignAndTravel();
  await deliverAndBill();
  await vendorAndPermissions();
}

// ── B to E ───────────────────────────────────────────────────────────────────
async function assignAndTravel() {
  const { accounts, truck1, truck2, lots } = ctx;
  const routesOf = (vehicleId, st) => rows('routes', `vehicle_id=eq.${vehicleId}&status=eq.${st}`);

  // ── B. Assign and send ─────────────────────────────────────────────────────
  section('B', 'Assign without sending, then send');
  await step('Assign lots A and B to truck 1 and lot C to truck 2 with dispatch=false', async () => {
    status(await post('superadmin', `/shipments/${lots.A.id}/assign`, { vehicle_id: truck1.id, dispatch: false }), 200, 'assign lot A');
    status(await post('superadmin', `/shipments/${lots.B.id}/assign`, { vehicle_id: truck1.id, dispatch: false }), 200, 'assign lot B');
    status(await post('superadmin', `/shipments/${lots.C.id}/assign`, { vehicle_id: truck2.id, dispatch: false }), 200, 'assign lot C');
    for (const l of ['A', 'B', 'C']) eq((await one('shipments', `id=eq.${lots[l].id}`)).status, 'assigned', `lot ${l} status`);
  });
  await step('The trips are pending and the trucks have not gone on the road', async () => {
    const r1 = await routesOf(truck1.id, 'pending');
    const r2 = await routesOf(truck2.id, 'pending');
    eq([r1.length, r2.length], [1, 1], 'pending trips of truck 1 and truck 2');
    ctx.route1 = r1[0].id; ctx.route2 = r2[0].id;
    for (const t of [truck1, truck2]) ok((await one('vehicles', `id=eq.${t.id}`)).status !== 'on_route', `${t.plate_number} is on the road already`);
    const stops = await rows('route_stops', `route_id=eq.${ctx.route1}`);
    eq(stops.length, 2, 'stops on truck 1 (lots A and B)');
  });
  await step('No driver has been notified of a trip', async () => {
    for (const d of ['driverA', 'driverB']) eq((await notesOf(accounts[d].id, 'route_activated')).length, 0, `${d} route_activated notifications`);
  });
  await step('Today shows the trips waiting to be sent (trips_to_send)', async () => {
    const res = await get('superadmin', '/ops/today');
    status(res, 200, 'ops today');
    ok(res.body.queues.trips_to_send.count >= 1, `trips_to_send is ${res.body.queues.trips_to_send.count}`);
    return `trips_to_send=${res.body.queues.trips_to_send.count}`;
  });
  await step('The booking follows the lots to assigned', async () => {
    eq((await one('customer_bookings', `id=eq.${ctx.booking.id}`)).status, 'assigned', 'booking status');
  });
  await step('Sending the trips activates them and puts the trucks on the road', async () => {
    for (const routeId of [ctx.route1, ctx.route2]) status(await patch('superadmin', `/routes/${routeId}/status`, { status: 'active' }), 200, `send trip ${routeId}`);
    for (const t of [truck1, truck2]) eq((await one('vehicles', `id=eq.${t.id}`)).status, 'on_route', `${t.plate_number} status`);
  });
  await step('Each driver is now notified of their trip', async () => {
    for (const d of ['driverA', 'driverB']) ok((await notesOf(accounts[d].id, 'route_activated')).length >= 1, `${d} has no route_activated notification`);
  });

  // ── C. Pickup ──────────────────────────────────────────────────────────────
  section('C', 'Pickup and departure');
  const pickup = (who, lot, pieces, seal) => post(who, '/cargo/custody', {
    ref: { shipment_id: lot.id }, kind: 'pickup', pieces, condition: 'good', seal_number: seal, photo_paths: [PHOTO(lot.id)], lat: ORIGIN.lat, lng: ORIGIN.lng,
  });
  await step('Driver A accepts the trip', async () => {
    const res = await post('driverA', '/telemetry/driver-ping/accept-route', { route_id: ctx.route1 });
    status(res, 200, 'accept');
    eq(res.body.accepted, 2, 'lots accepted');
  });
  await step('Driver A records the pickup of lots A and B (pieces, good condition, seal)', async () => {
    const a = status(await pickup('driverA', lots.A, 50, 'SEAL-A'), [200, 201], 'pickup lot A');
    const b = status(await pickup('driverA', lots.B, 25, 'SEAL-B'), [200, 201], 'pickup lot B');
    eq([a.status, b.status], ['picked_up', 'picked_up'], 'statuses');
    eq((await one('shipments', `id=eq.${lots.A.id}`)).seal_number, 'SEAL-A', 'seal');
  });
  await step('Driver A departs and both lots are in transit', async () => {
    status(await post('driverA', '/telemetry/driver-ping/start-route', { route_id: ctx.route1 }), 200, 'start');
    for (const l of ['A', 'B']) eq((await one('shipments', `id=eq.${lots[l].id}`)).status, 'in_transit', `lot ${l}`);
  });
  await step('Driver B accepts, picks up lot C and departs', async () => {
    status(await post('driverB', '/telemetry/driver-ping/accept-route', { route_id: ctx.route2 }), 200, 'accept');
    status(await pickup('driverB', lots.C, 25, 'SEAL-C'), [200, 201], 'pickup lot C');
    status(await post('driverB', '/telemetry/driver-ping/start-route', { route_id: ctx.route2 }), 200, 'start');
    eq((await one('shipments', `id=eq.${lots.C.id}`)).status, 'in_transit', 'lot C');
  });
  await step('The master and the customer booking are in transit', async () => {
    eq((await one('shipments', `id=eq.${ctx.masterId}`)).status, 'in_transit', 'master');
    eq((await one('customer_bookings', `id=eq.${ctx.booking.id}`)).status, 'in_transit', 'booking');
  });

  // ── D. Accident ────────────────────────────────────────────────────────────
  section('D', 'Accident on truck 1');
  await step('Driver A raises an accident SOS and marks it serious', async () => {
    const sos = await post('driverA', '/telemetry/sos/trigger', { alert_type: 'accident', lat: 20.5, lng: 75.5, description: 'Truck hit a divider' });
    status(sos, 200, 'sos');
    ctx.sosId = sos.body.id;
    status(await patch('driverA', `/telemetry/sos/${ctx.sosId}/details`, { severity: 'serious' }), 200, 'details');
  });
  await step('Truck 1 goes into maintenance', async () => {
    eq((await one('vehicles', `id=eq.${truck1.id}`)).status, 'maintenance', 'truck 1 status');
  });
  await step('Lots A and B are on hold', async () => {
    for (const l of ['A', 'B']) eq((await one('shipments', `id=eq.${lots[l].id}`)).status, 'on_hold', `lot ${l}`);
    eq((await one('shipments', `id=eq.${lots.C.id}`)).status, 'in_transit', 'lot C is unaffected');
  });
  await step('A vehicle_accident case is open', async () => {
    const c = await one('cargo_exceptions', 'type=eq.vehicle_accident&status=in.(open,investigating,action_planned)');
    ok(c, 'no open vehicle_accident case');
    ctx.accidentCase = c;
  });
  await step('The customer sees a problem notice on the booking, tagged with its lot (fix 2)', async () => {
    const res = await get('customer', `/customer/bookings/${ctx.booking.id}/cargo`);
    status(res, 200, 'cargo view');
    const notice = res.body.exceptions.find(e => e.type === 'vehicle_accident');
    ok(notice, `no accident notice; got ${JSON.stringify(res.body.exceptions)}`);
    ok(/^RTX-/.test(notice.lot_code ?? ''), `notice has no lot code: ${JSON.stringify(notice)}`);
    return `notice for ${notice.lot_code}`;
  });

  // ── E. Transfer ────────────────────────────────────────────────────────────
  section('E', 'Transfer to truck 2 with a short count');
  await step('Staff plan a transshipment to truck 2', async () => {
    const res = await post('superadmin', `/cargo/exceptions/${ctx.accidentCase.id}/actions`, { action: 'transship', to_vehicle_id: truck2.id, meet_lat: 20.51, meet_lng: 75.51, meet_address: 'Highway service road' });
    status(res, 200, 'transship');
    ctx.transfer = res.body.transfer;
    eq(res.body.transfer.status, 'planned', 'transfer status');
    ok((await notesOf(accounts.driverB.id, 'cargo_transfer_planned')).length >= 1, 'driver B was not told about the transfer');
  });
  await step('Driver A hands the goods over (50 and 25 pieces)', async () => {
    const items = [{ ref: { shipment_id: lots.A.id }, pieces_out: 50, condition: 'good' }, { ref: { shipment_id: lots.B.id }, pieces_out: 25, condition: 'good' }];
    const res = await post('driverA', `/cargo/transfers/${ctx.transfer.id}/handover-out`, { items });
    status(res, 200, 'handover out');
    eq(res.body.status, 'in_progress', 'transfer');
  });
  await step('Driver B receives 49 of 50 pieces of lot A and all 25 of lot B', async () => {
    const items = [{ ref: { shipment_id: lots.A.id }, pieces_in: 49, condition: 'good' }, { ref: { shipment_id: lots.B.id }, pieces_in: 25, condition: 'good' }];
    const res = await post('driverB', `/cargo/transfers/${ctx.transfer.id}/handover-in`, { items });
    status(res, 200, 'handover in');
    eq(res.body.status, 'completed', 'transfer');
    ctx.transferDone = res.body;
  });
  await step('A shortage case is open for the missing piece, and the goods are on truck 2', async () => {
    const c = await one('cargo_exceptions', 'type=eq.shortage');
    ok(c, 'no shortage case');
    const a = await one('shipments', `id=eq.${lots.A.id}`);
    eq([a.current_vehicle_id, a.pieces_short, a.status], [truck2.id, 1, 'in_transit'], 'lot A after transfer');
    eq((await one('shipments', `id=eq.${lots.B.id}`)).current_vehicle_id, truck2.id, 'lot B vehicle');
  });
  await step('Driver A is paid for the leg before the handover, once (fix 5)', async () => {
    const entries = await rows('driver_pay_entries', `driver_id=eq.${accounts.driverA.id}`);
    eq(entries.length, 1, 'driver A pay entries');
    eq(entries[0].route_id, ctx.route1, 'the entry is on the first route');
    ok(Number(entries[0].km) > 0, 'no km recorded');
    eq(Number(entries[0].per_trip_amount), 500, 'per trip amount');
    ctx.legEntry = entries[0];
    return `${entries[0].km} km, amount ${entries[0].amount}`;
  });
}

/** The six-digit delivery code is stored only as sha256(shipmentId:code): recover it by trying every code. */
function bruteForceOtp(shipmentId, hash) {
  for (let n = 0; n < 1_000_000; n++) {
    const code = String(n).padStart(6, '0');
    if (crypto.createHash('sha256').update(`${shipmentId}:${code}`).digest('hex') === hash) return code;
  }
  return null;
}

// ── F to I ───────────────────────────────────────────────────────────────────
async function deliverAndBill() {
  const { accounts, truck2, lots } = ctx;
  const deliver = (who, lot, extra = {}) => post(who, '/cargo/custody', {
    ref: { shipment_id: lot.id }, kind: 'delivery', receiver_name: 'Store manager', photo_paths: [PHOTO(lot.id)], lat: DROPS[0].lat, lng: DROPS[0].lng, ...extra,
  });

  // ── F. Delivery ────────────────────────────────────────────────────────────
  section('F', 'Delivery');
  await step('Dispatch sends the delivery code for lot A to the customer', async () => {
    const res = await post('superadmin', '/cargo/otp/send', { ref: { shipment_id: lots.A.id } });
    status(res, [200, 201], 'send otp');
    ok(res.body.notified?.in_app, 'the customer was not notified in the app');
  });
  await step('The code is recovered by brute force from its sha256(shipmentId:otp) hash', async () => {
    const row = await one('shipments', `id=eq.${lots.A.id}`);
    ok(row.delivery_otp_hash, 'no otp hash stored');
    ctx.otpA = bruteForceOtp(lots.A.id, row.delivery_otp_hash);
    ok(ctx.otpA, 'no code matches the hash');
    return 'found';
  });
  await step('Delivering lot A with a wrong code is refused with 400', async () => {
    const wrong = ctx.otpA === '123456' ? '654321' : '123456';
    const res = await deliver('driverB', lots.A, { otp: wrong });
    status(res, 400, 'wrong otp');
    eq((await one('shipments', `id=eq.${lots.A.id}`)).status, 'in_transit', 'lot A is still on the truck');
  });
  await step('Lot A is delivered with the right code (49 pieces, one was short)', async () => {
    const res = await deliver('driverB', lots.A, { otp: ctx.otpA });
    status(res, [200, 201], 'deliver lot A');
    const a = await one('shipments', `id=eq.${lots.A.id}`);
    eq([a.status, a.pieces_delivered, a.pieces_short], ['delivered', 49, 1], 'lot A');
  });
  await step('Lot B is a partial delivery: 23 accepted, 2 short', async () => {
    const res = await post('driverB', '/cargo/custody', {
      ref: { shipment_id: lots.B.id }, kind: 'partial_delivery', pieces: 23, pieces_short: 2, receiver_name: 'Store manager',
      photo_paths: [PHOTO(lots.B.id)], reason: 'Two cartons missing', lat: DROPS[1].lat, lng: DROPS[1].lng,
    });
    status(res, [200, 201], 'partial delivery');
    const b = await one('shipments', `id=eq.${lots.B.id}`);
    eq([b.status, b.pieces_delivered, b.pieces_short], ['partially_delivered', 23, 2], 'lot B');
  });
  await step('While lot C is still on the truck the booking stays in transit (fix 3)', async () => {
    eq((await one('customer_bookings', `id=eq.${ctx.booking.id}`)).status, 'in_transit', 'booking status');
    // The open cases on lots A and B put the master in exception until they are closed; it is never settled
    ok(['in_transit', 'exception'].includes((await one('shipments', `id=eq.${ctx.masterId}`)).status), 'master status is settled while lot C is on the truck');
  });
  await step('Lot C is delivered in full', async () => {
    const row = await one('shipments', `id=eq.${lots.C.id}`);
    let extra = {};
    if (row.delivery_otp_required) {
      status(await post('superadmin', '/cargo/otp/send', { ref: { shipment_id: lots.C.id } }), [200, 201], 'send otp for C');
      extra = { otp: bruteForceOtp(lots.C.id, (await one('shipments', `id=eq.${lots.C.id}`)).delivery_otp_hash) };
    }
    status(await deliver('driverB', lots.C, { lat: DROPS[2].lat, lng: DROPS[2].lng, ...extra }), [200, 201], 'deliver lot C');
    const c = await one('shipments', `id=eq.${lots.C.id}`);
    eq([c.status, c.pieces_delivered], ['delivered', 25], 'lot C');
  });
  await step('The master settles as partially delivered and the booking becomes delivered (fix 3)', async () => {
    eq((await one('shipments', `id=eq.${ctx.masterId}`)).status, 'partially_delivered', 'master status');
    eq((await one('customer_bookings', `id=eq.${ctx.booking.id}`)).status, 'delivered', 'booking status');
  });
  await step('The customer is told the shipment was delivered', async () => {
    const notes = await notesOf(accounts.customer.id);
    ok(notes.some(n => n.title === 'Your shipment was delivered'), `notifications: ${notes.map(n => n.title).join(' | ')}`);
  });

  // ── G. Receipt and claim ───────────────────────────────────────────────────
  section('G', 'Receipt, rating and claim');
  await step('The customer confirms receipt and rates the delivery', async () => {
    const res = await post('customer', `/customer/bookings/${ctx.booking.id}/confirm-receipt`, { rating: 5, comment: 'Careful driver' });
    status(res, 200, 'confirm receipt');
    eq(res.body.rating, 5, 'rating');
  });
  await step('A second rating is refused', async () => {
    status(await post('customer', `/customer/bookings/${ctx.booking.id}/confirm-receipt`, { rating: 4 }), 409, 'second rating');
  });
  await step('The customer raises a shortage claim on lot B', async () => {
    const res = await post('customer', '/cargo/claims', { ref: { shipment_id: lots.B.id }, claim_type: 'shortage', claimed_amount: 1000, notes: 'Two cartons never arrived' });
    status(res, [200, 201], 'claim');
    ctx.claim = res.body.claim ?? res.body;
    ok(ctx.claim.id, 'the claim has no id');
    return ctx.claim.status;
  });
  await step('Staff approve the claim', async () => {
    let claim = ctx.claim;
    if (claim.status === 'draft') claim = status(await patch('superadmin', `/cargo/claims/${claim.id}`, { status: 'filed' }), 200, 'file claim');
    const res = await patch('superadmin', `/cargo/claims/${ctx.claim.id}`, { status: 'approved', approved_amount: 800 });
    status(res, 200, 'approve claim');
    eq((await one('cargo_claims', `id=eq.${ctx.claim.id}`)).status, 'approved', 'claim status');
  });
  await step('The customer sees the claim in their cargo view', async () => {
    const res = await get('customer', `/customer/bookings/${ctx.booking.id}/cargo`);
    status(res, 200, 'cargo view');
    ok(JSON.stringify(res.body.claims).includes(ctx.claim.id), `claims: ${JSON.stringify(res.body.claims).slice(0, 200)}`);
  });
  await step('The other customer cannot open this booking or its cargo', async () => {
    status(await get('customer2', `/customer/bookings/${ctx.booking.id}`), 404, 'booking');
    status(await get('customer2', `/customer/bookings/${ctx.booking.id}/cargo`), 404, 'cargo');
    status(await post('customer2', '/cargo/claims', { ref: { shipment_id: lots.A.id }, claim_type: 'damage', notes: 'not mine' }), 404, 'claim');
  });

  // ── H. Invoices ────────────────────────────────────────────────────────────
  section('H', 'Invoices');
  const invoiceOf = (id) => one('invoices', `shipment_id=eq.${id}&status=neq.void`);
  await step('There is one invoice per lot for its freight share (5000, 2500, 2500)', async () => {
    const list = [await invoiceOf(lots.A.id), await invoiceOf(lots.B.id), await invoiceOf(lots.C.id)];
    ok(list.every(Boolean), `missing invoices: ${list.map(i => i?.invoice_number ?? 'none').join(', ')}`);
    eq(list.map(i => Number(i.amount)), [5000, 2500, 2500], 'amounts');
    ctx.invoices = { A: list[0], B: list[1], C: list[2] };
  });
  await step('The partial lot B is invoiced too, with the short pieces in the notes (fix 4)', async () => {
    ok(/23 of 25 pieces delivered, 2 short/.test(ctx.invoices.B.notes ?? ''), `notes: ${ctx.invoices.B.notes}`);
  });
  await step('The master has no invoice, and nothing is invoiced twice', async () => {
    eq((await rows('invoices', `shipment_id=eq.${ctx.masterId}`)).length, 0, 'master invoices');
    eq((await rows('invoices', 'status=neq.void')).length, 3, 'invoices in all');
  });
  await step('The customer lists their three invoices', async () => {
    const res = await get('customer', '/customer/invoices');
    status(res, 200, 'customer invoices');
    const list = Array.isArray(res.body) ? res.body : res.body.invoices;
    eq(list.length, 3, 'invoices listed');
  });
  await step('The invoice PDF is available to its owner', async () => {
    const res = await get('customer', `/invoices/${ctx.invoices.A.id}/pdf`);
    status(res, 200, 'pdf');
    ok(res.headers.get('content-type')?.includes('application/pdf'), `content-type ${res.headers.get('content-type')}`);
    ok(res.text.startsWith('%PDF'), 'the body is not a PDF');
  });
  await step('The invoice PDF is refused to another customer and to the vendor', async () => {
    status(await get('customer2', `/invoices/${ctx.invoices.A.id}/pdf`), [403, 404], 'other customer');
    status(await get('vendor', `/invoices/${ctx.invoices.A.id}/pdf`), [403, 404], 'vendor');
  });
  await step('Staff mark invoice A paid', async () => {
    const res = await put('superadmin', `/finance/invoices/${ctx.invoices.A.id}/pay`, { method: 'upi', reference: 'UPI-E2E-0001' });
    status(res, 200, 'pay');
    eq(res.body.status, 'paid', 'invoice status');
  });
  await step('The customer is told the invoice was paid (invoice_paid)', async () => {
    const notes = await notesOf(accounts.customer.id, 'invoice_paid');
    eq(notes.length, 1, 'invoice_paid notifications');
  });
  await step('The customer sees invoice A as paid and the other two as issued', async () => {
    const res = await get('customer', '/customer/invoices');
    const list = Array.isArray(res.body) ? res.body : res.body.invoices;
    eq(list.filter(i => i.status === 'paid').length, 1, 'paid');
    eq(list.filter(i => i.status === 'issued').length, 2, 'issued');
  });

  // ── I. Driver pay ──────────────────────────────────────────────────────────
  section('I', 'Driver pay');
  await step('Driver A has exactly one pay entry, for the leg before the transfer (fix 5)', async () => {
    const entries = await rows('driver_pay_entries', `driver_id=eq.${accounts.driverA.id}`);
    eq(entries.length, 1, 'driver A entries');
    eq(entries[0].id, ctx.legEntry.id, 'the same entry as at the transfer');
    eq(entries[0].route_id, ctx.route1, 'route');
  });
  await step('Driver B has one entry for their trip', async () => {
    let entries = await rows('driver_pay_entries', `driver_id=eq.${accounts.driverB.id}`);
    if (entries.length === 0) {
      // The trip closes once every stop is done; if dispatch has to close it, do so
      const open = await rows('routes', `vehicle_id=eq.${truck2.id}&status=eq.active`);
      for (const r of open) status(await patch('superadmin', `/routes/${r.id}/status`, { status: 'completed' }), 200, 'complete the trip');
      entries = await rows('driver_pay_entries', `driver_id=eq.${accounts.driverB.id}`);
    }
    eq(entries.length, 1, 'driver B entries');
    ctx.entryB = entries[0];
    return `${entries[0].km} km, amount ${entries[0].amount}`;
  });
  await step('Staff approve both entries', async () => {
    const entryA = await one('driver_pay_entries', `driver_id=eq.${accounts.driverA.id}`);
    const res = await post('superadmin', '/driver-pay/entries/approve', { ids: [entryA.id, ctx.entryB.id] });
    status(res, 200, 'approve');
    eq(res.body.approved.length, 2, 'approved');
  });
  await step('Staff pay both drivers out', async () => {
    for (const d of ['driverA', 'driverB']) {
      const entry = await one('driver_pay_entries', `driver_id=eq.${accounts[d].id}`);
      status(await post('superadmin', '/driver-pay/payouts', { driver_id: accounts[d].id, entry_ids: [entry.id], method: 'upi', reference: `PAY-${d}` }), [200, 201], `payout ${d}`);
      eq((await one('driver_pay_entries', `id=eq.${entry.id}`)).status, 'paid', `${d} entry`);
    }
  });
  await step('/driver/pay shows each driver their totals', async () => {
    for (const d of ['driverA', 'driverB']) {
      const entry = await one('driver_pay_entries', `driver_id=eq.${accounts[d].id}`);
      const res = await get(d, '/driver/pay');
      status(res, 200, `${d} pay`);
      const text = JSON.stringify(res.body);
      ok(text.includes(String(Number(entry.amount))) || text.includes(Number(entry.amount).toFixed(2)), `${d}: ${Number(entry.amount)} not found in ${text.slice(0, 300)}`);
    }
  });
}

// ── J to L ───────────────────────────────────────────────────────────────────
async function vendorAndPermissions() {
  const { accounts, truck2 } = ctx;

  // ── J. Vendor load ─────────────────────────────────────────────────────────
  section('J', 'Vendor load');
  await step('The vendor posts a load from Delhi to Jaipur', async () => {
    const res = await post('vendor', '/vendor/shipment-request', {
      pickup: { address: 'Okhla, Delhi', lat: 28.53, lng: 77.27 }, drop: { address: 'Sitapura, Jaipur', lat: 26.79, lng: 75.82 }, capacity: 2000,
      metadata: { cargo: { gstRate: '18', declaredValue: '250000', description: 'Auto parts' } },
    });
    status(res, [200, 201], 'post load');
    ctx.request = res.body;
    eq(res.body.status, 'pending', 'request status');
  });
  await step('Assigning a vehicle before the load is accepted gets a 409', async () => {
    status(await put('superadmin', `/vendor/shipment-request/${ctx.request.id}/assign-vehicle`, { vehicle_id: truck2.id }), 409, 'assign before accept');
  });
  await step('Staff accept it at a price, then assign truck 2 (which is sent at once)', async () => {
    status(await put('superadmin', `/vendor/shipment-request/${ctx.request.id}/approve`, { cost: 20000 }), 200, 'accept');
    status(await put('superadmin', `/vendor/shipment-request/${ctx.request.id}/assign-vehicle`, { vehicle_id: truck2.id }), 200, 'assign');
    ok((await notesOf(accounts.driverB.id, 'cargo_assigned')).length >= 1, 'the driver was not told about the load');
    ctx.manifest = await one('cargo_manifest', `vendor_request_id=eq.${ctx.request.id}`);
    ok(ctx.manifest, 'no manifest was made');
  });
  await step('Driver B picks the load up and delivers it', async () => {
    const ref = { manifest_id: ctx.manifest.id };
    status(await post('driverB', '/cargo/custody', { ref, kind: 'pickup', pieces: 10, condition: 'good', photo_paths: [`cargo/${ctx.manifest.id}/photo_1.jpg`], lat: 28.53, lng: 77.27 }), [200, 201], 'pickup');
    status(await post('driverB', '/cargo/custody', { ref, kind: 'departed' }), [200, 201], 'depart');
    status(await post('driverB', '/cargo/custody', { ref, kind: 'delivery', receiver_name: 'Jaipur warehouse', photo_paths: [`cargo/${ctx.manifest.id}/photo_2.jpg`], lat: 26.79, lng: 75.82 }), [200, 201], 'delivery');
    eq((await one('cargo_manifest', `id=eq.${ctx.manifest.id}`)).status, 'delivered', 'manifest status');
  });
  await step('The vendor sees the load delivered on their loads board', async () => {
    const res = await get('vendor', '/vendor/loads');
    status(res, 200, 'loads');
    const list = Array.isArray(res.body) ? res.body : res.body.loads;
    const load = list.find(l => JSON.stringify(l).includes(ctx.request.id));
    ok(load, `load not found in ${JSON.stringify(list).slice(0, 300)}`);
    ok(['delivered', 'closed'].includes(load.stage), `stage is ${load.stage}`);
  });
  await step('The vendor has an invoice for the agreed price, with GST', async () => {
    const res = await get('vendor', '/vendor/invoices');
    status(res, 200, 'vendor invoices');
    const inv = res.body.find(i => i.vendor_request_id === ctx.request.id || i.manifest_id === ctx.manifest.id);
    ok(inv, `no invoice in ${JSON.stringify(res.body).slice(0, 300)}`);
    eq([Number(inv.amount), Number(inv.gst_rate), Number(inv.total)], [20000, 18, 23600], 'amount, GST rate and total');
  });
  await step('The vendor can read the payment details to pay against the invoice', async () => {
    const res = await get('vendor', '/invoices/payment-details');
    status(res, 200, 'payment details');
    ok(JSON.stringify(res.body).includes('HDFC'), `payment details: ${JSON.stringify(res.body).slice(0, 200)}`);
  });

  // ── K. Return trip ─────────────────────────────────────────────────────────
  section('K', 'Return trip');
  await step('Truck 2 heads back through Delhi and dispatch opens a return trip for it', async () => {
    await rest('vehicles', { method: 'PATCH', query: `id=eq.${truck2.id}`, body: { latitude: 28.6, longitude: 77.2, status: 'available', available_capacity_kg: 6000, current_location_name: 'Delhi' } });
    // Staff open it with a minimum bid. (A driver-opened window has no floor price, and capacity_windows.floor_price is NOT NULL.)
    const res = await post('superadmin', '/capacity/driver/open-backhaul-window', { vehicle_id: truck2.id, available_capacity_kg: 5000, trigger_type: 'return_trip', floor_price: 5000 });
    status(res, [200, 201], 'open return trip');
    ctx.window = res.body;
    ok(ctx.window.id, 'the window has no id');
  });
  await step('The vendor is told (return_trip_opened)', async () => {
    // Vendors are told in the background after the window opens: wait for it
    let notes = [];
    for (let i = 0; i < 20 && notes.length === 0; i++) { notes = await notesOf(accounts.vendor.id, 'return_trip_opened'); if (notes.length === 0) await sleep(500); }
    ok(notes.length >= 1, 'no return_trip_opened notification');
  });
  await step('The vendor bids on the return trip', async () => {
    const res = await post('vendor', '/capacity/bids', {
      window_id: ctx.window.id, bid_amount: 9000, weight_kg: 1500, dropoff_name: 'Gurgaon depot', dropoff_address: 'Sector 18, Gurgaon', dropoff_lat: 28.47, dropoff_lng: 77.03,
    });
    status(res, [200, 201], 'bid');
    ctx.bid = res.body;
    ok(ctx.bid.id, 'the bid has no id');
  });
  await step('Staff award the bid', async () => {
    status(await post('superadmin', `/capacity/bids/${ctx.bid.id}/approve`, {}), 200, 'approve bid');
    eq((await one('capacity_bids', `id=eq.${ctx.bid.id}`)).status, 'won', 'bid status');
  });

  // ── L. Permissions ─────────────────────────────────────────────────────────
  section('L', 'Permissions');
  await step('The manager is refused Money (403)', async () => {
    status(await get('manager', '/finance/summary'), 403, 'finance summary');
    status(await get('manager', '/finance/invoices'), 403, 'finance invoices');
    status(await get('manager', '/driver-pay/entries'), 403, 'driver pay entries');
  });
  await step("A driver cannot read another driver's pay", async () => {
    status(await get('driverB', `/driver-pay/entries?driver_id=${accounts.driverA.id}`), 403, 'staff pay list');
    status(await get('driverB', `/driver-pay/payouts?driver_id=${accounts.driverA.id}`), 403, 'payouts');
    const mine = await get('driverB', '/driver/pay');
    ok(!JSON.stringify(mine.body).includes(accounts.driverA.id), "driver B's pay view leaks driver A");
  });
  await step("A customer cannot read another customer's invoice", async () => {
    const inv = ctx.invoices.B;
    status(await get('customer2', `/invoices/${inv.id}/pdf`), [403, 404], 'pdf');
    status(await get('customer2', `/invoices/${inv.id}`), 403, 'detail');
    const mine = await get('customer2', '/customer/invoices');
    const list = Array.isArray(mine.body) ? mine.body : mine.body.invoices;
    eq(list.length, 0, "customer2's invoices");
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
