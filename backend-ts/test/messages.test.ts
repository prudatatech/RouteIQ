import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { invalidateDriverVehicles } from '../src/core/ownership';

const app = testApp();
const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const driver1 = as('driver-1', 'driver');
const driver2 = as('driver-2', 'driver');
const admin = as('admin-1', 'admin');
const vendor = as('vendor-1', 'vendor');

const MANIFEST = '99999999-aaaa-bbbb-cccc-000000000001';
const T1 = '2026-09-29T10:00:00.000Z';
const T2 = '2026-09-29T10:05:00.000Z';

function fixtures() {
  return {
    users: [
      { id: 'driver-1', role: 'driver', is_active: true, full_name: 'Ravi Kumar' },
      { id: 'driver-2', role: 'driver', is_active: true, full_name: 'Sunil Rao' },
      { id: 'admin-1', role: 'admin', is_active: true, full_name: 'Asha Menon' },
      { id: 'vendor-1', role: 'vendor', is_active: true },
    ],
    vehicles: [{ id: 'veh-1', driver_id: 'driver-1' }, { id: 'veh-2', driver_id: 'driver-2' }],
    routes: [
      { id: 'route-1', vehicle_id: 'veh-1', status: 'active' },
      { id: 'route-2', vehicle_id: 'veh-2', status: 'active' },
    ],
    route_stops: [{ id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 1, status: 'pending' }],
    delivery_points: [{ id: 'dp-1', shipment_id: 's1' }],
    shipments: [
      { id: 's1', tracking_id: 'RTX-AAAA1111', status: 'in_transit' },
      { id: 's-free', tracking_id: 'RTX-FREE0000', status: 'created' },
    ],
    cargo_manifest: [{ id: MANIFEST, vehicle_id: 'veh-1', status: 'scheduled' }],
    messages: [
      { id: 'm1', route_id: 'route-1', shipment_id: null, sender_id: 'driver-1', sender_role: 'driver', sender_name: 'Ravi Kumar', body: 'Stuck at the toll', created_at: T1, read_at: null },
      { id: 'm2', route_id: 'route-1', shipment_id: 's1', sender_id: 'admin-1', sender_role: 'admin', sender_name: 'Asha Menon', body: 'Take the bypass', created_at: T2, read_at: null },
      { id: 'm3', route_id: 'route-2', shipment_id: null, sender_id: 'driver-2', sender_role: 'driver', sender_name: 'Sunil Rao', body: 'Other driver message', created_at: T1, read_at: null },
    ],
    notifications: [],
  };
}

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(fixtures());
});

describe('GET /messages', () => {
  it('returns the route conversation oldest first, with the shipment it was about', async () => {
    const res = await request(app).get('/api/v1/messages?route_id=route-1').set(driver1);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: any) => m.id)).toEqual(['m1', 'm2']);
    expect(res.body.messages[1].shipment_tracking_id).toBe('RTX-AAAA1111');
  });

  it("refuses another driver's route", async () => {
    expect((await request(app).get('/api/v1/messages?route_id=route-2').set(driver1)).status).toBe(403);
  });

  it('lets staff read any route', async () => {
    const res = await request(app).get('/api/v1/messages?route_id=route-2').set(admin);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });

  it("shows a shipment's messages together with those on the route that carries it", async () => {
    const res = await request(app).get('/api/v1/messages?shipment_id=s1').set(admin);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: any) => m.id)).toEqual(['m1', 'm2']);
  });

  it('is not open to vendors or signed-out callers', async () => {
    expect((await request(app).get('/api/v1/messages?route_id=route-1').set(vendor)).status).toBe(403);
    expect((await request(app).get('/api/v1/messages?route_id=route-1')).status).toBe(401);
  });

  it('needs a thread', async () => {
    expect((await request(app).get('/api/v1/messages').set(admin)).status).toBe(400);
  });
});

describe('POST /messages', () => {
  it('lets the driver write on their own route', async () => {
    const res = await request(app).post('/api/v1/messages').set(driver1).send({ route_id: 'route-1', body: '  Reached the depot  ' });
    expect(res.status).toBe(201);
    const row = supabaseMock.rows('messages').find(m => m.body === 'Reached the depot')!;
    expect(row).toMatchObject({ route_id: 'route-1', sender_id: 'driver-1', sender_role: 'driver', sender_name: 'Ravi Kumar' });
  });

  it("refuses another driver's route, and writes nothing", async () => {
    const res = await request(app).post('/api/v1/messages').set(driver1).send({ route_id: 'route-2', body: 'hello' });
    expect(res.status).toBe(403);
    expect(supabaseMock.writes('messages', 'POST')).toHaveLength(0);
  });

  it('works for a vendor load', async () => {
    expect((await request(app).post('/api/v1/messages').set(driver1).send({ route_id: MANIFEST, body: 'Loaded' })).status).toBe(201);
    expect((await request(app).post('/api/v1/messages').set(driver2).send({ route_id: MANIFEST, body: 'Not mine' })).status).toBe(403);
  });

  it('stores the staff role and tells the driver', async () => {
    const res = await request(app).post('/api/v1/messages').set(admin).send({ route_id: 'route-1', body: 'Call me' });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('messages').find(m => m.body === 'Call me')).toMatchObject({ sender_role: 'admin', sender_name: 'Asha Menon' });
    const note = supabaseMock.rows('notifications')[0];
    expect(note).toMatchObject({ user_id: 'driver-1', type: 'dispatch_message', body: 'Call me' });
  });

  it("puts a shipment message on the shipment's route", async () => {
    const res = await request(app).post('/api/v1/messages').set(admin).send({ shipment_id: 's1', body: 'Is it fragile?' });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('messages').find(m => m.body === 'Is it fragile?')).toMatchObject({ shipment_id: 's1', route_id: 'route-1' });
  });

  it('says so when a shipment is not on a route yet', async () => {
    const res = await request(app).post('/api/v1/messages').set(admin).send({ shipment_id: 's-free', body: 'Hello' });
    expect(res.status).toBe(409);
    expect(supabaseMock.writes('messages', 'POST')).toHaveLength(0);
  });

  it("does not let a driver message a shipment that is not on their route", async () => {
    const res = await request(app).post('/api/v1/messages').set(driver2).send({ shipment_id: 's1', body: 'Hi' });
    expect(res.status).toBe(403);
  });

  it('rejects an empty or very long message', async () => {
    expect((await request(app).post('/api/v1/messages').set(driver1).send({ route_id: 'route-1', body: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/v1/messages').set(driver1).send({ route_id: 'route-1', body: 'x'.repeat(2001) })).status).toBe(400);
  });
});

describe('unread counts and marking read', () => {
  it("counts staff messages for the driver and driver messages for staff", async () => {
    const forDriver = await request(app).get('/api/v1/messages/unread').set(driver1);
    expect(forDriver.body.total).toBe(1);
    expect(forDriver.body.threads[0]).toMatchObject({ route_id: 'route-1', count: 1, last_body: 'Take the bypass' });

    const forStaff = await request(app).get('/api/v1/messages/unread').set(admin);
    expect(forStaff.body.total).toBe(2);
    expect(forStaff.body.threads.map((t: any) => t.route_id).sort()).toEqual(['route-1', 'route-2']);
  });

  it("does not show a driver another driver's unread messages", async () => {
    const res = await request(app).get('/api/v1/messages/unread').set(driver2);
    expect(res.body.total).toBe(0);
  });

  it("marks only the other side's messages read", async () => {
    const res = await request(app).post('/api/v1/messages/read').set(driver1).send({ route_id: 'route-1' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    const rows = supabaseMock.rows('messages');
    expect(rows.find(m => m.id === 'm2')!.read_at).toBeTruthy();
    expect(rows.find(m => m.id === 'm1')!.read_at).toBeNull();
  });

  it('lets staff mark a route or a shipment thread read', async () => {
    await request(app).post('/api/v1/messages/read').set(admin).send({ shipment_id: 's1' });
    expect(supabaseMock.rows('messages').find(m => m.id === 'm1')!.read_at).toBeTruthy();
    expect(supabaseMock.rows('messages').find(m => m.id === 'm3')!.read_at).toBeNull();
  });

  it("refuses to mark another driver's thread", async () => {
    expect((await request(app).post('/api/v1/messages/read').set(driver1).send({ route_id: 'route-2' })).status).toBe(403);
  });
});
