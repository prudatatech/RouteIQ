/**
 * The response shapes the web control tower (frontend/src/services/cargo.ts) reads, and the
 * requests it sends. Each field asserted here is one the web maps or shows; if one changes,
 * the web client's mapping (frontend/src/services/cargoMap.ts) must change with it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld());
});

/** A serious breakdown SOS: the goods on v1 are held on one case. */
async function breakdownCase(): Promise<{ excId: string; alertId: string }> {
  const raised = await request(app).post(api('/telemetry/sos/trigger')).set(auth.driver()).send({ alert_type: 'breakdown', lat: 18.6, lng: 73.8 });
  await request(app).patch(api(`/telemetry/sos/${raised.body.id}/details`)).set(auth.driver()).send({ severity: 'serious' });
  const [exc] = supabaseMock.rows('cargo_exceptions');
  return { excId: exc.id, alertId: raised.body.id };
}

describe('where and timeline', () => {
  it('names the consignment, its attempts limit and whether the OTP is needed', async () => {
    one('shipments', ID.s1).delivery_otp_required = true;
    const res = await request(app).get(api(`/cargo/where/${ID.s1}`)).set(auth.admin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ref: { shipment_id: ID.s1 },
      code: one('shipments', ID.s1).tracking_id,
      current_holder: 'vehicle',
      vehicle: { id: ID.v1, plate_number: 'MH12AB0001', lat: 18.6, lng: 73.8 },
      pieces: { total: 10, on_board: 10 },
      delivery_attempts: 0,
      max_delivery_attempts: 3,
      delivery_otp_required: true,
    });
    const load = await request(app).get(api(`/cargo/where/${ID.m1}`)).set(auth.admin());
    expect(load.body).toMatchObject({ ref: { manifest_id: ID.m1 }, code: expect.stringMatching(/^CM-/), delivery_otp_required: false });
  });

  it('embeds vehicles, depots and the recorder as objects on each event', async () => {
    const hub = await request(app).post(api('/cargo/custody')).set(auth.admin())
      .send({ ref: { shipment_id: ID.s1 }, kind: 'hub_in', depot_id: ID.depot, pieces: 10 });
    expect(hub.status).toBe(201);
    const res = await request(app).get(api(`/cargo/timeline/${ID.s1}`)).set(auth.admin());
    expect(res.status).toBe(200);
    const [event] = res.body.events;
    expect(event).toMatchObject({
      kind: 'hub_in',
      summary: 'At the Chakan hub',
      from_holder: 'vehicle',
      to_holder: 'hub',
      from_vehicle: { id: ID.v1, plate_number: 'MH12AB0001' },
      to_depot: { id: ID.depot, name: 'Chakan' },
      recorded_by: { id: ID.admin, name: 'Asha Admin', role: 'admin' },
      photo_urls: [],
      signature_url: null,
    });
  });
});

describe('the case queue and case file', () => {
  it('lists cases with the vehicle, the owner and item codes', async () => {
    const { excId } = await breakdownCase();
    await request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin()).send({ action: 'assign_owner', owner_id: ID.admin });
    // The web asks for every open state at once
    const res = await request(app).get(api(`/cargo/exceptions?status=open,investigating,action_planned&vehicle_id=${ID.v1}`)).set(auth.admin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const [exc] = res.body;
    expect(exc).toMatchObject({
      id: excId,
      type: 'vehicle_breakdown',
      source: 'sos',
      plate_number: 'MH12AB0001',
      vehicle: { id: ID.v1, plate_number: 'MH12AB0001', latitude: 18.6, longitude: 73.8, driver_name: 'Ravi Driver' },
      owner: { id: ID.admin, full_name: 'Asha Admin' },
      sla: { overdue: false },
    });
    expect(exc.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: { shipment_id: ID.s1 }, code: one('shipments', ID.s1).tracking_id, pieces_total: 10, status: 'on_hold' }),
      expect.objectContaining({ ref: { manifest_id: ID.m1 }, code: expect.stringMatching(/^CM-/) }),
    ]));
  });

  it('shows the owner, who acted, and full transfers on the case page', async () => {
    const { excId, alertId } = await breakdownCase();
    const act = (body: object) => request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin()).send(body);
    await act({ action: 'assign_owner', owner_id: ID.admin });
    const planned = await act({ action: 'transship', to_vehicle_id: ID.v2, meet_address: 'Aundh flyover' });
    expect(planned.status).toBe(200);
    expect(planned.body).toHaveProperty('exception.id', excId);
    expect(planned.body).toHaveProperty('transfer.code');

    const res = await request(app).get(api(`/cargo/exceptions/${excId}`)).set(auth.admin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sos_alert_id: alertId, owner: { id: ID.admin, full_name: 'Asha Admin' }, vehicle: { plate_number: 'MH12AB0001' } });
    expect(res.body.timeline.find((t: any) => t.text === 'Owner set to Asha Admin')).toMatchObject({ source: 'case', kind: 'action', by: ID.admin, by_name: 'Asha Admin', role: 'admin' });
    const [transfer] = res.body.transfers;
    expect(transfer).toMatchObject({
      status: 'planned',
      to_vehicle: { id: ID.v2, plate_number: 'MH12AB0002' },
      exception: { id: excId, code: expect.stringMatching(/^EXC-/) },
    });
    expect(transfer.items[0]).toMatchObject({ ref: expect.any(Object), code: expect.any(String), pieces_planned: expect.any(Number) });
  });

  it('cancels a transfer with the reason in `reason`', async () => {
    const { excId } = await breakdownCase();
    const planned = await request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin()).send({ action: 'move_to_hub', depot_id: ID.depot });
    const id = planned.body.transfer.id;
    const res = await request(app).post(api(`/cargo/transfers/${id}/cancel`)).set(auth.admin()).send({ reason: 'Hub is full' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', to_depot: { id: ID.depot, name: 'Chakan', latitude: 18.76 } });
    expect(res.body.note).toMatch(/Hub is full/);
  });
});

describe('hubs, on board and claims', () => {
  it('answers the hub inventory as { depot, items } with the next leg by name and address', async () => {
    await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 }, kind: 'hub_in', depot_id: ID.depot, pieces: 10 });
    const res = await request(app).get(api(`/cargo/hubs/${ID.depot}/inventory`)).set(auth.admin());
    expect(res.body.depot).toMatchObject({ id: ID.depot });
    expect(res.body.items[0]).toMatchObject({
      ref: { shipment_id: ID.s1 }, code: one('shipments', ID.s1).tracking_id, pieces: 10, weight_kg: 1000,
      next_leg: { name: 'Hinjewadi warehouse', address: 'Hinjewadi, Pune' }, open_exceptions: [],
    });
  });

  it('answers the on-board view as { vehicle, totals, items }', async () => {
    const res = await request(app).get(api(`/cargo/vehicles/${ID.v1}/on-board`)).set(auth.admin());
    expect(res.status).toBe(200);
    expect(res.body.vehicle).toMatchObject({ id: ID.v1, plate_number: 'MH12AB0001' });
    expect(res.body.totals).toMatchObject({ consignments: 2 });
    expect(res.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: { shipment_id: ID.s1 }, code: one('shipments', ID.s1).tracking_id, pieces_on_board: 10, next_stop: expect.objectContaining({ name: 'Hinjewadi warehouse' }) }),
    ]));
  });

  it('gives each claim the consignment code, and records a document at upload-url time', async () => {
    const created = await request(app).post(api('/cargo/claims')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 5000 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'draft', consignment_code: one('shipments', ID.s1).tracking_id, documents: [] });
    const upload = await request(app).post(api(`/cargo/claims/${created.body.id}/documents-upload-url`)).set(auth.admin()).send({ content_type: 'application/pdf', size: 1000 });
    expect(upload.status).toBe(200);
    expect(upload.body).toMatchObject({ path: expect.stringMatching(new RegExp(`^claims/${created.body.id}/`)), token: expect.any(String), bucket: expect.any(String) });
    expect(one('cargo_claims', created.body.id).document_paths).toEqual([upload.body.path]);
    // document_paths is not a PATCH field, so the web does not send it
    expect((await request(app).patch(api(`/cargo/claims/${created.body.id}`)).set(auth.admin()).send({ document_paths: [upload.body.path] })).status).toBe(400);
    const got = await request(app).get(api(`/cargo/claims/${created.body.id}`)).set(auth.admin());
    expect(got.body).toMatchObject({ id: created.body.id, consignment_code: one('shipments', ID.s1).tracking_id });
    const list = await request(app).get(api('/cargo/claims')).set(auth.admin());
    expect(list.body.items[0]).toMatchObject({ consignment_code: one('shipments', ID.s1).tracking_id });
  });
});

describe('status changes the web may no longer send', () => {
  it('refuses a raw delivered PATCH from staff with use: cargo_custody', async () => {
    const res = await request(app).patch(api(`/shipments/${ID.s1}`)).set(auth.admin()).send({ status: 'delivered' });
    expect(res.status).toBe(409);
    expect(res.body.use).toBe('cargo_custody');
  });

  it('records a staff delivery through custody with a logged reason', async () => {
    const res = await request(app).post(api('/cargo/custody')).set(auth.admin())
      .send({ ref: { shipment_id: ID.s1 }, kind: 'delivery', receiver_name: 'Store manager', reason: 'Driver phone died; receiver called us' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'delivered', current_holder: 'consignee' });
  });

  it('accepts only this shipment\'s own uploads as verify-pod photos', async () => {
    const tracking = one('shipments', ID.s1).tracking_id;
    const foreign = await request(app).post(api('/cargo/verify-pod')).set(auth.admin())
      .send({ tracking_id: tracking, recipient_name: 'Store manager', photo_paths: ['kyc/someone-else/pan.jpg'] });
    expect(foreign.status).toBe(400);
    const own = await request(app).post(api('/cargo/verify-pod')).set(auth.admin())
      .send({ tracking_id: tracking, recipient_name: 'Store manager', photo_paths: [`cargo/${ID.s1}/photo_1.jpg`] });
    expect(own.status).toBe(200);
    expect(one('shipments', ID.s1).status).toBe('delivered');
  });
});
