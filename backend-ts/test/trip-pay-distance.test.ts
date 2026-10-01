/**
 * Completed trips and driver pay (UAT-002, UAT-003): every completed trip gets a pay entry (0 and
 * flagged when no rate exists), with the distance labelled actual or planned; the trips list and
 * route API carry the same distance and its basis; the odometer takes the trip in on completion.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { routeService } from '../src/services/route.service';
import { recordTripPay, backfillTripPay } from '../src/services/driver-pay.service';
import { basisOfKmSource } from '../src/services/trip-distance';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

const route = (id: string, over: Record<string, unknown> = {}) => ({
  id, vehicle_id: 'veh-1', status: 'completed', total_distance_km: 0, created_at: '2026-09-10T04:00:00Z',
  started_at: '2026-09-10T04:00:00Z', completed_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z', route_stops: [], ...over,
});
const stopsDelhiToPune = (routeId: string) => [
  { id: `${routeId}-s1`, route_id: routeId, sequence: 1, status: 'completed', delivery_points: { latitude: 28.61, longitude: 77.21 } },
  { id: `${routeId}-s2`, route_id: routeId, sequence: 2, status: 'completed', delivery_points: { latitude: 18.52, longitude: 73.85 } },
];

function reset(over: Record<string, unknown[]> = {}) {
  invalidateDriverVehicles();
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true, full_name: 'Asha Admin' },
      { id: 'driver-1', role: 'driver', is_active: true, full_name: 'Ravi Driver' },
      { id: 'driver-2', role: 'driver', is_active: true, full_name: 'Sam Driver' },
    ],
    vehicles: [
      { id: 'veh-1', driver_id: 'driver-1', vehicle_type: 'truck', status: 'on_route', plate_number: 'DL01AL0010' },
      { id: 'veh-nodriver', driver_id: null, vehicle_type: 'truck', status: 'available', plate_number: 'DL01AL0011' },
    ],
    routes: [], route_stops: [], cargo_manifest: [], gps_points: [], invoices: [],
    cargo_transfers: [], cargo_transfer_items: [], cargo_custody_events: [],
    driver_pay_rates: [], driver_pay_entries: [], driver_payouts: [], notifications: [], ai_agent_logs: [],
    vehicle_odometer_events: [],
    ...over,
  });
}
const entries = () => supabaseMock.rows('driver_pay_entries');

describe('every completed trip gets a pay entry', () => {
  beforeEach(() => reset());

  it('is 0 and flagged "awaiting rate" when the vehicle type has no rate, with the planned km', async () => {
    reset({ routes: [route('r1', { total_distance_km: 2617 })] });
    const out = await recordTripPay({ route_id: 'r1' });
    expect(out?.created).toBe(true);
    expect(entries()).toEqual([expect.objectContaining({ route_id: 'r1', driver_id: 'driver-1', km: 2617, km_source: 'planned', amount: 0, rate_missing: true, status: 'earned' })]);
  });

  it('uses the stops in a line, labelled estimated, when the trip had no planned distance and no GPS', async () => {
    reset({ routes: [route('r1', { route_stops: stopsDelhiToPune('r1') })] });
    await recordTripPay({ route_id: 'r1' });
    expect(entries()[0]).toMatchObject({ km_source: 'estimated', rate_missing: true });
    expect(entries()[0].km).toBeGreaterThan(1000);
  });

  it('prefers the distance driven (GPS) over the plan, labelled gps', async () => {
    const gps = [0, 1, 2, 3].map(i => ({ vehicle_id: 'veh-1', latitude: 28 + i * 0.05, longitude: 77.2, accuracy: 5, recorded_at: new Date(Date.UTC(2026, 8, 10, 5, i * 10)).toISOString() }));
    reset({ routes: [route('r1', { total_distance_km: 2617 })], gps_points: gps });
    await recordTripPay({ route_id: 'r1' });
    expect(entries()[0]).toMatchObject({ km_source: 'gps' });
    expect(entries()[0].km).toBeLessThan(30);
  });

  it('pays the last driver who handled the vehicle when it has no driver now, and tells staff when nobody can be paid', async () => {
    reset({
      routes: [route('r1', { vehicle_id: 'veh-nodriver', total_distance_km: 100 })],
      cargo_custody_events: [{ id: 'e1', to_vehicle_id: 'veh-nodriver', from_vehicle_id: null, driver_id: 'driver-2', recorded_at: '2026-09-10T08:00:00Z' }],
    });
    await recordTripPay({ route_id: 'r1' });
    expect(entries()[0]).toMatchObject({ route_id: 'r1', driver_id: 'driver-2', vehicle_id: 'veh-nodriver' });

    reset({ routes: [route('r2', { vehicle_id: 'veh-nodriver', total_distance_km: 100 })] });
    expect(await recordTripPay({ route_id: 'r2' })).toBeNull();
    expect(supabaseMock.rows('notifications').some(n => n.type === 'driver_pay_no_driver')).toBe(true);
  });

  it('the backfill creates the missing entries for already-completed trips and is safe to re-run', async () => {
    reset({
      routes: [route('r1', { total_distance_km: 846.9 }), route('r2', { total_distance_km: 2617 }), route('r3', { status: 'cancelled' })],
      driver_pay_entries: [{ id: 'old', driver_id: 'driver-1', vehicle_id: 'veh-1', route_id: 'r1', trip_date: '2026-09-10', km: 846.9, km_source: 'planned', amount: 0, status: 'earned', adjustments: [] }],
    });
    const actor = { user_id: 'admin-1', role: 'superadmin' };
    expect(await backfillTripPay(actor, '2026-09-01')).toEqual({ created: 1, skipped: 1 });
    expect(await backfillTripPay(actor, '2026-09-01')).toEqual({ created: 0, skipped: 2 });
    expect(entries().map(e => e.route_id).sort()).toEqual(['r1', 'r2']);
  });
});

describe('the trips API carries the same distance and its basis', () => {
  beforeEach(() => reset());

  it('maps the pay entry label to the words the screens use', () => {
    expect(['gps', 'planned', 'estimated', 'none', null].map(basisOfKmSource)).toEqual(['actual', 'planned', 'estimated', 'none', 'none']);
  });

  it('shows a completed trip with the distance its pay entry used, not 0', async () => {
    reset({
      routes: [route('r1', { total_distance_km: 0, route_stops: stopsDelhiToPune('r1') }), route('r2', { total_distance_km: 120 })],
      driver_pay_entries: [
        { id: 'e1', driver_id: 'driver-1', vehicle_id: 'veh-1', route_id: 'r1', trip_date: '2026-09-10', km: 2617, km_source: 'gps', amount: 0, status: 'earned', adjustments: [] },
      ],
    });
    const res = await request(app).get(api('/routes?vehicle_id=veh-1')).set(admin());
    expect(res.status).toBe(200);
    const by = (id: string) => res.body.find((r: any) => r.id === id);
    expect(by('r1')).toMatchObject({ distance_km: 2617, distance_basis: 'actual' });
    expect(by('r2')).toMatchObject({ distance_km: 120, distance_basis: 'planned' });
  });

  it('estimates a trip with no planned distance and no entry from its stops, and says so', async () => {
    reset({ routes: [route('r1', { status: 'active', route_stops: stopsDelhiToPune('r1') }), route('r2', { status: 'pending' })] });
    const res = await request(app).get(api('/routes?vehicle_id=veh-1')).set(admin());
    const by = (id: string) => res.body.find((r: any) => r.id === id);
    expect(by('r1').distance_basis).toBe('estimated');
    expect(by('r1').distance_km).toBeGreaterThan(1000);
    expect(by('r2')).toMatchObject({ distance_km: 0, distance_basis: 'none' });
  });

  it('gives a vendor load an estimated distance (pickup to drop) instead of 0 km', async () => {
    reset({
      cargo_manifest: [{
        id: 'm1', vehicle_id: 'veh-1', status: 'delivered', created_at: '2026-09-10T04:00:00Z', updated_at: '2026-09-10T10:00:00Z',
        pickup_location: 'Pune', pickup_lat: 18.52, pickup_lng: 73.85, drop_location: 'Mumbai', drop_lat: 19.07, drop_lng: 72.87,
      }],
    });
    const res = await request(app).get(api('/routes?vehicle_id=veh-1')).set(admin());
    const load = res.body.find((r: any) => r.id === 'm1');
    expect(load.distance_basis).toBe('estimated');
    expect(load.distance_km).toBeGreaterThan(100);
    expect(load.total_distance_km).toBe(load.distance_km);
  });

  it('a delivered load shows what its journey pay entry used', async () => {
    reset({
      cargo_manifest: [{ id: 'm1', vehicle_id: 'veh-1', status: 'delivered', created_at: '2026-09-10T04:00:00Z', updated_at: '2026-09-10T10:00:00Z', pickup_lat: 18.52, pickup_lng: 73.85, drop_lat: 19.07, drop_lng: 72.87 }],
      driver_pay_entries: [{ id: 'e1', driver_id: 'driver-1', vehicle_id: 'veh-1', manifest_id: 'm1', trip_date: '2026-09-10', km: 150.5, km_source: 'gps', amount: 0, status: 'earned', adjustments: [] }],
    });
    const res = await request(app).get(api('/routes?vehicle_id=veh-1')).set(admin());
    expect(res.body.find((r: any) => r.id === 'm1')).toMatchObject({ distance_km: 150.5, distance_basis: 'actual' });
  });
});

describe('the odometer moves when a trip completes', () => {
  it('takes in the trip distance (the pay entry\'s, when the route was planned with none) for a vehicle with a reading', async () => {
    reset({
      vehicles: [{ id: 'veh-1', driver_id: 'driver-1', vehicle_type: 'truck', status: 'on_route', plate_number: 'DL01AL0010', odometer_km: 1000, odometer_updated_at: '2026-09-01T00:00:00Z' }],
      routes: [{ ...route('r1', { status: 'active', route_stops: stopsDelhiToPune('r1') }), completed_at: null }],
    });
    await routeService.changeStatus('r1', 'completed');
    const vehicle = supabaseMock.rows('vehicles')[0];
    expect(entries()[0]).toMatchObject({ route_id: 'r1', km_source: 'estimated' });
    expect(vehicle.odometer_km).toBeGreaterThan(1000 + 1000);
    expect(vehicle.odometer_source).toBe('routes');
  });

  it('leaves a vehicle with no starting reading alone (it is not guessed)', async () => {
    reset({
      routes: [{ ...route('r1', { status: 'active', total_distance_km: 300 }), completed_at: null }],
    });
    await routeService.changeStatus('r1', 'completed');
    expect(supabaseMock.rows('vehicles')[0].odometer_km ?? null).toBeNull();
    expect(entries()).toHaveLength(1);
  });
});
