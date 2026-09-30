import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { vendorService } from '../src/services/vendor.service';

const app = testApp();
const VENDOR = 'vendor-1';
const adminToken = () => supabaseMock.signUserToken('admin-1');

function vendorRequest(status: string) {
  return {
    id: 'req-1',
    vendor_id: VENDOR,
    pickup_location: 'Bhiwandi, Maharashtra',
    pickup_lat: 19.3,
    pickup_lng: 73.06,
    drop_location: 'Pune, Maharashtra',
    drop_lat: 18.52,
    drop_lng: 73.85,
    required_capacity_kg: 400,
    status,
    assigned_vehicle_id: null,
  };
}

function reset(status: string) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    vendor_shipment_requests: [vendorRequest(status)],
    vehicles: [{ id: 'vehicle-1', driver_id: 'driver-1', status: 'available', capacity_kg: 1000, current_load_kg: 0, available_capacity_kg: 1000 }],
    cargo_manifest: [],
    notifications: [],
  });
}

const put = (path: string, body?: Record<string, unknown>) =>
  request(app).put(`/api/v1/vendor/shipment-request/req-1/${path}`).set('Authorization', `Bearer ${adminToken()}`).send(body ?? {});

describe('vendor shipment request decisions', () => {
  beforeEach(() => reset('pending'));

  it('accepts a new request at a price and tells the vendor', async () => {
    const res = await put('approve', { cost: 12500 });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'approved', cost: 12500 });
    const note = supabaseMock.writes('notifications', 'POST').map(w => w.body).find(b => b.type === 'request_approved');
    expect(note?.body).toBe("Accepted at ₹12,500. We'll assign a truck next.");
    expect(note?.data).toMatchObject({ request_id: 'req-1', cost: 12500 });
  });

  it('turns a rate per km into the accepted price', async () => {
    const res = await put('approve', { cost_per_km: 20 });
    expect(res.status).toBe(200);
    const stored = supabaseMock.rows('vendor_shipment_requests')[0];
    expect(stored).toMatchObject({ status: 'approved', cost_per_km: 20 });
    expect(stored.cost).toBeGreaterThan(2500);
  });

  it('needs a price to accept a request that has none', async () => {
    const res = await put('approve');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price/i);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('pending');
  });

  it('accepts without a new price when the request already carries one', async () => {
    supabaseMock.rows('vendor_shipment_requests')[0].cost = 8000;
    const res = await put('approve');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'approved', cost: 8000 });
  });

  it('lets a manager accept a request', async () => {
    supabaseMock.rows('users').push({ id: 'manager-1', role: 'manager', is_active: true });
    const res = await request(app).put('/api/v1/vendor/shipment-request/req-1/approve')
      .set('Authorization', `Bearer ${supabaseMock.signUserToken('manager-1')}`).send({ cost: 9000 });
    expect(res.status).toBe(200);
  });

  it('refuses to approve a request that was already rejected', async () => {
    reset('rejected');
    const res = await put('approve', { cost: 9000 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already rejected/);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('rejected');
  });

  it('rejects a pending request and stores the reason', async () => {
    const res = await put('reject', { reason: 'No matching lane available' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'rejected', rejection_reason: 'No matching lane available' });
  });

  it.each([
    ['missing', {}],
    ['too short', { reason: 'no' }],
    ['too long', { reason: 'x'.repeat(501) }],
  ])('requires a reason to reject (%s)', async (_name, body) => {
    const res = await put('reject', body);
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('pending');
  });

  it('refuses to reject a request that already has a vehicle', async () => {
    reset('assigned');
    const res = await put('reject', { reason: 'No matching lane available' });
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('assigned');
  });

  it('refuses to assign a vehicle before the request is accepted with a price', async () => {
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Accept the request with a price first/);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'pending', assigned_vehicle_id: null });
    expect(supabaseMock.writes('cargo_manifest', 'POST')).toEqual([]);
  });

  it('assigns a vehicle once and creates one manifest entry', async () => {
    reset('approved');
    const first = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(first.status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'assigned', assigned_vehicle_id: 'vehicle-1' });
    expect(supabaseMock.writes('cargo_manifest', 'POST')).toHaveLength(1);

    const second = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(second.status).toBe(409);
    expect(supabaseMock.writes('cargo_manifest', 'POST')).toHaveLength(1);
  });

  it('releases the request when the manifest cannot be created', async () => {
    reset('approved');
    supabaseMock.fail('cargo_manifest', 'insert failed');
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(res.status).toBe(500);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'approved', assigned_vehicle_id: null });
  });

  it('returns 404 for an unknown request', async () => {
    supabaseMock.rows('vendor_shipment_requests').length = 0;
    const res = await put('approve', { cost: 9000 });
    expect(res.status).toBe(404);
  });
});

describe('assigning a vehicle', () => {
  const vehicle = (over: Record<string, unknown> = {}) => ({
    id: 'vehicle-1', driver_id: 'driver-1', status: 'available', capacity_kg: 1000, current_load_kg: 200, available_capacity_kg: 800, ...over,
  });
  beforeEach(() => {
    reset('approved');
    supabaseMock.rows('vehicles')[0] = vehicle();
  });

  it('adds the load to the vehicle but does not send it, and does not tell the driver, without dispatch', async () => {
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1', cost: 9000 });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ status: 'available', current_load_kg: 600, available_capacity_kg: 400 });
    expect(supabaseMock.rows('vendor_shipment_requests')[0].cost).toBe(9000);
    const sent = supabaseMock.writes('notifications', 'POST').map(w => w.body);
    expect(sent.some(b => b.type === 'cargo_assigned')).toBe(false);
    expect(sent.some(b => b.type === 'vehicle_assigned')).toBe(true);
  });

  it('puts the vehicle on the road and tells the driver when dispatch is true', async () => {
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1', cost: 9000, dispatch: true });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ status: 'on_route', current_load_kg: 600, available_capacity_kg: 400 });
    expect(supabaseMock.writes('notifications', 'POST').map(w => w.body).some(b => b.type === 'cargo_assigned')).toBe(true);
  });

  it('refuses a load that does not fit the free capacity, without claiming the request', async () => {
    supabaseMock.rows('vehicles')[0] = vehicle({ available_capacity_kg: 300 });
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/300 kg free/);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('approved');
    expect(supabaseMock.writes('cargo_manifest', 'POST')).toEqual([]);
  });

  it.each(['maintenance', 'archived'])('refuses a vehicle in %s', async status => {
    supabaseMock.rows('vehicles')[0] = vehicle({ status });
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('vehicles')[0].status).toBe(status);
  });

  it('refuses a vehicle with no driver, without claiming the request', async () => {
    supabaseMock.rows('vehicles')[0] = vehicle({ driver_id: null, plate_number: 'MH01AB1234' });
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/MH01AB1234 has no driver/);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'approved', assigned_vehicle_id: null });
    expect(supabaseMock.writes('cargo_manifest', 'POST')).toEqual([]);
  });

  it('turns a rate per km into an amount using the road distance', async () => {
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1', cost_per_km: 20 });
    expect(res.status).toBe(200);
    const stored = supabaseMock.rows('vendor_shipment_requests')[0];
    expect(stored.cost_per_km).toBe(20);
    // Bhiwandi to Pune is roughly 150 km by road; the amount is rate x km
    expect(stored.cost).toBeGreaterThan(2500);
    expect(stored.cost).toBeLessThan(4500);
    expect(res.body.cost).toBe(stored.cost);
  });

  it('asks for a flat price when there is no distance to price a rate on', async () => {
    supabaseMock.rows('vendor_shipment_requests')[0].drop_lat = null;
    supabaseMock.rows('vendor_shipment_requests')[0].drop_lng = null;
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1', cost_per_km: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flat price/);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('approved');
  });

  it('tells the vendor the agreed price', async () => {
    await put('assign-vehicle', { vehicle_id: 'vehicle-1', cost: 9000 });
    const note = supabaseMock.writes('notifications', 'POST').map(w => w.body).find(b => b.type === 'vehicle_assigned');
    expect(note?.body).toMatch(/₹9,000/);
    expect(note?.data).toMatchObject({ request_id: 'req-1', cost: 9000 });
  });
});

describe('vendor cancelling a load', () => {
  const cancel = (id = 'req-1', user = VENDOR) =>
    request(app).put(`/api/v1/vendor/shipment-request/${id}/cancel`).set('Authorization', `Bearer ${supabaseMock.signUserToken(user)}`);
  beforeEach(() => {
    reset('pending');
    supabaseMock.rows('users').push({ id: VENDOR, role: 'vendor', is_active: true }, { id: 'vendor-2', role: 'vendor', is_active: true });
  });

  it.each(['pending', 'approved'])('cancels a %s request and tells staff', async status => {
    reset(status);
    supabaseMock.rows('users').push({ id: VENDOR, role: 'vendor', is_active: true });
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('cancelled');
    const note = supabaseMock.writes('notifications', 'POST').map(w => w.body);
    expect(note).toEqual([expect.objectContaining({ user_id: 'admin-1', type: 'vendor_request_cancelled', data: { request_id: 'req-1' } })]);
  });

  it.each(['assigned', 'escalated', 'completed', 'rejected'])('will not cancel a %s request', async status => {
    reset(status);
    supabaseMock.rows('users').push({ id: VENDOR, role: 'vendor', is_active: true });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe(status);
  });

  it('only cancels the vendor\'s own request', async () => {
    expect((await cancel('req-1', 'vendor-2')).status).toBe(404);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('pending');
  });

  it('is for vendors', async () => {
    const res = await request(app).put('/api/v1/vendor/shipment-request/req-1/cancel').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(403);
  });
});

describe('the requests that need a vehicle', () => {
  it('include escalated ones and are open to managers', async () => {
    reset('pending');
    supabaseMock.rows('users').push({ id: 'manager-1', role: 'manager', is_active: true });
    supabaseMock.rows('vendor_shipment_requests').push(
      { ...vendorRequest('escalated'), id: 'req-2' },
      { ...vendorRequest('completed'), id: 'req-3' },
      { ...vendorRequest('cancelled'), id: 'req-4' },
    );
    supabaseMock.rows('vendor_profiles').push({ id: VENDOR, company_name: 'Acme' });
    const res = await request(app).get('/api/v1/vendor/shipment-request/pending').set('Authorization', `Bearer ${supabaseMock.signUserToken('manager-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.id).sort()).toEqual(['req-1', 'req-2']);
  });
});

describe('market rates', () => {
  it('count delivered (completed) loads', async () => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vendor_shipment_requests: [
        { id: 'a', status: 'completed', cost: 5000, cost_per_km: 30, required_capacity_kg: 1000 },
        { id: 'b', status: 'pending', cost: 1, cost_per_km: 1, required_capacity_kg: 1 },
      ],
      vehicles: [],
    });
    const res = await request(app).get('/api/v1/vendor/rates').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ avg_cost_per_km: 30, avg_cost_per_kg: 5, recent_shipments: 1 });
  });
});

describe('telling the vendor about their load', () => {
  beforeEach(() => {
    supabaseMock.reset({
      vendor_shipment_requests: [vendorRequest('assigned')],
      cargo_manifest: [
        { id: 'm1', vendor_request_id: 'req-1', pickup_location: 'Bhiwandi, Maharashtra', drop_location: 'Pune, Maharashtra' },
        { id: 'm-bid', vendor_request_id: null },
      ],
      notifications: [],
    });
  });
  const sent = () => supabaseMock.writes('notifications', 'POST').map(w => w.body);

  it('sends a pickup, a departure and a delivery notice to the vendor', async () => {
    await vendorService.notifyVendorLoadEvent('m1', 'picked_up');
    await vendorService.notifyVendorLoadEvent('m1', 'in_transit');
    await vendorService.notifyVendorLoadEvent('m1', 'delivered');
    expect(sent().map(n => [n.user_id, n.type])).toEqual([
      [VENDOR, 'load_picked_up'], [VENDOR, 'load_in_transit'], [VENDOR, 'request_completed'],
    ]);
    expect(sent()[0]).toMatchObject({ data: { request_id: 'req-1' } });
    expect(sent()[0].body).toMatch(/Bhiwandi to Pune/);
  });

  it('does not repeat a notice for the same step', async () => {
    await vendorService.notifyVendorLoadEvent('m1', 'picked_up');
    await vendorService.notifyVendorLoadEvent('m1', 'picked_up');
    expect(sent()).toHaveLength(1);
  });

  it('says nothing for a manifest that is not a vendor request, and never throws', async () => {
    await vendorService.notifyVendorLoadEvent('m-bid', 'delivered');
    await vendorService.notifyVendorLoadEvent('missing', 'delivered');
    expect(sent()).toEqual([]);
  });
});

describe('passing trucks', () => {
  it('shows only recent offers and retires old ones', async () => {
    const old = new Date(Date.now() - 12 * 3600_000).toISOString();
    supabaseMock.reset({
      users: [{ id: VENDOR, role: 'vendor', is_active: true }],
      vendor_route_opportunities: [
        { id: 'o-old', vendor_id: VENDOR, route_id: 'r1', status: 'notified', created_at: old },
        { id: 'o-new', vendor_id: VENDOR, route_id: 'r1', status: 'notified', created_at: new Date().toISOString() },
      ],
    });
    const res = await request(app).get('/api/v1/vendor/passing-routes').set('Authorization', `Bearer ${supabaseMock.signUserToken(VENDOR)}`);
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_route_opportunities').find(o => o.id === 'o-old')?.status).toBe('ignored');
    expect(supabaseMock.rows('vendor_route_opportunities').find(o => o.id === 'o-new')?.status).toBe('notified');
  });
});
