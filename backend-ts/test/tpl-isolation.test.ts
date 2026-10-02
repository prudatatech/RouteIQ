/**
 * 3PL lifecycle audit (area 5): what one company can and cannot do with another company's partner work, who reads an
 * application in full, and that an accepted order belongs to the company that made the offer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, ORGS, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const P = 'cccccccc-0000-4000-8000-000000000001';
const REQ = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OFFER = 'eeeeeeee-0000-4000-8000-000000000001';
const ORDER = 'ffffffff-0000-4000-8000-000000000001';

const adminA = () => as('admin-a', ORG.companyA);
const adminB = () => as('admin-b', ORG.companyB);
const platform = () => as('super-1', ORG.platform);
const tpl = () => as('tpl-1', ORG.tplT);

function world(extra: Record<string, Row[]> = {}) {
  return orgWorld({
    organizations: ORGS.map(o => (o.id === ORG.tplT ? { ...o, profile: { legacy_tpl_partner_id: P } } : { ...o })),
    tpl_affiliations: [{ company_id: ORG.companyA, tpl_id: ORG.tplT, status: 'active', rules: {} }],
    tpl_partners: [{
      id: P, user_id: uid('tpl-1'), company_name: 'Tiny Transport', status: 'active', email: 't@example.test', sla_commitment: '4 Hours',
      pan_number: 'AAAPL1234C', bank_account_no: '50100123456789', bank_ifsc: 'HDFC0000123', tpl_corridors: [], tpl_documents: [{ id: 'd1', file_url: 'x' }],
    }],
    tpl_corridors: [],
    vendor_shipment_requests: [{ id: REQ, vendor_id: uid('vendor-1'), status: 'assigned_to_partner', carrier_org_id: ORG.companyA, cost: 21000, pickup_location: 'Delhi', drop_location: 'Jaipur' }],
    tpl_offers: [{ id: OFFER, carrier_org_id: ORG.companyA, partner_id: P, status: 'offered', source_type: 'request', request_id: REQ, offered_at: '2026-10-01T10:00:00Z', pickup_location: 'Delhi', drop_location: 'Jaipur', proposed_price: 18000 }],
    tpl_orders: [{ id: ORDER, offer_id: OFFER, carrier_org_id: ORG.companyA, partner_id: P, status: 'delivered', agreed_amount: 18000, delivered_at: '2026-10-02T10:00:00Z', due_by: '2026-10-03T10:00:00Z', source_type: 'request', request_id: REQ }],
    tpl_partner_statements: [], vehicles: [], cargo_manifest: [],
    ...extra,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  supabaseMock.reset(world());
});

describe("another company cannot touch a company's partner work", () => {
  it('cannot withdraw, rate, mark paid or re-price what is not its own (404, nothing changes)', async () => {
    expect((await request(app).post(api(`/tpl-network/offers/${OFFER}/withdraw`)).set(adminB())).status).toBe(404);
    expect(supabaseMock.rows('tpl_offers')[0].status).toBe('offered');
    expect((await request(app).post(api(`/tpl-network/orders/${ORDER}/rate`)).set(adminB()).send({ rating: 1 })).status).toBe(404);
    expect(supabaseMock.rows('tpl_orders')[0].rating ?? null).toBeNull();
    expect((await request(app).post(api(`/tpl-network/orders/${ORDER}/paid`)).set(adminB()).send({ paid: true })).status).toBe(404);
    expect(supabaseMock.rows('tpl_orders')[0].paid_at ?? null).toBeNull();
    expect((await request(app).put(api(`/tpl-network/requests/${REQ}/price`)).set(adminB()).send({ cost: 1 })).status).toBe(404);
    expect(Number(supabaseMock.rows('vendor_shipment_requests')[0].cost)).toBe(21000);
  });

  it('the owning company still can', async () => {
    expect((await request(app).post(api(`/tpl-network/orders/${ORDER}/rate`)).set(adminA()).send({ rating: 4 })).status).toBe(200);
    expect((await request(app).post(api(`/tpl-network/orders/${ORDER}/paid`)).set(adminA()).send({ paid: true })).status).toBe(200);
    expect((await request(app).put(api(`/tpl-network/requests/${REQ}/price`)).set(adminA()).send({ cost: 22000 })).status).toBe(200);
    expect((await request(app).post(api(`/tpl-network/offers/${OFFER}/withdraw`)).set(adminA())).status).toBe(200);
  });

  it("reads the stats of its own partners and of its own work only", async () => {
    expect((await request(app).get(api(`/tpl-network/partners/${P}/stats`)).set(adminB())).status).toBe(404);
    const own = await request(app).get(api(`/tpl-network/partners/${P}/stats`)).set(adminA());
    expect(own.status).toBe(200);
    expect(own.body.orders_completed).toBe(1);
    expect(Object.keys((await request(app).get(api('/tpl-network/partners/stats')).set(adminB())).body)).toEqual([]);
    expect(Object.keys((await request(app).get(api('/tpl-network/partners/stats')).set(adminA())).body)).toEqual([P]);
    // the partner's own numbers are not limited to one company
    expect((await request(app).get(api('/tpl-network/my/stats')).set(tpl())).body.orders_completed).toBe(1);
  });
});

describe('who reads an application', () => {
  it('shows the platform everything and a company only its own partners, without bank details', async () => {
    const all = await request(app).get(api('/tpl/queue?status=all')).set(platform());
    expect(all.body).toHaveLength(1);
    expect(all.body[0].bank_account_no).toBe('50100123456789');

    const mine = await request(app).get(api('/tpl/queue?status=all')).set(adminA());
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).not.toHaveProperty('bank_account_no');
    expect(mine.body[0]).not.toHaveProperty('pan_number');
    expect((await request(app).get(api('/tpl/queue?status=all')).set(adminB())).body).toEqual([]);
  });

  it("gives a stranger company the status view, and never lets it edit someone's application", async () => {
    const seen = await request(app).get(api(`/tpl/${P}`)).set(adminB());
    expect(seen.status).toBe(200);
    expect(seen.body).not.toHaveProperty('pan_number');
    expect(seen.body).not.toHaveProperty('bank_account_no');
    const own = await request(app).get(api(`/tpl/${P}`)).set(adminA());
    expect(own.body.company_name).toBe('Tiny Transport');
    expect(own.body).not.toHaveProperty('bank_account_no');
    const edit = await request(app).patch(api(`/tpl/${P}`)).set(adminB()).send({ companyName: 'Hacked' });
    expect(edit.status).toBe(403);
  });
});

describe('the order of an accepted offer', () => {
  it("belongs to the company that made the offer, not to the partner's own organisation", async () => {
    supabaseMock.reset(world({ tpl_orders: [], vendor_shipment_requests: [{ id: REQ, vendor_id: uid('vendor-1'), status: 'escalated', carrier_org_id: ORG.companyA, cost: 21000 }] }));
    const res = await request(app).post(api(`/tpl-network/my/offers/${OFFER}/accept`)).set(tpl()).send({ agreed_amount: 18000 });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('tpl_orders')[0].carrier_org_id).toBe(ORG.companyA);
    // so the company lists it, and the partner's portal groups it under the company
    const listed = await request(app).get(api('/tpl-network/orders')).set(adminA());
    expect(listed.body).toHaveLength(1);
    const mine = await request(app).get(api('/tpl-network/my/orders')).set(tpl());
    expect(mine.body.companies.map((c: { org_id: string }) => c.org_id)).toEqual([ORG.companyA]);
  });

  it("is not reachable by the partner's drivers through the partner routes", async () => {
    const driverSeat = { org_id: ORG.tplT, user_id: uid('driver-a'), role: 'driver', status: 'active', organizations: ORGS.find(o => o.id === ORG.tplT) };
    supabaseMock.reset(world({ org_members: [...world().org_members, driverSeat] }));
    const res = await request(app).get(api('/tpl-network/my/offers')).set(as('driver-a', ORG.tplT));
    expect(res.status).toBe(403);
  });
});

describe('the partner photos of its vehicles', () => {
  it('are for members of the owning partner, on its own vehicles', async () => {
    const V = '99999999-0000-4000-8000-000000000001';
    supabaseMock.reset(world({ vehicles: [{ id: V, carrier_org_id: ORG.tplT, plate_number: 'MH12AB1234', status: 'available' }, { id: '99999999-0000-4000-8000-000000000002', carrier_org_id: ORG.companyA, plate_number: 'MH12AB9999', status: 'available' }] }));
    expect((await request(app).get(api(`/tpl-portal/${ORG.tplT}/vehicles/${V}/photos`)).set(tpl())).status).toBe(200);
    expect((await request(app).get(api(`/tpl-portal/${ORG.tplT}/vehicles/99999999-0000-4000-8000-000000000002/photos`)).set(tpl())).status).toBe(404);
    expect((await request(app).get(api(`/tpl-portal/${ORG.tplT}/vehicles/${V}/photos`)).set(adminA())).status).toBe(403);
  });
});
