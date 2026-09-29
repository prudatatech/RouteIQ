import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { isDispatchable, isLive, isPlaceholderPlate } from '../src/core/vehicles';

const app = testApp();
const staff = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const manager = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('manager-1')}` });
const driverToken = createAccessToken({ sub: 'driver-1', role: 'driver' });

const veh = (over: Record<string, unknown> = {}) => ({
  id: 'veh-1', plate_number: 'MH01AB1234', vehicle_type: 'truck', capacity_kg: 5000, fuel_type: 'diesel', status: 'idle', ...over,
});

const USERS = [
  { id: 'admin-1', role: 'admin', is_active: true, full_name: 'Asha Admin' },
  { id: 'manager-1', role: 'manager', is_active: true, full_name: 'Manoj Manager' },
  { id: 'driver-1', role: 'driver', is_active: true, phone: '+919876543210' },
  { id: 'driver-2', role: 'driver', is_active: true, phone: '+919000000002' },
];

function reset(vehicles: Record<string, unknown>[], extra: Record<string, Record<string, unknown>[]> = {}) {
  supabaseMock.reset({ users: USERS, vehicles, routes: [], sos_alerts: [], notifications: [], cargo_manifest: [], invoices: [], ...extra });
}

const setStatus = (id: string, status: string, who = staff()) =>
  request(app).post(`/api/v1/vehicles/${id}/status`).set(who).send({ status });

describe('vehicle rules', () => {
  it('spots placeholder plates', () => {
    expect(isPlaceholderPlate('TEMP-AB12CD')).toBe(true);
    expect(isPlaceholderPlate('drft-1')).toBe(true);
    expect(isPlaceholderPlate('MH01AB1234')).toBe(false);
  });

  it('dispatches available, idle, on_route and offline trucks, but not placeholders, maintenance or archived', () => {
    for (const status of ['available', 'idle', 'on_route', 'offline']) expect(isDispatchable({ status, plate_number: 'MH01AB1234' })).toBe(true);
    for (const status of ['maintenance', 'archived']) expect(isDispatchable({ status, plate_number: 'MH01AB1234' })).toBe(false);
    expect(isDispatchable({ status: 'idle', plate_number: 'TEMP-ABC123' })).toBe(false);
  });

  it('is live by the newer of heartbeat and sync', () => {
    const now = Date.parse('2026-09-29T10:00:00Z');
    expect(isLive({ last_heartbeat: '2026-09-29T09:58:00Z', last_sync: null }, 5, now)).toBe(true);
    expect(isLive({ last_heartbeat: '2026-09-29T09:00:00Z', last_sync: '2026-09-29T09:59:00Z' }, 5, now)).toBe(true);
    expect(isLive({ last_heartbeat: '2026-09-29T09:00:00Z', last_sync: '2026-09-29T09:30:00Z' }, 5, now)).toBe(false);
    expect(isLive({}, 5, now)).toBe(false);
  });
});

describe('POST /vehicles/:id/status', () => {
  it('returns a vehicle from maintenance to service', async () => {
    reset([veh({ status: 'maintenance' })]);
    const res = await setStatus('veh-1', 'available');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('available');
  });

  it('lets a manager do it, but not a driver', async () => {
    reset([veh({ status: 'maintenance' })]);
    expect((await setStatus('veh-1', 'idle', manager())).status).toBe(200);
    reset([veh({ status: 'maintenance' })]);
    const res = await request(app).post('/api/v1/vehicles/veh-1/status').set({ Authorization: `Bearer ${driverToken}` }).send({ status: 'idle' });
    expect(res.status).toBe(403);
  });

  it('refuses moves the history does not allow', async () => {
    reset([veh({ status: 'archived' })]);
    expect((await setStatus('veh-1', 'maintenance')).status).toBe(409);
  });

  it('never sets on_route by hand', async () => {
    reset([veh()]);
    expect((await setStatus('veh-1', 'on_route')).status).toBe(400);
  });

  it('refuses to archive a vehicle on an active route, and clears the driver link when archiving', async () => {
    reset([veh({ status: 'available', driver_id: 'driver-1' })], { routes: [{ id: 'r1', vehicle_id: 'veh-1', status: 'active' }] });
    expect((await setStatus('veh-1', 'archived')).status).toBe(409);
    reset([veh({ status: 'available', driver_id: 'driver-1' })]);
    expect((await setStatus('veh-1', 'archived')).status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ status: 'archived', driver_id: null });
  });

  it('unarchives to idle, only when archived', async () => {
    reset([veh({ status: 'archived' })]);
    expect((await request(app).post('/api/v1/vehicles/veh-1/unarchive').set(staff())).status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('idle');
    expect((await request(app).post('/api/v1/vehicles/veh-1/unarchive').set(staff())).status).toBe(409);
  });

  it('404s for an unknown vehicle', async () => {
    reset([]);
    expect((await setStatus('nope', 'idle')).status).toBe(404);
  });
});

describe('PATCH /vehicles/:id', () => {
  const patch = (body: object) => request(app).patch('/api/v1/vehicles/veh-1').set(staff()).send(body);

  it('ignores a status that matches the stored one (stale edit form)', async () => {
    reset([veh({ status: 'maintenance' })]);
    const res = await patch({ status: 'maintenance', vehicle_model: 'Tata 407' });
    expect(res.status).toBe(200);
    expect(supabaseMock.writes('vehicles', 'PATCH')[0].body).not.toHaveProperty('status');
  });

  it('refuses a status change the transitions do not allow', async () => {
    reset([veh({ status: 'archived' })]);
    expect((await patch({ status: 'maintenance' })).status).toBe(409);
  });

  it('allows a valid status change', async () => {
    reset([veh({ status: 'maintenance' })]);
    expect((await patch({ status: 'available' })).status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('available');
  });

  it('links the driver account when the phone is edited', async () => {
    reset([veh({ driver_name: null, driver_phone: null })]);
    const res = await patch({ driver_name: 'Ravi', driver_phone: '9876543210' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].driver_id).toBe('driver-1');
  });

  it('renames the linked driver account when only the name is edited', async () => {
    reset([veh({ driver_id: 'driver-1', driver_name: 'Ravi', driver_phone: '9876543210' })]);
    const res = await patch({ driver_name: 'Ravi Kumar' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('users').find(u => u.id === 'driver-1')!.full_name).toBe('Ravi Kumar');
  });

  it('replaces the driver TEMP placeholder when linking them to this vehicle', async () => {
    reset([veh(), veh({ id: 'temp-1', plate_number: 'TEMP-ABC123', driver_id: 'driver-1' })]);
    const res = await patch({ driver_name: 'Ravi', driver_phone: '9876543210' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vehicles').find(v => v.id === 'temp-1')).toMatchObject({ status: 'archived', driver_id: null });
    expect(supabaseMock.rows('vehicles').find(v => v.id === 'veh-1')!.driver_id).toBe('driver-1');
  });

  it('refuses to give a driver a second real vehicle', async () => {
    reset([veh(), veh({ id: 'veh-2', plate_number: 'MH02CD5678', driver_id: 'driver-1' })]);
    expect((await patch({ driver_name: 'Ravi', driver_phone: '9876543210' })).status).toBe(409);
  });
});

describe('POST /vehicles driver handling', () => {
  const body = { plate_number: 'MH12XY9999', vehicle_type: 'truck', capacity_kg: 3000, driver_name: 'Ravi', driver_phone: '9876543210' };
  const create = () => request(app).post('/api/v1/vehicles').set(staff()).send(body);

  it('adopts the driver TEMP placeholder instead of creating a second vehicle', async () => {
    reset([veh({ id: 'temp-1', plate_number: 'TEMP-ABC123', driver_id: 'driver-1' })]);
    const res = await create();
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ id: 'temp-1', plate_number: 'MH12XY9999', driver_id: 'driver-1' });
  });

  it('refuses when the driver already has a real vehicle', async () => {
    reset([veh({ driver_id: 'driver-1' })]);
    expect((await create()).status).toBe(409);
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });

  it('saving a draft links no driver and leaves the placeholder alone', async () => {
    reset([veh({ id: 'temp-1', plate_number: 'TEMP-ABC123', driver_id: 'driver-1' })]);
    const res = await request(app).post('/api/v1/vehicles').set(staff()).send({ ...body, status: 'archived' });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('vehicles')).toHaveLength(2);
    expect(supabaseMock.rows('vehicles').find(v => v.id === 'temp-1')!.plate_number).toBe('TEMP-ABC123');
  });

  it('creates normally for a driver with no vehicle', async () => {
    reset([]);
    expect((await create()).status).toBe(201);
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });
});

describe('GET /vehicles and /vehicles/summary', () => {
  it('lists in a stable plate order', async () => {
    reset([veh()]);
    await request(app).get('/api/v1/vehicles?limit=500').set(staff());
    const url = supabaseMock.requests.find(u => u.pathname === '/rest/v1/vehicles')!;
    expect(url.searchParams.get('order')).toContain('plate_number.asc');
  });

  it('counts real fleet vehicles and keeps placeholders out, as drafts', async () => {
    reset([
      veh({ id: 'a', plate_number: 'MH01AA0001', status: 'idle' }),
      veh({ id: 'b', plate_number: 'MH01AA0002', status: 'on_route' }),
      veh({ id: 'c', plate_number: 'MH01AA0003', status: 'archived' }),
      veh({ id: 'd', plate_number: 'TEMP-AAAAAA', status: 'idle' }),
      veh({ id: 'e', plate_number: 'TEMP-BBBBBB', status: 'archived' }),
      veh({ id: 'f', plate_number: 'DRFT-1', status: 'archived' }),
    ]);
    const res = await request(app).get('/api/v1/vehicles/summary').set(staff());
    expect(res.body).toEqual({ total: 2, active: 1, idle: 1, maintenance: 0, offline: 0, archived: 1, drafts: 2 });
  });
});

describe('staff SOS on a vehicle', () => {
  const sos = (body: object = {}) => request(app).post('/api/v1/vehicles/veh-1/sos').set(staff()).send(body);

  it('records the vehicle driver, names the staff member and defaults to a real type', async () => {
    reset([veh({ driver_id: 'driver-1' })]);
    const res = await sos({ latitude: 1, longitude: 1 });
    expect(res.status).toBe(201);
    const row = supabaseMock.rows('sos_alerts')[0];
    expect(row).toMatchObject({ driver_id: 'driver-1', alert_type: 'panic_button', status: 'active' });
    expect(row.description).toContain('Raised by staff: Asha Admin');
  });

  it('accepts a severity', async () => {
    reset([veh({ driver_id: 'driver-1' })]);
    await sos({ alert_type: 'accident', severity: 'serious' });
    expect(supabaseMock.rows('sos_alerts')[0].severity).toBe('serious');
    expect(supabaseMock.rows('vehicles')[0].status).toBe('maintenance');
  });

  it('is rate limited per user', async () => {
    reset([veh()]);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await request(app).post('/api/v1/vehicles/veh-1/sos').set(manager()).send({})).status);
    }
    expect(statuses.slice(0, 5).every(s => s === 201)).toBe(true);
    expect(statuses[6]).toBe(429);
  });
});

describe('manager notifications', () => {
  it('reach managers for an SOS but not for KYC', async () => {
    reset([veh()]);
    await request(app).post('/api/v1/vehicles/veh-1/sos').set(staff()).send({});
    const start = Date.now();
    while (supabaseMock.writes('notifications', 'POST').length < 3 && Date.now() - start < 500) {
      await new Promise(r => setTimeout(r, 10));
    }
    const ids = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id);
    // (a set: notifications from the rate-limit test above can still be landing)
    expect([...new Set(ids)].sort()).toEqual(['admin-1', 'manager-1']);

    const { notificationService } = await import('../src/services/notification.service');
    await new Promise(r => setTimeout(r, 100));
    supabaseMock.reset({ users: USERS, notifications: [] });
    await notificationService.notifyStaff('KYC', 'submitted', 'kyc_submitted');
    expect(supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id)).toEqual(['admin-1']);
  });
});
