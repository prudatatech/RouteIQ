/**
 * The vendor portal's loads: GET /vendor/loads (the "My loads" board) and GET /vendor/loads/:id.
 * A vendor sees their own loads only, in stages, with the price, truck, invoice, open problems in
 * plain words with a new arrival time, the proof of delivery and whether a claim can be raised.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { stageFor } from '../src/services/vendor-loads.service';
import { ID, NOW, auth, cargoWorld, manifestRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const DAY = 86_400_000;

const OTHER_REQUEST = 'ab000000-0000-4000-8000-0000000000aa';
const POSTED = 'ab000000-0000-4000-8000-0000000000bb';
const M_OTHER = 'aa110000-0000-4000-8000-0000000000aa';
const BID_SHIPMENT = '51000000-0000-4000-8000-0000000000cc';
const EXC = 'ee110000-0000-4000-8000-000000000001';

describe('stageFor', () => {
  const base = { requestStatus: 'assigned', status: 'in_transit', outcome: null, held: null, invoiceStatus: null } as const;

  it('reads a posted load from its request until a truck carries it', () => {
    expect(stageFor({ ...base, requestStatus: 'pending', status: null })).toBe('waiting');
    for (const s of ['approved', 'escalated', 'assigned_to_partner']) expect(stageFor({ ...base, requestStatus: s, status: null })).toBe('accepted');
    expect(stageFor({ ...base, requestStatus: 'assigned', status: null })).toBe('assigned');
    for (const s of ['rejected', 'cancelled']) expect(stageFor({ ...base, requestStatus: s, status: null })).toBe('closed');
  });

  it('reads it from the truck once there is one', () => {
    expect(stageFor({ ...base, status: 'assigned' })).toBe('assigned');
    expect(stageFor({ ...base, status: 'created' })).toBe('assigned');
    for (const s of ['picked_up', 'in_transit', 'out_for_delivery', 'on_hold', 'at_hub', 'exception', 'returning']) expect(stageFor({ ...base, status: s })).toBe('on_the_way');
    expect(stageFor({ ...base, status: 'delivered' })).toBe('delivered');
    expect(stageFor({ ...base, status: 'partially_delivered' })).toBe('delivered');
  });

  it('keeps a delivered load in Delivered until its invoice is paid, and closes returned and lost ones', () => {
    expect(stageFor({ ...base, status: 'delivered', invoiceStatus: 'issued' })).toBe('delivered');
    expect(stageFor({ ...base, status: 'delivered', invoiceStatus: 'paid' })).toBe('closed');
    expect(stageFor({ ...base, status: 'returned' })).toBe('closed');
    expect(stageFor({ ...base, status: 'cancelled', outcome: 'lost' })).toBe('closed');
  });

  it('counts a partly delivered load with nothing left on board as delivered', () => {
    expect(stageFor({ ...base, status: 'exception', outcome: 'partly_delivered', held: 0 })).toBe('delivered');
    expect(stageFor({ ...base, status: 'exception', outcome: 'partly_delivered', held: 2 })).toBe('on_the_way');
  });
});

function world(over: Record<string, any[]> = {}) {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld({
    vendor_shipment_requests: [
      { id: ID.request1, vendor_id: ID.vendor, status: 'assigned', assigned_vehicle_id: ID.v1, pickup_location: 'Pune', drop_location: 'Mumbai', required_capacity_kg: 300, cost: 8000, created_at: NOW, metadata: { cargo: { noOfPackages: 4 } } },
      { id: POSTED, vendor_id: ID.vendor, status: 'pending', pickup_location: 'Nashik', drop_location: 'Surat', required_capacity_kg: 900, cost: null, created_at: '2026-01-01T00:00:00Z', metadata: { offered_price_inr: 12000, cargo: { noOfPackages: 9 } } },
      { id: OTHER_REQUEST, vendor_id: ID.otherVendor, status: 'assigned', pickup_location: 'Delhi', drop_location: 'Agra', required_capacity_kg: 100, cost: 5000, created_at: NOW, metadata: {} },
    ],
    cargo_manifest: [manifestRow(ID.m1), manifestRow(M_OTHER, { vendor_request_id: OTHER_REQUEST })],
    ...over,
  }));
}

const get = (path: string, who: Record<string, string> = auth.vendor()) => request(app).get(api(path)).set(who);

describe('GET /vendor/loads', () => {
  beforeEach(() => world());

  it('lists the vendor\'s own loads in stages with price, truck and tracking code, and nobody else\'s', async () => {
    const res = await get('/vendor/loads');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((l: any) => [l.id, l]));
    expect(Object.keys(byId).sort()).toEqual([ID.request1, POSTED].sort());
    expect(byId[ID.request1]).toMatchObject({
      stage: 'on_the_way', pickup: 'Pune', drop: 'Mumbai', weight_kg: 300, pieces: 4, price: 8000, price_source: 'agreed',
      truck: { plate_number: 'MH12AB0001' }, manifest_id: ID.m1, tracking_id: expect.stringMatching(/^CM-/), kind: 'posted',
    });
    expect(byId[POSTED]).toMatchObject({ stage: 'waiting', price: 12000, price_source: 'offered', pieces: 9, truck: null, tracking_id: null });
  });

  it('never gives the driver\'s name', async () => {
    const res = await get('/vendor/loads');
    expect(JSON.stringify(res.body)).not.toMatch(/Ravi/);
  });

  it('is for vendors only', async () => {
    expect((await get('/vendor/loads', auth.driver())).status).toBe(403);
    expect((await get('/vendor/loads', auth.customer())).status).toBe(403);
    expect((await request(app).get(api('/vendor/loads'))).status).toBe(401);
  });

  it('shows the open problem on a load in plain words, and the invoice', async () => {
    world({
      cargo_exceptions: [{ id: EXC, code: 'EXC-1', type: 'vehicle_breakdown', severity: 'high', status: 'open', description: 'Gearbox: internal staff note', created_at: NOW }],
      cargo_exception_items: [{ id: 'i1', exception_id: EXC, manifest_id: ID.m1 }],
      invoices: [{ id: 'inv-1', invoice_number: 'INV-202609-0001', vendor_id: ID.vendor, manifest_id: ID.m1, vendor_request_id: ID.request1, amount: 8000, gst_amount: 400, total: 8400, status: 'issued', issued_at: NOW }],
    });
    const load = (await get('/vendor/loads')).body.find((l: any) => l.id === ID.request1);
    expect(load.problems).toEqual([expect.objectContaining({ type: 'vehicle_breakdown', title: 'Your goods are delayed' })]);
    expect(JSON.stringify(load)).not.toMatch(/Gearbox|EXC-1/);
    expect(load.invoice).toMatchObject({ invoice_number: 'INV-202609-0001', status: 'issued', total: 8400 });
  });

  it('puts a delivered load with a paid invoice in Closed, and includes return-trip space the vendor won', async () => {
    world({
      cargo_manifest: [manifestRow(ID.m1, { status: 'delivered', current_holder: 'consignee', current_vehicle_id: null, pieces_delivered: 4 })],
      invoices: [{ id: 'inv-1', invoice_number: 'INV-1', vendor_id: ID.vendor, manifest_id: ID.m1, amount: 8000, total: 8000, status: 'paid', issued_at: NOW, paid_at: NOW }],
      capacity_bids: [{ id: 'bid-1', vendor_id: ID.vendor, bid_amount: 4500, status: 'won' }, { id: 'bid-2', vendor_id: ID.otherVendor, bid_amount: 100, status: 'won' }],
      shipments: [
        { id: BID_SHIPMENT, tracking_id: 'RTX-BID0001', status: 'assigned', origin_name: 'Vendor yard', origin_address: 'Vendor yard, Pune', total_weight_kg: 250, total_items: 1, pieces_total: 1, bid_id: 'bid-1', current_holder: 'consignor', current_vehicle_id: null, created_at: NOW },
        { id: '51000000-0000-4000-8000-0000000000dd', tracking_id: 'RTX-OTHER', status: 'assigned', bid_id: 'bid-2', current_holder: 'consignor', created_at: NOW },
      ],
      delivery_points: [{ id: 'dp-bid', shipment_id: BID_SHIPMENT, name: 'Drop', address: 'Baner, Pune', created_at: NOW }],
    });
    const rows = (await get('/vendor/loads')).body;
    expect(rows.find((l: any) => l.id === ID.request1).stage).toBe('closed');
    const space = rows.find((l: any) => l.id === BID_SHIPMENT);
    expect(space).toMatchObject({ kind: 'space', stage: 'assigned', code: 'RTX-BID0001', price: 4500, price_source: 'bid', drop: 'Baner, Pune', pickup: 'Vendor yard, Pune', bid_id: 'bid-1' });
    expect(rows.some((l: any) => l.code === 'RTX-OTHER')).toBe(false);
  });
});

describe('GET /vendor/loads/:id', () => {
  beforeEach(() => world());

  it('refuses another vendor\'s load and a malformed id', async () => {
    expect((await get(`/vendor/loads/${OTHER_REQUEST}`)).status).toBe(404);
    expect((await get(`/vendor/loads/${ID.request1}`, auth.vendor(ID.otherVendor))).status).toBe(404);
    expect((await get('/vendor/loads/not-a-uuid')).status).toBe(404);
  });

  it('gives a load waiting to be accepted with no truck, record or claim yet', async () => {
    const res = await get(`/vendor/loads/${POSTED}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'waiting', where: null, pod: null, lots: [], claims: [] });
    expect(res.body.claim_window.allowed).toBe(false);
  });

  it('gives the open problem with its new arrival time and no internal notes', async () => {
    world({
      cargo_exceptions: [{ id: EXC, code: 'EXC-1', type: 'delay', severity: 'low', status: 'open', description: 'Internal: driver sick', created_at: NOW }],
      cargo_exception_items: [{ id: 'i1', exception_id: EXC, manifest_id: ID.m1 }],
    });
    const res = await get(`/vendor/loads/${ID.request1}`);
    expect(res.status).toBe(200);
    expect(res.body.problems).toHaveLength(1);
    expect(res.body.problems[0]).toMatchObject({ title: 'Your goods are running late', message: expect.stringMatching(/running late/), revised_eta: { eta_at: expect.any(String), eta_text: expect.any(String) } });
    expect(JSON.stringify(res.body)).not.toMatch(/driver sick|Ravi/);
    expect(res.body.where).toMatchObject({ current_holder: 'vehicle' });
    expect(res.body.claim_window.allowed).toBe(false);
  });

  it('gives the proof of delivery with signed links, lets the vendor claim inside 7 days and shows their claims', async () => {
    world({
      cargo_manifest: [manifestRow(ID.m1, { status: 'delivered', current_holder: 'consignee', current_vehicle_id: null, pieces_delivered: 4, received_by: 'Suresh', photo_url: 'pod/x/photo.jpg', signature_url: 'pod/x/signature.png' })],
      cargo_custody_events: [{ id: 'ev', manifest_id: ID.m1, kind: 'delivery', pieces: 4, photo_paths: [], recorded_at: new Date(Date.now() - 2 * DAY).toISOString() }],
      cargo_claims: [{ id: 'c1a10000-0000-4000-8000-000000000001', code: 'CLM-1', manifest_id: ID.m1, claim_type: 'damage', status: 'filed', claimed_amount: 500, created_at: NOW }],
    });
    const res = await get(`/vendor/loads/${ID.request1}`);
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('delivered');
    expect(res.body.pod).toMatchObject({ received_by: 'Suresh', photo_url: expect.stringContaining('pod/x/photo.jpg'), signature_url: expect.stringContaining('signature.png') });
    expect(res.body.claim_window).toMatchObject({ allowed: true, reason: null });
    expect(Date.parse(res.body.claim_window.until)).toBeGreaterThan(Date.now());
    expect(res.body.claims).toEqual([expect.objectContaining({ code: 'CLM-1', status: 'filed' })]);
  });

  it('closes the claim window 7 days after delivery, saying why', async () => {
    world({
      cargo_manifest: [manifestRow(ID.m1, { status: 'delivered', current_holder: 'consignee', current_vehicle_id: null })],
      cargo_custody_events: [{ id: 'ev', manifest_id: ID.m1, kind: 'delivery', pieces: 4, photo_paths: [], recorded_at: new Date(Date.now() - 9 * DAY).toISOString() }],
    });
    const { body } = await get(`/vendor/loads/${ID.request1}`);
    expect(body.claim_window).toMatchObject({ allowed: false, reason: expect.stringMatching(/within 7 days/) });
  });

  it('opens return-trip space by its shipment id', async () => {
    world({
      capacity_bids: [{ id: 'bid-1', vendor_id: ID.vendor, bid_amount: 4500, status: 'won' }],
      shipments: [{ id: BID_SHIPMENT, tracking_id: 'RTX-BID0001', status: 'assigned', origin_name: 'Yard', origin_address: 'Yard, Pune', total_weight_kg: 250, total_items: 1, pieces_total: 1, bid_id: 'bid-1', current_holder: 'consignor', current_vehicle_id: null, created_at: NOW }],
    });
    const res = await get(`/vendor/loads/${BID_SHIPMENT}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'space', code: 'RTX-BID0001', shipment_id: BID_SHIPMENT });
    expect(res.body.claim_window.allowed).toBe(false);
  });
});
