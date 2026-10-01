/**
 * UAT-007: a delivery of goods nobody picked up is refused (409). Only a staff override, with a
 * reason, delivers them: it back-fills a pickup flagged `backfilled` and opens a problem note.
 * A queued pickup followed by its delivery still succeeds, in that order.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const TRACKING = 'RTX-' + ID.s2.slice(-8).toUpperCase();

const completeStop = (body: object) => request(app).post(api('/telemetry/driver-ping/complete-stop')).set(auth.driver()).send(body);
const pickup = () => request(app).post(api('/cargo/custody')).set(auth.driver()).send({ ref: { shipment_id: ID.s2 }, kind: 'pickup', pieces: 5 });
const verifyPod = (extra: object = {}) =>
  request(app).post(api('/cargo/verify-pod')).set(auth.admin()).send({ tracking_id: TRACKING, recipient_name: 'Meera', reason: 'Consignee confirmed by phone', ...extra });

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld());
});

describe('delivering goods that were never picked up', () => {
  it('refuses the driver with a clear message and changes nothing', async () => {
    const res = await completeStop({ stop_id: ID.stop2, received_by: 'Guard' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/Record the pickup/);
    expect(one('shipments', ID.s2).status).toBe('assigned');
    expect(one('route_stops', ID.stop2).status).toBe('pending');
    expect(supabaseMock.rows('cargo_custody_events')).toHaveLength(0);
  });

  it('refuses staff too, unless they override with a reason', async () => {
    const plain = await verifyPod();
    expect(plain.status).toBe(409);
    expect(plain.body.detail).toMatch(/never picked up/);
    const noReason = await verifyPod({ allow_without_pickup: true });
    expect(noReason.status).toBe(400);
    expect(one('shipments', ID.s2).status).toBe('assigned');
  });

  it('a staff override back-fills a flagged pickup and opens a problem note, not a shortage', async () => {
    const res = await verifyPod({ allow_without_pickup: true, pickup_reason: 'Handed over before the app was used' });
    expect(res.status).toBe(200);
    expect(one('shipments', ID.s2).status).toBe('delivered');
    const events = supabaseMock.rows('cargo_custody_events');
    expect(events.map(e => e.kind)).toEqual(['pickup', 'delivery']);
    expect(events[0].notes).toMatch(/Back-filled/);
    const log = supabaseMock.rows('shipment_logs').find(l => l.metadata_json?.custody_kind === 'pickup');
    expect(log!.metadata_json).toMatchObject({ backfilled: true, backfill_reason: 'Handed over before the app was used' });
    const cases = supabaseMock.rows('cargo_exceptions');
    expect(cases).toHaveLength(1);
    expect(cases[0].type).toBe('other');
    expect(cases[0].description).toMatch(/backfilled: true/);
  });

  it('a pickup recorded first, then the delivery, succeeds in that order (the offline queue)', async () => {
    expect((await pickup()).status).toBe(201);
    const res = await completeStop({ stop_id: ID.stop2, received_by: 'Guard' });
    expect(res.status).toBe(200);
    expect(one('shipments', ID.s2).status).toBe('delivered');
    expect(supabaseMock.rows('cargo_custody_events').map(e => e.kind)).toEqual(['pickup', 'delivery']);
    expect(supabaseMock.rows('cargo_exceptions').filter(e => e.type === 'other')).toHaveLength(0);
  });
});
