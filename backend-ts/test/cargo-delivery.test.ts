/**
 * Delivery outcomes: partial delivery, refused and not delivered with re-attempts up to RTO,
 * the delivery OTP, the complete-stop fields of the delivery sheet, and verify-pod evidence.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { cacheDelete } from '../src/core/redis';
import { ID, auth, cargoWorld, one, notesFor, shipmentRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const PHOTO = `cargo/${ID.s1}/photo_a.jpg`;

const custody = (body: object, who = auth.driver()) => request(app).post(api('/cargo/custody')).set(who).send({ ref: { shipment_id: ID.s1 }, ...body });
const completeStop = (body: object) => request(app).post(api('/telemetry/driver-ping/complete-stop')).set(auth.driver()).send(body);

beforeEach(async () => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld());
  await cacheDelete(`cargo-otp-fail:${ID.s1}`);
  await cacheDelete(`ratelimit:cargo-otp-send:${ID.s1}`);
});

describe('partial delivery', () => {
  it('delivers what was accepted, keeps the refused pieces on board and opens a case', async () => {
    const res = await custody({ kind: 'partial_delivery', pieces: 7, pieces_refused: 2, pieces_short: 1, receiver_name: 'Store manager', photo_paths: [PHOTO], reason: 'Two cartons crushed' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'partially_delivered', current_holder: 'vehicle', pieces: { total: 10, delivered: 7, short: 1, returned: 0, on_board: 2 } });
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'partially_delivered', current_vehicle_id: ID.v1, received_by: 'Store manager', photo_url: PHOTO });
    const [exc] = supabaseMock.rows('cargo_exceptions');
    expect(exc).toMatchObject({ type: 'shortage', status: 'open' });
    expect(supabaseMock.rows('cargo_exception_items')[0]).toMatchObject({ shipment_id: ID.s1, pieces_affected: 3 });
    // The stop is done; staff and the customer are told
    expect(one('route_stops', ID.stop1).status).toBe('completed');
    expect(notesFor(ID.admin).some(n => n.type === 'cargo_partial_delivery')).toBe(true);
    expect(notesFor(ID.customer).some(n => n.type === 'cargo_partial_delivery' && /7 of your pieces were delivered/.test(n.body))).toBe(true);
  });

  it('must account for every piece on board, never more', async () => {
    expect((await custody({ kind: 'partial_delivery', pieces: 7, pieces_refused: 2, receiver_name: 'X', photo_paths: [PHOTO] })).status).toBe(409);
    expect((await custody({ kind: 'partial_delivery', pieces: 9, pieces_refused: 2, receiver_name: 'X', photo_paths: [PHOTO] })).status).toBe(409);
    expect((await custody({ kind: 'delivery', pieces: 11, receiver_name: 'X', photo_paths: [PHOTO] })).status).toBe(409);
    const fewer = await custody({ kind: 'delivery', pieces: 6, receiver_name: 'X', photo_paths: [PHOTO] });
    expect(fewer.status).toBe(409);
    expect(fewer.body.detail).toMatch(/partial delivery/);
    expect(one('shipments', ID.s1).status).toBe('in_transit');
  });

  it('comes through complete-stop from the delivery sheet, taking only the delivered weight off the truck', async () => {
    const res = await completeStop({ stop_id: ID.stop1, outcome: 'partial', pieces: 8, pieces_refused: 2, received_by: 'Guard', photo_paths: [`pod/${ID.stop1}/photo_b.jpg`] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'partially_delivered', pieces_delivered: 8 });
    expect(one('route_stops', ID.stop1)).toMatchObject({ status: 'completed', photo_url: `pod/${ID.stop1}/photo_b.jpg` });
    // 8 of 10 pieces of 1,000 kg came off, so 200 kg of it is still on board, with the 500 kg shipment still to
    // collect and the 300 kg vendor load: the load is worked out from what is on or planned for the truck.
    expect(one('vehicles', ID.v1).current_load_kg).toBe(1000);
  });

  it('records a delivery with remarks as delivered, with a damage case', async () => {
    const res = await completeStop({ stop_id: ID.stop1, outcome: 'delivered_with_remarks', condition: 'damaged_packaging', pieces_damaged: 1, received_by: 'Guard', photo_url: `pod/${ID.stop1}/photo_c.jpg` });
    expect(res.status).toBe(200);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'delivered', pieces_delivered: 10, pieces_damaged: 1, current_holder: 'consignee' });
    expect(supabaseMock.rows('cargo_exceptions')[0]).toMatchObject({ type: 'damage' });
    expect((await completeStop({ stop_id: ID.stop2, outcome: 'delivered_with_remarks', received_by: 'X' })).status).toBe(400);
  });
});

describe('refused, not delivered, re-attempt and return to origin', () => {
  beforeEach(() => { one('shipments', ID.s1).max_delivery_attempts = 2; });

  it('opens a case per failed attempt and starts an RTO at the last one', async () => {
    const first = await completeStop({ stop_id: ID.stop1, outcome: 'not_delivered', reason: 'customer_unavailable', note: 'Gate locked' });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('failed');
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'exception', delivery_attempts: 1, rto: false, current_holder: 'vehicle' });
    const [undeliverable] = supabaseMock.rows('cargo_exceptions');
    expect(undeliverable).toMatchObject({ type: 'undeliverable', source: 'stop_failed' });
    expect(one('route_stops', ID.stop1).status).toBe('failed');
    expect(notesFor(ID.customer).some(n => n.title === 'Delivery attempt failed')).toBe(true);

    // Staff schedule a re-attempt: a new stop on the vehicle's route, and the goods go out again
    const again = await request(app).post(api(`/cargo/exceptions/${undeliverable.id}/actions`)).set(auth.admin())
      .send({ action: 'reattempt', scheduled_for: new Date(Date.now() + 3600_000).toISOString() });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('action_planned');
    expect(one('shipments', ID.s1).status).toBe('out_for_delivery');
    const retry = supabaseMock.rows('route_stops').find(s => s.delivery_point_id === ID.dp1 && s.status === 'pending')!;
    expect(retry).toBeTruthy();

    // The second (last) attempt is refused: return to origin with a return leg on the same truck
    const second = await completeStop({ stop_id: retry.id, outcome: 'refused', reason: 'customer_refused' });
    expect(second.status).toBe(200);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'returning', rto: true, delivery_attempts: 2 });
    const back = supabaseMock.rows('delivery_points').find(d => d.shipment_id === ID.s1 && /^Return to/.test(d.name))!;
    expect(back).toMatchObject({ latitude: 19.3, longitude: 73.06 });
    const backStop = supabaseMock.rows('route_stops').find(s => s.delivery_point_id === back.id)!;
    expect(backStop).toMatchObject({ route_id: ID.route1, status: 'pending' });
    expect(notesFor(ID.admin).some(n => n.type === 'cargo_rto_started')).toBe(true);
    expect(notesFor(ID.customer).some(n => n.type === 'cargo_rto_started')).toBe(true);

    // Completing the return stop is the return delivery
    const returned = await completeStop({ stop_id: backStop.id, received_by: 'Bhiwandi Hub dock' });
    expect(returned.status).toBe(200);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'returned', current_holder: 'consignor', current_vehicle_id: null, pieces_returned: 10 });
    const kinds = supabaseMock.rows('cargo_custody_events').filter(e => e.shipment_id === ID.s1).map(e => e.kind);
    expect(kinds).toEqual(['undelivered', 'departed', 'refused', 'return_delivery']);
  });

  it('needs a known reason', async () => {
    expect((await custody({ kind: 'refused', reason: 'bad_mood' })).status).toBe(400);
    expect((await custody({ kind: 'undelivered' })).status).toBe(400);
    expect((await custody({ kind: 'refused', reason: 'damaged_refused' })).status).toBe(201);
    expect(supabaseMock.rows('cargo_exceptions')[0]).toMatchObject({ type: 'refused' });
  });
});

describe('delivery OTP', () => {
  async function sendCode(): Promise<string> {
    const res = await request(app).post(api('/cargo/otp/send')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 } });
    expect(res.status).toBe(200);
    expect(res.body.notified.in_app).toBe(true);
    const note = notesFor(ID.customer).filter(n => n.type === 'cargo_delivery_otp').pop()!;
    return /code for \S+ is (\d{6})/.exec(note.body)![1];
  }

  it('stores only a hash, and accepts the right code once', async () => {
    const code = await sendCode();
    const row = one('shipments', ID.s1);
    expect(row.delivery_otp_required).toBe(true);
    expect(row.delivery_otp_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.delivery_otp_hash).not.toContain(code);
    expect(Date.parse(row.delivery_otp_expires_at) - Date.now()).toBeGreaterThan(23 * 3600_000);

    expect((await custody({ kind: 'delivery', receiver_name: 'Meera', photo_paths: [PHOTO] })).status).toBe(400);
    const ok = await custody({ kind: 'delivery', receiver_name: 'Meera', photo_paths: [PHOTO], otp: code });
    expect(ok.status).toBe(201);
    expect(ok.body.event.otp_verified).toBe(true);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'delivered', delivery_otp_hash: null });
  });

  it('counts wrong codes and locks after five', async () => {
    const code = await sendCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) {
      const res = await custody({ kind: 'delivery', receiver_name: 'Meera', photo_paths: [PHOTO], otp: wrong });
      expect(res.status).toBe(400);
      expect(res.body.tries_left).toBe(5 - i);
    }
    expect((await custody({ kind: 'delivery', receiver_name: 'Meera', photo_paths: [PHOTO], otp: wrong })).status).toBe(429);
    // Locked: even the right code waits out the lock
    expect((await custody({ kind: 'delivery', receiver_name: 'Meera', photo_paths: [PHOTO], otp: code })).status).toBe(429);
    expect(one('shipments', ID.s1).status).toBe('in_transit');
  });

  it('refuses an expired code', async () => {
    const code = await sendCode();
    one('shipments', ID.s1).delivery_otp_expires_at = new Date(Date.now() - 60_000).toISOString();
    const res = await custody({ kind: 'delivery', receiver_name: 'Meera', photo_paths: [PHOTO], otp: code });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/expired/);
  });

  it('is sent by itself when goods that need one go out for delivery', async () => {
    Object.assign(one('shipments', ID.s1), { status: 'exception', delivery_otp_required: true });
    const res = await custody({ kind: 'departed' }, auth.admin());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('out_for_delivery');
    expect(notesFor(ID.customer).some(n => n.type === 'cargo_delivery_otp')).toBe(true);
  });

  it('is sent by staff only, and only for shipments', async () => {
    expect((await request(app).post(api('/cargo/otp/send')).set(auth.driver()).send({ ref: { shipment_id: ID.s1 } })).status).toBe(403);
    expect((await request(app).post(api('/cargo/otp/send')).set(auth.admin()).send({ ref: { manifest_id: ID.m1 } })).status).toBe(400);
  });
});

describe('proof of delivery by staff', () => {
  it('needs a photo, the delivery code or a logged reason', async () => {
    const tracking = shipmentRow(ID.s1).tracking_id;
    const bare = await request(app).post(api('/cargo/verify-pod')).set(auth.admin()).send({ tracking_id: tracking, recipient_name: 'Meera' });
    expect(bare.status).toBe(400);
    const res = await request(app).post(api('/cargo/verify-pod')).set(auth.admin()).send({ tracking_id: tracking, recipient_name: 'Meera', reason: 'Consignee confirmed by phone' });
    expect(res.status).toBe(200);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'delivered', current_holder: 'consignee', received_by: 'Meera' });
    const event = supabaseMock.rows('cargo_custody_events').find(e => e.kind === 'delivery')!;
    expect(event.notes).toMatch(/Consignee confirmed by phone/);
    expect(event.recorded_role).toBe('admin');
  });
});

describe('a driver delivery', () => {
  it('needs a receiver and a photo or signature from our storage', async () => {
    expect((await custody({ kind: 'delivery', receiver_name: 'Meera' })).status).toBe(400);
    expect((await custody({ kind: 'delivery', receiver_name: 'Meera', photo_paths: ['cargo/someone-else/photo.jpg'] })).status).toBe(400);
    expect((await custody({ kind: 'delivery', receiver_name: 'Meera', reason: 'trust me' })).status).toBe(400);
    const ok = await custody({ kind: 'delivery', receiver_name: 'Meera', signature_path: `cargo/${ID.s1}/signature_a.png`, lat: 18.59, lng: 73.74 });
    expect(ok.status).toBe(201);
    expect(ok.body.pieces).toMatchObject({ delivered: 10, on_board: 0 });
    expect(one('route_stops', ID.stop1).status).toBe('completed');
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
  });

  it('refuses a delivery before the pickup through the custody endpoint', async () => {
    const res = await request(app).post(api('/cargo/custody')).set(auth.driver())
      .send({ ref: { shipment_id: ID.s2 }, kind: 'delivery', receiver_name: 'X', photo_paths: [`cargo/${ID.s2}/p.jpg`] });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/pickup/);
  });

  it('records a pickup with the pieces counted, a seal and a shortage case', async () => {
    const res = await request(app).post(api('/cargo/custody')).set(auth.driver())
      .send({ ref: { shipment_id: ID.s2 }, kind: 'pickup', pieces: 4, seal_number: 'SEAL-77', condition: 'good' });
    expect(res.status).toBe(201);
    expect(one('shipments', ID.s2)).toMatchObject({ status: 'picked_up', current_holder: 'vehicle', current_vehicle_id: ID.v1, pieces_total: 5, pieces_short: 1, seal_number: 'SEAL-77' });
    expect(supabaseMock.rows('cargo_exceptions')[0]).toMatchObject({ type: 'shortage' });
    // Starting the route marks the goods in transit
    const start = await request(app).post(api('/telemetry/driver-ping/start-route')).set(auth.driver()).send({ route_id: ID.route1 });
    expect(start.status).toBe(200);
    expect(one('shipments', ID.s2).status).toBe('in_transit');
    expect(supabaseMock.rows('cargo_custody_events').filter(e => e.shipment_id === ID.s2).map(e => e.kind)).toEqual(['pickup', 'departed']);
  });

  it('records the route acceptance once per consignment', async () => {
    const accept = () => request(app).post(api('/telemetry/driver-ping/accept-route')).set(auth.driver()).send({ route_id: ID.route1 });
    expect((await accept()).body).toMatchObject({ accepted: 2 });
    expect((await accept()).body).toMatchObject({ accepted: 0 });
    expect(supabaseMock.rows('cargo_custody_events').filter(e => e.kind === 'accepted')).toHaveLength(2);
    expect((await request(app).post(api('/telemetry/driver-ping/accept-route')).set(auth.driver(ID.driver2)).send({ route_id: ID.route1 })).status).toBe(403);
  });
});
