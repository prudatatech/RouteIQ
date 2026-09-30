import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { AnalyticsService } from '../src/services/analytics.service';
import { InvoiceService } from '../src/services/invoice.service';
import { resetMlHealth } from '../src/services/optimizer/ml-client';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const users = [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true }];
const NOW = new Date().toISOString();

describe('shipment counts and deliveries include vendor loads', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users,
      shipments: [{ id: 's1', status: 'created' }, { id: 's2', status: 'assigned' }, { id: 's3', status: 'delivered', updated_at: NOW }],
      cargo_manifest: [
        { id: 'm1', status: 'scheduled', updated_at: NOW },
        { id: 'm2', status: 'in_transit', updated_at: NOW },
        { id: 'm3', status: 'delivered', updated_at: NOW },
        { id: 'm4', status: 'completed', updated_at: NOW },
      ],
      shipment_logs: [{ id: 'l1', shipment_id: 's3', status: 'delivered', timestamp: NOW }],
      vehicles: [], routes: [], vendor_shipment_requests: [],
    });
  });

  it('counts scheduled loads as created and delivered or completed ones as delivered', async () => {
    const res = await request(app).get('/api/v1/dashboard/shipment-counts').set(admin());
    expect(res.body.counts).toEqual({
      created: 2, assigned: 1, picked_up: 0, in_transit: 1, delivered: 3, cancelled: 0, exception: 0,
      out_for_delivery: 0, at_hub: 0, partially_delivered: 0, on_hold: 0, returning: 0, returned: 0, lost: 0,
    });
    expect(res.body.total).toBe(7);
  });

  it('counts deliveries today from when they were delivered, vendor loads included', async () => {
    const overview = await AnalyticsService.getFleetOverview();
    expect(overview.deliveries_today).toBe(3);
  });

  it('does not count a delivery today because the row was edited today', async () => {
    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString();
    supabaseMock.rows('shipment_logs')[0].timestamp = lastWeek;
    const overview = await AnalyticsService.getFleetOverview();
    expect(overview.deliveries_today).toBe(2);
  });
});

describe('vendor request analytics', () => {
  it('counts completed requests as delivered work', async () => {
    supabaseMock.reset({
      vendor_profiles: [{ id: 'v1', company_name: 'Acme', city: 'Pune', is_verified: true, kyc_status: 'approved' }],
      vendor_shipment_requests: [
        { id: 'r1', vendor_id: 'v1', status: 'completed', cost: 1000 },
        { id: 'r2', vendor_id: 'v1', status: 'assigned', cost: 500 },
        { id: 'r3', vendor_id: 'v1', status: 'pending', cost: null },
      ],
    });
    const [vendor] = await AnalyticsService.getVendorPerformance();
    expect(vendor.deliveries).toBe(2);
  });
});

describe('vendor-load invoices', () => {
  const manifest = { id: 'm1', vendor_request_id: 'r1', pickup_lat: 19.3, pickup_lng: 73.06, drop_lat: 18.52, drop_lng: 73.85 };
  const reset = (requestRow: Record<string, unknown>) => supabaseMock.reset({
    cargo_manifest: [manifest],
    vendor_shipment_requests: [{ id: 'r1', vendor_id: 'v1', cost: null, cost_per_km: null, metadata: {}, ...requestRow }],
    invoices: [],
  });

  it('bills the agreed cost with the GST rate the vendor entered', async () => {
    reset({ cost: 10000, metadata: { cargo: { gstRate: 18 } } });
    expect((await InvoiceService.createForManifest('m1')).status).toBe('created');
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ amount: 10000, gst_rate: 18, gst_amount: 1800, total: 11800, price_source: 'vendor_request' });
  });

  it('prices a rate per km over the trip distance', async () => {
    reset({ cost_per_km: 20 });
    expect((await InvoiceService.createForManifest('m1')).status).toBe('created');
    const invoice = supabaseMock.rows('invoices')[0];
    expect(invoice.price_source).toBe('vendor_rate_per_km');
    expect(invoice.amount).toBeGreaterThan(20 * 100);
    expect(invoice.amount % 20).toBe(0);
    expect(invoice.gst_rate).toBe(0);
  });

  it('stays unpriced with neither a cost nor a rate', async () => {
    reset({});
    expect((await InvoiceService.createForManifest('m1')).status).toBe('unpriced');
  });
});

describe('the optimizer', () => {
  const VEH = '11111111-1111-4111-8111-111111111111';
  const TEMP = '11111111-1111-4111-8111-111111111112';
  const DRAFT = '11111111-1111-4111-8111-111111111113';
  const MAINT = '11111111-1111-4111-8111-111111111114';
  const DEPOT = '22222222-2222-4222-8222-222222222222';
  const SHIP = '00000000-0000-4000-8000-000000000000';
  let sentToMl: any = null;
  const globalFetch = globalThis.fetch;

  beforeEach(() => {
    sentToMl = null;
    const stops = (id: string, created: string) => ({ id, latitude: 21.2, longitude: 79.1, created_at: created, name: id });
    supabaseMock.reset({
      users,
      depots: [{ id: DEPOT, name: 'Depot', latitude: 21.14, longitude: 79.08 }],
      vehicles: [
        { id: VEH, plate_number: 'MH12AB1234', status: 'available', capacity_kg: 5000, driver_id: 'driver-1' },
        { id: TEMP, plate_number: 'TEMP-ABC123', status: 'available', capacity_kg: 5000 },
        { id: DRAFT, plate_number: 'DRFT-ABC123', status: 'available', capacity_kg: 5000 },
        { id: MAINT, plate_number: 'MH12ZZ0001', status: 'maintenance', capacity_kg: 5000 },
      ],
      shipments: [{
        id: SHIP, status: 'created', total_weight_kg: 100, origin_lat: 21.1, origin_lng: 79.0,
        delivery_points: [stops('dp-last', '2026-09-29T10:00:00.002Z'), stops('dp-first', '2026-09-29T10:00:00.001Z')],
      }],
      delivery_points: [], routes: [], route_stops: [], notifications: [], shipment_logs: [], customer_bookings: [],
    });
    supabaseMock.rows('shipments')[0].delivery_points[0].latitude = 22.0;
    supabaseMock.rows('shipments')[0].delivery_points[1].latitude = 21.5;
    resetMlHealth();
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).endsWith('/health')) return new Response('{"status":"healthy"}', { status: 200 });
      if (String(input).includes('/optimize')) {
        sentToMl = JSON.parse(init.body);
        return new Response(JSON.stringify({ routes: [{ vehicle_id: VEH, stop_ids: [SHIP], total_distance_km: 50, total_duration_minutes: 90, estimated_fuel_liters: 8 }], total_distance_km: 50, total_fuel_liters: 8 }), { status: 200 });
      }
      return globalFetch(input, init);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('plans only vehicles in service, never placeholders, aiming at the final drop', async () => {
    const res = await request(app).post('/api/v1/optimize').set(admin()).send({ depot_id: DEPOT, vehicle_ids: [VEH, TEMP, DRAFT, MAINT], shipment_ids: [SHIP], consider_weather: false });
    expect(res.status).toBe(200);
    expect(sentToMl.vehicles.map((v: any) => v.id)).toEqual([VEH]);
    expect(sentToMl.locations[1].lat).toBe(22.0);
  });

  it('assigns the shipment through the shared helper and leaves the route pending for review', async () => {
    const res = await request(app).post('/api/v1/optimize').set(admin()).send({ depot_id: DEPOT, vehicle_ids: [VEH], shipment_ids: [SHIP], consider_weather: false });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments')[0].status).toBe('assigned');
    expect(supabaseMock.rows('shipment_logs').find(l => l.status === 'assigned')?.metadata_json).toMatchObject({ vehicle_id: VEH, actor_id: 'admin-1' });
    expect(supabaseMock.rows('routes')[0].status).toBe('pending');
    expect(res.body.routes[0].status).toBe('pending');
    expect(supabaseMock.rows('vehicles')[0].status).toBe('available');
    expect(supabaseMock.rows('route_stops').map(s => s.sequence)).toEqual([1, 2]);
    // The driver is told when the trip is sent, not when it is planned
    expect(supabaseMock.rows('notifications').filter(n => n.user_id === 'driver-1')).toHaveLength(0);
    // Dispatching it later is the route service's job
    const { routeService } = await import('../src/services/route.service');
    await routeService.changeStatus(supabaseMock.rows('routes')[0].id, 'active');
    expect(supabaseMock.rows('vehicles')[0].status).toBe('on_route');
    expect(supabaseMock.rows('notifications').filter(n => n.user_id === 'driver-1').map(n => n.type)).toEqual(['route_activated']);
  });

  it('ignores a shipment that is already assigned', async () => {
    supabaseMock.rows('shipments')[0].status = 'assigned';
    const res = await request(app).post('/api/v1/optimize').set(admin()).send({ depot_id: DEPOT, vehicle_ids: [VEH], shipment_ids: [SHIP], consider_weather: false });
    expect(res.status).toBe(400);
  });
});

describe('idle insights', () => {
  it('skip placeholder vehicles', async () => {
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
    supabaseMock.reset({
      vehicles: [
        { id: 'v1', plate_number: 'MH12AB1234', status: 'idle', updated_at: old },
        { id: 'v2', plate_number: 'TEMP-ABC123', status: 'idle', updated_at: old },
        { id: 'v3', plate_number: 'DRFT-ABC123', status: 'idle', updated_at: old },
      ],
      routes: [], route_stops: [], shipments: [],
    });
    const ids = (await AnalyticsService.getLiveInsights()).map(i => i.id);
    expect(ids).toContain('idle_v1');
    expect(ids).not.toContain('idle_v2');
    expect(ids).not.toContain('idle_v3');
  });
});
