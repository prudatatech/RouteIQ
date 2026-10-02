/**
 * Phase 2, operations and fleet (docs/tenancy-design.md §5): two logistic companies share one database, and each
 * sees and changes only its own records. Another company's record is a 404 (never a 403, so ids cannot be probed),
 * a platform admin acting as the platform sees everything, and staff notifications reach only the members of the
 * company that owns the record, plus the platform's owners and admins.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'net';
import http from 'http';
import WebSocket from 'ws';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { createHttpServer } from '../src/app';
import { wsManager } from '../src/core/websocket';
import { notificationService, PLATFORM } from '../src/services/notification.service';
import { clearAllMemos } from '../src/core/memo';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const NOW = new Date().toISOString();
const ids = (body: any) => (Array.isArray(body) ? body : body.items ?? []).map((r: any) => r.id).sort();

const U = {
  va1: 'a1000000-0000-4000-8000-000000000001', va2: 'a1000000-0000-4000-8000-000000000002', vb1: 'b1000000-0000-4000-8000-000000000001',
  sa1: '51000000-0000-4000-8000-0000000000a1', sb1: '51000000-0000-4000-8000-0000000000b1',
  ra1: 'b0000000-0000-4000-8000-0000000000a1', rb1: 'b0000000-0000-4000-8000-0000000000b1',
  soA: '50500000-0000-4000-8000-0000000000a1', soB: '50500000-0000-4000-8000-0000000000b1',
  alA: 'a1e00000-0000-4000-8000-0000000000a1', alB: 'a1e00000-0000-4000-8000-0000000000b1',
  wA: 'c0000000-0000-4000-8000-0000000000a1', wB: 'c0000000-0000-4000-8000-0000000000b1',
  eA: 'e0000000-0000-4000-8000-0000000000a1', eB: 'e0000000-0000-4000-8000-0000000000b1',
  tA: '70000000-0000-4000-8000-0000000000a1', tB: '70000000-0000-4000-8000-0000000000b1',
  dpA: 'd0000000-0000-4000-8000-0000000000a1', dpB: 'd0000000-0000-4000-8000-0000000000b1', dpO: 'd0000000-0000-4000-8000-0000000000c1',
  flA: 'f1000000-0000-4000-8000-0000000000a1', flB: 'f1000000-0000-4000-8000-0000000000b1',
  plB: 'f2000000-0000-4000-8000-0000000000b1', slB: 'f3000000-0000-4000-8000-0000000000b1',
  jobB: 'f4000000-0000-4000-8000-0000000000b1', mA: 'f5000000-0000-4000-8000-0000000000a1', mB: 'f5000000-0000-4000-8000-0000000000b1',
};

const vehicle = (id: string, org: string, plate: string, extra: Row = {}): Row => ({
  id, plate_number: plate, vehicle_type: 'truck', capacity_kg: 5000, available_capacity_kg: 5000, current_load_kg: 0, status: 'available',
  latitude: 18.5, longitude: 73.8, odometer_km: 1000, driver_id: null, carrier_org_id: org, created_at: NOW, ...extra,
});
const shipment = (id: string, org: string, track: string): Row => ({
  id, tracking_id: track, status: 'created', priority: 'medium', origin_name: 'Hub', total_items: 1, total_weight_kg: 100,
  created_at: NOW, updated_at: NOW, metadata: {}, carrier_org_id: org, is_master: false, origin_lat: 19.1, origin_lng: 73.1,
});
const route = (id: string, org: string, vehicleId: string, status = 'active'): Row => ({ id, vehicle_id: vehicleId, status, created_at: NOW, carrier_org_id: org });

function seed(opts: { configured?: boolean } = {}) {
  clearAllMemos();
  supabaseMock.reset({
    ...orgWorld({}, opts),
    vehicles: [vehicle(U.va1, ORG.companyA, 'MH01AA0001'), vehicle(U.va2, ORG.companyA, 'MH01AA0002'), vehicle(U.vb1, ORG.companyB, 'MH01BB0001', { driver_id: uid('driver-b') })],
    shipments: [shipment(U.sa1, ORG.companyA, 'RTX-ALPHA1'), shipment(U.sb1, ORG.companyB, 'RTX-BETA1')],
    routes: [route(U.ra1, ORG.companyA, U.va1), route(U.rb1, ORG.companyB, U.vb1)],
    sos_alerts: [
      { id: U.soA, vehicle_id: U.va1, driver_id: uid('driver-a'), alert_type: 'panic_button', status: 'active', created_at: NOW, updated_at: NOW, carrier_org_id: ORG.companyA },
      { id: U.soB, vehicle_id: U.vb1, driver_id: uid('driver-b'), alert_type: 'panic_button', status: 'active', created_at: NOW, updated_at: NOW, carrier_org_id: ORG.companyB },
    ],
    maintenance_alerts: [
      { id: U.alA, vehicle_id: U.va1, alert_type: 'overspeed', severity: 'high', description: 'Fast', is_resolved: false, status: 'open', is_test: false, occurrences: 1, created_at: NOW, carrier_org_id: ORG.companyA },
      { id: U.alB, vehicle_id: U.vb1, alert_type: 'overspeed', severity: 'high', description: 'Fast', is_resolved: false, status: 'open', is_test: false, occurrences: 1, created_at: NOW, carrier_org_id: ORG.companyB },
    ],
    capacity_windows: [
      { id: U.wA, vehicle_id: U.va1, status: 'open', opens_at: '2026-01-01T00:00:00Z', closes_at: '2099-01-01T00:00:00Z', winning_bid_id: null, carrier_org_id: ORG.companyA, vehicles: { vehicle_type: 'truck', plate_number: 'MH01AA0001' } },
      { id: U.wB, vehicle_id: U.vb1, status: 'open', opens_at: '2026-01-01T00:00:00Z', closes_at: '2099-01-01T00:00:00Z', winning_bid_id: null, carrier_org_id: ORG.companyB, vehicles: { vehicle_type: 'truck', plate_number: 'MH01BB0001' } },
    ],
    capacity_bids: [], cargo_manifest: [
      { id: U.mA, status: 'scheduled', vehicle_id: U.va1, carrier_org_id: ORG.companyA, created_at: NOW, pickup_lat: 19.1, pickup_lng: 73.1, drop_lat: 18.5, drop_lng: 73.8, pickup_location: 'P', drop_location: 'D' },
      { id: U.mB, status: 'scheduled', vehicle_id: U.vb1, carrier_org_id: ORG.companyB, created_at: NOW, pickup_lat: 19.1, pickup_lng: 73.1, drop_lat: 18.5, drop_lng: 73.8, pickup_location: 'P', drop_location: 'D' },
    ],
    cargo_exceptions: [
      { id: U.eA, code: 'EXC-AAA111', type: 'damage', severity: 'medium', status: 'open', vehicle_id: U.va1, lat: 18.5, lng: 73.8, notes: [], sla_due_at: '2099-01-01T00:00:00Z', created_at: NOW, updated_at: NOW, carrier_org_id: ORG.companyA },
      { id: U.eB, code: 'EXC-BBB111', type: 'damage', severity: 'medium', status: 'open', vehicle_id: U.vb1, lat: 28.6, lng: 77.2, notes: [], sla_due_at: '2099-01-01T00:00:00Z', created_at: NOW, updated_at: NOW, carrier_org_id: ORG.companyB },
    ],
    cargo_transfers: [
      { id: U.tA, code: 'TRF-AAA111', status: 'planned', from_vehicle_id: U.va1, planned_at: NOW, carrier_org_id: ORG.companyA },
      { id: U.tB, code: 'TRF-BBB111', status: 'planned', from_vehicle_id: U.vb1, planned_at: NOW, carrier_org_id: ORG.companyB },
    ],
    cargo_exception_items: [], cargo_transfer_items: [], cargo_claims: [], depots: [],
    delivery_points: [
      { id: U.dpA, name: 'Alpha drop', status: 'pending', shipment_id: U.sa1, created_at: NOW, shipments: { carrier_org_id: ORG.companyA }, route_stops: [] },
      { id: U.dpB, name: 'Beta drop', status: 'pending', shipment_id: U.sb1, created_at: NOW, shipments: { carrier_org_id: ORG.companyB }, route_stops: [] },
      { id: U.dpO, name: 'Orphan', status: 'pending', shipment_id: null, created_at: NOW, shipments: null, route_stops: [] },
    ],
    route_stops: [], parcels: [], shipment_logs: [], gps_points: [], telemetry: [], vendor_profiles: [], customers: [], customer_bookings: [],
    vendor_shipment_requests: [], invoices: [], user_profiles: [], user_documents: [], vehicle_maintenance_jobs: [], cargo_custody_events: [],
    vehicle_fuel_logs: [{ id: U.flA, vehicle_id: U.va1, filled_at: NOW, litres: 50, price_per_litre: 100, total_amount: 5000, flags: [], created_at: NOW }, { id: U.flB, vehicle_id: U.vb1, filled_at: NOW, litres: 60, price_per_litre: 100, total_amount: 6000, flags: ['no_bill'], created_at: NOW }],
    vehicle_service_plans: [{ id: U.plB, vehicle_id: U.vb1, item: 'Oil', interval_km: 10000, interval_days: null, last_done_km: 0, last_done_at: null }],
    vehicle_share_links: [{ id: U.slB, vehicle_id: U.vb1, token_hash: 'x', created_at: NOW, expires_at: '2099-01-01T00:00:00Z', revoked_at: null }],
    vehicle_service_log: [], vehicle_service_items: [], vehicle_service_attachments: [], vehicle_photos: [], vehicle_odometer_events: [], driver_confirmations: [],
    system_settings: [...orgWorld({}, opts).system_settings],
  });
}

const get = (path: string, who: string, org?: string) => request(app).get(api(path)).set(as(who, org));
const post = (path: string, who: string, body: object = {}, org?: string) => request(app).post(api(path)).set(as(who, org)).send(body);
const put = (path: string, who: string, body: object = {}, org?: string) => request(app).put(api(path)).set(as(who, org)).send(body);
const patch = (path: string, who: string, body: object = {}, org?: string) => request(app).patch(api(path)).set(as(who, org)).send(body);
const del = (path: string, who: string, org?: string) => request(app).delete(api(path)).set(as(who, org));

describe('Today, the dashboard and search count only the company\'s own records', () => {
  beforeEach(() => seed());

  it('Today: open SOS, trips and vehicles on the road', async () => {
    const a = await get('/ops/today', 'admin-a');
    expect(a.status).toBe(200);
    expect(a.body.queues.sos.count).toBe(1);
    expect(a.body.live.active_trips).toBe(1);
    expect(a.body.live.vehicles_on_road).toBe(1);
  });

  it('Today: the platform sees both companies, a company only itself', async () => {
    seed();
    const b = await get('/ops/today', 'admin-b');
    expect(b.body.queues.sos.count).toBe(1);
    const platform = await get('/ops/today', 'super-1', ORG.platform);
    expect(platform.body.queues.sos.count).toBe(2);
    expect(platform.body.live.active_trips).toBe(2);
  });

  it('Today: shipments waiting for a vehicle, trips to send and open problems', async () => {
    seed();
    supabaseMock.reset({
      ...(Object.fromEntries(['vehicles', 'shipments', 'cargo_exceptions', 'sos_alerts'].map(t => [t, supabaseMock.rows(t)]))),
      ...orgWorld(),
      routes: [route(U.ra1, ORG.companyA, U.va1, 'pending'), route(U.rb1, ORG.companyB, U.vb1, 'pending'), route('b0000000-0000-4000-8000-0000000000b9', ORG.companyB, U.vb1, 'pending')],
    });
    const a = (await get('/ops/today', 'admin-a')).body.queues;
    const b = (await get('/ops/today', 'admin-b')).body.queues;
    expect(a.trips_to_send.count).toBe(1);
    expect(b.trips_to_send.count).toBe(2);
    expect(a.needs_vehicle.shipments).toBe(1);
    expect(a.problems.count).toBe(1);
    expect(b.problems.count).toBe(1);
  });

  it('the dashboard: active vehicles and shipment counts', async () => {
    seed();
    supabaseMock.reset({
      ...orgWorld(),
      vehicles: [vehicle(U.va1, ORG.companyA, 'A1', { status: 'on_route' }), vehicle(U.vb1, ORG.companyB, 'B1', { status: 'on_route' }), vehicle('b1000000-0000-4000-8000-000000000002', ORG.companyB, 'B2', { status: 'on_route' })],
      routes: [route(U.ra1, ORG.companyA, U.va1), route(U.rb1, ORG.companyB, U.vb1)],
      shipments: [shipment(U.sa1, ORG.companyA, 'RTX-ALPHA1'), shipment(U.sb1, ORG.companyB, 'RTX-BETA1')],
      cargo_manifest: [],
    });
    expect((await get('/dashboard/kpis', 'admin-a')).body.active_vehicles).toBe(1);
    expect((await get('/dashboard/kpis', 'admin-b')).body.active_vehicles).toBe(2);
    expect((await get('/dashboard/shipment-counts', 'admin-a')).body.counts.created).toBe(1);
    expect((await get('/dashboard/shipment-counts', 'super-1', ORG.platform)).body.counts.created).toBe(2);
  });

  it('global search finds a company\'s own plates and tracking ids, never the other company\'s', async () => {
    seed();
    const a = (await get('/search?q=MH01', 'admin-a')).body.results;
    expect(a.vehicles.map((v: any) => v.id).sort()).toEqual([U.va1, U.va2]);
    expect((await get('/search?q=MH01', 'admin-b')).body.results.vehicles.map((v: any) => v.id)).toEqual([U.vb1]);
    expect((await get('/search?q=RTX-', 'admin-a')).body.results.shipments.map((s: any) => s.id)).toEqual([U.sa1]);
    expect((await get('/search?q=RTX-BETA', 'admin-a')).body.results.shipments).toEqual([]);
    expect((await get('/search?q=RTX-', 'super-1', ORG.platform)).body.results.shipments).toHaveLength(2);
  });

  it('search lists only the company\'s people', async () => {
    seed();
    const names = (who: string) => get('/search?q=Alpha', who).then(r => r.body.results.users.map((u: any) => u.id));
    expect(await names('admin-a')).toContain(uid('driver-a'));
    expect(await names('admin-b')).toEqual([]);
  });
});

describe('the live map and the live feed carry only the company\'s vehicles', () => {
  beforeEach(() => seed());

  it('positions come from the company\'s own vehicles', async () => {
    expect(ids((await get('/vehicles', 'admin-a')).body)).toEqual([U.va1, U.va2]);
    expect(ids((await get('/vehicles', 'admin-b')).body)).toEqual([U.vb1]);
    expect((await get(`/telemetry/${U.vb1}/history`, 'admin-a')).status).toBe(404);
    expect((await get(`/telemetry/${U.va1}/history`, 'admin-a')).status).toBe(200);
    expect((await get(`/gps/vehicle/${U.vb1}`, 'admin-a')).status).toBe(404);
    expect((await get(`/telemetry/${U.vb1}/live`, 'admin-a')).status).toBe(404);
  });

  it('a phone-tracking session is made only for the company\'s own vehicle', async () => {
    expect((await post('/telemetry/mobile-session', 'admin-a', { vehicle_id: U.vb1 })).status).toBe(404);
    expect((await post('/telemetry/mobile-session', 'admin-a', { vehicle_id: U.va1 })).status).toBe(200);
  });

  describe('the WebSocket', () => {
    let server: http.Server;
    let wsUrl: string;
    beforeAll(async () => {
      server = createHttpServer();
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/telemetry/ws`;
    });
    afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

    const open = (who: string, org?: string) => new Promise<{ ws: WebSocket; got: any[] }>((resolve, reject) => {
      const token = supabaseMock.signUserToken(uid(who));
      const ws = new WebSocket(`${wsUrl}?token=${token}${org ? `&org=${org}` : ''}`);
      const got: any[] = [];
      ws.on('message', m => got.push(JSON.parse(String(m))));
      ws.on('open', () => resolve({ ws, got }));
      ws.on('error', reject);
    });
    const settle = () => new Promise(r => setTimeout(r, 80));

    it('each company hears its own vehicles, the platform hears all, and a stranger\'s org is refused', async () => {
      const a = await open('admin-a');
      const b = await open('admin-b');
      const platform = await open('super-1', ORG.platform);
      await wsManager.broadcast({ type: 'TELEMETRY_UPDATE', data: { vehicle_id: U.va1 } }, ORG.companyA);
      await wsManager.broadcast({ type: 'TELEMETRY_UPDATE', data: { vehicle_id: U.vb1 } }, ORG.companyB);
      await wsManager.broadcast({ type: 'TELEMETRY_UPDATE', data: { vehicle_id: 'unowned' } });
      await settle();
      expect(a.got.map(m => m.data.vehicle_id)).toEqual([U.va1]);
      expect(b.got.map(m => m.data.vehicle_id)).toEqual([U.vb1]);
      expect(platform.got.map(m => m.data.vehicle_id)).toEqual([U.va1, U.vb1, 'unowned']);
      for (const c of [a, b, platform]) c.ws.close();

      const refused = await new Promise<number>(resolve => {
        const ws = new WebSocket(`${wsUrl}?token=${supabaseMock.signUserToken(uid('admin-a'))}&org=${ORG.companyB}`);
        ws.on('unexpected-response', (_q, res) => resolve(res.statusCode!));
        ws.on('open', () => { ws.close(); resolve(101); });
        ws.on('error', () => undefined);
      });
      expect(refused).toBe(403);
    });
  });
});

describe('vehicle sub-routes and actions: another company\'s vehicle is a 404', () => {
  beforeEach(() => seed());

  it('status, archive and delete', async () => {
    expect((await post(`/vehicles/${U.vb1}/status`, 'admin-a', { status: 'maintenance' })).status).toBe(404);
    expect((await post(`/vehicles/${U.vb1}/archive`, 'admin-a')).status).toBe(404);
    expect((await del(`/vehicles/${U.vb1}`, 'admin-a')).status).toBe(404);
    expect((await patch(`/vehicles/${U.vb1}`, 'admin-a', { current_location_name: 'x' })).status).toBe(404);
    expect(supabaseMock.writes('vehicles').filter(w => w.method !== 'POST')).toEqual([]);
    expect((await post(`/vehicles/${U.va2}/status`, 'admin-a', { status: 'maintenance' })).status).toBe(200);
  });

  it('photos, SOS history and raising an SOS', async () => {
    expect((await get(`/vehicles/${U.vb1}/photos`, 'admin-a')).status).toBe(404);
    expect((await post(`/vehicles/${U.vb1}/photos/upload-url`, 'admin-a', { slot: 'front', content_type: 'image/jpeg', size: 1000 })).status).toBe(404);
    expect((await get(`/vehicles/${U.vb1}/sos`, 'admin-a')).status).toBe(404);
    expect((await get(`/vehicles/${U.va1}/photos`, 'admin-a')).status).toBe(200);
    expect((await post(`/vehicles/${U.vb1}/sos`, 'admin-a', { alert_type: 'breakdown' })).status).toBe(404);
    expect((await post(`/vehicles/${U.vb1}/return-trip`, 'admin-a', {})).status).toBe(404);
  });

  it('share links, odometer, service plans and log, health and location', async () => {
    for (const [method, path, body] of [
      ['get', `/fleet/vehicles/${U.vb1}/share-links`, {}],
      ['post', `/fleet/vehicles/${U.vb1}/share-links`, {}],
      ['put', `/fleet/vehicles/${U.vb1}/odometer`, { odometer_km: 2000 }],
      ['get', `/fleet/vehicles/${U.vb1}/service-plans`, {}],
      ['post', `/fleet/vehicles/${U.vb1}/service-plans`, { item: 'Oil', interval_km: 10000 }],
      ['get', `/fleet/vehicles/${U.vb1}/service-log`, {}],
      ['post', `/fleet/vehicles/${U.vb1}/service-log`, { item: 'Oil', done_at: '2026-10-01' }],
      ['get', `/fleet/vehicles/${U.vb1}/health`, {}],
      ['get', `/fleet/vehicles/${U.vb1}/location`, {}],
      ['get', `/fleet/vehicles/${U.vb1}/activity`, {}],
      ['get', `/fleet/vehicles/${U.vb1}/maintenance/preview`, {}],
      ['post', `/fleet/vehicles/${U.vb1}/maintenance`, { reason_type: 'breakdown' }],
      ['post', `/fleet/vehicles/${U.vb1}/odometer/sync`, {}],
      ['get', `/fleet/vehicles/${U.vb1}/fuel-logs`, {}],
      ['get', `/fleet/vehicles/${U.vb1}/fuel-stats`, {}],
      ['delete', `/fleet/share-links/${U.slB}`, {}],
      ['delete', `/fleet/service-plans/${U.plB}`, {}],
    ] as const) {
      const res = await (request(app) as any)[method](api(path)).set(as('admin-a')).send(body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(supabaseMock.writes('vehicle_share_links')).toEqual([]);
    expect(supabaseMock.writes('vehicle_service_plans')).toEqual([]);
    expect((await get(`/fleet/vehicles/${U.va1}/share-links`, 'admin-a')).status).toBe(200);
    expect((await get(`/fleet/vehicles/${U.va1}/health`, 'admin-a')).status).toBe(200);
    expect((await put(`/fleet/vehicles/${U.va1}/odometer`, 'admin-a', { odometer_km: 2000 })).status).toBe(200);
  });

  it('fuel logs: another company\'s entry cannot be changed, and the summary is the company\'s own', async () => {
    expect((await put(`/fleet/fuel-logs/${U.flB}`, 'admin-a', { litres: 10 })).status).toBe(404);
    expect((await del(`/fleet/fuel-logs/${U.flB}`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('vehicle_fuel_logs')).toEqual([]);
    expect((await get('/fleet/fuel-summary', 'admin-a')).body.vehicles_with_logs).toBe(1);
    expect((await get('/fleet/fuel-anomalies?reviewed=all', 'admin-a')).body.map((l: any) => l.id)).toEqual([]);
    expect((await get('/fleet/fuel-anomalies?reviewed=all', 'admin-b')).body.map((l: any) => l.id)).toEqual([U.flB]);
  });

  it('fleet health, analytics and alerts list only the company\'s own', async () => {
    expect((await get('/fleet/health', 'admin-a')).body.map((h: any) => h.vehicle_id).sort()).toEqual([U.va1, U.va2]);
    expect((await get('/fleet/health', 'admin-b')).body.map((h: any) => h.vehicle_id)).toEqual([U.vb1]);
    expect((await get('/fleet/analytics', 'admin-b')).body.total_vehicles).toBe(1);
    expect((await get('/fleet/alerts', 'admin-a')).body.map((a: any) => a.id)).toEqual([U.alA]);
    expect((await get('/fleet/alerts', 'admin-b')).body.map((a: any) => a.id)).toEqual([U.alB]);
    expect((await get('/fleet/alerts/summary', 'admin-a')).body.open).toBe(1);
    expect((await get('/fleet/alerts', 'super-1', ORG.platform)).body).toHaveLength(2);
  });

  it('alerts: acknowledge and resolve', async () => {
    expect((await post(`/fleet/alerts/${U.alB}/acknowledge`, 'admin-a')).status).toBe(404);
    expect((await post(`/fleet/alerts/${U.alB}/resolve`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('maintenance_alerts', 'PATCH')).toEqual([]);
    expect((await post(`/fleet/alerts/${U.alA}/acknowledge`, 'admin-a')).status).toBe(200);
  });

  it('alert settings are each company\'s own, with the platform default underneath', async () => {
    expect((await put('/fleet/alert-settings', 'super-1', { overspeed_kmph: 60 }, ORG.companyA)).status).toBe(200);
    expect((await get('/fleet/alert-settings', 'admin-a')).body.values.overspeed_kmph).toBe(60);
    expect((await get('/fleet/alert-settings', 'admin-b')).body.values.overspeed_kmph).toBe(80);
    expect(supabaseMock.rows('system_settings').some(r => r.key === `alert_overspeed_kmph@${ORG.companyA}`)).toBe(true);
  });

  it('a platform admin acting as the platform reaches every vehicle', async () => {
    expect((await get(`/fleet/vehicles/${U.vb1}/share-links`, 'super-1', ORG.platform)).status).toBe(200);
    expect((await get(`/fleet/vehicles/${U.va1}/share-links`, 'super-1', ORG.platform)).status).toBe(200);
  });
});

describe('SOS and emergency', () => {
  beforeEach(() => seed());

  it('acknowledge, resolve and cancel touch only the company\'s own alerts', async () => {
    expect((await put(`/telemetry/sos/${U.soB}/acknowledge`, 'admin-a')).status).toBe(404);
    expect((await put(`/telemetry/sos/${U.soB}/resolve`, 'admin-a')).status).toBe(404);
    expect((await post(`/telemetry/sos/${U.soB}/cancel`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('sos_alerts', 'PATCH')).toEqual([]);
    expect((await put(`/telemetry/sos/${U.soA}/acknowledge`, 'admin-a')).status).toBe(200);
    expect((await put(`/telemetry/sos/${U.soA}/resolve`, 'manager-a')).status).toBe(200);
    expect((await post(`/telemetry/sos/${U.soB}/cancel`, 'admin-b')).status).toBe(200);
  });

  it('SOS counts per vehicle are the company\'s own', async () => {
    expect(Object.keys((await get('/vehicles/sos-counts', 'admin-a')).body)).toEqual([U.va1]);
    expect(Object.keys((await get('/vehicles/sos-counts', 'admin-b')).body)).toEqual([U.vb1]);
  });

  it('a driver\'s SOS is stamped with the vehicle\'s company and only that company hears of it', async () => {
    supabaseMock.reset({ ...orgWorld(), vehicles: [vehicle(U.va1, ORG.companyA, 'MH01AA0001', { driver_id: uid('driver-a'), driver_name: 'Ravi' }), vehicle(U.vb1, ORG.companyB, 'MH01BB0001')], sos_alerts: [] });
    const res = await post('/telemetry/sos/trigger', 'driver-a', { lat: 18.5, lng: 73.8 });
    expect(res.status).toBe(200);
    expect(supabaseMock.writes('sos_alerts', 'POST')[0].body.carrier_org_id).toBe(ORG.companyA);
    const told = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id);
    expect(told.sort()).toEqual([uid('admin-a'), uid('manager-a'), uid('super-1')].sort());
  });
});

describe('trips and dispatch', () => {
  beforeEach(() => seed());

  it('a trip of another company cannot be sent, cancelled, changed, rerouted or deleted', async () => {
    expect((await get(`/routes/${U.rb1}`, 'admin-a')).status).toBe(404);
    expect((await patch(`/routes/${U.rb1}/status`, 'admin-a', { status: 'cancelled' })).status).toBe(404);
    expect((await patch(`/routes/${U.rb1}`, 'admin-a', { status: 'cancelled' })).status).toBe(404);
    expect((await post(`/routes/${U.rb1}/reroute`, 'admin-a', { new_sequence: [] })).status).toBe(404);
    expect((await del(`/routes/${U.rb1}`, 'admin-a')).status).toBe(404);
    expect((await post(`/optimize/reoptimize/${U.rb1}`, 'admin-a')).status).toBe(404);
    expect((await get(`/weather/route/${U.rb1}`, 'admin-a')).status).toBe(404);
    expect((await post(`/optimize/incubate/${U.vb1}`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('routes')).toEqual([]);
    expect((await patch(`/routes/${U.ra1}/status`, 'admin-a', { status: 'cancelled' })).status).toBe(200);
  });

  it('a planned trip is made only on the company\'s own vehicle, and carries its company', async () => {
    const stops = [{ name: 'Pune', lat: 18.5, lng: 73.8 }, { name: 'Nashik', lat: 20, lng: 73.7 }];
    const plan = { stops, distance_km: 200, duration_minutes: 240, provider: 'tomtom', truck_aware: true, origin: { name: 'Hub', lat: 19, lng: 73 } };
    expect((await post('/routing/create-route', 'admin-a', { vehicle_id: U.vb1, ...plan })).status).toBe(404);
    const own = await post('/routing/create-route', 'admin-a', { vehicle_id: U.va2, ...plan });
    expect(own.status).toBe(201);
    expect(supabaseMock.writes('routes', 'POST')[0].body.carrier_org_id).toBe(ORG.companyA);
    // The platform acts for no company: the trip still belongs to the vehicle's
    const viaPlatform = await post('/routing/create-route', 'super-1', { vehicle_id: U.vb1, ...plan }, ORG.platform);
    expect(viaPlatform.status).toBe(201);
    expect(supabaseMock.writes('routes', 'POST')[1].body.carrier_org_id).toBe(ORG.companyB);
  });

  it('a stop that is part of another company\'s shipment cannot be planned', async () => {
    const plan = { vehicle_id: U.va2, stops: [{ name: 'Beta drop', lat: 18.5, lng: 73.8, delivery_point_id: U.dpB }], distance_km: 10, duration_minutes: 20, provider: 'tomtom', truck_aware: true, origin: { name: 'Hub', lat: 19, lng: 73 } };
    expect((await post('/routing/create-route', 'admin-a', plan)).status).toBe(404);
  });

  it('open loads for the planner are the company\'s own', async () => {
    expect((await get('/routing/open-loads', 'admin-a')).body.loads.map((l: any) => l.id).sort()).toEqual([U.mA, U.sa1].sort());
    expect((await get('/routing/open-loads', 'admin-b')).body.loads.map((l: any) => l.id).sort()).toEqual([U.mB, U.sb1].sort());
  });

  it('assigning: the shipment and the vehicle must both be the company\'s', async () => {
    expect((await post(`/shipments/${U.sb1}/assign`, 'admin-a', { vehicle_id: U.va1 })).status).toBe(404);
    expect((await post(`/shipments/${U.sa1}/assign`, 'admin-a', { vehicle_id: U.vb1 })).status).toBe(404);
    expect((await get(`/shipments/${U.sb1}/assign-options`, 'admin-a')).status).toBe(404);
    expect((await get(`/shipments/${U.sa1}/assign-options`, 'admin-a')).body.map((v: any) => v.id).sort()).toEqual([U.va1, U.va2]);
    expect((await patch(`/shipments/${U.sb1}`, 'admin-a', { status: 'created' })).status).toBe(404);
    expect((await patch(`/shipments/${U.sb1}/edit`, 'admin-a', { origin_name: 'x' })).status).toBe(404);
    expect((await del(`/shipments/${U.sb1}`, 'admin-a')).status).toBe(404);
    expect((await get(`/shipments/${U.sb1}/history`, 'admin-a')).status).toBe(404);
    expect((await get(`/shipments/${U.sb1}/proof`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('shipments')).toEqual([]);
    expect(supabaseMock.writes('routes')).toEqual([]);
  });

  it('delivery points are the company\'s own', async () => {
    expect(ids((await get('/routes/delivery-points', 'admin-a')).body)).toEqual([U.dpA]);
    expect(ids((await get('/routes/delivery-points', 'admin-b')).body)).toEqual([U.dpB]);
    expect(ids((await get('/routes/delivery-points', 'super-1', ORG.platform)).body)).toEqual([U.dpA, U.dpB, U.dpO].sort());
    expect((await get('/routes/delivery-points', 'admin-a')).body[0]).not.toHaveProperty('shipments');
  });
});

describe('capacity windows, company side', () => {
  beforeEach(() => seed());

  it('lists, closes and cancels only the company\'s own windows', async () => {
    expect(ids((await get('/capacity/windows', 'admin-a')).body)).toEqual([U.wA]);
    expect(ids((await get('/capacity/windows', 'admin-b')).body)).toEqual([U.wB]);
    expect((await get('/capacity/windows/open', 'admin-a')).body.map((w: any) => w.id)).toEqual([U.wA]);
    expect((await post(`/capacity/windows/${U.wB}/close`, 'admin-a')).status).toBe(404);
    expect((await post(`/capacity/windows/${U.wB}/cancel`, 'admin-a')).status).toBe(404);
    expect((await get(`/capacity/windows/${U.wB}/bid-count`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('capacity_windows', 'PATCH')).toEqual([]);
    expect((await post(`/capacity/windows/${U.wA}/close`, 'admin-a')).status).toBe(200);
  });

  it('opens a window only on the company\'s own vehicle', async () => {
    expect((await post('/capacity/windows', 'admin-a', { vehicle_id: U.vb1, floor_price: 100, duration_minutes: 60 })).status).toBe(404);
    expect((await post('/capacity/windows', 'admin-a', { vehicle_id: U.va2, floor_price: 100, duration_minutes: 60 })).status).toBe(201);
    expect(supabaseMock.writes('capacity_windows', 'POST')[0].body.carrier_org_id).toBe(ORG.companyA);
  });

  it('awarding and rejecting a bid on another company\'s window is a 404', async () => {
    const bid = 'bd000000-0000-4000-8000-0000000000b1';
    supabaseMock.reset({
      ...orgWorld(),
      vehicles: [vehicle(U.vb1, ORG.companyB, 'MH01BB0001')],
      capacity_windows: [{ id: U.wB, vehicle_id: U.vb1, status: 'closed', opens_at: NOW, closes_at: NOW, winning_bid_id: null, carrier_org_id: ORG.companyB }],
      capacity_bids: [{ id: bid, window_id: U.wB, vendor_id: uid('vendor-1'), status: 'pending', weight_kg: 10, bid_amount: 500, submitted_at: NOW, capacity_windows: { carrier_org_id: ORG.companyB, vehicles: { plate_number: 'x' } } }],
    });
    expect((await post(`/capacity/bids/${bid}/approve`, 'admin-a')).status).toBe(404);
    expect((await post(`/capacity/bids/${bid}/reject`, 'admin-a', { reason: 'Too low' })).status).toBe(404);
    expect(supabaseMock.writes('capacity_bids')).toEqual([]);
    expect((await get('/capacity/bids/pending', 'admin-a')).body).toEqual([]);
    expect((await get('/capacity/bids/pending', 'admin-b')).body.map((b: any) => b.id)).toEqual([bid]);
    expect((await post(`/capacity/bids/${bid}/reject`, 'admin-b', { reason: 'Too low' })).status).toBe(200);
  });
});

describe('cargo cases and transfers: actions', () => {
  beforeEach(() => seed());

  it('another company\'s case cannot be acted on', async () => {
    expect((await post(`/cargo/exceptions/${U.eB}/actions`, 'admin-a', { action: 'add_note', note: 'hi' })).status).toBe(404);
    expect((await post(`/cargo/exceptions/${U.eB}/actions`, 'admin-a', { action: 'set_status', status: 'investigating' })).status).toBe(404);
    expect((await get(`/cargo/exceptions/${U.eB}/relief-vehicles`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('cargo_exceptions', 'PATCH')).toEqual([]);
    expect((await post(`/cargo/exceptions/${U.eA}/actions`, 'admin-a', { action: 'add_note', note: 'hi' })).status).toBe(200);
  });

  it('relief vehicles are the company\'s own', async () => {
    supabaseMock.reset({
      ...orgWorld(),
      vehicles: [vehicle(U.va1, ORG.companyA, 'A1'), vehicle(U.va2, ORG.companyA, 'A2'), vehicle(U.vb1, ORG.companyB, 'B1')],
      cargo_exceptions: [{ id: U.eA, code: 'EXC-AAA111', type: 'damage', severity: 'medium', status: 'open', vehicle_id: U.va1, lat: 18.5, lng: 73.8, notes: [], created_at: NOW, updated_at: NOW, carrier_org_id: ORG.companyA }],
      cargo_exception_items: [], shipments: [], cargo_manifest: [],
    });
    const res = await get(`/cargo/exceptions/${U.eA}/relief-vehicles`, 'admin-a');
    expect(res.status).toBe(200);
    expect(res.body.vehicles.map((v: any) => v.vehicle.id)).toEqual([U.va2]);
  });

  it('transfers: plan only between the company\'s own vehicles, and act only on its own transfers', async () => {
    const body = { from_vehicle_id: U.vb1, to_depot_id: 'd0000000-0000-4000-8000-0000000000d1', items: [{ ref: { shipment_id: U.sb1 }, pieces: 1 }] };
    expect((await post('/cargo/transfers', 'admin-a', body)).status).toBe(404);
    expect((await post(`/cargo/transfers/${U.tB}/cancel`, 'admin-a', {})).status).toBe(404);
    expect((await post(`/cargo/transfers/${U.tB}/eway`, 'admin-a', { eway_part_b_ref: '123456789012' })).status).toBe(404);
    expect((await post(`/cargo/transfers/${U.tB}/handover-out`, 'admin-a', { items: [{ ref: { shipment_id: U.sb1 }, pieces_out: 1 }] })).status).toBe(404);
    expect((await get(`/cargo/transfers/${U.tB}`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('cargo_transfers')).toEqual([]);
    expect((await post(`/cargo/transfers/${U.tA}/cancel`, 'admin-a', {})).status).toBe(200);
  });

  it('custody, lots and OTP on another company\'s shipment are a 404', async () => {
    expect((await post('/cargo/custody', 'admin-a', { ref: { shipment_id: U.sb1 }, kind: 'pickup', notes: 'x' })).status).toBe(404);
    expect((await post('/cargo/lots/split', 'admin-a', { ref: { shipment_id: U.sb1 }, reason: 'manual', lots: [{ pieces: 1 }] })).status).toBe(404);
    expect((await post('/cargo/lots/eway', 'admin-a', { ref: { shipment_id: U.sb1 }, eway_bill_ref: '123456789012' })).status).toBe(404);
    expect((await post('/cargo/otp/send', 'admin-a', { ref: { shipment_id: U.sb1 } })).status).toBe(404);
    expect((await get(`/cargo/where/${U.sb1}`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.writes('shipments')).toEqual([]);
  });

  it('a case opened by the system belongs to the vehicle\'s company, and only that company is told', async () => {
    supabaseMock.reset({
      ...orgWorld(),
      vehicles: [vehicle(U.vb1, ORG.companyB, 'B1')], cargo_exceptions: [], cargo_exception_items: [], shipments: [], cargo_manifest: [],
    });
    const { openException } = await import('../src/services/cargo/exception.service');
    const opened = await openException({ type: 'vehicle_breakdown', source: 'custody', description: 'Engine', items: [], vehicle_id: U.vb1 }, null);
    expect(opened.row.carrier_org_id ?? supabaseMock.writes('cargo_exceptions', 'POST')[0].body.carrier_org_id).toBe(ORG.companyB);
    expect(supabaseMock.writes('cargo_exceptions', 'POST')[0].body.carrier_org_id).toBe(ORG.companyB);
    expect(supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id).sort()).toEqual([uid('admin-b'), uid('super-1')].sort());
  });
});

describe('notifyStaff: the right company\'s members, plus the platform\'s admins', () => {
  beforeEach(() => seed());
  const told = () => supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id).sort();

  it('names the owning company', async () => {
    await notificationService.notifyStaff('SOS', 'x', 'sos', {}, ORG.companyA);
    expect(told()).toEqual([uid('admin-a'), uid('manager-a'), uid('super-1')].sort());
    supabaseMock.reset({ ...orgWorld(), notifications: [] });
    await notificationService.notifyStaff('SOS', 'x', 'sos', {}, ORG.companyB);
    expect(told()).toEqual([uid('admin-b'), uid('super-1')].sort());
  });

  it('keeps managers out of what only admins handle', async () => {
    await notificationService.notifyStaff('Bid', 'x', 'capacity_bid', {}, ORG.companyA);
    expect(told()).toEqual([uid('admin-a'), uid('super-1')].sort());
  });

  it('news about the platform itself goes to the platform\'s owners and admins only', async () => {
    await notificationService.notifyStaff('3PL application', 'x', 'tpl_application', {}, PLATFORM);
    expect(told()).toEqual([uid('super-1')]);
  });

  it('without a company, the company of the request is used', async () => {
    const res = await post('/telemetry/call-driver/' + U.vb1, 'admin-a');
    expect(res.status).toBe(404);
  });

  it('before organisations are set up, every staff member is told, as before', async () => {
    supabaseMock.reset({ ...orgWorld({}, { configured: false }), notifications: [] });
    await notificationService.notifyStaff('SOS', 'x', 'sos', {}, null);
    expect(told()).toEqual([uid('admin-a'), uid('admin-b'), uid('manager-a'), uid('super-1'), uid('loner')].sort());
  });

  it('a fleet alarm tells the vehicle\'s company, whoever raised it', async () => {
    const { raiseAlert } = await import('../src/services/alerts.service');
    supabaseMock.reset({ ...orgWorld(), vehicles: [vehicle(U.vb1, ORG.companyB, 'B1')], maintenance_alerts: [] });
    await raiseAlert({ vehicleId: U.vb1, plate: 'B1', type: 'overspeed', description: 'Fast', source: 'webhook' });
    expect(supabaseMock.writes('maintenance_alerts', 'POST')[0].body.carrier_org_id).toBe(ORG.companyB);
    expect(told()).toEqual([uid('admin-b'), uid('super-1')].sort());
  });

  it('the SOS reminder (scheduler) tells the alert\'s company only', async () => {
    const { escalateStaleSos } = await import('../src/services/sos.service');
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    supabaseMock.reset({
      ...orgWorld(),
      vehicles: [vehicle(U.va1, ORG.companyA, 'A1'), vehicle(U.vb1, ORG.companyB, 'B1')],
      sos_alerts: [{ id: U.soB, vehicle_id: U.vb1, alert_type: 'panic_button', status: 'active', created_at: old, updated_at: old, carrier_org_id: ORG.companyB }],
    });
    await escalateStaleSos();
    expect(told()).toEqual([uid('admin-b'), uid('super-1')].sort());
  });
});

describe('before organisations are set up, nothing changes', () => {
  it('every company-looking record is reachable', async () => {
    seed({ configured: false });
    expect(ids((await get('/vehicles', 'admin-a')).body)).toEqual([U.va1, U.va2, U.vb1]);
    expect((await get(`/fleet/vehicles/${U.vb1}/share-links`, 'admin-a')).status).toBe(200);
    expect((await put(`/telemetry/sos/${U.soB}/acknowledge`, 'admin-a')).status).toBe(200);
    expect((await get('/ops/today', 'admin-a')).body.queues.sos.count).toBe(2);
  });
});
