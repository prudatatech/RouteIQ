/**
 * Driver pay: a fixed amount per trip plus a rate per km, per vehicle type (docs/workflow-blueprint.html).
 * The customer's invoice never counts. Covers the rate in force on the trip date, where the km come
 * from, the zero-rate flag, that finishing a trip twice pays it once, payouts, and who may see what.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { routeService } from '../src/services/route.service';
import { adjustmentTotal, journeyEstimateKm, payAmount, pickRate, recordJourneyAfterTransferSafe, recordTripPay, weekStartKey } from '../src/services/driver-pay.service';
import { haversineKm } from '../src/services/odometer';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const driverAuth = (id = 'driver-1') => ({ Authorization: `Bearer ${createAccessToken({ sub: id, role: 'driver' })}` });
const staff = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });
const admin = () => staff('admin-1');

const rate = (over: Record<string, unknown> = {}) => ({
  id: `rate-${Math.random().toString(36).slice(2, 8)}`, vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10,
  effective_from: '2026-01-01', active: true, ...over,
});
const route = (over: Record<string, unknown> = {}) => ({
  id: 'route-1', vehicle_id: 'veh-1', status: 'completed', total_distance_km: 120,
  started_at: '2026-09-10T04:00:00Z', completed_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z', route_stops: [], ...over,
});
const load = (over: Record<string, unknown> = {}) => ({
  id: 'man-1', vehicle_id: 'veh-1', status: 'delivered', is_master: false,
  pickup_lat: 18.52, pickup_lng: 73.85, drop_lat: 19.07, drop_lng: 72.87, updated_at: '2026-09-10T10:00:00Z', ...over,
});
const entry = (over: Record<string, unknown> = {}) => ({
  id: `e-${Math.random().toString(36).slice(2, 8)}`, driver_id: 'driver-1', vehicle_id: 'veh-1', vehicle_type: 'truck', route_id: null, manifest_id: null,
  trip_date: '2026-09-10', km: 100, km_source: 'planned', per_trip_amount: 500, per_km_amount: 10, adjustments: [], amount: 1500,
  rate_missing: false, status: 'earned', payout_id: null, created_at: '2026-09-10T10:00:00Z', ...over,
});

function reset(over: Record<string, unknown[]> = {}) {
  invalidateDriverVehicles();
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true, full_name: 'Asha Admin' },
      { id: 'super-1', role: 'superadmin', is_active: true, full_name: 'Sue Super' },
      { id: 'mgr-1', role: 'manager', is_active: true, full_name: 'Mona Manager' },
      { id: 'driver-1', role: 'driver', is_active: true, full_name: 'Ravi Driver' },
      { id: 'driver-2', role: 'driver', is_active: true, full_name: 'Sam Driver' },
    ],
    vehicles: [
      { id: 'veh-1', driver_id: 'driver-1', vehicle_type: 'truck', status: 'on_route', plate_number: 'MH12AB1234' },
      { id: 'veh-2', driver_id: 'driver-2', vehicle_type: 'van', status: 'available', plate_number: 'MH12AB9999' },
    ],
    routes: [], route_stops: [], cargo_manifest: [], gps_points: [], invoices: [],
    cargo_transfers: [], cargo_transfer_items: [], cargo_custody_events: [],
    driver_pay_rates: [], driver_pay_entries: [], driver_payouts: [], notifications: [], ai_agent_logs: [],
    ...over,
  });
}
const entries = () => supabaseMock.rows('driver_pay_entries');
const notes = (type: string) => supabaseMock.rows('notifications').filter(n => n.type === type);

describe('the rules', () => {
  it('picks the rate in force on the trip date, from the active rows of that vehicle type', () => {
    const rates = [
      rate({ id: 'a', effective_from: '2026-01-01' }),
      rate({ id: 'b', effective_from: '2026-09-15' }),
      rate({ id: 'c', effective_from: '2026-09-20', active: false }),
      rate({ id: 'd', vehicle_type: 'van', effective_from: '2026-01-01' }),
    ];
    expect(pickRate(rates, 'truck', '2026-09-14')?.id).toBe('a');
    expect(pickRate(rates, 'truck', '2026-09-15')?.id).toBe('b');
    expect(pickRate(rates, 'truck', '2026-10-30')?.id).toBe('b'); // the withdrawn row is ignored
    expect(pickRate(rates, 'truck', '2025-12-31')).toBeNull();
    expect(pickRate(rates, 'van', '2026-09-30')?.id).toBe('d');
    expect(pickRate(rates, 'bike', '2026-09-30')).toBeNull();
    expect(pickRate(rates, null, '2026-09-30')).toBeNull();
  });

  it('adds the trip amount, the km rate times the distance and the corrections', () => {
    expect(payAmount(500, 10, 120.5)).toBe(1705);
    const adj = [{ amount: 150 }, { amount: -40.5 }];
    expect(adjustmentTotal(adj)).toBe(109.5);
    expect(payAmount(500, 10, 100, adj)).toBe(1609.5);
  });

  it('starts the week on Monday, in India', () => {
    expect(weekStartKey(new Date('2026-09-30T03:00:00Z'))).toBe('2026-09-28'); // a Wednesday
    expect(weekStartKey(new Date('2026-09-27T20:00:00Z'))).toBe('2026-09-28'); // Monday 01:30 IST
  });
});

describe('a trip finishes', () => {
  beforeEach(() => reset());

  it('pays a route at the rate in force on its date, from the planned km', async () => {
    reset({
      routes: [route()],
      driver_pay_rates: [rate({ id: 'old', effective_from: '2026-01-01', per_trip_amount: 500, per_km_amount: 10 }), rate({ id: 'new', effective_from: '2026-09-15', per_trip_amount: 800, per_km_amount: 12 })],
    });
    const out = await recordTripPay({ route_id: 'route-1' });
    expect(out?.created).toBe(true);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      driver_id: 'driver-1', vehicle_id: 'veh-1', vehicle_type: 'truck', route_id: 'route-1', trip_date: '2026-09-10', rate_id: 'old',
      km: 120, km_source: 'planned', per_trip_amount: 500, per_km_amount: 10, amount: 1700, rate_missing: false, status: 'earned',
    });
    // the same trip a fortnight later would be paid at the new rate
    reset({ routes: [route({ completed_at: '2026-09-20T10:00:00Z' })], driver_pay_rates: [rate({ id: 'old' }), rate({ id: 'new', effective_from: '2026-09-15', per_trip_amount: 800, per_km_amount: 12 })] });
    await recordTripPay({ route_id: 'route-1' });
    expect(entries()[0]).toMatchObject({ rate_id: 'new', amount: 800 + 12 * 120 });
  });

  it('uses the IST calendar day of the finish for the trip date', async () => {
    reset({ routes: [route({ completed_at: '2026-09-10T20:00:00Z' })], driver_pay_rates: [rate()] });
    await recordTripPay({ route_id: 'route-1' });
    expect(entries()[0].trip_date).toBe('2026-09-11');
  });

  it('counts the km driven from GPS when the trip recorded them, otherwise the plan', async () => {
    // about 0.09 degrees of latitude per step: roughly 10 km each, 4 steps
    const points = [0, 1, 2, 3, 4].map(i => ({
      id: `p${i}`, vehicle_id: 'veh-1', latitude: 18.5 + i * 0.09, longitude: 73.8, accuracy: 10, recorded_at: `2026-09-10T0${5 + i}:00:00Z`,
    }));
    reset({ routes: [route()], gps_points: points, driver_pay_rates: [rate()] });
    await recordTripPay({ route_id: 'route-1' });
    expect(entries()[0].km_source).toBe('gps');
    expect(entries()[0].km).toBeGreaterThan(38);
    expect(entries()[0].km).toBeLessThan(42);
    expect(entries()[0].amount).toBeCloseTo(500 + 10 * entries()[0].km, 1);

    // two stray pings are not a trip: the planned distance is used
    reset({ routes: [route()], gps_points: points.slice(0, 2), driver_pay_rates: [rate()] });
    await recordTripPay({ route_id: 'route-1' });
    expect(entries()[0]).toMatchObject({ km_source: 'planned', km: 120 });

    // pings outside the trip's hours do not count either
    reset({ routes: [route()], gps_points: points.map(p => ({ ...p, recorded_at: p.recorded_at.replace('09-10', '09-12') })), driver_pay_rates: [rate()] });
    await recordTripPay({ route_id: 'route-1' });
    expect(entries()[0].km_source).toBe('planned');
  });

  it('falls back to the stops in a line, and to none when nothing is known', async () => {
    reset({
      routes: [route({
        total_distance_km: 0,
        route_stops: [
          { sequence: 1, delivery_points: { latitude: 18.5, longitude: 73.8 } },
          { sequence: 2, delivery_points: { latitude: 19.0, longitude: 73.8 } },
        ],
      })],
      driver_pay_rates: [rate()],
    });
    await recordTripPay({ route_id: 'route-1' });
    expect(entries()[0].km_source).toBe('estimated');
    expect(entries()[0].km).toBeGreaterThan(50);

    reset({ routes: [route({ total_distance_km: 0 })], driver_pay_rates: [rate()] });
    await recordTripPay({ route_id: 'route-1' });
    expect(entries()[0]).toMatchObject({ km: 0, km_source: 'none', amount: 500 });
  });

  it('pays a delivered vendor load by the straight line between pickup and drop, and skips a master', async () => {
    reset({ cargo_manifest: [load(), load({ id: 'man-master', is_master: true })], driver_pay_rates: [rate()] });
    await recordTripPay({ manifest_id: 'man-1' });
    expect(entries()[0]).toMatchObject({ manifest_id: 'man-1', route_id: null, km_source: 'estimated', driver_id: 'driver-1' });
    expect(entries()[0].km).toBeGreaterThan(100);
    expect(await recordTripPay({ manifest_id: 'man-master' })).toBeNull();
    expect(entries()).toHaveLength(1);
  });

  it('pays nothing for a trip that is not finished, or a vehicle with no driver', async () => {
    reset({ routes: [route({ status: 'active' }), route({ id: 'route-2', vehicle_id: 'veh-3' })], vehicles: [{ id: 'veh-1', driver_id: 'driver-1', vehicle_type: 'truck' }, { id: 'veh-3', driver_id: null, vehicle_type: 'truck' }] });
    expect(await recordTripPay({ route_id: 'route-1' })).toBeNull();
    expect(await recordTripPay({ route_id: 'route-2' })).toBeNull();
    expect(entries()).toHaveLength(0);
  });

  it('is idempotent: finishing the same trip again pays it once', async () => {
    reset({ routes: [route()], driver_pay_rates: [rate()] });
    const first = await recordTripPay({ route_id: 'route-1' });
    const second = await recordTripPay({ route_id: 'route-1' });
    expect(first?.created).toBe(true);
    expect(second?.created).toBe(false);
    expect(second?.entry.id).toBe(first?.entry.id);
    expect(entries()).toHaveLength(1);
  });

  it('is made when a route is completed, and never from an invoice', async () => {
    reset({
      routes: [route({ status: 'active', completed_at: null })],
      driver_pay_rates: [rate({ effective_from: '2000-01-01' })],
      invoices: [{ id: 'inv-1', manifest_id: null, shipment_id: 's1', amount: 99999, status: 'paid', voided_at: null }],
    });
    await routeService.changeStatus('route-1', 'completed');
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ route_id: 'route-1', driver_id: 'driver-1', per_trip_amount: 500, amount: 500 + 10 * 120 });
    await routeService.changeStatus('route-1', 'completed'); // a retry
    expect(entries()).toHaveLength(1);
  });

  it('has amount 0 and a rate_missing flag with no rate, and tells admins once', async () => {
    reset({
      routes: [route(), route({ id: 'route-2' })],
      driver_pay_rates: [rate({ vehicle_type: 'van' })], // a rate for another type does not count
    });
    await recordTripPay({ route_id: 'route-1' });
    await recordTripPay({ route_id: 'route-2' });
    expect(entries()).toHaveLength(2);
    for (const e of entries()) expect(e).toMatchObject({ amount: 0, rate_missing: true, rate_id: null, status: 'earned', vehicle_type: 'truck' });
    const told = notes('driver_pay_rate_missing');
    expect(told.map(n => n.user_id).sort()).toEqual(['admin-1', 'super-1']); // not the manager
    expect(told[0]).toMatchObject({ title: 'Set a pay rate for truck', data: { vehicle_type: 'truck', link: '/money/driver-pay' } });
  });

  it('prices those entries as soon as a rate covers them', async () => {
    reset({ routes: [route()] });
    await recordTripPay({ route_id: 'route-1' });
    const res = await request(app).post(api('/driver-pay/rates')).set(admin()).send({ vehicle_type: 'truck', per_trip_amount: 400, per_km_amount: 5, effective_from: '2026-01-01' });
    expect(res.status).toBe(201);
    expect(res.body.repriced_entries).toBe(1);
    expect(entries()[0]).toMatchObject({ rate_missing: false, per_trip_amount: 400, amount: 400 + 5 * 120 });
  });
});

const PUNE = { lat: 18.52, lng: 73.85 };
const MUMBAI = { lat: 19.07, lng: 72.87 };
const NASHIK = { lat: 20.0, lng: 73.79 };
const LONAVALA = { lat: 18.75, lng: 73.4 };
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.round(haversineKm(a, b) * 10) / 10;
const master = (over: Record<string, unknown> = {}) => load({ id: 'M', is_master: true, status: 'delivered', vehicle_id: 'veh-1', ...over });
const lot = (id: string, drop: { lat: number; lng: number }, over: Record<string, unknown> = {}) => load({
  id, parent_manifest_id: 'M', lot_seq: Number(id.slice(-1)) || 1, is_master: false, vehicle_id: 'veh-1', status: 'delivered',
  pickup_lat: PUNE.lat, pickup_lng: PUNE.lng, drop_lat: drop.lat, drop_lng: drop.lng, ...over,
});

describe('vendor loads are paid per vehicle journey, not per lot', () => {
  it('pays 3 lots on 1 truck once: one per-trip amount and the journey km, when the last lot is done', async () => {
    reset({
      cargo_manifest: [master(), lot('L1', MUMBAI), lot('L2', NASHIK), lot('L3', LONAVALA, { status: 'in_transit' })],
      driver_pay_rates: [rate()],
    });
    // the first lots delivered while one is still on the truck: no pay yet
    expect(await recordTripPay({ manifest_id: 'L1' })).toBeNull();
    expect(await recordTripPay({ manifest_id: 'L2' })).toBeNull();
    expect(entries()).toHaveLength(0);

    supabaseMock.rows('cargo_manifest').find(m => m.id === 'L3')!.status = 'delivered';
    for (const id of ['L3', 'L1', 'L2']) await recordTripPay({ manifest_id: id });
    expect(entries()).toHaveLength(1);
    const journey = km(PUNE, NASHIK); // the farthest drop, counted once
    expect(entries()[0]).toMatchObject({ manifest_id: 'M', vehicle_id: 'veh-1', driver_id: 'driver-1', per_trip_amount: 500, km_source: 'estimated', km: journey });
    expect(entries()[0].amount).toBeCloseTo(500 + 10 * journey, 1);
  });

  it('counts a cancelled last lot as the end of the journey, and pays nothing for all-cancelled lots', async () => {
    reset({ cargo_manifest: [master(), lot('L1', MUMBAI), lot('L2', NASHIK, { status: 'cancelled' })], driver_pay_rates: [rate()] });
    await recordTripPay({ manifest_id: 'L2' });
    expect(entries()).toHaveLength(1);
    expect(entries()[0].km).toBe(km(PUNE, MUMBAI)); // a cancelled lot's drop is not driven to

    reset({ cargo_manifest: [master({ status: 'cancelled' }), lot('L1', MUMBAI, { status: 'cancelled' }), lot('L2', NASHIK, { status: 'cancelled' })], driver_pay_rates: [rate()] });
    expect(await recordTripPay({ manifest_id: 'L1' })).toBeNull();
    expect(entries()).toHaveLength(0);
  });

  it('is idempotent when delivery events repeat', async () => {
    reset({ cargo_manifest: [master(), lot('L1', MUMBAI), lot('L2', NASHIK)], driver_pay_rates: [rate()] });
    const first = await recordTripPay({ manifest_id: 'L1' });
    for (let i = 0; i < 2; i++) for (const id of ['L1', 'L2', 'L1']) await recordTripPay({ manifest_id: id });
    expect(first?.created).toBe(true);
    expect(entries()).toHaveLength(1);
    expect((await recordTripPay({ manifest_id: 'L2' }))?.created).toBe(false);
  });

  it('walks the drops in order when the start is unknown', () => {
    const legs = journeyEstimateKm(null, [PUNE, LONAVALA, NASHIK]);
    expect(legs.source).toBe('estimated');
    expect(legs.km).toBeCloseTo(km(PUNE, LONAVALA) + km(LONAVALA, NASHIK), 0);
    expect(journeyEstimateKm(PUNE, [])).toEqual({ km: 0, source: 'none' });
  });

  it('a partial transfer pays two drivers, one each: km to the handover, then from it', async () => {
    const meet = { lat: 18.75, lng: 73.4 }; // Lonavala
    reset({
      // L1 stays on veh-1 and is delivered in Mumbai; L2 moved to veh-2 (the vehicle_id follows the goods) and went to Nashik
      cargo_manifest: [master(), lot('L1', MUMBAI), lot('L2', NASHIK, { vehicle_id: 'veh-2' })],
      cargo_transfers: [{ id: 't1', from_vehicle_id: 'veh-1', to_vehicle_id: 'veh-2', status: 'completed', meet_lat: meet.lat, meet_lng: meet.lng, completed_at: '2026-09-10T08:00:00Z' }],
      cargo_transfer_items: [{ id: 'i1', transfer_id: 't1', manifest_id: 'L2' }],
      driver_pay_rates: [rate(), rate({ vehicle_type: 'van', per_trip_amount: 300, per_km_amount: 8 })],
    });
    await recordTripPay({ manifest_id: 'L1' });
    await recordTripPay({ manifest_id: 'L2' });
    expect(entries()).toHaveLength(2);
    const first = entries().find(e => e.driver_id === 'driver-1')!;
    const second = entries().find(e => e.driver_id === 'driver-2')!;
    // the first driver: pickup to the farthest of their own drop (Mumbai) and the handover
    expect(first).toMatchObject({ manifest_id: 'M', vehicle_id: 'veh-1', per_trip_amount: 500, km: Math.max(km(PUNE, MUMBAI), km(PUNE, meet)) });
    // the second driver: from the handover to the drop, at the van's rate
    expect(second).toMatchObject({ manifest_id: 'M', vehicle_id: 'veh-2', per_trip_amount: 300, per_km_amount: 8, km: km(meet, NASHIK) });
    expect(second.amount).toBeCloseTo(300 + 8 * km(meet, NASHIK), 1);
  });

  it('pays the first driver when their last lot leaves in a transfer, using the handover ping', async () => {
    const ping = { lat: 18.6, lng: 73.7 };
    reset({
      cargo_manifest: [master(), lot('L1', NASHIK, { vehicle_id: 'veh-2', status: 'in_transit' })],
      cargo_transfers: [{ id: 't1', from_vehicle_id: 'veh-1', to_vehicle_id: 'veh-2', status: 'completed', meet_lat: 19.9, meet_lng: 73.0, completed_at: '2026-09-10T08:00:00Z' }],
      cargo_transfer_items: [{ id: 'i1', transfer_id: 't1', manifest_id: 'L1' }],
      // one ping near the handover beats the (far) meet point on the transfer
      gps_points: [{ id: 'g1', vehicle_id: 'veh-1', latitude: ping.lat, longitude: ping.lng, accuracy: 5, recorded_at: '2026-09-10T08:05:00Z' }],
      driver_pay_rates: [rate()],
    });
    await recordJourneyAfterTransferSafe('M', 'veh-1');
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ driver_id: 'driver-1', vehicle_id: 'veh-1', km: km(PUNE, ping) });
    // the receiving truck's lot is still on the road: no entry for its driver yet
    expect(await recordTripPay({ manifest_id: 'L1' })).toBeNull();
    await recordJourneyAfterTransferSafe('M', 'veh-1');
    expect(entries()).toHaveLength(1);
  });

  it('pays a route carrying 3 shipment lots once', async () => {
    const stops = ['S1', 'S2', 'S3'].map((s, i) => ({ sequence: i + 1, status: 'completed', delivery_points: { latitude: 18.5 + i * 0.2, longitude: 73.8, shipment_id: s } }));
    reset({
      routes: [route({ status: 'active', completed_at: null, total_distance_km: 90, route_stops: stops })],
      route_stops: stops.map((s, i) => ({ id: `rs${i}`, route_id: 'route-1', status: 'completed' })),
      driver_pay_rates: [rate()],
    });
    await routeService.changeStatus('route-1', 'completed');
    await routeService.changeStatus('route-1', 'completed');
    await recordTripPay({ route_id: 'route-1' });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ route_id: 'route-1', per_trip_amount: 500, km: 90, amount: 500 + 10 * 90 });
  });
});

describe('rates', () => {
  beforeEach(() => reset());

  it('are set per vehicle type, replace a rate starting the same day, and keep history', async () => {
    const post = (body: object) => request(app).post(api('/driver-pay/rates')).set(admin()).send(body);
    expect((await post({ vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10, effective_from: '2026-01-01' })).status).toBe(201);
    expect((await post({ vehicle_type: 'truck', per_trip_amount: 700, per_km_amount: 12, effective_from: '2026-09-15' })).status).toBe(201);
    expect((await post({ vehicle_type: 'truck', per_trip_amount: 750, per_km_amount: 12, effective_from: '2026-09-15' })).status).toBe(201);
    const rows = supabaseMock.rows('driver_pay_rates');
    expect(rows.filter(r => r.active)).toHaveLength(2);
    expect(rows.filter(r => !r.active)).toHaveLength(1);

    const list = await request(app).get(api('/driver-pay/rates')).set(admin());
    const truck = list.body.filter((r: any) => r.vehicle_type === 'truck');
    expect(truck.map((r: any) => [r.effective_from, r.per_trip_amount, r.state])).toEqual([
      ['2026-09-15', 750, 'current'],
      ['2026-01-01', 500, 'superseded'],
    ]);
    expect(truck[1].superseded_on).toBe('2026-09-15');
    expect((await request(app).get(api('/driver-pay/rates?history=1')).set(admin())).body).toHaveLength(3);
  });

  it('reject an unknown vehicle type or a bad amount', async () => {
    const post = (body: object) => request(app).post(api('/driver-pay/rates')).set(admin()).send(body);
    expect((await post({ vehicle_type: 'boat', per_trip_amount: 1, per_km_amount: 1 })).status).toBe(400);
    expect((await post({ vehicle_type: 'truck', per_trip_amount: -1, per_km_amount: 1 })).status).toBe(400);
    expect((await post({ vehicle_type: 'truck', per_trip_amount: 'lots', per_km_amount: 1 })).status).toBe(400);
    expect((await post({ vehicle_type: 'truck', per_trip_amount: 1, per_km_amount: 1, effective_from: '30/09/2026' })).status).toBe(400);
  });

  it('can be edited and withdrawn, and the change is in the audit log', async () => {
    reset({ driver_pay_rates: [rate({ id: 'r1' })] });
    const patch = await request(app).patch(api('/driver-pay/rates/r1')).set(admin()).send({ per_km_amount: 11 });
    expect(patch.status).toBe(200);
    expect(supabaseMock.rows('driver_pay_rates')[0].per_km_amount).toBe(11);
    expect((await request(app).delete(api('/driver-pay/rates/r1')).set(admin())).status).toBe(200);
    expect(supabaseMock.rows('driver_pay_rates')[0].active).toBe(false);
    expect((await request(app).delete(api('/driver-pay/rates/r1')).set(admin())).status).toBe(404);
    expect(supabaseMock.rows('ai_agent_logs').map(l => l.action)).toEqual(['driver_pay.rate_changed', 'driver_pay.rate_withdrawn']);
  });
});

describe('approve, adjust, void', () => {
  it('approves earned entries, skipping those with no rate, and audits it', async () => {
    reset({ driver_pay_entries: [entry({ id: 'e1' }), entry({ id: 'e2', rate_missing: true, amount: 0 }), entry({ id: 'e3', status: 'approved' })] });
    const res = await request(app).post(api('/driver-pay/entries/approve')).set(admin()).send({ ids: ['e1', 'e2', 'e3', 'nope'] });
    expect(res.status).toBe(200);
    expect(res.body.approved).toEqual(['e1']);
    expect(res.body.skipped.map((s: any) => s.id).sort()).toEqual(['e2', 'e3', 'nope']);
    expect(entries().find(e => e.id === 'e1')).toMatchObject({ status: 'approved', approved_by: 'admin-1' });
    expect(entries().find(e => e.id === 'e2')!.status).toBe('earned');
    expect(supabaseMock.rows('ai_agent_logs')[0]).toMatchObject({ action: 'driver_pay.approved' });
    expect((await request(app).post(api('/driver-pay/entries/approve')).set(admin()).send({ ids: [] })).status).toBe(400);
  });

  it('adjusts with a reason, recomputes the amount and records who and why', async () => {
    reset({ driver_pay_entries: [entry({ id: 'e1' })] });
    const post = (body: object) => request(app).post(api('/driver-pay/entries/e1/adjust')).set(admin()).send(body);
    expect((await post({ amount: 200 })).status).toBe(400); // no reason
    expect((await post({ amount: 0, reason: 'Nothing' })).status).toBe(400);
    const ok = await post({ amount: 250, reason: 'Toll paid by driver' });
    expect(ok.status).toBe(200);
    expect(ok.body.amount).toBe(1750);
    expect(ok.body.adjustments[0]).toMatchObject({ amount: 250, reason: 'Toll paid by driver', by: 'admin-1' });
    expect((await post({ amount: -100, reason: 'Late delivery' })).body.amount).toBe(1650);
    expect((await post({ amount: -5000, reason: 'Too much' })).status).toBe(400);
    const audit = supabaseMock.rows('ai_agent_logs').filter(l => l.action === 'driver_pay.adjusted');
    expect(audit).toHaveLength(2);
    expect(audit[0].input_data).toMatchObject({ actor_id: 'admin-1', entry_id: 'e1', reason: 'Toll paid by driver', adjustment: 250 });
  });

  it('does not adjust or void a paid entry, and voids with a reason otherwise', async () => {
    reset({ driver_pay_entries: [entry({ id: 'paid', status: 'paid', payout_id: 'po' }), entry({ id: 'open' })] });
    expect((await request(app).post(api('/driver-pay/entries/paid/adjust')).set(admin()).send({ amount: 10, reason: 'Bonus' })).status).toBe(409);
    expect((await request(app).post(api('/driver-pay/entries/paid/void')).set(admin()).send({ reason: 'Wrong trip' })).status).toBe(409);
    expect((await request(app).post(api('/driver-pay/entries/open/void')).set(admin()).send({})).status).toBe(400);
    const ok = await request(app).post(api('/driver-pay/entries/open/void')).set(admin()).send({ reason: 'Duplicate trip' });
    expect(ok.status).toBe(200);
    expect(entries().find(e => e.id === 'open')).toMatchObject({ status: 'void', void_reason: 'Duplicate trip' });
  });

  it('lists with filters and totals by state', async () => {
    reset({
      driver_pay_entries: [
        entry({ id: 'a', amount: 1000, status: 'earned' }),
        entry({ id: 'b', amount: 2000, status: 'approved' }),
        entry({ id: 'c', amount: 3000, status: 'paid', payout_id: 'po1' }),
        entry({ id: 'd', driver_id: 'driver-2', vehicle_id: 'veh-2', vehicle_type: 'van', amount: 0, rate_missing: true }),
      ],
      driver_payouts: [{ id: 'po1', paid_at: '2026-09-12T10:00:00Z', method: 'cash', reference: null }],
    });
    const all = await request(app).get(api('/driver-pay/entries')).set(admin());
    expect(all.body.entries).toHaveLength(4);
    expect(all.body.totals).toEqual({ earned: 1000, approved: 2000, paid: 3000 });
    expect(all.body.rate_missing_types).toEqual(['van']);
    expect(all.body.entries.find((e: any) => e.id === 'a')).toMatchObject({ driver_name: 'Ravi Driver', plate_number: 'MH12AB1234' });
    expect(all.body.entries.find((e: any) => e.id === 'c').paid_at).toBe('2026-09-12T10:00:00Z');
    expect((await request(app).get(api('/driver-pay/entries?driver_id=driver-2')).set(admin())).body.entries.map((e: any) => e.id)).toEqual(['d']);
    expect((await request(app).get(api('/driver-pay/entries?status=approved')).set(admin())).body.entries.map((e: any) => e.id)).toEqual(['b']);
    expect((await request(app).get(api('/driver-pay/entries?status=bogus')).set(admin())).status).toBe(400);
  });
});

describe('payouts', () => {
  const world = () => reset({
    driver_pay_entries: [
      entry({ id: 'a', amount: 1200.5, status: 'approved', trip_date: '2026-09-05' }),
      entry({ id: 'b', amount: 800, status: 'approved', trip_date: '2026-09-09' }),
      entry({ id: 'c', amount: 500, status: 'earned' }),
      entry({ id: 'x', driver_id: 'driver-2', amount: 700, status: 'approved' }),
    ],
  });
  const pay = (body: object) => request(app).post(api('/driver-pay/payouts')).set(admin()).send(body);

  it('pays approved entries in one payout: total, period, entries marked paid, driver told with a wallet link', async () => {
    world();
    const res = await pay({ driver_id: 'driver-1', entry_ids: ['a', 'b'], method: 'bank', reference: 'UTR123456789' });
    expect(res.status).toBe(201);
    expect(res.body.payout).toMatchObject({ amount: 2000.5, method: 'bank', reference: 'UTR123456789', period_from: '2026-09-05', period_to: '2026-09-09' });
    const payoutId = supabaseMock.rows('driver_payouts')[0].id;
    expect(supabaseMock.rows('driver_payouts')[0]).toMatchObject({ driver_id: 'driver-1', paid_by: 'admin-1', amount: 2000.5 });
    expect(entries().filter(e => e.status === 'paid').map(e => e.id).sort()).toEqual(['a', 'b']);
    expect(entries().filter(e => e.payout_id === payoutId)).toHaveLength(2);
    expect(entries().find(e => e.id === 'c')!.status).toBe('earned');
    const told = notes('payout_sent');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ user_id: 'driver-1', data: { payout_id: payoutId, amount: 2000.5, method: 'bank', link: '/wallet' } });
    expect(supabaseMock.rows('ai_agent_logs').some(l => l.action === 'driver_pay.paid')).toBe(true);

    // the same entries cannot be paid twice
    expect((await pay({ driver_id: 'driver-1', entry_ids: ['a'], method: 'cash' })).status).toBe(409);
    expect(supabaseMock.rows('driver_payouts')).toHaveLength(1);
  });

  it('refuses entries that are not approved, belong to another driver, or need a reference', async () => {
    world();
    expect((await pay({ driver_id: 'driver-1', entry_ids: ['a', 'c'], method: 'cash' })).status).toBe(409);
    expect((await pay({ driver_id: 'driver-1', entry_ids: ['a', 'x'], method: 'cash' })).status).toBe(409);
    expect((await pay({ driver_id: 'driver-1', entry_ids: ['a'], method: 'upi' })).status).toBe(400);
    expect((await pay({ driver_id: 'driver-1', entry_ids: ['a'], method: 'cheque', reference: 'x' })).status).toBe(400);
    expect((await pay({ driver_id: 'driver-1', entry_ids: [], method: 'cash' })).status).toBe(400);
    expect((await pay({ driver_id: 'driver-1', entry_ids: ['a', 'missing'], method: 'cash' })).status).toBe(404);
    expect(supabaseMock.rows('driver_payouts')).toHaveLength(0);
    expect(entries().every(e => e.status !== 'paid')).toBe(true);
    expect(notes('payout_sent')).toHaveLength(0);
    // cash needs no reference
    expect((await pay({ driver_id: 'driver-1', entry_ids: ['a'], method: 'cash' })).status).toBe(201);
  });

  it('lists payouts, by driver', async () => {
    world();
    await pay({ driver_id: 'driver-1', entry_ids: ['a'], method: 'cash' });
    await pay({ driver_id: 'driver-2', entry_ids: ['x'], method: 'cash' });
    expect((await request(app).get(api('/driver-pay/payouts')).set(admin())).body).toHaveLength(2);
    const one = await request(app).get(api('/driver-pay/payouts?driver_id=driver-2')).set(admin());
    expect(one.body).toHaveLength(1);
    expect(one.body[0]).toMatchObject({ driver_name: 'Sam Driver', amount: 700 });
  });
});

describe('the driver wallet', () => {
  it('shows only their own pay: totals by state, this trip, week, month, trip lines and payouts', async () => {
    const now = new Date();
    const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    reset({
      driver_pay_entries: [
        entry({ id: 'mine-earned', amount: 1000, status: 'earned', trip_date: today, route_id: 'aaaaaaaa-1111' }),
        entry({ id: 'mine-approved', amount: 2000, status: 'approved', trip_date: '2026-01-05', manifest_id: 'bbbbbbbb-2222' }),
        entry({ id: 'mine-paid', amount: 3000, status: 'paid', payout_id: 'po1', trip_date: '2026-01-02' }),
        entry({ id: 'mine-void', amount: 9999, status: 'void', trip_date: '2026-01-03' }),
        entry({ id: 'theirs', driver_id: 'driver-2', amount: 5555, status: 'earned', trip_date: today }),
      ],
      driver_payouts: [
        { id: 'po1', driver_id: 'driver-1', amount: 3000, method: 'upi', reference: 'UPI1234', paid_at: '2026-01-10T10:00:00Z', period_from: '2026-01-02', period_to: '2026-01-02' },
        { id: 'po2', driver_id: 'driver-2', amount: 4444, method: 'cash', reference: null, paid_at: '2026-01-10T10:00:00Z' },
      ],
    });
    const res = await request(app).get(api('/driver/pay')).set(driverAuth());
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ earned: 6000, pending: 1000, approved: 2000, paid: 3000 });
    expect(res.body.this_trip).toMatchObject({ id: 'mine-earned', trip_ref: 'TR-AAAAAAAA', amount: 1000, status: 'earned' });
    expect(res.body.this_week.total).toBe(1000);
    expect(res.body.this_month.total).toBe(1000);
    expect(res.body.trips.map((t: any) => t.id).sort()).toEqual(['mine-approved', 'mine-earned', 'mine-paid']);
    expect(res.body.trips.find((t: any) => t.id === 'mine-approved')).toMatchObject({ trip_ref: 'CM-BBBBBBBB', trip_type: 'load' });
    expect(res.body.trips.find((t: any) => t.id === 'mine-paid').paid_at).toBe('2026-01-10T10:00:00Z');
    expect(res.body.payouts.map((p: any) => p.id)).toEqual(['po1']);
    expect(JSON.stringify(res.body)).not.toContain('5555');
    expect(JSON.stringify(res.body)).not.toContain('4444');
  });

  it('is empty, not the invoice, for a driver with no trips paid', async () => {
    reset({ invoices: [{ id: 'i', manifest_id: 'm', amount: 90000, status: 'paid', voided_at: null }] });
    const res = await request(app).get(api('/driver/pay')).set(driverAuth());
    expect(res.body.totals).toEqual({ earned: 0, pending: 0, approved: 0, paid: 0 });
    expect(res.body.trips).toEqual([]);
    const legacy = await request(app).get(api('/auth/driver/earnings')).set(driverAuth());
    expect(legacy.body).toMatchObject({ total_earnings: 0, completed_trips: 0, recent_invoices: [] });
  });

  it('keeps the older earnings endpoints on real pay', async () => {
    reset({ driver_pay_entries: [entry({ amount: 1500, status: 'paid', payout_id: 'p' }), entry({ amount: 900, status: 'approved' }), entry({ amount: 4000, status: 'void' })] });
    const res = await request(app).get(api('/auth/driver/earnings/history')).set(driverAuth());
    expect(res.body).toMatchObject({ total_earnings: 2400, total: 2, has_more: false });
    expect(res.body.invoices.map((i: any) => [i.total_payout, i.status]).sort()).toEqual([[1500, 'paid'], [900, 'pending']].sort());
  });
});

describe('who may use it', () => {
  beforeEach(() => reset({ driver_pay_entries: [entry({ id: 'e1' })], driver_pay_rates: [rate({ id: 'r1' })] }));

  const calls: Array<[string, string, object?]> = [
    ['get', '/driver-pay/rates'], ['post', '/driver-pay/rates', { vehicle_type: 'truck', per_trip_amount: 1, per_km_amount: 1 }],
    ['patch', '/driver-pay/rates/r1', { per_km_amount: 2 }], ['delete', '/driver-pay/rates/r1'],
    ['get', '/driver-pay/entries'], ['post', '/driver-pay/entries/approve', { ids: ['e1'] }],
    ['post', '/driver-pay/entries/e1/adjust', { amount: 5, reason: 'Bonus' }], ['post', '/driver-pay/entries/e1/void', { reason: 'Wrong' }],
    ['get', '/driver-pay/payouts'], ['post', '/driver-pay/payouts', { driver_id: 'driver-1', entry_ids: ['e1'], method: 'cash' }],
  ];
  const send = (method: string, path: string, headers: Record<string, string> | null, body?: object) => {
    let r = (request(app) as any)[method](api(path));
    if (headers) r = r.set(headers);
    return body ? r.send(body) : r;
  };

  it('is closed to a manager, a driver and anyone signed out', async () => {
    for (const [method, path, body] of calls) {
      expect((await send(method, path, staff('mgr-1'), body)).status, `manager ${method} ${path}`).toBe(403);
      expect((await send(method, path, driverAuth(), body)).status, `driver ${method} ${path}`).toBe(403);
      expect((await send(method, path, null, body)).status, `signed out ${method} ${path}`).toBe(401);
    }
  });

  it('is open to admin and superadmin', async () => {
    for (const who of ['admin-1', 'super-1']) {
      expect((await send('get', '/driver-pay/entries', staff(who))).status).toBe(200);
      expect((await send('get', '/driver-pay/rates', staff(who))).status).toBe(200);
      expect((await send('get', '/driver-pay/payouts', staff(who))).status).toBe(200);
    }
  });

  it('keeps the wallet for drivers: staff cannot open a driver wallet, a signed-out caller cannot either', async () => {
    expect((await request(app).get(api('/driver/pay')).set(staff('mgr-1'))).status).toBe(403);
    expect((await request(app).get(api('/driver/pay')).set(admin())).status).toBe(403);
    expect((await request(app).get(api('/driver/pay'))).status).toBe(401);
  });

  it('backfills old trips for a company admin (its own trips only), not for a manager or a driver', async () => {
    reset({ routes: [route()], driver_pay_rates: [rate()] });
    expect((await request(app).post(api('/driver-pay/backfill')).set(staff('mgr-1')).send({ from: '2026-09-01' })).status).toBe(403);
    const ok = await request(app).post(api('/driver-pay/backfill')).set(admin()).send({ from: '2026-09-01' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ created: 1, skipped: 0 });
    expect((await request(app).post(api('/driver-pay/backfill')).set(admin()).send({ from: '2026-09-01' })).body).toEqual({ created: 0, skipped: 1 });
  });
});
