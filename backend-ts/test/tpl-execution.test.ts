/**
 * Real 3PL execution (docs/network-design.md, section 2): a partner accepts an offer with its own vehicle and
 * driver, the load becomes a manifest kept with the company, the partner's driver runs it in the driver app,
 * and the partner's order follows the trip.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, SEATS, orgWorld, uid } from './support/org-world';
import { cargoWorld, auth, one } from './support/cargo-world';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { syncTplOrderFromManifest } from '../src/services/tpl-network.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

const TP = 'cccccccc-0000-4000-8000-0000000000a1';
const REQ = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const OFFER = 'dddddddd-0000-4000-8000-0000000000a1';
const V_OK = 'a1000000-0000-4000-8000-0000000000a1';
const V_SMALL = 'a1000000-0000-4000-8000-0000000000a2';
const V_FOREIGN = 'a1000000-0000-4000-8000-0000000000a3';
const V_OTHER_DRIVER = 'a1000000-0000-4000-8000-0000000000a4';
const DRIVER = uid('tpl-driver');
const STRANGER = uid('tpl-stranger');
const PARTNER_USER = uid('tpl-1');

const asPartner = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken(PARTNER_USER)}` });
const asDriver = () => auth.driver(DRIVER);

const vehicle = (id: string, over: Row = {}): Row => ({
  id, plate_number: `MH01TP${id.slice(-4)}`, vehicle_type: 'truck', status: 'available', driver_id: DRIVER, carrier_org_id: ORG.tplT,
  capacity_kg: 5000, available_capacity_kg: 5000, current_load_kg: 0, hazmat_certified: false, is_reefer: false, body_type: 'closed', ...over,
});

function world(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  const orgs = orgWorld({}, { seats: [...SEATS, { user: 'tpl-driver', org: 'tplT', role: 'driver' }] });
  const base = cargoWorld();
  return {
    ...base,
    ...orgs,
    users: [
      ...orgs.users,
      { id: DRIVER, role: 'driver', is_active: true, full_name: 'Partner Driver' },
      { id: STRANGER, role: 'driver', is_active: true, full_name: 'Not Ours' },
    ],
    organizations: orgs.organizations.map(o => (o.id === ORG.tplT ? { ...o, profile: { legacy_tpl_partner_id: TP } } : o)),
    system_settings: [...orgs.system_settings, ...base.system_settings],
    tpl_partners: [{ id: TP, user_id: PARTNER_USER, company_name: 'Tiny Transport', status: 'active', email: null, sla_commitment: '4 Hours' }],
    vehicles: [vehicle(V_OK), vehicle(V_SMALL, { capacity_kg: 100, available_capacity_kg: 100, driver_id: null }), vehicle(V_FOREIGN, { carrier_org_id: ORG.companyA, driver_id: null }), vehicle(V_OTHER_DRIVER, { driver_id: STRANGER })],
    vendor_shipment_requests: [{
      id: REQ, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, carrier_org_id: ORG.companyA, status: 'escalated',
      pickup_location: 'Okhla, New Delhi', pickup_lat: 28.5, pickup_lng: 77.3, drop_location: 'Andheri, Mumbai', drop_lat: 19.1, drop_lng: 72.8,
      required_capacity_kg: 800, hazmat_mixed: false, special_handling: [], metadata: {},
    }],
    load_items: [],
    cargo_manifest: [],
    routes: [], route_stops: [], shipments: [],
    tpl_offers: [{
      id: OFFER, partner_id: TP, source_type: 'request', request_id: REQ, shipment_id: null, status: 'offered', proposed_price: 41200,
      pickup_location: 'Okhla, New Delhi', drop_location: 'Andheri, Mumbai', weight_kg: 800, carrier_org_id: ORG.companyA, offered_at: '2026-10-01T00:00:00Z',
    }],
    tpl_orders: [],
    ...over,
  };
}

const accept = (body: Record<string, unknown> = {}, offer = OFFER) =>
  request(app).post(api(`/tpl-network/my/offers/${offer}/accept`)).set(asPartner()).send(body);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation((...a) => { if (process.env.DBG) process.stderr.write(a.map(String).join(' ') + '\n'); });
  invalidateDriverVehicles();
  supabaseMock.reset(world());
});

describe('accepting with a vehicle and driver', () => {
  it('needs the vehicle and driver when the partner has vehicles', async () => {
    const res = await accept({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vehicle and driver/);
    expect(res.body.detail).toBe(res.body.error);
    expect((await accept({ vehicle_id: V_OK })).status).toBe(400);
    expect(supabaseMock.rows('tpl_orders')).toEqual([]);
    expect(supabaseMock.rows('tpl_offers')[0].status).toBe('offered');
  });

  it('keeps the older flow for a partner with no vehicles: no manifest', async () => {
    supabaseMock.rows('vehicles').length = 0;
    const res = await accept({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'accepted' });
    expect(res.body.manifest_id ?? null).toBeNull();
    expect(supabaseMock.rows('cargo_manifest')).toEqual([]);
  });

  it('refuses a vehicle of another organisation, a driver who is not a member, and a driver the vehicle is not given to', async () => {
    expect((await accept({ vehicle_id: V_FOREIGN, driver_id: DRIVER })).status).toBe(404);
    expect((await accept({ vehicle_id: V_OTHER_DRIVER, driver_id: STRANGER })).status).toBe(404);
    const mismatch = await accept({ vehicle_id: V_OK, driver_id: uid('driver-a') });
    expect(mismatch.status).toBe(404);
    supabaseMock.rows('org_members').push({ org_id: ORG.tplT, user_id: STRANGER, role: 'driver', status: 'active' });
    const wrongDriver = await accept({ vehicle_id: V_OK, driver_id: STRANGER });
    expect(wrongDriver.status).toBe(409);
    expect(wrongDriver.body.error).toMatch(/not assigned to that driver/);
    expect(supabaseMock.rows('tpl_orders')).toEqual([]);
  });

  it('checks the vehicle fits the goods and has the room', async () => {
    supabaseMock.rows('vendor_shipment_requests')[0].hazmat_mixed = true;
    const hazmat = await accept({ vehicle_id: V_OK, driver_id: DRIVER });
    expect(hazmat.status).toBe(409);
    expect(hazmat.body.error).toMatch(/hazmat/);
    supabaseMock.rows('vendor_shipment_requests')[0].hazmat_mixed = false;
    supabaseMock.rows('vehicles').find(v => v.id === V_OK)!.available_capacity_kg = 300;
    const room = await accept({ vehicle_id: V_OK, driver_id: DRIVER });
    expect(room.status).toBe(409);
    expect(room.body.error).toMatch(/300 kg free/);
    expect(supabaseMock.rows('tpl_orders')).toEqual([]);
    expect(supabaseMock.rows('cargo_manifest')).toEqual([]);
    expect(supabaseMock.rows('tpl_offers')[0].status).toBe('offered');
  });

  it('makes the manifest for the company, run by the partner, and links the order', async () => {
    const res = await accept({ vehicle_id: V_OK, driver_id: DRIVER });
    expect(res.status).toBe(201);
    const [manifest] = supabaseMock.rows('cargo_manifest');
    expect(manifest).toMatchObject({
      carrier_org_id: ORG.companyA, vendor_org_id: ORG.vendorV, vehicle_id: V_OK, vendor_request_id: REQ, status: 'scheduled', capacity_kg: 800,
      metadata: { executed_by_org: ORG.tplT },
    });
    expect(res.body).toMatchObject({ vehicle_id: V_OK, driver_id: DRIVER, manifest_id: manifest.id, status: 'accepted' });
    expect(supabaseMock.rows('tpl_orders')[0]).toMatchObject({ vehicle_id: V_OK, driver_id: DRIVER, manifest_id: manifest.id });
    // The order belongs to the company that made the offer, not to the partner that accepted it (lists, statements, payments)
    expect(supabaseMock.rows('tpl_orders')[0].carrier_org_id).toBe(ORG.companyA);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('assigned_to_partner');
    // The load sits on the partner's vehicle and the driver is told
    expect(one('vehicles', V_OK)).toMatchObject({ current_load_kg: 800, available_capacity_kg: 4200, status: 'on_route' });
    expect(supabaseMock.rows('notifications').some(n => n.user_id === DRIVER && n.type === 'cargo_assigned')).toBe(true);
  });
});

describe('the vendor path makes the same manifest as before', () => {
  it('stamps the company, copies the load and puts it on its own vehicle', async () => {
    const { vendorService } = await import('../src/services/vendor.service');
    supabaseMock.reset(world({
      vendor_shipment_requests: [{
        id: REQ, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, carrier_org_id: ORG.companyA, status: 'approved',
        pickup_location: 'Okhla', drop_location: 'Andheri', required_capacity_kg: 800, hazmat_mixed: false, special_handling: [], metadata: {},
      }],
      vehicles: [vehicle(V_OK, { carrier_org_id: ORG.companyA, driver_id: DRIVER })],
    }));
    const { as } = await import('./support/org-world');
    const res = await request(app).put(api(`/vendor/shipment-request/${REQ}/assign-vehicle`)).set(as('admin-a')).send({ vehicle_id: V_OK, cost: 9000 });
    expect([200, 201]).toContain(res.status);
    void vendorService;
    const [manifest] = supabaseMock.rows('cargo_manifest');
    expect(manifest).toMatchObject({ carrier_org_id: ORG.companyA, vendor_org_id: ORG.vendorV, vehicle_id: V_OK, vendor_request_id: REQ, status: 'scheduled', capacity_kg: 800 });
    expect(manifest.metadata).toBeUndefined();
    expect(one('vehicles', V_OK)).toMatchObject({ current_load_kg: 800, status: 'on_route' });
    expect(supabaseMock.rows('notifications').some(n => n.user_id === DRIVER && n.type === 'cargo_assigned')).toBe(true);
  });
});

describe('running the trip', () => {
  beforeEach(async () => {
    expect((await accept({ vehicle_id: V_OK, driver_id: DRIVER })).status).toBe(201);
  });
  const manifestId = () => supabaseMock.rows('cargo_manifest')[0].id as string;
  const order = () => supabaseMock.rows('tpl_orders')[0];

  it('shows the partner driver the manifest trip, as it does a company driver', async () => {
    const res = await request(app).get(api('/telemetry/driver-ping/my-route')).set(asDriver());
    expect(res.body).toMatchObject({ is_manifest: true });
    expect(res.status).toBe(200);
    expect(res.body.route.id).toBe(manifestId());
    expect(res.body.route.stops.map((s: any) => s.id)).toEqual([`${manifestId()}_pickup`, `${manifestId()}_drop`]);
  });

  it('keeps another driver away from the trip', async () => {
    const res = await request(app).post(api('/telemetry/driver-ping/complete-stop')).set(auth.driver(STRANGER)).send({ stop_id: `${manifestId()}_pickup` });
    expect(res.status).toBe(403);
  });

  it('moves the order when the driver picks up and delivers', async () => {
    const pickup = await request(app).post(api('/telemetry/driver-ping/complete-stop')).set(asDriver()).send({ stop_id: `${manifestId()}_pickup` });
    expect(pickup.status).toBe(200);
    expect(one('cargo_manifest', manifestId()).status).toBe('in_transit');
    expect(order()).toMatchObject({ status: 'in_transit' });
    expect(order().picked_up_at).toBeTruthy();

    const drop = await request(app).post(api('/telemetry/driver-ping/complete-stop')).set(asDriver())
      .send({ stop_id: `${manifestId()}_drop`, received_by: 'Store manager', photo_paths: [`pod/${manifestId()}_drop/photo_a.jpg`], photo_url: `pod/${manifestId()}_drop/photo_a.jpg` });
    expect(drop.status).toBe(200);
    expect(one('cargo_manifest', manifestId()).status).toBe('delivered');
    expect(order()).toMatchObject({ status: 'delivered', pod_received_by: 'Store manager', pod_photo_url: `pod/${manifestId()}_drop/photo_a.jpg` });
    expect(order().delivered_at).toBeTruthy();
  });
});

describe('syncTplOrderFromManifest', () => {
  const M = 'aa110000-0000-4000-8000-0000000000a1';
  beforeEach(() => {
    supabaseMock.reset(world({
      cargo_manifest: [{ id: M, status: 'scheduled', vehicle_id: V_OK, carrier_org_id: ORG.companyA, pickup_location: 'A', drop_location: 'B' }],
      tpl_orders: [{ id: 'o1', partner_id: TP, manifest_id: M, status: 'accepted', pickup_location: 'Okhla', drop_location: 'Andheri', source_type: 'request', request_id: REQ }],
    }));
  });
  const set = (patch: Row) => Object.assign(supabaseMock.rows('cargo_manifest')[0], patch);

  it('follows pickup, stamps the time, and ignores a manifest that has not moved', async () => {
    expect(await syncTplOrderFromManifest(M)).toBeNull();
    set({ status: 'in_transit' });
    await syncTplOrderFromManifest(M);
    expect(supabaseMock.rows('tpl_orders')[0]).toMatchObject({ status: 'in_transit' });
    expect(supabaseMock.rows('tpl_orders')[0].picked_up_at).toBeTruthy();
  });

  it('delivers with the proof the driver captured, and never moves backwards', async () => {
    set({ status: 'delivered', signature_url: 'pod/x/sig.png', received_by: 'Guard' });
    await syncTplOrderFromManifest(M);
    expect(supabaseMock.rows('tpl_orders')[0]).toMatchObject({ status: 'delivered', pod_signature_url: 'pod/x/sig.png', pod_received_by: 'Guard' });
    expect(supabaseMock.rows('tpl_orders')[0].delivered_at).toBeTruthy();
    set({ status: 'in_transit' });
    expect(await syncTplOrderFromManifest(M)).toBeNull();
    expect(supabaseMock.rows('tpl_orders')[0].status).toBe('delivered');
  });

  it('cancels the order with its trip, and does nothing for a manifest no order backs', async () => {
    set({ status: 'cancelled' });
    await syncTplOrderFromManifest(M);
    expect(supabaseMock.rows('tpl_orders')[0].status).toBe('cancelled');
    expect(await syncTplOrderFromManifest('aa110000-0000-4000-8000-0000000000ff')).toBeNull();
  });
});

describe('delivering from the partner portal', () => {
  const M = 'aa110000-0000-4000-8000-0000000000b1';
  const O = 'eeeeeeee-0000-4000-8000-0000000000b1';
  const O2 = 'eeeeeeee-0000-4000-8000-0000000000b2';
  const deliver = (id: string, body: Record<string, unknown> = {}) =>
    request(app).post(api(`/tpl-network/my/orders/${id}/status`)).set(asPartner()).send({ status: 'delivered', ...body });
  beforeEach(() => {
    supabaseMock.reset(world({
      cargo_manifest: [{ id: M, status: 'in_transit', vehicle_id: V_OK, carrier_org_id: ORG.companyA }],
      tpl_orders: [
        { id: O, partner_id: TP, manifest_id: M, status: 'in_transit', pickup_location: 'A', drop_location: 'B', source_type: 'request', request_id: REQ, carrier_org_id: ORG.companyA, accepted_at: '2026-10-02T00:00:00Z' },
        { id: O2, partner_id: TP, manifest_id: null, status: 'in_transit', pickup_location: 'A', drop_location: 'B', source_type: 'request', request_id: REQ, carrier_org_id: ORG.companyB, accepted_at: '2026-10-01T00:00:00Z' },
      ],
    }));
  });

  it('needs the trip\'s proof of delivery, then copies it onto the order', async () => {
    const no = await deliver(O, { note: 'handed over' });
    expect(no.status).toBe(409);
    expect(no.body.error).toMatch(/proof of delivery/);
    Object.assign(supabaseMock.rows('cargo_manifest')[0], { photo_url: 'pod/p.jpg', received_by: 'Guard' });
    const ok = await deliver(O);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'delivered', pod_photo_url: 'pod/p.jpg', pod_received_by: 'Guard' });
    expect(ok.body.delivered_at).toBeTruthy();
  });

  it('leaves pickup and departure of a trip to the driver', async () => {
    const res = await request(app).post(api(`/tpl-network/my/orders/${O}/status`)).set(asPartner()).send({ status: 'picked_up' });
    expect(res.status).toBe(409);
  });

  it('keeps the note path for an order with no trip', async () => {
    expect((await deliver(O2)).status).toBe(400);
    const ok = await deliver(O2, { note: 'Received by the store manager' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'delivered', pod_note: 'Received by the store manager' });
  });

  it('groups the orders and offers by the company that gave the work, and keeps the flat list', async () => {
    const orders = await request(app).get(api('/tpl-network/my/orders')).set(asPartner());
    expect(orders.status).toBe(200);
    expect(orders.body.items).toHaveLength(2);
    expect(orders.body.companies.map((c: any) => [c.org_id, c.name, c.orders.length])).toEqual([[ORG.companyA, 'Alpha Logistics', 1], [ORG.companyB, 'Beta Freight', 1]]);
    const offers = await request(app).get(api('/tpl-network/my/offers')).set(asPartner());
    expect(offers.status).toBe(200);
    expect(offers.body.items).toHaveLength(1);
    expect(offers.body.companies).toEqual([expect.objectContaining({ org_id: ORG.companyA, name: 'Alpha Logistics', offers: [expect.objectContaining({ id: OFFER })] })]);
  });

  it('lets a manager of the partner organisation in, and keeps other accounts out', async () => {
    supabaseMock.rows('org_members').push({ org_id: ORG.tplT, user_id: uid('tpl-manager'), role: 'ops', status: 'active', organizations: supabaseMock.rows('organizations').find(o => o.id === ORG.tplT) });
    supabaseMock.rows('users').push({ id: uid('tpl-manager'), role: 'manager', is_active: true });
    const mgr = await request(app).get(api('/tpl-network/my/orders')).set({ Authorization: `Bearer ${supabaseMock.signUserToken(uid('tpl-manager'))}` });
    expect(mgr.status).toBe(200);
    expect(mgr.body.items).toHaveLength(2);
    expect((await request(app).get(api('/tpl-network/my/orders')).set({ Authorization: `Bearer ${supabaseMock.signUserToken(uid('vendor-1'))}` })).status).toBe(403);
  });
});
