import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();

const VENDOR = 'vendor-1';
const MINUTE = 60_000;

const vendorToken = () => supabaseMock.signUserToken(VENDOR);
const adminToken = () => supabaseMock.signUserToken('admin-1');

function openWindow() {
  return {
    id: 'w1',
    vehicle_id: 'vehicle-1',
    opens_at: new Date(Date.now() - MINUTE).toISOString(),
    closes_at: new Date(Date.now() + 5 * MINUTE).toISOString(),
    floor_price: 1000,
    status: 'open',
    winning_bid_id: null,
    fallback_shipment_id: null,
    vehicles: { plate_number: 'MH12AB1234', latitude: 18.53, longitude: 73.86, current_location_name: 'Baner, Pune', available_capacity_kg: 800 },
  };
}

const GOOD_BID = {
  window_id: 'w1',
  bid_amount: 1500,
  weight_kg: 500,
  dropoff_name: 'Hinjewadi',
  dropoff_address: 'Hinjewadi, Pune',
  dropoff_lat: 18.59,
  dropoff_lng: 73.73,
  eway_bill_ref: '123456789012',
  load_configuration: 'Palletized',
};

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: VENDOR, role: 'vendor', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
    ],
    vendor_profiles: [{ id: VENDOR, kyc_status: 'approved', company_name: 'Acme', address: 'Plot 4, MIDC Bhosari', latitude: 18.52, longitude: 73.85, city: 'Pune' }],
    tpl_partners: [],
    capacity_windows: [openWindow()],
    capacity_bids: [],
    delivery_points: [],
  });
});

describe('POST /capacity/bids', () => {
  const submit = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/capacity/bids').set('Authorization', `Bearer ${vendorToken()}`).send(body);

  it('accepts a valid bid', async () => {
    const res = await submit(GOOD_BID);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ vendor_id: VENDOR, window_id: 'w1', bid_amount: 1500, status: 'pending' });
    expect(supabaseMock.writes('delivery_points', 'POST')).toHaveLength(1);
  });

  it('rejects a bid below the minimum bid', async () => {
    const res = await submit({ ...GOOD_BID, bid_amount: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/minimum bid/);
  });

  it('rejects a load over the available capacity and removes the new drop-off point', async () => {
    const res = await submit({ ...GOOD_BID, weight_kg: 900 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/available/);

    const [created] = supabaseMock.writes('delivery_points', 'POST');
    expect(created).toBeDefined();
    expect(supabaseMock.writes('delivery_points', 'DELETE')).toHaveLength(1);
    expect(supabaseMock.rows('delivery_points')).toEqual([]);
    expect(supabaseMock.writes('capacity_bids', 'POST')).toEqual([]);
  });

  it.each([
    ['a malformed e-way bill number', { eway_bill_ref: '12345' }],
    ['a 0,0 drop-off', { dropoff_lat: 0, dropoff_lng: 0 }],
    ['a missing drop-off', { dropoff_name: undefined }],
    ['a zero weight', { weight_kg: 0 }],
  ])('rejects %s', async (_name, change) => {
    const res = await submit({ ...GOOD_BID, ...change });
    expect(res.status).toBe(400);
    expect(supabaseMock.mutations).toEqual([]);
  });

  it('rejects a second pending bid on the same window', async () => {
    supabaseMock.rows('capacity_bids').push({ id: 'old', window_id: 'w1', vendor_id: VENDOR, status: 'pending' });
    expect((await submit(GOOD_BID)).status).toBe(409);
  });

  it('rejects a bid on a closed window', async () => {
    supabaseMock.rows('capacity_windows')[0].closes_at = new Date(Date.now() - 1000).toISOString();
    expect((await submit(GOOD_BID)).status).toBe(409);
  });

  it('rejects a bid on a window that already has a winner', async () => {
    supabaseMock.rows('capacity_windows')[0].winning_bid_id = 'someone';
    expect((await submit(GOOD_BID)).status).toBe(409);
  });

  it('requires approved KYC', async () => {
    supabaseMock.rows('vendor_profiles')[0].kyc_status = 'submitted';
    const res = await submit(GOOD_BID);
    expect(res.status).toBe(403);
    expect(supabaseMock.mutations).toEqual([]);
  });
});

describe('POST /capacity/bids/:id/approve', () => {
  const approve = (bidId: string) =>
    request(app).post(`/api/v1/capacity/bids/${bidId}/approve`).set('Authorization', `Bearer ${adminToken()}`);
  const pendingBid = { id: 'bid-1', window_id: 'w1', vendor_id: VENDOR, status: 'pending', weight_kg: 500, dropoff_point_id: null };
  const downstreamInserts = () =>
    ['shipments', 'cargo_manifest', 'route_stops'].flatMap(table => supabaseMock.writes(table, 'POST'));

  it('turns a pending bid on an open window into a shipment and manifest', async () => {
    supabaseMock.rows('capacity_bids').push({ ...pendingBid });

    const res = await approve('bid-1');

    expect(res.status).toBe(200);
    expect(supabaseMock.rows('capacity_windows')[0].winning_bid_id).toBe('bid-1');
    expect(supabaseMock.writes('shipments', 'POST')).toHaveLength(1);
    expect(supabaseMock.writes('cargo_manifest', 'POST')).toHaveLength(1);
  });

  it('refuses to approve a bid that already won, without creating anything', async () => {
    supabaseMock.rows('capacity_bids').push({ ...pendingBid, status: 'won' });

    const res = await approve('bid-1');

    expect(res.status).toBe(409);
    expect(downstreamInserts()).toEqual([]);
  });

  it('marks the bid lost when the window already has a winner', async () => {
    supabaseMock.rows('capacity_windows')[0].winning_bid_id = 'other-bid';
    supabaseMock.rows('capacity_bids').push({ ...pendingBid });

    const res = await approve('bid-1');

    expect(res.status).toBe(409);
    expect(supabaseMock.rows('capacity_bids')[0].status).toBe('lost');
    expect(supabaseMock.rows('capacity_windows')[0].winning_bid_id).toBe('other-bid');
    expect(downstreamInserts()).toEqual([]);
  });
});

describe('POST /capacity/bids/:id/reject', () => {
  const pendingBid = { id: 'bid-1', window_id: 'w1', vendor_id: VENDOR, status: 'pending', weight_kg: 500, bid_amount: 1500, dropoff_point_id: null };
  const reject = (bidId: string, body?: Record<string, unknown>) =>
    request(app).post(`/api/v1/capacity/bids/${bidId}/reject`).set('Authorization', `Bearer ${adminToken()}`).send(body ?? { reason: 'Rate too high for this lane' });

  beforeEach(() => {
    supabaseMock.rows('capacity_bids').push({ ...pendingBid });
  });

  it('rejects a pending bid and stores the reason', async () => {
    const res = await reject('bid-1');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('capacity_bids')[0]).toMatchObject({ status: 'rejected', rejection_reason: 'Rate too high for this lane' });
  });

  it.each([
    ['missing', {}],
    ['too short', { reason: 'no' }],
    ['too long', { reason: 'x'.repeat(501) }],
    ['blank', { reason: '   ' }],
  ])('requires a reason (%s)', async (_name, body) => {
    const res = await reject('bid-1', body);
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('capacity_bids')[0].status).toBe('pending');
  });

  it('refuses to reject a bid that is already decided', async () => {
    supabaseMock.rows('capacity_bids')[0].status = 'won';
    const res = await reject('bid-1');
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown bid', async () => {
    const res = await reject('missing-bid');
    expect(res.status).toBe(404);
  });
});

describe('awarding a bid', () => {
  // Notifications go out without being waited for; let them land before the next test resets the data
  afterEach(() => new Promise(resolve => setTimeout(resolve, 40)));

  const approve = (bidId: string, token = adminToken()) =>
    request(app).post(`/api/v1/capacity/bids/${bidId}/approve`).set('Authorization', `Bearer ${token}`);
  const BID = {
    id: 'bid-1', window_id: 'w1', vendor_id: VENDOR, status: 'pending', bid_amount: 1500, weight_kg: 500,
    dropoff_point_id: 'dp-1', eway_bill_ref: '123456789012', load_configuration: 'Palletized',
  };

  beforeEach(() => {
    supabaseMock.reset({
      users: [
        { id: VENDOR, role: 'vendor', is_active: true },
        { id: 'admin-1', role: 'admin', is_active: true },
        { id: 'manager-1', role: 'manager', is_active: true },
        { id: 'driver-1', role: 'driver', is_active: true },
      ],
      vendor_profiles: [{ id: VENDOR, company_name: 'Acme', address: 'Plot 4, MIDC Bhosari', city: 'Pune', latitude: 18.62, longitude: 73.85 }],
      vehicles: [{ id: 'vehicle-1', driver_id: 'driver-1', status: 'available', capacity_kg: 1000, available_capacity_kg: 800, latitude: 18.53, longitude: 73.86 }],
      capacity_windows: [{ ...openWindow(), fallback_shipment_id: 'standby-1' }],
      capacity_bids: [{ ...BID }, { id: 'bid-2', window_id: 'w1', vendor_id: 'vendor-2', status: 'pending', bid_amount: 1100, weight_kg: 100 }],
      shipments: [{ id: 'standby-1', tracking_id: 'TRK-STANDBY', status: 'created', priority: 'low', total_weight_kg: 50, origin_name: 'Depot' }],
      delivery_points: [{ id: 'dp-1', name: 'Hinjewadi', address: 'Hinjewadi, Pune', latitude: 18.59, longitude: 73.73, demand_kg: 500, shipment_id: null }],
      routes: [{ id: 'route-1', vehicle_id: 'vehicle-1', status: 'active' }],
      route_stops: [{ id: 'old-stop', route_id: 'route-1', delivery_point_id: 'dp-old', sequence: 1, status: 'pending' }],
      cargo_manifest: [],
      driver_confirmations: [],
      notifications: [],
    });
  });

  it('makes a separate shipment and leaves the standby shipment alone', async () => {
    const res = await approve('bid-1');
    expect(res.status).toBe(200);

    const standby = supabaseMock.rows('shipments').find(s => s.id === 'standby-1');
    expect(standby).toMatchObject({ status: 'created', priority: 'low', total_weight_kg: 50, origin_name: 'Depot' });
    expect(standby?.bid_id).toBeUndefined();

    const created = supabaseMock.rows('shipments').filter(s => s.id !== 'standby-1');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      status: 'assigned', bid_id: 'bid-1', total_weight_kg: 500, origin_name: 'Acme', origin_lat: 18.62, origin_lng: 73.85,
    });
    // Priority is not forced up: it follows the standby shipment
    expect(created[0].priority).toBe('low');
    expect(created[0].metadata).toMatchObject({ eway_bill_ref: '123456789012', load_configuration: 'Palletized', window_id: 'w1' });
    expect(supabaseMock.rows('delivery_points').find(p => p.id === 'dp-1')?.shipment_id).toBe(created[0].id);
  });

  it('takes only the bid weight off the free capacity', async () => {
    await approve('bid-1');
    expect(supabaseMock.rows('vehicles')[0].available_capacity_kg).toBe(300);
  });

  it('routes the truck to the pickup and then the drop-off, with planned arrivals', async () => {
    await approve('bid-1');
    const stops = supabaseMock.rows('route_stops').sort((a, b) => a.sequence - b.sequence);
    const [pickup, drop, later] = stops;
    expect([pickup.sequence, drop.sequence, later.sequence]).toEqual([1, 2, 3]);
    expect(later.id).toBe('old-stop');
    expect(drop.delivery_point_id).toBe('dp-1');
    const pickupPoint = supabaseMock.rows('delivery_points').find(p => p.id === pickup.delivery_point_id);
    expect(pickupPoint).toMatchObject({ name: 'Pickup: Acme', latitude: 18.62, longitude: 73.85 });
    expect(pickup.planned_arrival_at).toBeTruthy();
    expect(new Date(drop.planned_arrival_at).getTime()).toBeGreaterThan(new Date(pickup.planned_arrival_at).getTime());
    expect(supabaseMock.rows('driver_confirmations')).toHaveLength(1);
    expect(supabaseMock.rows('driver_confirmations')[0]).toMatchObject({ route_stop_id: drop.id, vehicle_id: 'vehicle-1' });
  });

  it('creates the manifest from the vendor pickup and tells the vendor and the driver', async () => {
    await approve('bid-1');
    expect(supabaseMock.rows('cargo_manifest')[0]).toMatchObject({ vehicle_id: 'vehicle-1', pickup_lat: 18.62, pickup_lng: 73.85, drop_lat: 18.59, capacity_kg: 500, status: 'scheduled' });
    await new Promise(r => setTimeout(r, 20));
    const types = supabaseMock.rows('notifications').map(n => `${n.user_id}:${n.type}`).sort();
    expect(types).toEqual(['driver-1:cargo_assigned', 'vendor-1:bid_accepted', 'vendor-2:bid_lost']);
    const titles = Object.fromEntries(supabaseMock.rows('notifications').map(n => [n.type, n.title]));
    expect(titles).toMatchObject({ bid_accepted: 'Approved', bid_lost: 'Not selected' });
    expect(supabaseMock.rows('notifications').find(n => n.type === 'bid_accepted')?.body).toContain('₹1,500 for 500 kg');
  });

  it('closes the window on award', async () => {
    await approve('bid-1');
    expect(supabaseMock.rows('capacity_windows')[0]).toMatchObject({ winning_bid_id: 'bid-1', status: 'closed' });
  });

  it('needs the vendor pickup location and changes nothing without it', async () => {
    supabaseMock.rows('vendor_profiles')[0].latitude = null;
    const res = await approve('bid-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pickup location/);
    expect(supabaseMock.rows('capacity_bids')[0].status).toBe('pending');
    expect(supabaseMock.mutations).toEqual([]);
  });

  it('refuses a bid that no longer fits the vehicle', async () => {
    supabaseMock.rows('vehicles')[0].available_capacity_kg = 200;
    const res = await approve('bid-1');
    expect(res.status).toBe(409);
    expect(supabaseMock.mutations).toEqual([]);
  });

  it('puts everything back when a step fails', async () => {
    supabaseMock.fail('cargo_manifest', 'insert failed');
    const res = await approve('bid-1');
    expect(res.status).toBe(500);
    expect(supabaseMock.rows('capacity_bids').map(b => b.status)).toEqual(['pending', 'pending']);
    expect(supabaseMock.rows('capacity_windows')[0]).toMatchObject({ winning_bid_id: null, status: 'open' });
    expect(supabaseMock.rows('vehicles')[0].available_capacity_kg).toBe(800);
    expect(supabaseMock.rows('shipments').map(s => s.id)).toEqual(['standby-1']);
    expect(supabaseMock.rows('delivery_points').find(p => p.id === 'dp-1')?.shipment_id).toBeNull();
  });

  it('lets a manager approve and reject as well', async () => {
    const token = supabaseMock.signUserToken('manager-1');
    expect((await approve('bid-1', token)).status).toBe(200);
    const pending = await request(app).get('/api/v1/capacity/bids/pending').set('Authorization', `Bearer ${token}`);
    expect(pending.status).toBe(200);
    const reject = await request(app).post('/api/v1/capacity/bids/bid-2/reject').set('Authorization', `Bearer ${token}`).send({ reason: 'Too far off route' });
    // bid-2 already lost to the award, so a manager reaches the same 409 an admin would
    expect(reject.status).toBe(409);
  });

  it('takes the award back when the driver flags the stop', async () => {
    await approve('bid-1');
    const drop = supabaseMock.rows('route_stops').find(s => s.delivery_point_id === 'dp-1')!;
    const conf = supabaseMock.rows('driver_confirmations')[0];
    supabaseMock.rows('notifications').length = 0;

    const flag = await request(app).post('/api/v1/capacity/driver/flag-stop')
      .set('Authorization', `Bearer ${supabaseMock.signUserToken('driver-1')}`).send({ confirmation_id: conf.id });
    expect(flag.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));

    const bids = Object.fromEntries(supabaseMock.rows('capacity_bids').map(b => [b.id, b]));
    expect(bids['bid-1']).toMatchObject({ status: 'rejected' });
    expect(bids['bid-2'].status).toBe('pending');
    expect(supabaseMock.rows('capacity_windows')[0]).toMatchObject({ winning_bid_id: null, status: 'open' });
    expect(supabaseMock.rows('vehicles')[0].available_capacity_kg).toBe(800);
    expect(supabaseMock.rows('route_stops').map(s => s.id)).toEqual(['old-stop']);
    expect(supabaseMock.rows('route_stops').some(s => s.id === drop.id)).toBe(false);
    expect(supabaseMock.rows('cargo_manifest')).toEqual([]);
    expect(supabaseMock.rows('shipments').find(s => s.bid_id === 'bid-1')?.status).toBe('cancelled');
    const told = supabaseMock.rows('notifications').map(n => `${n.user_id}:${n.type}`);
    expect(told).toContain('vendor-1:bid_rejected');
    expect(supabaseMock.rows('notifications').find(n => n.type === 'bid_rejected')?.title).toBe('Bid cancelled');
    expect(told).toContain('admin-1:stop_flagged');
  });
});

describe('bidding again and the minimum bid', () => {
  const submit = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/capacity/bids').set('Authorization', `Bearer ${vendorToken()}`).send(body);

  it('lets a vendor bid again after a rejected, lost or expired bid', async () => {
    for (const status of ['rejected', 'lost', 'expired']) {
      supabaseMock.rows('capacity_bids').length = 0;
      supabaseMock.rows('capacity_bids').push({ id: 'old', window_id: 'w1', vendor_id: VENDOR, status });
      expect((await submit(GOOD_BID)).status).toBe(200);
    }
  });

  it('needs a pickup location on the vendor profile', async () => {
    supabaseMock.rows('vendor_profiles')[0].latitude = null;
    const res = await submit(GOOD_BID);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pickup location/);
    expect(supabaseMock.writes('capacity_bids', 'POST')).toEqual([]);
  });

  it('keeps a truck far away out of reach, but not one in the vendor\'s own city', async () => {
    const window = supabaseMock.rows('capacity_windows')[0];
    // 200 km away and not in the vendor's city
    window.vehicles = { ...window.vehicles, latitude: 20.3, longitude: 73.85, current_location_name: 'Nashik' };
    const far = await submit(GOOD_BID);
    expect(far.status).toBe(400);
    expect(far.body.error).toMatch(/Geofencing/);

    // Far by the coordinates, but the truck reports it is in Pune, the vendor's city
    window.vehicles = { ...window.vehicles, latitude: 20.3, longitude: 73.85, current_location_name: 'Kothrud, Pune' };
    expect((await submit(GOOD_BID)).status).toBe(200);
  });
});
