import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const VEHICLE = '66666666-6666-6666-6666-666666666666';
const OTHER = '88888888-8888-8888-8888-888888888888';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });
const admin = bearer('admin-1');
const driver = bearer('drv-own');
const BILL = 'expenses/3f2b8a3e-1111-4222-8333-444455556666/fuel_bill_aaaa.jpg';
const url = (id = VEHICLE) => `/api/v1/fleet/vehicles/${id}/fuel-logs`;

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const post = (body: Record<string, unknown>, who = admin, id = VEHICLE) => request(app).post(url(id)).set(who).send(body);

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'drv-own', role: 'driver', is_active: true },
      { id: 'drv-other', role: 'driver', is_active: true },
    ],
    vehicles: [
      { id: VEHICLE, plate_number: 'MH12AB1234', status: 'idle', odometer_km: 10000, fuel_capacity_liters: 100, fuel_efficiency_kmpl: 4, current_fuel_liters: 10, driver_id: 'drv-own' },
      { id: OTHER, plate_number: 'MH12ZZ0001', status: 'idle', odometer_km: 500, driver_id: 'drv-other' },
    ],
    vehicle_fuel_logs: [],
    expenses: [],
    gps_points: [],
    ai_agent_logs: [],
  });
});

describe('logging a fill-up', () => {
  it('works out the total from litres and price, prefills the odometer and records a fuel expense', async () => {
    const res = await post({ litres: 40, price_per_litre: 95.5, station_name: 'HP Pump, Vashi' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      litres: 40, price_per_litre: 95.5, total_amount: 3820, odometer_km: 10000, is_full_tank: true, payment_mode: 'cash',
      bill_status: 'no_bill', bill_path: null, logged_by: 'admin-1', logged_by_role: 'admin', expense_recorded: true,
    });
    expect(res.body.flags).toEqual(['no_bill']);
    const [expense] = supabaseMock.rows('expenses');
    expect(expense).toMatchObject({ vehicle_id: VEHICLE, category: 'fuel', amount: 3820, litres: 40, note: 'Fuel at HP Pump, Vashi' });
    expect(supabaseMock.rows('vehicle_fuel_logs')[0].expense_id).toBe(expense.id);
  });

  it('derives litres from price and total, and rejects figures that disagree or too few', async () => {
    const res = await post({ price_per_litre: 100, total_amount: 2500, odometer_km: 10100 });
    expect(res.body).toMatchObject({ litres: 25, total_amount: 2500 });
    expect((await post({ litres: 40, price_per_litre: 95, total_amount: 9000 })).status).toBe(400);
    expect((await post({ litres: 40 })).status).toBe(400);
    expect((await post({ litres: -3, price_per_litre: 90 })).status).toBe(400);
  });

  it('with a bill: attaches it and marks the entry verified with bill', async () => {
    const res = await post({ litres: 40, total_amount: 4000, bill_path: BILL });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ bill_status: 'with_bill', bill_path: BILL });
    expect(res.body.flags).not.toContain('no_bill');
    expect(supabaseMock.rows('expenses')[0].receipt_path).toBe(BILL);
    const link = await request(app).get(`/api/v1/fleet/fuel-logs/${res.body.id}/bill-url`).set(admin);
    expect(link.status).toBe(200);
    expect(link.body.url).toContain(BILL);
    expect(supabaseMock.signedReads.some(p => p.endsWith(BILL))).toBe(true);
  });

  it('without a bill: allowed, flagged no bill, and 404 for the bill link', async () => {
    const res = await post({ litres: 40, total_amount: 4000 });
    expect(res.body.bill_status).toBe('no_bill');
    expect(res.body.flags).toContain('no_bill');
    expect((await request(app).get(`/api/v1/fleet/fuel-logs/${res.body.id}/bill-url`).set(admin)).status).toBe(404);
  });

  it('rejects a bill path that is not an upload folder path, a future date and a vehicle that does not exist', async () => {
    expect((await post({ litres: 40, total_amount: 4000, bill_path: '../../secret' })).status).toBe(400);
    expect((await post({ litres: 40, total_amount: 4000, filled_at: '2999-01-01T00:00:00Z' })).status).toBe(400);
    expect((await post({ litres: 40, total_amount: 4000 }, admin, '99999999-9999-9999-9999-999999999999')).status).toBe(404);
  });

  it('keeps the fill on the log alone when the expense cannot be written', async () => {
    supabaseMock.fail('expenses', 'relation "expenses" does not exist');
    const res = await post({ litres: 40, total_amount: 4000 });
    expect(res.status).toBe(201);
    expect(res.body.expense_recorded).toBe(false);
    expect(supabaseMock.rows('vehicle_fuel_logs')[0].expense_id ?? null).toBeNull();
  });

  it('issues a signed upload URL for a bill and refuses other file types', async () => {
    const ok = await request(app).post(`${url()}/bill-upload`).set(admin).send({ content_type: 'image/jpeg', size: 200_000 });
    expect(ok.status).toBe(200);
    expect(ok.body.path).toMatch(/^expenses\/[\w-]+\/fuel_bill_[\w-]+\.jpg$/);
    expect(supabaseMock.signedUploads.some(p => p.endsWith(ok.body.path))).toBe(true);
    expect((await request(app).post(`${url()}/bill-upload`).set(admin).send({ content_type: 'text/html', size: 10 })).status).toBe(415);
    expect((await request(app).post(`${url()}/bill-upload`).set(admin).send({ content_type: 'image/png', size: 999_999_999 })).status).toBe(413);
  });
});

describe('mileage and the vehicle record', () => {
  const fills = [
    { litres: 50, total_amount: 5000, odometer_km: 10000, filled_at: daysAgo(20) },
    { litres: 20, total_amount: 2000, odometer_km: 10200, is_full_tank: false, filled_at: daysAgo(15) },
    { litres: 20, total_amount: 2000, odometer_km: 10400, filled_at: daysAgo(10) },
  ];

  it('works out mileage over partial fills and keeps the vehicle up to date', async () => {
    for (const f of fills) expect((await post({ ...f, bill_path: BILL })).status).toBe(201);
    const list = await request(app).get(url()).set(admin);
    expect(list.body.map((l: any) => l.mileage_kmpl)).toEqual([10, null, null]); // newest first
    expect(list.body[0]).toMatchObject({ distance_km: 400, litres_used: 40 });
    const vehicle = supabaseMock.rows('vehicles')[0];
    expect(vehicle.fuel_efficiency_kmpl).toBe(10);
    expect(vehicle.current_fuel_liters).toBe(100); // full fill: tank capacity
  });

  it('leaves the litres in the tank alone after a partial fill', async () => {
    await post({ litres: 20, total_amount: 2000, odometer_km: 10000, is_full_tank: false });
    expect(supabaseMock.rows('vehicles')[0].current_fuel_liters).toBe(10);
  });

  it('gives the vehicle stats', async () => {
    for (const f of fills) await post({ ...f, bill_path: BILL });
    const res = await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/fuel-stats`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fills: 3, rolling_avg_kmpl: 10, last_kmpl: 10, cost_per_km: 10, no_bill_fills: 0, tank_capacity_liters: 100, fuel_efficiency_kmpl: 10 });
    expect(res.body.trend).toHaveLength(1);
    expect(res.body.month_spend).toBeGreaterThanOrEqual(0);
  });

  it('recalculates when an entry is corrected or deleted', async () => {
    const ids: string[] = [];
    for (const f of [fills[0], { ...fills[2], litres: 40, total_amount: 4000 }]) ids.push((await post({ ...f, bill_path: BILL })).body.id);
    expect(supabaseMock.rows('vehicles')[0].fuel_efficiency_kmpl).toBe(10);

    const edit = await request(app).put(`/api/v1/fleet/fuel-logs/${ids[1]}`).set(admin).send({ litres: 20 });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ litres: 20, total_amount: 2000, price_per_litre: 100 }); // one changed figure: price kept
    expect(edit.body.mileage_kmpl).toBe(20);
    expect(supabaseMock.rows('vehicles')[0].fuel_efficiency_kmpl).toBe(20);
    expect(supabaseMock.rows('expenses').find(e => e.id === edit.body.expense_id)).toMatchObject({ amount: 2000, litres: 20 });

    const del = await request(app).delete(`/api/v1/fleet/fuel-logs/${ids[1]}`).set(admin);
    expect(del.status).toBe(204);
    expect(supabaseMock.rows('vehicle_fuel_logs')).toHaveLength(1);
    expect(supabaseMock.rows('expenses')).toHaveLength(1);
    expect(supabaseMock.rows('vehicle_fuel_logs')[0].mileage_kmpl ?? null).toBeNull();
  });

  it('a staff reading above the vehicle odometer raises it; a driver reading does not', async () => {
    await post({ litres: 30, total_amount: 3000, odometer_km: 10500 });
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBe(10500);
    await post({ litres: 31, total_amount: 3100, odometer_km: 11000, filled_at: daysAgo(0) }, driver);
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBe(10500);
  });
});

describe('anomalies', () => {
  it('stores flags on the entries and lists them, with review', async () => {
    const good = [
      { litres: 50, total_amount: 5000, odometer_km: 10000, filled_at: daysAgo(30) },
      { litres: 40, total_amount: 4000, odometer_km: 10400, filled_at: daysAgo(25) },
      { litres: 40, total_amount: 4000, odometer_km: 10800, filled_at: daysAgo(20) },
      { litres: 40, total_amount: 4000, odometer_km: 11200, filled_at: daysAgo(15) },
    ];
    for (const f of good) await post({ ...f, bill_path: BILL });
    const slow = await post({ litres: 40, total_amount: 4000, odometer_km: 11500, filled_at: daysAgo(10), bill_path: BILL }); // 7.5 -> 300 km on 40 L
    expect(slow.body.flags).not.toContain('low_mileage');
    const slower = await post({ litres: 45, total_amount: 4500, odometer_km: 11750, filled_at: daysAgo(6), bill_path: BILL }); // 250 km on 45 L = 5.6
    expect(slower.body.flags).toContain('low_mileage');
    // A reading below the fill before it is refused on entry (ROL-06); the engine still flags such rows already stored
    const backwards = await post({ litres: 30, total_amount: 3000, odometer_km: 9000, filled_at: daysAgo(3), bill_path: BILL });
    expect(backwards.status).toBe(422);
    // The answer names the field and groups the km the way the table does
    expect(backwards.body.field).toBe('odometer_km');
    expect(backwards.body.detail).toMatch(/reads 9,000 km, but the fill before this one was at 11,750 km/);
    const tooMuch = await post({ litres: 130, total_amount: 13000, odometer_km: 12000, filled_at: daysAgo(2), bill_path: BILL });
    expect(tooMuch.body.flags).toContain('over_tank_capacity');
    const dup = await post({ litres: 130.2, total_amount: 13020, odometer_km: 12000, filled_at: new Date(Date.parse(tooMuch.body.filled_at) + 10 * 60_000).toISOString(), bill_path: BILL });
    expect(dup.body.flags).toContain('duplicate');
    const noBill = await post({ litres: 20, total_amount: 2000, odometer_km: 12100, filled_at: daysAgo(1), is_full_tank: false });

    const all = await request(app).get('/api/v1/fleet/fuel-anomalies').set(admin);
    expect(all.status).toBe(200);
    expect(all.body.every((r: any) => r.plate_number === 'MH12AB1234')).toBe(true);
    const ids = all.body.map((r: any) => r.id);
    expect(ids).toEqual(expect.arrayContaining([slower.body.id, tooMuch.body.id, dup.body.id, noBill.body.id]));
    expect(ids).not.toContain(slow.body.id);

    const onlyNoBill = await request(app).get('/api/v1/fleet/fuel-anomalies?type=no_bill').set(admin);
    expect(onlyNoBill.body.map((r: any) => r.id)).toEqual([noBill.body.id]);
    expect((await request(app).get('/api/v1/fleet/fuel-anomalies?type=nonsense').set(admin)).status).toBe(400);

    const reviewed = await request(app).put(`/api/v1/fleet/fuel-logs/${noBill.body.id}`).set(admin).send({ reviewed: true });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body).toMatchObject({ reviewed_by: 'admin-1' });
    expect(reviewed.body.reviewed_at).toBeTruthy();
    expect((await request(app).get('/api/v1/fleet/fuel-anomalies?type=no_bill').set(admin)).body).toEqual([]);
    expect((await request(app).get('/api/v1/fleet/fuel-anomalies?type=no_bill&reviewed=true').set(admin)).body).toHaveLength(1);
  });

  it('flags a fill far from the vehicle GPS position at that time', async () => {
    const at = daysAgo(1);
    supabaseMock.rows('gps_points').push({ id: 'g1', vehicle_id: VEHICLE, latitude: 19.08, longitude: 72.88, recorded_at: at });
    const near = await post({ litres: 30, total_amount: 3000, filled_at: at, fill_latitude: 19.076, fill_longitude: 72.8777 });
    expect(near.body.flags).not.toContain('far_from_gps');
    const far = await post({ litres: 31, total_amount: 3100, filled_at: at, fill_latitude: 18.5204, fill_longitude: 73.8567 });
    expect(far.body.flags).toContain('far_from_gps');
    expect((await post({ litres: 31, total_amount: 3100, fill_latitude: 18.5 })).status).toBe(400); // both coordinates or none
  });
});

describe('fleet summary', () => {
  it('ranks vehicles by rolling mileage and totals the month', async () => {
    const run = async (vehicle: string, kmpl: number) => {
      await post({ litres: 50, total_amount: 5000, odometer_km: 1000, filled_at: daysAgo(10), bill_path: BILL }, admin, vehicle);
      await post({ litres: 40, total_amount: 4000, odometer_km: 1000 + 40 * kmpl, filled_at: daysAgo(5), bill_path: BILL }, admin, vehicle);
    };
    await run(VEHICLE, 10);
    await run(OTHER, 6);
    const res = await request(app).get('/api/v1/fleet/fuel-summary').set(admin);
    expect(res.status).toBe(200);
    expect(res.body.best.map((v: any) => v.plate_number)).toEqual(['MH12AB1234']);
    expect(res.body.worst.map((v: any) => v.plate_number)).toEqual(['MH12ZZ0001']);
    expect(res.body).toMatchObject({ vehicles_with_logs: 2, vehicles_with_mileage: 2, fleet_avg_kmpl: 8, anomalies_to_review: 0, no_bill_to_review: 0 });
    expect(res.body.vehicles).toHaveLength(2);
  });
});

describe('permissions', () => {
  it('lets a driver log and read fuel for their own vehicle', async () => {
    const res = await post({ litres: 40, total_amount: 4000, station_name: 'IOC' }, driver);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ logged_by: 'drv-own', logged_by_role: 'driver' });
    expect((await request(app).get(url()).set(driver)).body).toHaveLength(1);
    expect((await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/fuel-stats`).set(driver)).status).toBe(200);
    expect((await request(app).post(`${url()}/bill-upload`).set(driver).send({ content_type: 'image/png', size: 1000 })).status).toBe(200);
    expect((await request(app).get(`/api/v1/fleet/fuel-logs/${res.body.id}/bill-url`).set(driver)).status).toBe(404); // no bill, but allowed to ask
  });

  it("keeps a driver out of another driver's vehicle", async () => {
    expect((await post({ litres: 40, total_amount: 4000 }, driver, OTHER)).status).toBe(403);
    expect((await request(app).get(url(OTHER)).set(driver)).status).toBe(403);
    expect((await request(app).get(`/api/v1/fleet/vehicles/${OTHER}/fuel-stats`).set(driver)).status).toBe(403);
    expect((await post({ litres: 40, total_amount: 4000 }, bearer('drv-other'))).status).toBe(403);
  });

  it('applies a fill the phone resends with the same idempotency key once', async () => {
    supabaseMock.reset({ ...{}, users: [{ id: 'drv-own', role: 'driver', is_active: true }], vehicles: [{ id: VEHICLE, plate_number: 'MH12AB1234', status: 'idle', driver_id: 'drv-own' }], vehicle_fuel_logs: [], expenses: [], idempotency_keys: [] });
    const send = () => request(app).post(url()).set(driver).set('Idempotency-Key', 'fuel-key-12345').send({ litres: 40, total_amount: 4000 });
    const first = await send();
    const again = await send();
    expect(first.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(supabaseMock.rows('vehicle_fuel_logs')).toHaveLength(1);
  });

  it('lets a driver enter a fill from the last week only', async () => {
    expect((await post({ litres: 40, total_amount: 4000, filled_at: daysAgo(3) }, driver)).status).toBe(201);
    expect((await post({ litres: 41, total_amount: 4100, filled_at: daysAgo(30) }, driver)).status).toBe(400);
  });

  it('keeps edit, delete, the fleet summary and the anomaly list for staff', async () => {
    const made = await post({ litres: 40, total_amount: 4000 }, driver);
    const id = made.body.id;
    expect((await request(app).put(`/api/v1/fleet/fuel-logs/${id}`).set(driver).send({ reviewed: true })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/fleet/fuel-logs/${id}`).set(driver)).status).toBe(403);
    expect((await request(app).get('/api/v1/fleet/fuel-summary').set(driver)).status).toBe(403);
    expect((await request(app).get('/api/v1/fleet/fuel-anomalies').set(driver)).status).toBe(403);
    // a driver who is not on the vehicle gets the answer for an entry that does not exist, never a 403 that says it does
    expect((await request(app).get(`/api/v1/fleet/fuel-logs/${id}/bill-url`).set(bearer('drv-other'))).status).toBe(404);
    expect((await request(app).get(url())).status).toBe(401);
    expect((await request(app).put(`/api/v1/fleet/fuel-logs/${id}`).set(admin).send({})).status).toBe(400);
    expect((await request(app).put('/api/v1/fleet/fuel-logs/00000000-0000-0000-0000-000000000000').set(admin).send({ reviewed: true })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/fleet/fuel-logs/${id}`).set(admin)).status).toBe(204);
    expect(supabaseMock.rows('ai_agent_logs')[0]).toMatchObject({ action: 'fuel_log_deleted' });
  });
});

describe('a mistyped odometer reading (ROL-06)', () => {
  const fill = (odometer_km: number, daysBack: number, litres = 40) => post({ litres, total_amount: litres * 100, odometer_km, filled_at: daysAgo(daysBack), bill_path: BILL });

  it('refuses a reading that jumps too far or goes backwards with a 422, and later fills still work', async () => {
    expect((await fill(10000, 10)).status).toBe(201);
    const typo = await fill(910000, 8);
    expect(typo.status).toBe(422);
    expect(typo.body.detail).toMatch(/Check the reading/);
    expect((await fill(9000, 8)).status).toBe(422);
    expect(supabaseMock.rows('vehicle_fuel_logs')).toHaveLength(1);
    const next = await fill(10700, 6);
    expect(next.status).toBe(201);
    expect(next.body.mileage_kmpl).toBe(17.5);
  });

  it('never fails later fills when a bad reading is already stored: it is flagged and left out of the averages', async () => {
    await fill(10000, 10);
    // A row that got in before the check: a typo for 10100
    supabaseMock.rows('vehicle_fuel_logs').push({
      id: 'bad-row', vehicle_id: VEHICLE, filled_at: daysAgo(8), litres: 40, price_per_litre: 100, total_amount: 4000, odometer_km: 910000,
      is_full_tank: true, payment_mode: 'cash', bill_status: 'no_bill', flags: [], created_at: daysAgo(8), updated_at: daysAgo(8),
    });
    const next = await fill(10700, 6);
    expect(next.status).toBe(201);
    expect(next.body.mileage_kmpl).toBeLessThan(100);
    const bad = supabaseMock.rows('vehicle_fuel_logs').find(r => r.id === 'bad-row')!;
    expect(bad.flags).toContain('odometer_jump');
    expect(bad.mileage_kmpl ?? null).toBeNull();
    expect((await fill(11300, 3)).status).toBe(201);
    const stats = await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/fuel-stats`).set(admin);
    expect(stats.status).toBe(200);
    expect(stats.body.rolling_avg_kmpl).toBeLessThan(100);
  });

  it('lets staff correct a bad reading and checks the correction too', async () => {
    await fill(10000, 10);
    const second = await fill(10400, 6);
    expect((await request(app).put(`/api/v1/fleet/fuel-logs/${second.body.id}`).set(admin).send({ odometer_km: 990000 })).status).toBe(422);
    const fixed = await request(app).put(`/api/v1/fleet/fuel-logs/${second.body.id}`).set(admin).send({ odometer_km: 10500 });
    expect(fixed.status).toBe(200);
    expect(fixed.body.odometer_km).toBe(10500);
  });
});
