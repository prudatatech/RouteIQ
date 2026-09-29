import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { DISPATCHABLE_STATUSES, isDispatchable } from '../src/core/vehicles';
import { matchingService } from '../src/services/matching.service';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const manager = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('manager-1')}` });
const driver = (id = 'driver-1') => ({ Authorization: `Bearer ${createAccessToken({ sub: id, role: 'driver' })}` });

const USERS = [
  { id: 'admin-1', role: 'admin', is_active: true, full_name: 'Asha Admin' },
  { id: 'manager-1', role: 'manager', is_active: true, full_name: 'Manoj Manager' },
  { id: 'driver-1', role: 'driver', is_active: true, full_name: 'Ravi Driver', phone: '+919876543210' },
  { id: 'driver-2', role: 'driver', is_active: true, full_name: 'Sunil Driver', phone: '+919000000002' },
];

const VEHICLE_UUID = '22222222-2222-4222-8222-222222222222';
const ROUTE_ID = '11111111-1111-4111-8111-111111111111';
const REGISTRATION = { plate_number: 'mh 12-ab 1234', vehicle_type: 'truck', capacity_kg: 5000, vehicle_model: 'Tata 407', rc_number: 'RC-77' };

function reset(vehicles: Record<string, unknown>[] = [], extra: Record<string, Record<string, unknown>[]> = {}) {
  supabaseMock.reset({
    users: USERS, vehicles, routes: [], notifications: [], ai_agent_logs: [], vehicle_photos: [], cargo_manifest: [], invoices: [], ...extra,
  });
}

const pendingVehicle = (over: Record<string, unknown> = {}) => ({
  id: 'veh-p', plate_number: 'MH12AB1234', vehicle_type: 'truck', capacity_kg: 5000, status: 'pending_approval',
  driver_id: 'driver-1', submitted_by: 'driver-1', driver_name: 'Ravi Driver', driver_phone: '+919876543210', submitted_at: '2026-09-29T08:00:00.000Z', ...over,
});

/** A vehicle staff rejected: archived, freed from its driver, still tied to them by submitted_by. */
const rejectedVehicle = (over: Record<string, unknown> = {}) => pendingVehicle({
  status: 'archived', driver_id: null, review_decision: 'rejected', rejection_reason: 'Wrong plate', reviewed_by: 'admin-1', reviewed_at: '2026-09-29T09:00:00.000Z', ...over,
});

const register = (body: Record<string, unknown> = REGISTRATION, who = driver()) => request(app).post('/api/v1/vehicles/register').set(who).send(body);
const vehicleRow = (id: string) => supabaseMock.rows('vehicles').find(v => v.id === id)!;

describe('a driver registers a vehicle', () => {
  beforeEach(() => reset());

  it('creates it pending approval, linked to the driver, with the plate normalised', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending_approval', plate_number: 'MH12AB1234', driver_id: 'driver-1', driver_name: 'Ravi Driver', driver_phone: '+919876543210', submitted_by: 'driver-1' });
    expect(res.body.submitted_at).toEqual(expect.any(String));
    expect(res.body.review_decision).toBeNull();
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });

  it('tells admin and manager, but not the driver', async () => {
    await register();
    await vi.waitFor(() => expect(supabaseMock.rows('notifications')).toHaveLength(2));
    const notes = supabaseMock.rows('notifications');
    expect(notes.map(n => n.user_id).sort()).toEqual(['admin-1', 'manager-1']);
    expect(notes[0]).toMatchObject({ type: 'vehicle_request', title: 'New vehicle request' });
  });

  it('fills the TEMP placeholder from first login instead of adding a second vehicle', async () => {
    reset([{ id: 'veh-t', plate_number: 'TEMP-ABC123', vehicle_type: 'truck', capacity_kg: 1000, status: 'idle', driver_id: 'driver-1' }]);
    const res = await register();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'veh-t', status: 'pending_approval', plate_number: 'MH12AB1234' });
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });

  it('refuses a placeholder plate, a bad plate and a driver-less caller', async () => {
    expect((await register({ ...REGISTRATION, plate_number: 'TEMP-1234' })).status).toBe(400);
    expect((await register({ ...REGISTRATION, plate_number: 'MH 12 @@' })).status).toBe(400);
    expect((await register({ ...REGISTRATION, capacity_kg: 0 })).status).toBe(400);
    expect((await register(REGISTRATION, admin())).status).toBe(403);
    expect((await request(app).post('/api/v1/vehicles/register').send(REGISTRATION)).status).toBe(401);
  });

  it('refuses a plate that belongs to another vehicle', async () => {
    reset([{ id: 'veh-x', plate_number: 'MH12AB1234', vehicle_type: 'truck', capacity_kg: 9000, status: 'available', driver_id: 'driver-2' }]);
    const res = await register();
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });

  it('refuses a driver who already has an approved vehicle', async () => {
    reset([{ id: 'veh-a', plate_number: 'DL01AA0001', vehicle_type: 'truck', capacity_kg: 9000, status: 'available', driver_id: 'driver-1' }]);
    const res = await register();
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain('DL01AA0001');
  });

  it('submitting the same plate again updates the waiting request without a duplicate or a second alert', async () => {
    await register();
    await vi.waitFor(() => expect(supabaseMock.rows('notifications')).toHaveLength(2));
    supabaseMock.rows('notifications').length = 0;
    const first = vehicleRow(supabaseMock.rows('vehicles')[0].id as string).submitted_at;
    const res = await register({ ...REGISTRATION, capacity_kg: 6000 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'pending_approval', capacity_kg: 6000, submitted_at: first });
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
    expect(supabaseMock.rows('notifications')).toHaveLength(0);
  });

  it('a corrected plate updates the same waiting request', async () => {
    reset([pendingVehicle()]);
    const res = await register({ ...REGISTRATION, plate_number: 'MH12AB9999' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'veh-p', plate_number: 'MH12AB9999', status: 'pending_approval' });
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });

  it('reports where the registration stands', async () => {
    let res = await request(app).get('/api/v1/vehicles/my-registration').set(driver());
    expect(res.body).toMatchObject({ state: 'none', vehicle: null });

    await register();
    res = await request(app).get('/api/v1/vehicles/my-registration').set(driver());
    expect(res.body).toMatchObject({ state: 'pending', vehicle: { plate_number: 'MH12AB1234', status: 'pending_approval' } });
    expect((await request(app).get('/api/v1/vehicles/my-registration').set(admin())).status).toBe(403);
  });
});

describe('the review', () => {
  beforeEach(() => reset([pendingVehicle()]));

  it('approve makes the vehicle available and records who and when', async () => {
    const res = await request(app).post('/api/v1/vehicles/veh-p/approve').set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'available', review_decision: 'approved', reviewed_by: 'admin-1', rejection_reason: null });
    expect(res.body.reviewed_at).toEqual(expect.any(String));
    expect(vehicleRow('veh-p').status).toBe('available');
    expect(supabaseMock.rows('ai_agent_logs')[0]).toMatchObject({ action: 'vehicle_approved', vehicle_id: 'veh-p' });
  });

  it('notifies the driver of the approval', async () => {
    await request(app).post('/api/v1/vehicles/veh-p/approve').set(manager());
    await vi.waitFor(() => expect(supabaseMock.rows('notifications').some(n => n.user_id === 'driver-1')).toBe(true));
    const note = supabaseMock.rows('notifications').find(n => n.user_id === 'driver-1');
    expect(note).toMatchObject({ type: 'vehicle_approval', data: { vehicle_id: 'veh-p', decision: 'approved' } });
    expect(vehicleRow('veh-p').reviewed_by).toBe('manager-1');
  });

  it('reject needs a reason', async () => {
    for (const body of [{}, { reason: '  ' }, { reason: 'no' }]) {
      const res = await request(app).post('/api/v1/vehicles/veh-p/reject').set(admin()).send(body);
      expect(res.status).toBe(400);
    }
    expect(vehicleRow('veh-p').status).toBe('pending_approval');
  });

  it('reject archives the vehicle with the reason, keeps the driver and shows it in the archived filter', async () => {
    const res = await request(app).post('/api/v1/vehicles/veh-p/reject').set(admin()).send({ reason: 'RC photo is unreadable' });
    expect(res.status).toBe(200);
    // Like any archive it frees the driver link; the vehicle stays tied to them by submitted_by
    expect(res.body).toMatchObject({ status: 'archived', review_decision: 'rejected', rejection_reason: 'RC photo is unreadable', reviewed_by: 'admin-1', driver_id: null, submitted_by: 'driver-1' });

    const archived = await request(app).get('/api/v1/vehicles?status=archived').set(admin());
    expect(archived.body[0]).toMatchObject({ id: 'veh-p', rejection_reason: 'RC photo is unreadable' });

    await vi.waitFor(() => expect(supabaseMock.rows('notifications').some(n => n.user_id === 'driver-1')).toBe(true));
    const note = supabaseMock.rows('notifications').find(n => n.user_id === 'driver-1');
    expect(note).toMatchObject({ type: 'vehicle_approval', data: { decision: 'rejected' } });
    expect(String(note!.body)).toContain('RC photo is unreadable');
    expect(supabaseMock.rows('ai_agent_logs')[0]).toMatchObject({ action: 'vehicle_rejected', output_data: 'RC photo is unreadable' });

    const mine = await request(app).get('/api/v1/vehicles/my-registration').set(driver());
    expect(mine.body).toMatchObject({ state: 'rejected', vehicle: { rejection_reason: 'RC photo is unreadable' } });
  });

  it('decides a vehicle once', async () => {
    await request(app).post('/api/v1/vehicles/veh-p/approve').set(admin());
    expect((await request(app).post('/api/v1/vehicles/veh-p/approve').set(admin())).status).toBe(409);
    expect((await request(app).post('/api/v1/vehicles/veh-p/reject').set(admin()).send({ reason: 'too late' })).status).toBe(409);
    expect((await request(app).post('/api/v1/vehicles/nope/approve').set(admin())).status).toBe(404);
  });

  it('no status endpoint can approve a vehicle around the review', async () => {
    const res = await request(app).post('/api/v1/vehicles/veh-p/status').set(admin()).send({ status: 'available' });
    expect(res.status).toBe(409);
    expect((await request(app).post('/api/v1/vehicles/veh-p/archive').set(admin())).status).toBe(409);
    expect(vehicleRow('veh-p').status).toBe('pending_approval');
  });

  it('approving replaces the driver\'s TEMP placeholder', async () => {
    reset([pendingVehicle(), { id: 'veh-t', plate_number: 'TEMP-ABC123', vehicle_type: 'truck', capacity_kg: 1000, status: 'idle', driver_id: 'driver-1' }]);
    const res = await request(app).post('/api/v1/vehicles/veh-p/approve').set(admin());
    expect(res.status).toBe(200);
    expect(vehicleRow('veh-t')).toMatchObject({ status: 'archived', driver_id: null });
  });

  it('approving is refused when the driver already has a live vehicle', async () => {
    reset([pendingVehicle(), { id: 'veh-a', plate_number: 'DL01AA0001', vehicle_type: 'truck', capacity_kg: 9000, status: 'available', driver_id: 'driver-1' }]);
    const res = await request(app).post('/api/v1/vehicles/veh-p/approve').set(admin());
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain('DL01AA0001');
    expect(vehicleRow('veh-p').status).toBe('pending_approval');
  });

  it('restoring a rejected vehicle from the fleet approves it, on any route to idle', async () => {
    await request(app).post('/api/v1/vehicles/veh-p/reject').set(admin()).send({ reason: 'Wrong plate' });
    const res = await request(app).post('/api/v1/vehicles/veh-p/status').set(admin()).send({ status: 'idle' });
    expect(res.status).toBe(200);
    expect(vehicleRow('veh-p')).toMatchObject({ status: 'available', review_decision: 'approved', reviewed_by: 'admin-1' });
  });

  it('a rejected vehicle can still be approved later, from the fleet\'s unarchive', async () => {
    await request(app).post('/api/v1/vehicles/veh-p/reject').set(admin()).send({ reason: 'Wrong plate' });
    const res = await request(app).post('/api/v1/vehicles/veh-p/unarchive').set(manager());
    expect(res.status).toBe(200);
    expect(vehicleRow('veh-p')).toMatchObject({ status: 'available', review_decision: 'approved', reviewed_by: 'manager-1', rejection_reason: null });
  });
});

describe('a driver submits again after a rejection', () => {
  beforeEach(() => reset([rejectedVehicle()]));

  it('puts the same vehicle back to pending and clears the decision', async () => {
    const res = await register({ ...REGISTRATION, plate_number: 'MH12AB4321' });
    expect(res.status).toBe(200);
    // Linked to the driver again, decision cleared
    expect(res.body).toMatchObject({ id: 'veh-p', status: 'pending_approval', plate_number: 'MH12AB4321', resubmitted: true, review_decision: null, rejection_reason: null, reviewed_by: null, driver_id: 'driver-1' });
    expect(res.body.submitted_at).not.toBe('2026-09-29T08:00:00.000Z');
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
    await vi.waitFor(() => expect(supabaseMock.rows('notifications').map(n => n.type)).toEqual(['vehicle_request', 'vehicle_request']));
  });

  it('accepts the same plate again as the same vehicle', async () => {
    const res = await register();
    expect(res.body).toMatchObject({ id: 'veh-p', status: 'pending_approval' });
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });

  it('the TEMP placeholder does not become a second live vehicle', async () => {
    reset([
      rejectedVehicle(),
      { id: 'veh-t', plate_number: 'TEMP-ABC123', vehicle_type: 'truck', capacity_kg: 1000, status: 'idle', driver_id: 'driver-1' },
    ]);
    const res = await register();
    expect(res.body.id).toBe('veh-p');
    expect(vehicleRow('veh-t')).toMatchObject({ status: 'archived', driver_id: null });
  });
});

describe('a driver with a rejected vehicle and a new one', () => {
  it('has one live vehicle for the endpoints that look up the driver\'s vehicle', async () => {
    reset([rejectedVehicle(), { id: 'veh-a', plate_number: 'DL01AA0001', vehicle_type: 'truck', capacity_kg: 9000, status: 'available', driver_id: 'driver-1' }]);
    const list = await request(app).get('/api/v1/vehicles').set(driver());
    expect(list.body.map((v: any) => v.id)).toEqual(['veh-a']);
    const mine = await request(app).get('/api/v1/vehicles/my-registration').set(driver());
    expect(mine.body).toMatchObject({ state: 'approved', vehicle: { id: 'veh-a' } });
  });

  it('approving a rejected vehicle links the driver again, unless they have another live vehicle', async () => {
    reset([rejectedVehicle(), { id: 'veh-a', plate_number: 'DL01AA0001', vehicle_type: 'truck', capacity_kg: 9000, status: 'available', driver_id: 'driver-1' }]);
    const blocked = await request(app).post('/api/v1/vehicles/veh-p/approve').set(admin());
    expect(blocked.status).toBe(409);
    reset([rejectedVehicle()]);
    const ok = await request(app).post('/api/v1/vehicles/veh-p/approve').set(admin());
    expect(ok.status).toBe(200);
    expect(vehicleRow('veh-p')).toMatchObject({ status: 'available', driver_id: 'driver-1' });
  });
});

describe('who can see and decide requests', () => {
  beforeEach(() => reset([pendingVehicle()]));

  it('staff list the pending requests with the driver and a count', async () => {
    for (const who of [admin(), manager()]) {
      const res = await request(app).get('/api/v1/vehicles/requests').set(who);
      expect(res.status).toBe(200);
      expect(res.body.pending).toBe(1);
      expect(res.body.requests[0]).toMatchObject({
        vehicle: { id: 'veh-p', plate_number: 'MH12AB1234' },
        driver: { id: 'driver-1', full_name: 'Ravi Driver', phone: '+919876543210' },
        submitted_at: '2026-09-29T08:00:00.000Z',
        primary_photo_url: null,
      });
    }
    const count = await request(app).get('/api/v1/vehicles/requests/count').set(manager());
    expect(count.body).toEqual({ pending: 1 });
  });

  it('only pending vehicles are listed', async () => {
    reset([pendingVehicle(), { id: 'veh-a', plate_number: 'DL01AA0001', vehicle_type: 'truck', capacity_kg: 9000, status: 'available' }, rejectedVehicle({ id: 'veh-r', plate_number: 'DL01AA0002' })]);
    const res = await request(app).get('/api/v1/vehicles/requests').set(admin());
    expect(res.body.requests.map((r: any) => r.vehicle.id)).toEqual(['veh-p']);
  });

  it('a driver, a vendor and a stranger cannot list, count, approve or reject', async () => {
    for (const who of [driver(), { Authorization: 'Bearer nonsense' }, {}]) {
      const expected = 'Authorization' in who && who.Authorization !== 'Bearer nonsense' ? 403 : 401;
      expect((await request(app).get('/api/v1/vehicles/requests').set(who)).status).toBe(expected);
      expect((await request(app).get('/api/v1/vehicles/requests/count').set(who)).status).toBe(expected);
      expect((await request(app).post('/api/v1/vehicles/veh-p/approve').set(who)).status).toBe(expected);
      expect((await request(app).post('/api/v1/vehicles/veh-p/reject').set(who).send({ reason: 'nope nope' })).status).toBe(expected);
    }
    expect(vehicleRow('veh-p').status).toBe('pending_approval');
  });

  it('vehicles staff create on the web are approved at once, with who did it', async () => {
    const res = await request(app).post('/api/v1/vehicles').set(admin()).send({ plate_number: 'DL01AA0007', vehicle_type: 'truck', capacity_kg: 4000 });
    expect(res.status).toBe(201);
    expect(res.body.status).not.toBe('pending_approval');
    expect(res.body).toMatchObject({ review_decision: 'approved', reviewed_by: 'admin-1' });
    expect((await request(app).get('/api/v1/vehicles/requests').set(admin())).body.pending).toBe(1);
  });

  it('the fleet summary keeps pending vehicles out of the fleet total', async () => {
    reset([pendingVehicle(), { id: 'veh-a', plate_number: 'DL01AA0001', vehicle_type: 'truck', capacity_kg: 9000, status: 'available' }]);
    const res = await request(app).get('/api/v1/vehicles/summary').set(admin());
    expect(res.body).toMatchObject({ total: 1, pending_approval: 1 });
  });
});

describe('a pending vehicle is not part of dispatch or bidding', () => {
  it('is not dispatchable', () => {
    expect(isDispatchable({ status: 'pending_approval', plate_number: 'MH12AB1234' })).toBe(false);
    expect(DISPATCHABLE_STATUSES as readonly string[]).not.toContain('pending_approval');
  });

  it('is left out of matching', async () => {
    supabaseMock.reset({
      shipments: [{ id: 'ship-1', origin_lat: 28.6, origin_lng: 77.2, required_vehicle_type: 'truck', metadata: {} }],
      vehicles: [
        { id: 'a', plate_number: 'DL01AA0001', status: 'available', vehicle_type: 'truck', latitude: 28.61, longitude: 77.21 },
        { id: 'b', plate_number: 'DL01AA0002', status: 'pending_approval', vehicle_type: 'truck', latitude: 28.62, longitude: 77.21 },
      ],
    });
    const result: any = await matchingService.computeAvailabilityScore('ship-1');
    expect(result.count ?? result.available_count).toBe(1);
  });

  it('cannot open a bidding window', async () => {
    reset([pendingVehicle({ available_capacity_kg: 3000, current_load_kg: 0 })]);
    const res = await request(app).post('/api/v1/vehicles/veh-p/return-trip').set(admin()).send({});
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('capacity_windows')).toHaveLength(0);
  });

  it('cannot be given a route', async () => {
    reset([pendingVehicle({ id: VEHICLE_UUID })], { routes: [{ id: ROUTE_ID, vehicle_id: null, status: 'pending' }] });
    const res = await request(app).patch(`/api/v1/routes/${ROUTE_ID}`).set(admin()).send({ vehicle_id: VEHICLE_UUID });
    expect(res.status).toBe(409);
  });

  it('a driver cannot move it out of pending by editing the vehicle', async () => {
    reset([pendingVehicle()]);
    await request(app).patch('/api/v1/vehicles/veh-p').set(driver()).send({ status: 'available', declared_load_percentage: 0 });
    expect(vehicleRow('veh-p').status).toBe('pending_approval');
  });
});

describe('vehicle photos', () => {
  beforeEach(() => reset([pendingVehicle()]));
  const uploadUrl = (slot: string, who = driver(), id = 'veh-p') =>
    request(app).post(`/api/v1/vehicles/${id}/photos/upload-url`).set(who).send({ slot, content_type: 'image/jpeg', size: 200_000 });

  it('the driver and staff get a signed upload URL inside the vehicle folder', async () => {
    const res = await uploadUrl('front');
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(/^vehicles\/veh-p\/photos\/front_[0-9a-f-]+\.jpg$/);
    expect((await uploadUrl('interior', admin())).status).toBe(200);
  });

  it('refuses another driver, a bad slot, a bad type and a huge file', async () => {
    expect((await uploadUrl('front', driver('driver-2'))).status).toBe(403);
    expect((await uploadUrl('roof')).status).toBe(400);
    const pdf = await request(app).post('/api/v1/vehicles/veh-p/photos/upload-url').set(driver()).send({ slot: 'front', content_type: 'application/pdf', size: 10 });
    expect(pdf.status).toBe(415);
    const big = await request(app).post('/api/v1/vehicles/veh-p/photos/upload-url').set(driver()).send({ slot: 'front', content_type: 'image/png', size: 50_000_000 });
    expect(big.status).toBe(413);
  });

  it('records an uploaded photo, shows it as the thumbnail, and replaces it', async () => {
    const first = (await uploadUrl('side')).body.path as string;
    const saved = await request(app).put('/api/v1/vehicles/veh-p/photos/side').set(driver()).send({ file_path: first });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ slot: 'side', url: expect.stringContaining(first) });

    const list = await request(app).get('/api/v1/vehicles/veh-p/photos').set(driver());
    expect(list.body).toHaveLength(1);

    const requests = await request(app).get('/api/v1/vehicles/requests').set(admin());
    expect(requests.body.requests[0].primary_photo_url).toContain(first);
    expect(requests.body.requests[0].photos.map((p: any) => p.slot)).toEqual(['side']);

    const second = (await uploadUrl('side', admin())).body.path as string;
    await request(app).put('/api/v1/vehicles/veh-p/photos/side').set(admin()).send({ file_path: second });
    expect(supabaseMock.rows('vehicle_photos')).toHaveLength(1);
    expect(supabaseMock.rows('vehicle_photos')[0].file_path).toBe(second);
  });

  it('front is the primary photo when there are several', async () => {
    for (const slot of ['back', 'front']) {
      const path = (await uploadUrl(slot)).body.path as string;
      await request(app).put(`/api/v1/vehicles/veh-p/photos/${slot}`).set(driver()).send({ file_path: path });
    }
    const res = await request(app).get('/api/v1/vehicles/requests').set(admin());
    expect(res.body.requests[0].photos.map((p: any) => p.slot)).toEqual(['front', 'back']);
    expect(res.body.requests[0].primary_photo_url).toContain('front_');
  });

  it('only accepts a path uploaded for this vehicle and slot', async () => {
    const put = (slot: string, file_path: string) => request(app).put(`/api/v1/vehicles/veh-p/photos/${slot}`).set(driver()).send({ file_path });
    expect((await put('front', 'vehicles/other/photos/front_x.jpg')).status).toBe(400);
    expect((await put('front', 'vehicles/veh-p/photos/../../secret.jpg')).status).toBe(400);
    expect((await put('front', 'vehicles/veh-p/photos/back_x.jpg')).status).toBe(400);
    expect((await put('roof', 'vehicles/veh-p/photos/roof_x.jpg')).status).toBe(400);
    expect(supabaseMock.rows('vehicle_photos')).toHaveLength(0);
  });

  it('a photo can be removed; once rejected only staff change the photos until the driver submits again', async () => {
    const path = (await uploadUrl('cargo')).body.path as string;
    await request(app).put('/api/v1/vehicles/veh-p/photos/cargo').set(driver()).send({ file_path: path });
    expect((await request(app).delete('/api/v1/vehicles/veh-p/photos/cargo').set(driver())).status).toBe(204);
    expect((await request(app).delete('/api/v1/vehicles/veh-p/photos/cargo').set(driver())).status).toBe(404);

    await request(app).post('/api/v1/vehicles/veh-p/reject').set(admin()).send({ reason: 'Add clear photos' });
    expect((await uploadUrl('front')).status).toBe(403);
    expect((await uploadUrl('front', admin())).status).toBe(200);
  });
});
