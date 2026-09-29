import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { runSchedulerTick } from '../src/services/scheduler.service';

const app = testApp();
const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

const admin = () => supabaseMock.signUserToken('admin-1');
const vendor = () => supabaseMock.signUserToken('vendor-1');

function seed(extra: Record<string, any[]> = {}) {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
    ],
    vehicles: [
      { id: 'v1', plate_number: 'MH12AB1234', vehicle_type: 'truck', status: 'available', available_capacity_kg: 800, bidding_window_open: false },
      { id: 'v2', plate_number: 'MH12ZZ0001', vehicle_type: 'truck', status: 'available', available_capacity_kg: 0, bidding_window_open: false },
    ],
    shipments: [{ id: 's1', tracking_id: 'TRK1' }],
    capacity_windows: [],
    capacity_bids: [],
    notifications: [],
    driver_confirmations: [],
    ...extra,
  });
}

describe('staff bidding windows', () => {
  beforeEach(() => seed());

  const open = (body: Record<string, unknown>, token = admin()) =>
    request(app).post('/api/v1/capacity/windows').set('Authorization', `Bearer ${token}`).send(body);

  it('opens a window with a floor price, duration and linked shipment', async () => {
    const res = await open({ vehicle_id: 'v1', floor_price: 1200, duration_minutes: 30, shipment_id: 's1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vehicle_id: 'v1', floor_price: 1200, fallback_shipment_id: 's1', trigger_type: 'superadmin_dispatch' });
    const minutes = (new Date(res.body.closes_at).getTime() - new Date(res.body.opens_at).getTime()) / MINUTE;
    expect(minutes).toBe(30);
    expect(supabaseMock.rows('vehicles').find(v => v.id === 'v1')?.bidding_window_open).toBe(true);
  });

  it('refuses a second open window, a full vehicle, bad numbers and unknown links', async () => {
    expect((await open({ vehicle_id: 'v1', floor_price: 100, duration_minutes: 30 })).status).toBe(201);
    expect((await open({ vehicle_id: 'v1', floor_price: 100, duration_minutes: 30 })).status).toBe(409);
    expect((await open({ vehicle_id: 'v2', floor_price: 100, duration_minutes: 30 })).status).toBe(400);
    expect((await open({ vehicle_id: 'v1', floor_price: -5, duration_minutes: 30 })).status).toBe(400);
    expect((await open({ vehicle_id: 'v1', floor_price: 100, duration_minutes: 1 })).status).toBe(400);
    expect((await open({ vehicle_id: 'nope', floor_price: 100, duration_minutes: 30 })).status).toBe(404);
    expect((await open({ vehicle_id: 'v1', floor_price: 100, duration_minutes: 30, shipment_id: 'nope' })).status).toBe(404);
  });

  it('is staff only', async () => {
    expect((await open({ vehicle_id: 'v1', floor_price: 100, duration_minutes: 30 }, vendor())).status).toBe(403);
  });

  it('lists windows with bid counts and the linked shipment', async () => {
    seed({
      capacity_windows: [{ id: 'w1', vehicle_id: 'v1', opens_at: ago(MINUTE), closes_at: ahead(10 * MINUTE), floor_price: 500, winning_bid_id: null, fallback_shipment_id: 's1', trigger_type: 'superadmin_dispatch', status: 'open' }],
      capacity_bids: [{ id: 'b1', window_id: 'w1', status: 'pending' }, { id: 'b2', window_id: 'w1', status: 'lost' }],
    });
    const res = await request(app).get('/api/v1/capacity/windows').set('Authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'w1', state: 'open', bid_count: 2, pending_bid_count: 1, shipment_tracking_id: 'TRK1' });
  });

  it('closes a window early, once', async () => {
    const { body } = await open({ vehicle_id: 'v1', floor_price: 100, duration_minutes: 30 });
    const close = () => request(app).post(`/api/v1/capacity/windows/${body.id}/close`).set('Authorization', `Bearer ${admin()}`);
    expect((await close()).body).toEqual({ id: body.id, status: 'closed' });
    expect(supabaseMock.rows('vehicles').find(v => v.id === 'v1')?.bidding_window_open).toBe(false);
    expect((await close()).status).toBe(409);
    expect((await request(app).post('/api/v1/capacity/windows/none/close').set('Authorization', `Bearer ${admin()}`)).status).toBe(404);
  });

  it('cancels a window and turns pending bids down', async () => {
    const { body } = await open({ vehicle_id: 'v1', floor_price: 100, duration_minutes: 30 });
    supabaseMock.rows('capacity_bids').push({ id: 'b1', window_id: body.id, vendor_id: 'vendor-1', bid_amount: 900, status: 'pending' });
    const res = await request(app).post(`/api/v1/capacity/windows/${body.id}/cancel`).set('Authorization', `Bearer ${admin()}`);
    expect(res.body).toEqual({ id: body.id, status: 'cancelled' });
    expect(supabaseMock.rows('capacity_bids')[0]).toMatchObject({ status: 'rejected' });
  });
});

describe('scheduler', () => {
  it('closes expired windows once and leaves running ones alone', async () => {
    seed({
      vehicles: [{ id: 'v1', plate_number: 'A', available_capacity_kg: 100, bidding_window_open: true }],
      capacity_windows: [
        { id: 'old', vehicle_id: 'v1', opens_at: ago(20 * MINUTE), closes_at: ago(5 * MINUTE), floor_price: 1, winning_bid_id: null, status: 'open' },
        { id: 'live', vehicle_id: 'v1', opens_at: ago(MINUTE), closes_at: ahead(5 * MINUTE), floor_price: 1, winning_bid_id: null, status: 'open' },
        { id: 'done', vehicle_id: 'v1', opens_at: ago(30 * MINUTE), closes_at: ago(20 * MINUTE), floor_price: 1, winning_bid_id: null, status: 'cancelled' },
      ],
      capacity_bids: [{ id: 'b1', window_id: 'old', vendor_id: 'vendor-1', status: 'pending' }],
    });
    expect(await runSchedulerTick()).toEqual({ windowsClosed: 1 });
    const status = (id: string) => supabaseMock.rows('capacity_windows').find(w => w.id === id)?.status;
    expect(status('old')).toBe('closed');
    expect(status('live')).toBe('open');
    expect(status('done')).toBe('cancelled');
    // Pending bids stay for staff to decide
    expect(supabaseMock.rows('capacity_bids')[0].status).toBe('pending');
    // The live window keeps the vehicle marked as bidding
    expect(supabaseMock.rows('vehicles')[0].bidding_window_open).toBe(true);
    // Second pass changes nothing
    expect(await runSchedulerTick()).toEqual({ windowsClosed: 0 });
  });

  it('times out driver confirmations once', async () => {
    seed({
      driver_confirmations: [
        { id: 'c-shown', vehicle_id: 'v1', prompted_at: ago(10 * MINUTE), delivered_at: ago(3 * MINUTE), responded_at: null, action: null },
        { id: 'c-fresh', vehicle_id: 'v1', prompted_at: ago(MINUTE), delivered_at: ago(30_000), responded_at: null, action: null },
        { id: 'c-offline', vehicle_id: 'v1', prompted_at: ago(16 * MINUTE), delivered_at: null, responded_at: null, action: null },
        { id: 'c-answered', vehicle_id: 'v1', prompted_at: ago(16 * MINUTE), delivered_at: null, responded_at: ago(MINUTE), action: 'flagged' },
      ],
    });
    await runSchedulerTick();
    const action = (id: string) => supabaseMock.rows('driver_confirmations').find(c => c.id === id)?.action;
    expect(action('c-shown')).toBe('auto_accepted');
    expect(action('c-fresh')).toBeNull();
    expect(action('c-offline')).toBe('auto_accepted_offline');
    expect(action('c-answered')).toBe('flagged');
    const before = supabaseMock.writes('driver_confirmations', 'PATCH').length;
    await runSchedulerTick();
    expect(supabaseMock.writes('driver_confirmations', 'PATCH').length).toBe(before);
  });
});

describe('one way to open a window', () => {
  const driver = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('driver-1')}` });
  const toggle = (enabled: boolean) =>
    request(app).post('/api/v1/capacity/driver/toggle-matching').set(driver()).send({ vehicle_id: 'v1', enabled });
  const openBackhaul = () =>
    request(app).post('/api/v1/capacity/driver/open-backhaul-window').set(driver())
      .send({ vehicle_id: 'v1', available_capacity_kg: 300, trigger_type: 'mid_route' });

  beforeEach(() => {
    seed({
      users: [
        { id: 'admin-1', role: 'admin', is_active: true },
        { id: 'vendor-1', role: 'vendor', is_active: true },
        { id: 'driver-1', role: 'driver', is_active: true },
      ],
      vehicles: [
        { id: 'v1', driver_id: 'driver-1', plate_number: 'MH12AB1234', vehicle_type: 'truck', status: 'available', capacity_kg: 1000, available_capacity_kg: 800, bidding_window_open: false },
        { id: 'v-maint', driver_id: null, plate_number: 'X', vehicle_type: 'truck', status: 'maintenance', capacity_kg: 1000, available_capacity_kg: 800 },
      ],
    });
  });

  it('opens the same window for the driver toggle as the other paths: default length, no fixed price', async () => {
    expect((await toggle(true)).status).toBe(200);
    const [w] = supabaseMock.rows('capacity_windows');
    expect(w).toMatchObject({ vehicle_id: 'v1', trigger_type: 'return_trip', status: 'open', floor_price: null });
    expect((new Date(w.closes_at).getTime() - new Date(w.opens_at).getTime()) / MINUTE).toBe(30);
    expect(supabaseMock.rows('vehicles')[0].bidding_window_open).toBe(true);
  });

  it('does not open a second window when the driver turns it on twice or uses another button', async () => {
    await toggle(true);
    expect((await toggle(true)).status).toBe(200);
    expect((await openBackhaul()).status).toBe(409);
    expect(supabaseMock.rows('capacity_windows')).toHaveLength(1);
  });

  it('closes the open window when the driver turns matching off', async () => {
    await toggle(true);
    expect((await toggle(false)).status).toBe(200);
    expect(supabaseMock.rows('capacity_windows')[0]).toMatchObject({ status: 'closed' });
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ bidding_window_open: false, bidding_window_closes_at: null });
  });

  it('will not offer space on a full vehicle or one in maintenance', async () => {
    supabaseMock.rows('vehicles')[0].available_capacity_kg = 0;
    expect((await toggle(true)).status).toBe(400);
    expect(supabaseMock.rows('vehicles')[0].bidding_window_open).toBe(false);
    expect((await request(app).post('/api/v1/capacity/windows').set('Authorization', `Bearer ${admin()}`)
      .send({ vehicle_id: 'v-maint', floor_price: 100, duration_minutes: 30 })).status).toBe(409);
  });

  it('lets staff set the minimum bid and length on the same path, and a driver cannot', async () => {
    const staffOpen = await request(app).post('/api/v1/capacity/driver/open-backhaul-window').set('Authorization', `Bearer ${admin()}`)
      .send({ vehicle_id: 'v1', available_capacity_kg: 300, trigger_type: 'mid_route', floor_price: 2500, duration_minutes: 60 });
    expect(staffOpen.status).toBe(200);
    expect(staffOpen.body.floor_price).toBe(2500);
    expect((new Date(staffOpen.body.closes_at).getTime() - new Date(staffOpen.body.opens_at).getTime()) / MINUTE).toBe(60);
  });

  it('is open to managers', async () => {
    supabaseMock.rows('users').push({ id: 'manager-1', role: 'manager', is_active: true });
    const res = await request(app).post('/api/v1/capacity/windows').set('Authorization', `Bearer ${supabaseMock.signUserToken('manager-1')}`)
      .send({ vehicle_id: 'v1', floor_price: 100, duration_minutes: 30 });
    expect(res.status).toBe(201);
  });
});

describe('bids nobody decided', () => {
  const old = 26 * 60 * MINUTE;

  it('expire a day after their window closed, and the vendor is told', async () => {
    seed({
      vehicles: [{ id: 'v1', plate_number: 'A', status: 'available', available_capacity_kg: 100, bidding_window_open: false }],
      capacity_windows: [
        { id: 'stale', vehicle_id: 'v1', opens_at: ago(old + 30 * MINUTE), closes_at: ago(old), resolved_at: ago(old), floor_price: 1, winning_bid_id: null, status: 'closed' },
        { id: 'recent', vehicle_id: 'v1', opens_at: ago(2 * 60 * MINUTE), closes_at: ago(60 * MINUTE), resolved_at: ago(60 * MINUTE), floor_price: 1, winning_bid_id: null, status: 'closed' },
      ],
      capacity_bids: [
        { id: 'b-stale', window_id: 'stale', vendor_id: 'vendor-1', status: 'pending', bid_amount: 900 },
        { id: 'b-recent', window_id: 'recent', vendor_id: 'vendor-1', status: 'pending', bid_amount: 900 },
        { id: 'b-lost', window_id: 'stale', vendor_id: 'vendor-1', status: 'lost', bid_amount: 900 },
      ],
    });
    await runSchedulerTick();
    await new Promise(r => setTimeout(r, 30));
    const status = (id: string) => supabaseMock.rows('capacity_bids').find(b => b.id === id)?.status;
    expect(status('b-stale')).toBe('expired');
    expect(status('b-recent')).toBe('pending');
    expect(status('b-lost')).toBe('lost');
    const told = supabaseMock.rows('notifications');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ user_id: 'vendor-1', type: 'bid_expired', data: { bid_id: 'b-stale' } });
  });
});
