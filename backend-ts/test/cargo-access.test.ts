/**
 * Who may see and act on cargo: drivers only for their own vehicle, customers and vendors only
 * for their own goods (and redacted), staff for everything.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one, notesFor, shipmentRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const S1_CODE = shipmentRow(ID.s1).tracking_id;
const M1_CODE = `CM-${ID.m1.slice(0, 8).toUpperCase()}`;

beforeEach(async () => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld());
  // One event with internal detail, recorded by staff
  await request(app).post(api('/cargo/custody')).set(auth.admin())
    .send({ ref: { shipment_id: ID.s1 }, kind: 'inspection', condition: 'good', pieces: 10, seal_number: 'SEAL-1', notes: 'Checked at the Chakan weighbridge' });
});

describe('drivers', () => {
  it('record custody only for consignments on their own vehicle', async () => {
    const body = { ref: { shipment_id: ID.s1 }, kind: 'arrived_drop', notes: 'Geofence 40 m' };
    expect((await request(app).post(api('/cargo/custody')).set(auth.driver(ID.driver2)).send(body)).status).toBe(403);
    expect((await request(app).post(api('/cargo/custody')).set(auth.driver()).send(body)).status).toBe(201);
    // Before pickup, the planned vehicle's driver may act
    expect((await request(app).post(api('/cargo/custody')).set(auth.driver()).send({ ref: { shipment_id: ID.s2 }, kind: 'arrived_pickup' })).status).toBe(201);
    expect((await request(app).post(api('/cargo/custody')).set(auth.driver(ID.driver2)).send({ ref: { shipment_id: ID.s2 }, kind: 'pickup', pieces: 5 })).status).toBe(403);
  });

  it('see where their own goods are, redacted, and not anyone else\'s', async () => {
    expect((await request(app).get(api(`/cargo/where/${ID.s1}`)).set(auth.driver(ID.driver2))).status).toBe(403);
    const mine = await request(app).get(api(`/cargo/where/${ID.s1}`)).set(auth.driver());
    expect(mine.status).toBe(200);
    expect(mine.body.seal_number).toBeNull();
    const timeline = await request(app).get(api(`/cargo/timeline/${ID.s1}`)).set(auth.driver());
    expect(timeline.body.events[0]).not.toHaveProperty('notes');
  });

  it('see what is on their own vehicle only', async () => {
    expect((await request(app).get(api(`/cargo/vehicles/${ID.v1}/on-board`)).set(auth.driver())).status).toBe(200);
    expect((await request(app).get(api(`/cargo/vehicles/${ID.v1}/on-board`)).set(auth.driver(ID.driver2))).status).toBe(403);
    const board = await request(app).get(api(`/cargo/vehicles/${ID.v1}/on-board`)).set(auth.admin());
    expect(board.body.totals).toEqual({ consignments: 2, pieces: 14, weight_kg: 1300 });
    expect(board.body.items.find((i: any) => i.ref.shipment_id === ID.s1)).toMatchObject({ next_stop: { name: 'Hinjewadi warehouse', sequence: 1 } });
  });

  it('raise a case for their own vehicle, and report refused offline actions to dispatch', async () => {
    const mine = await request(app).post(api('/cargo/exceptions')).set(auth.driver())
      .send({ type: 'damage', description: 'Cartons wet after rain', items: [{ ref: { shipment_id: ID.s1 }, pieces_affected: 2, condition: 'wet' }] });
    expect(mine.status).toBe(201);
    expect(mine.body).toMatchObject({ source: 'driver', vehicle_id: ID.v1 });
    const other = await request(app).post(api('/cargo/exceptions')).set(auth.driver(ID.driver2))
      .send({ type: 'damage', description: 'x', items: [{ ref: { shipment_id: ID.s1 } }] });
    expect(other.status).toBe(403);
    expect((await request(app).get(api('/cargo/exceptions')).set(auth.driver())).status).toBe(403);

    const report = await request(app).post(api('/cargo/driver/rejected-action')).set(auth.driver())
      .send({ action: 'complete_stop', error: 'This stop was just changed by someone else', payload_summary: 'stop 2, delivered' });
    expect(report.status).toBe(201);
    expect(notesFor(ID.admin).some(n => n.type === 'driver_action_rejected' && /MH12AB0001/.test(n.body))).toBe(true);
    expect((await request(app).post(api('/cargo/driver/rejected-action')).set(auth.admin()).send({ action: 'x', error: 'y' })).status).toBe(403);
  });
});

describe('customers and vendors', () => {
  it('let a customer follow their own booking by id or tracking id, redacted', async () => {
    for (const ref of [ID.s1, S1_CODE]) {
      const res = await request(app).get(api(`/cargo/timeline/${ref}`)).set(auth.customer());
      expect(res.status).toBe(200);
      const [event] = res.body.events;
      expect(event).toMatchObject({ kind: 'inspection', summary: 'Checked by our team', pieces: 10 });
      for (const hidden of ['notes', 'recorded_by', 'driver', 'seal_number', 'exception_id', 'recorded_role']) expect(event).not.toHaveProperty(hidden);
    }
    expect((await request(app).get(api(`/cargo/where/${ID.s1}`)).set(auth.customer(ID.otherCustomer))).status).toBe(404);
    expect((await request(app).get(api(`/cargo/where/${ID.s2}`)).set(auth.customer())).status).toBe(404);
    expect((await request(app).post(api('/cargo/custody')).set(auth.customer()).send({ ref: { shipment_id: ID.s1 }, kind: 'arrived_drop' })).status).toBe(403);
  });

  it('let a vendor follow their own load only', async () => {
    const res = await request(app).get(api(`/cargo/where/${M1_CODE}`)).set(auth.vendor());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ref: { manifest_id: ID.m1 }, status: 'in_transit', current_holder: 'vehicle', pieces: { total: 4, on_board: 4 } });
    expect((await request(app).get(api(`/cargo/where/${ID.m1}`)).set(auth.vendor(ID.otherVendor))).status).toBe(404);
    expect((await request(app).get(api(`/cargo/where/${ID.s1}`)).set(auth.vendor())).status).toBe(404);
  });

  it('show staff the full record', async () => {
    const res = await request(app).get(api(`/cargo/timeline/${ID.s1}`)).set(auth.admin());
    expect(res.body.events[0]).toMatchObject({ notes: 'Checked at the Chakan weighbridge', seal_ok: true, recorded_by: { id: ID.admin, name: 'Asha Admin', role: 'admin' } });
    const where = await request(app).get(api(`/cargo/where/${S1_CODE}`)).set(auth.admin());
    expect(where.body).toMatchObject({ code: S1_CODE, seal_number: 'SEAL-1', vehicle: { id: ID.v1, driver_name: 'Ravi Driver' }, pieces: { total: 10, on_board: 10 } });
    expect((await request(app).get(api('/cargo/where/RTX-NOPE0000')).set(auth.admin())).status).toBe(404);
  });

  it('keep staff-only endpoints away from everyone else', async () => {
    for (const [who, transfers] of [[auth.customer(), 403], [auth.vendor(), 403], [auth.driver(), 200]] as const) {
      expect((await request(app).get(api('/cargo/transfers')).set(who)).status).toBe(transfers);
      expect((await request(app).post(api('/cargo/otp/send')).set(who).send({ ref: { shipment_id: ID.s1 } })).status).toBe(403);
      expect((await request(app).get(api('/cargo/hubs')).set(who)).status).toBe(403);
    }
    expect((await request(app).get(api('/cargo/where/x'))).status).toBe(401);
    expect(one('shipments', ID.s1).status).toBe('in_transit');
  });
});
