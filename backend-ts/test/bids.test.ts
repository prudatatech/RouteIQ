import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';

const app = createApp();

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
    winning_bid_id: null,
    fallback_shipment_id: null,
    vehicles: { plate_number: 'MH12AB1234', latitude: null, longitude: null, city: 'Pune', available_capacity_kg: 800 },
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
    vendor_profiles: [{ id: VENDOR, kyc_status: 'approved', company_name: 'Acme', latitude: null, longitude: null, city: 'Pune' }],
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

  it('rejects a bid below the floor price', async () => {
    const res = await submit({ ...GOOD_BID, bid_amount: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/floor/);
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
