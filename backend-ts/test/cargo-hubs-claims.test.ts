/**
 * Hubs (hub in and out, inventory and ageing), claims (customer within 7 days, vendor, staff
 * workflow and documents) and the customer's own cargo view and receipt confirmation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one, notesFor } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const DAY = 86_400_000;

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld());
});

describe('hubs', () => {
  const hubIn = (pieces: number, who = auth.driver()) =>
    request(app).post(api('/cargo/custody')).set(who).send({ ref: { shipment_id: ID.s1 }, kind: 'hub_in', depot_id: ID.depot, pieces });

  it('takes goods in, lists them with their age and next leg, and sends them out on another truck', async () => {
    const res = await hubIn(10);
    expect(res.status).toBe(201);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'at_hub', current_holder: 'hub', current_depot_id: ID.depot, current_vehicle_id: null });
    expect(one('route_stops', ID.stop1).status).toBe('cancelled');
    expect(notesFor(ID.customer).some(n => n.type === 'cargo_at_hub' && /Chakan hub/.test(n.body))).toBe(true);

    const hubs = await request(app).get(api('/cargo/hubs')).set(auth.admin());
    expect(hubs.status).toBe(200);
    expect(hubs.body.find((h: any) => h.id === ID.depot)).toMatchObject({ name: 'Chakan', consignments: 1, pieces: 10, weight_kg: 1000 });

    const inventory = await request(app).get(api(`/cargo/hubs/${ID.depot}/inventory`)).set(auth.admin());
    expect(inventory.status).toBe(200);
    const [item] = inventory.body.items;
    expect(item).toMatchObject({ ref: { shipment_id: ID.s1 }, status: 'at_hub', pieces: 10, next_leg: { name: 'Hinjewadi warehouse' } });
    expect(item.since).toBeTruthy();
    expect(item.age_hours).toBeGreaterThanOrEqual(0);

    const out = await request(app).post(api('/cargo/custody')).set(auth.admin())
      .send({ ref: { shipment_id: ID.s1 }, kind: 'hub_out', vehicle_id: ID.v2, next_status: 'out_for_delivery' });
    expect(out.status).toBe(201);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'out_for_delivery', current_holder: 'vehicle', current_vehicle_id: ID.v2, current_depot_id: null });
    const route = supabaseMock.rows('routes').find(r => r.vehicle_id === ID.v2)!;
    expect(supabaseMock.rows('route_stops').find(s => s.route_id === route.id)).toMatchObject({ delivery_point_id: ID.dp1, status: 'pending' });
    expect((await request(app).get(api(`/cargo/hubs/${ID.depot}/inventory`)).set(auth.admin())).body.items).toHaveLength(0);
  });

  it('opens a shortage case when fewer pieces reach the hub', async () => {
    expect((await hubIn(9)).status).toBe(201);
    expect(one('shipments', ID.s1)).toMatchObject({ pieces_short: 1 });
    expect(supabaseMock.rows('cargo_exceptions')[0]).toMatchObject({ type: 'shortage' });
  });

  it('needs a real hub, goods on a vehicle, and a named vehicle to leave', async () => {
    expect((await request(app).post(api('/cargo/custody')).set(auth.driver()).send({ ref: { shipment_id: ID.s1 }, kind: 'hub_in' })).status).toBe(400);
    expect((await request(app).post(api('/cargo/custody')).set(auth.driver()).send({ ref: { shipment_id: ID.s1 }, kind: 'hub_in', depot_id: 'd0000000-0000-4000-8000-000000000099' })).status).toBe(404);
    await hubIn(10);
    expect((await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 }, kind: 'hub_out' })).status).toBe(400);
    expect((await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 }, kind: 'departed' })).status).toBe(409);
  });

  it('is for staff', async () => {
    expect((await request(app).get(api('/cargo/hubs')).set(auth.driver())).status).toBe(403);
    expect((await request(app).get(api(`/cargo/hubs/${ID.depot}/inventory`)).set(auth.customer())).status).toBe(403);
  });
});

describe('claims', () => {
  function delivered(daysAgo: number) {
    Object.assign(one('shipments', ID.s1), { status: 'delivered', current_holder: 'consignee', current_vehicle_id: null, pieces_delivered: 10 });
    supabaseMock.rows('cargo_custody_events').push({
      id: 'ev-delivery', shipment_id: ID.s1, kind: 'delivery', pieces: 10, photo_paths: [], recorded_role: 'driver',
      recorded_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    });
  }
  const file = (body: object, who = auth.customer()) => request(app).post(api('/cargo/claims')).set(who).send(body);

  it('lets a customer claim on their own delivered shipment within 7 days, with the declared value', async () => {
    delivered(2);
    const res = await file({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 12000, notes: 'Screen cracked' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'filed', raised_by_role: 'customer', raised_by: ID.customer, declared_value: 250000, claimed_amount: 12000 });
    expect(res.body.code).toMatch(/^CLM-/);
    expect(notesFor(ID.admin).some(n => n.type === 'cargo_claim_update')).toBe(true);
    // One open claim per type
    expect((await file({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 1 })).status).toBe(409);
  });

  it('refuses a customer after 7 days, before delivery, or on someone else\'s shipment', async () => {
    delivered(8);
    const late = await file({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 100 });
    expect(late.status).toBe(409);
    expect(late.body.detail).toMatch(/within 7 days/);
    expect((await file({ ref: { shipment_id: ID.s1 }, claim_type: 'damage' }, auth.customer(ID.otherCustomer))).status).toBe(404);
    one('shipments', ID.s1).status = 'in_transit';
    expect((await file({ ref: { shipment_id: ID.s1 }, claim_type: 'shortage' })).status).toBe(409);
    expect(supabaseMock.rows('cargo_claims')).toHaveLength(0);
  });

  it('lets a vendor claim on their own load only', async () => {
    const res = await file({ ref: { manifest_id: ID.m1 }, claim_type: 'shortage', claimed_amount: 3000 }, auth.vendor());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'filed', raised_by_role: 'vendor', declared_value: 150000 });
    expect((await file({ ref: { manifest_id: ID.m1 }, claim_type: 'loss' }, auth.vendor(ID.otherVendor))).status).toBe(404);
    expect((await file({ ref: { shipment_id: ID.s1 }, claim_type: 'loss' }, auth.vendor())).status).toBe(404);
    expect((await file({ ref: { manifest_id: ID.m1 }, claim_type: 'loss' }, auth.driver())).status).toBe(403);
  });

  it('moves through the staff workflow and tells the customer', async () => {
    delivered(1);
    const { body: claim } = await file({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 12000 });
    const patch = (body: object, who = auth.admin()) => request(app).patch(api(`/cargo/claims/${claim.id}`)).set(who).send(body);
    expect((await patch({ status: 'surveyed' }, auth.customer())).status).toBe(403);
    expect((await patch({ status: 'surveyed' })).status).toBe(400);
    expect((await patch({ status: 'surveyed', surveyor_name: 'K. Iyer', survey_date: '2026-09-29', insurer: 'New India Assurance', policy_number: 'POL-1' })).status).toBe(200);
    expect((await patch({ status: 'settled', settled_amount: 1 })).status).toBe(409);
    expect((await patch({ status: 'approved' })).status).toBe(400);
    expect((await patch({ status: 'approved', approved_amount: 10000 })).status).toBe(200);
    const settled = await patch({ status: 'settled', settled_amount: 10000 });
    expect(settled.status).toBe(200);
    expect(settled.body).toMatchObject({ status: 'settled', settled_amount: 10000, insurer: 'New India Assurance' });
    expect(settled.body.settled_at).toBeTruthy();
    expect(notesFor(ID.customer).filter(n => n.type === 'cargo_claim_update').map(n => n.body)).toEqual(expect.arrayContaining([
      expect.stringMatching(/approved: ₹10,000/), expect.stringMatching(/settled: ₹10,000/),
    ]));
    expect((await patch({ notes: 'late edit' })).status).toBe(409);
  });

  it('takes documents through signed uploads into the claim\'s own folder', async () => {
    delivered(1);
    const { body: claim } = await file({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 500 });
    const upload = (body: object, who = auth.customer()) => request(app).post(api(`/cargo/claims/${claim.id}/documents-upload-url`)).set(who).send(body);
    const res = await upload({ content_type: 'application/pdf', size: 20_000 });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(new RegExp(`^claims/${claim.id}/[0-9a-f-]+\\.pdf$`));
    expect(one('cargo_claims', claim.id).document_paths).toEqual([res.body.path]);
    expect((await upload({ content_type: 'application/x-msdownload', size: 10 })).status).toBe(415);
    expect((await upload({ content_type: 'image/jpeg', size: 10 }, auth.customer(ID.otherCustomer))).status).toBe(404);
  });

  it('lists all claims for staff and only their own for a customer or vendor', async () => {
    delivered(1);
    await file({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 500 });
    await file({ ref: { manifest_id: ID.m1 }, claim_type: 'shortage', claimed_amount: 100 }, auth.vendor());
    expect((await request(app).get(api('/cargo/claims')).set(auth.admin())).body.items).toHaveLength(2);
    expect((await request(app).get(api('/cargo/claims')).set(auth.customer())).body.items.map((c: any) => c.claim_type)).toEqual(['damage']);
    expect((await request(app).get(api('/cargo/claims')).set(auth.vendor())).body.items.map((c: any) => c.claim_type)).toEqual(['shortage']);
    expect((await request(app).get(api('/cargo/claims')).set(auth.customer(ID.otherCustomer))).body.items).toHaveLength(0);
  });

  it('can be raised from a case by staff, as a draft linked to it', async () => {
    const exc = await request(app).post(api('/cargo/exceptions')).set(auth.admin())
      .send({ type: 'damage', description: 'Water in the container', items: [{ ref: { shipment_id: ID.s1 }, pieces_affected: 3, condition: 'wet' }] });
    const res = await request(app).post(api(`/cargo/exceptions/${exc.body.id}/actions`)).set(auth.admin()).send({ action: 'raise_claim', claim_type: 'damage', claimed_amount: 40000 });
    expect(res.status).toBe(200);
    expect(res.body.claim).toMatchObject({ status: 'draft', exception_id: exc.body.id, raised_by_role: 'staff' });
    expect(res.body.exception.claims).toHaveLength(1);
  });
});

describe('the customer\'s cargo view and receipt', () => {
  it('shows where the goods are, a redacted timeline, notices with a revised ETA, and claims', async () => {
    await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 }, kind: 'inspection', condition: 'wet', pieces: 10, notes: 'Tarpaulin torn, driver careless' });
    const res = await request(app).get(api(`/customer/bookings/${ID.booking1}/cargo`)).set(auth.customer());
    expect(res.status).toBe(200);
    expect(res.body.where).toMatchObject({ status: 'in_transit', current_holder: 'vehicle', vehicle: { plate_number: 'MH12AB0001', driver_name: null } });
    expect(res.body.timeline).toHaveLength(1);
    expect(res.body.timeline[0]).toMatchObject({ kind: 'inspection', summary: 'Checked by our team', condition: 'wet' });
    expect(res.body.timeline[0]).not.toHaveProperty('notes');
    expect(res.body.timeline[0]).not.toHaveProperty('recorded_by');
    expect(JSON.stringify(res.body)).not.toMatch(/careless|Asha Admin/);
    expect(res.body.exceptions).toEqual([expect.objectContaining({ type: 'damage', title: 'We found damage to your goods' })]);
    expect(res.body.exceptions[0].revised_eta.eta_text).toMatch(/[ap]m$/);
    expect(res.body.pod).toBeNull();
    expect((await request(app).get(api(`/customer/bookings/${ID.booking1}/cargo`)).set(auth.customer(ID.otherCustomer))).status).toBe(404);
  });

  it('confirms receipt with a rating once, and opens a claim for an issue', async () => {
    const confirm = (body: object) => request(app).post(api(`/customer/bookings/${ID.booking1}/confirm-receipt`)).set(auth.customer()).send(body);
    expect((await confirm({ rating: 5 })).status).toBe(409);
    await request(app).post(api('/cargo/custody')).set(auth.driver())
      .send({ ref: { shipment_id: ID.s1 }, kind: 'delivery', receiver_name: 'Meera', photo_paths: [`cargo/${ID.s1}/p.jpg`] });
    expect((await confirm({ rating: 9 })).status).toBe(400);
    const res = await confirm({ rating: 4, comment: 'On time', issue: { type: 'damage', description: 'One carton dented', claimed_amount: 800 } });
    expect(res.status).toBe(200);
    expect(one('shipments', ID.s1)).toMatchObject({ driver_rating: 4, driver_rating_note: 'On time', rated_vehicle_id: ID.v1, rated_driver_id: ID.driver1, driver_rated_by: null });
    expect(res.body.claim).toMatchObject({ claim_type: 'damage', status: 'filed', raised_by_role: 'customer', notes: 'One carton dented' });
    expect((await confirm({ rating: 5 })).status).toBe(409);
    const view = await request(app).get(api(`/customer/bookings/${ID.booking1}/cargo`)).set(auth.customer());
    expect(view.body.pod).toMatchObject({ received_by: 'Meera' });
    expect(view.body.claims).toHaveLength(1);
  });
});
