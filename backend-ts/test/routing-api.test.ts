/**
 * Order routing over HTTP (mocked Supabase), docs/order-routing.md: who sees a load, quotes (create, replace, withdraw,
 * one live quote per company), the vendor awarding a quote, the direct accept, notifications to the matching companies
 * only, and the documents carrier. The database function award_load is stood in for by test/support/routing-world.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, ORGS, as, uid } from './support/org-world';
import { L, notesFor, quoteRow, routingWorld } from './support/routing-world';
import { supabase } from '../src/core/supabase';
import { draft } from './support/load-draft';
import { goodsTables } from './support/goods-world';
import { releaseHeldLoads } from '../src/services/loads/loads.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

const adminA = () => as('admin-a', ORG.companyA);
const adminB = () => as('admin-b', ORG.companyB);
const managerA = () => as('manager-a', ORG.companyA);
const vendor = () => as('vendor-1', ORG.vendorV);
const tpl = () => as('tpl-1', ORG.tplT);

const market = (who: Record<string, string>, tab = 'new') => request(app).get(api(`/company/loads/market?tab=${tab}`)).set(who);
const idsOf = (res: any) => res.body.items.map((i: any) => i.id).sort();
const quote = (who: Record<string, string>, id: string, body: object) => request(app).post(api(`/company/loads/${id}/quotes`)).set(who).send(body);
const live = (id: string, org: string) => supabaseMock.rows('load_quotes').filter(q => q.load_id === id && q.carrier_org_id === org && q.status === 'submitted');
const load = (id: string) => supabaseMock.rows('vendor_shipment_requests').find(r => r.id === id)!;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  routingWorld();
});

describe('who sees a load', () => {
  it('shows a company the open loads and the ones chosen for it, never a held load or another company\'s award', async () => {
    // Alpha: open + quote-requested open load (the chosen-for-Beta, the held, the cancelled and Alpha's own award stay out of "new")
    expect(idsOf(await market(adminA()))).toEqual([L.open, L.quoteReq].sort());
    // Beta: the same open loads, plus the one chosen for it
    expect(idsOf(await market(adminB()))).toEqual([L.open, L.chosenB, L.quoteReq].sort());
    // Won: only the company the load was awarded to
    expect(idsOf(await market(adminA(), 'won'))).toEqual([L.awardedA]);
    expect(idsOf(await market(adminB(), 'won'))).toEqual([]);
  });

  it('keeps a load held for the vendor\'s verification from every company, even when the vendor organisation is active', async () => {
    expect((await market(adminA())).body.items.some((i: any) => i.id === L.held)).toBe(false);
    expect((await request(app).get(api(`/company/loads/${L.held}`)).set(adminA())).status).toBe(404);
  });

  it('keeps every load of a vendor whose organisation is not active from the companies', async () => {
    routingWorld({}, ORGS.map(o => (o.id === ORG.vendorV ? { ...o, status: 'pending' } : { ...o })));
    expect(idsOf(await market(adminA()))).toEqual([]);
  });

  it('answers 404, never 403, for a load that is chosen for another company or awarded to one', async () => {
    expect((await request(app).get(api(`/company/loads/${L.chosenB}`)).set(adminA())).status).toBe(404);
    expect((await request(app).get(api(`/company/loads/${L.chosenB}`)).set(adminB())).status).toBe(200);
    // Awarded to Alpha: Beta cannot see it any more, Alpha can
    expect((await request(app).get(api(`/company/loads/${L.awardedA}`)).set(adminB())).status).toBe(404);
    expect((await request(app).get(api(`/company/loads/${L.awardedA}`)).set(adminA())).status).toBe(200);
    expect((await request(app).get(api('/company/loads/not-a-uuid')).set(adminA())).status).toBe(404);
  });

  it('is for the logistic company\'s staff: a vendor, a 3PL partner and a signed-out caller are refused', async () => {
    expect((await market(vendor())).status).toBe(403);
    expect((await market(tpl())).status).toBe(403);
    expect((await request(app).get(api('/company/loads/market'))).status).toBe(401);
    // The platform acting as the platform has no market
    expect((await market(as('super-1', ORG.platform))).status).toBe(403);
  });

  it('lists the quoted, won and lost tabs with counts, and hides contacts and goods on a lost load', async () => {
    await quote(adminA(), L.open, { amount_inr: 19000 });
    const lostQuote = quoteRow(L.cancelled, ORG.companyA, 17000, { status: 'declined' });
    supabaseMock.rows('load_quotes').push(lostQuote);
    const quoted = await market(adminA(), 'quoted');
    expect(idsOf(quoted)).toEqual([L.open]);
    expect(quoted.body.items[0].my_quote).toMatchObject({ amount_inr: 19000, status: 'submitted' });
    expect(quoted.body.counts).toEqual({ new: 1, quoted: 1, won: 1, lost: 1 });
    expect(idsOf(await market(adminA()))).toEqual([L.quoteReq]);
    const lost = await market(adminA(), 'lost');
    expect(idsOf(lost)).toEqual([L.cancelled]);
    expect(lost.body.items[0]).toMatchObject({ pickup_contact_phone: null, pickup_address: null, items: [], pickup_city: 'Pune' });
    // A won load keeps every posted field
    const won = (await market(adminA(), 'won')).body.items[0];
    expect(won).toMatchObject({ id: L.awardedA, pickup_contact_phone: '+919800000000', carrier_org_id: ORG.companyA, vendor: { name: 'Acme Traders' } });
  });

  it('gives the detail every posted field and the goods lines, with the company\'s own quote', async () => {
    await quote(adminA(), L.open, { amount_inr: 19000, notes: 'Open body' });
    const res = await request(app).get(api(`/company/loads/${L.open}`)).set(adminA());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: L.open, budget_inr: 20000, quote_requested: false, eway_required: true, my_quote: { amount_inr: 19000, notes: 'Open body' } });
    expect(res.body.items[0]).toMatchObject({ product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18 });
    // Another company's quote is never in it
    expect((await request(app).get(api(`/company/loads/${L.open}`)).set(adminB())).body.my_quote).toBeNull();
  });
});

describe('GET /vendor/loads/:id for a company', () => {
  const read = (who: Record<string, string>, id: string) => request(app).get(api(`/vendor/loads/${id}`)).set(who);

  it('opens the loads routed to the company, with their goods lines, and nothing else', async () => {
    const open = await read(adminA(), L.open);
    expect(open.status).toBe(200);
    expect(open.body.load.id).toBe(L.open);
    expect(open.body.items.map((i: any) => i.product_name)).toEqual(['Cement bags']);
    // Chosen for Beta only; held; cancelled; awarded to Alpha
    expect((await read(adminA(), L.chosenB)).status).toBe(404);
    expect((await read(adminB(), L.chosenB)).status).toBe(200);
    expect((await read(adminA(), L.held)).status).toBe(404);
    expect((await read(adminA(), L.cancelled)).status).toBe(404);
    expect((await read(adminA(), L.awardedA)).status).toBe(200);
    expect((await read(adminB(), L.awardedA)).status).toBe(404);
  });

  it('keeps every load of a vendor whose organisation is not active from the companies', async () => {
    routingWorld({}, ORGS.map(o => (o.id === ORG.vendorV ? { ...o, status: 'pending' } : { ...o })));
    expect((await read(adminA(), L.open)).status).toBe(404);
    expect((await read(vendor(), L.open)).status).toBe(200);
  });

  it('is not opened to a vendor of another organisation or a 3PL partner', async () => {
    expect((await read(tpl(), L.open)).status).toBe(404);
  });
});

describe('quotes', () => {
  it('creates a quote, replaces it (one live quote per company), and tells the vendor', async () => {
    const first = await quote(adminA(), L.open, { amount_inr: 19000, valid_until: new Date(Date.now() + 86_400_000).toISOString(), vehicle_class: '20ft', pickup_eta: '2026-12-01', notes: 'Closed body' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ replaced: false, quote: { amount_inr: 19000, status: 'submitted', vehicle_class: '20ft', pickup_eta: '2026-12-01' } });
    const second = await quote(managerA(), L.open, { amount_inr: 18500 });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ replaced: true, quote: { amount_inr: 18500 } });
    expect(live(L.open, ORG.companyA)).toHaveLength(1);
    expect(supabaseMock.rows('load_quotes').filter(q => q.load_id === L.open)).toHaveLength(1);
    // Beta's quote is its own
    expect((await quote(adminB(), L.open, { amount_inr: 21000 })).status).toBe(201);
    expect(supabaseMock.rows('load_quotes').filter(q => q.load_id === L.open)).toHaveLength(2);
    expect(notesFor('vendor-1', 'quote_received')).toHaveLength(3);
  });

  it('withdraws the live quote, once', async () => {
    await quote(adminA(), L.open, { amount_inr: 19000 });
    const gone = await request(app).delete(api(`/company/loads/${L.open}/quotes/mine`)).set(adminA());
    expect(gone.status).toBe(200);
    expect(gone.body.quote.status).toBe('withdrawn');
    expect(live(L.open, ORG.companyA)).toHaveLength(0);
    expect((await request(app).delete(api(`/company/loads/${L.open}/quotes/mine`)).set(adminA())).status).toBe(404);
    // After withdrawing it can quote again
    expect((await quote(adminA(), L.open, { amount_inr: 17000 })).status).toBe(201);
    expect(supabaseMock.rows('load_quotes').filter(q => q.load_id === L.open && q.carrier_org_id === ORG.companyA).map(q => q.status).sort()).toEqual(['submitted', 'withdrawn']);
  });

  it('refuses a load that is not visible, not pending or already awarded, and bad amounts', async () => {
    expect((await quote(adminA(), L.chosenB, { amount_inr: 100 })).status).toBe(404);
    expect((await quote(adminA(), L.held, { amount_inr: 100 })).status).toBe(404);
    expect((await quote(adminB(), L.awardedA, { amount_inr: 100 })).status).toBe(404);
    expect((await quote(adminA(), L.awardedA, { amount_inr: 100 })).status).toBe(409);
    expect((await quote(adminA(), L.cancelled, { amount_inr: 100 })).status).toBe(404);
    expect((await quote(adminA(), L.open, { amount_inr: 0 })).status).toBe(400);
    expect((await quote(adminA(), L.open, { amount_inr: 'cheap' })).status).toBe(400);
    expect((await quote(adminA(), L.open, { amount_inr: 100, valid_until: '2020-01-01T00:00:00Z' })).status).toBe(400);
    expect((await quote(vendor(), L.open, { amount_inr: 100 })).status).toBe(403);
    expect(supabaseMock.rows('load_quotes')).toHaveLength(0);
  });
});

describe('the vendor picks a quote', () => {
  const setup = async () => {
    const a = await quote(adminA(), L.quoteReq, { amount_inr: 19000 });
    const b = await quote(adminB(), L.quoteReq, { amount_inr: 17500 });
    supabaseMock.rows('shipments').push(
      { id: 's1', carrier_org_id: ORG.companyA, status: 'delivered', is_master: false },
      { id: 's2', carrier_org_id: ORG.companyA, status: 'delivered', is_master: false },
      { id: 's3', carrier_org_id: ORG.companyA, status: 'in_transit', is_master: false },
    );
    return { a: a.body.quote.id as string, b: b.body.quote.id as string };
  };
  const accept = (who: Record<string, string>, id: string, quoteId: string) => request(app).post(api(`/vendor/loads/${id}/quotes/${quoteId}/accept`)).set(who);

  it('lists the quotes with the company name and its completed trips', async () => {
    const { a, b } = await setup();
    const res = await request(app).get(api(`/vendor/loads/${L.quoteReq}/quotes`)).set(vendor());
    expect(res.status).toBe(200);
    expect(res.body.load).toMatchObject({ id: L.quoteReq, quote_requested: true, status: 'pending' });
    expect(res.body.quotes.map((q: any) => q.id)).toEqual([b, a]);
    expect(res.body.quotes[1]).toMatchObject({ company_name: 'Alpha Logistics', trips_completed: 2, completed_trips: 2, amount_inr: 19000, status: 'submitted' });
    expect(res.body.quotes[0]).toMatchObject({ company_name: 'Beta Freight', trips_completed: 0 });
    expect(res.body).toMatchObject({ quote_requested: true, awarded: null });
    expect(res.body.quote_deadline).toBe(load(L.quoteReq).quote_deadline);
    // Another vendor, and a company, cannot read them
    expect((await request(app).get(api(`/vendor/loads/${L.quoteReq}/quotes`)).set(tpl())).status).toBe(404);
    expect((await request(app).get(api(`/vendor/loads/${L.quoteReq}/quotes`)).set(adminA())).status).toBe(403);
  });

  it('awards the load: the carrier is set, the cost is the amount, the others are declined, a second accept is refused', async () => {
    const { a, b } = await setup();
    const won = await accept(vendor(), L.quoteReq, b);
    expect(won.status).toBe(200);
    expect(won.body).toMatchObject({ load: { id: L.quoteReq, status: 'approved', carrier_org_id: ORG.companyB, awarded_quote_id: b }, quote: { id: b, status: 'accepted', amount_inr: 17500 } });
    expect(load(L.quoteReq)).toMatchObject({ carrier_org_id: ORG.companyB, status: 'approved', cost: 17500, awarded_quote_id: b });
    expect(supabaseMock.rows('load_quotes').find(q => q.id === a)!.status).toBe('declined');
    expect(supabaseMock.rows('load_quotes').find(q => q.id === b)!.status).toBe('accepted');
    // The winner and the other company are told
    expect(notesFor('admin-b', 'quote_accepted')).toHaveLength(1);
    expect(notesFor('admin-a', 'quote_declined')).toHaveLength(1);
    expect(notesFor('admin-b', 'quote_declined')).toHaveLength(0);

    // Only one award can ever happen
    const second = await accept(vendor(), L.quoteReq, a);
    expect(second.status).toBe(409);
    expect(load(L.quoteReq).carrier_org_id).toBe(ORG.companyB);
    expect(supabaseMock.rows('load_quotes').find(q => q.id === a)!.status).toBe('declined');
    const after = await request(app).get(api(`/vendor/loads/${L.quoteReq}/quotes`)).set(vendor());
    expect(after.body.awarded).toEqual({ company_name: 'Beta Freight', amount_inr: 17500 });
    // The market follows: Beta now has it in Won, Alpha in Lost and no longer sees it
    expect(idsOf(await market(adminB(), 'won'))).toContain(L.quoteReq);
    expect(idsOf(await market(adminA(), 'lost'))).toEqual([L.quoteReq]);
    expect((await request(app).get(api(`/company/loads/${L.quoteReq}`)).set(adminA())).status).toBe(404);
  });

  it('refuses another vendor, an expired quote, a withdrawn quote and a made-up quote', async () => {
    const { a } = await setup();
    expect((await accept(tpl(), L.quoteReq, a)).status).toBe(404);
    expect((await accept(vendor(), L.quoteReq, 'b2000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    supabaseMock.rows('load_quotes').find(q => q.id === a)!.valid_until = '2020-01-01T00:00:00Z';
    expect((await accept(vendor(), L.quoteReq, a)).status).toBe(409);
    supabaseMock.rows('load_quotes').find(q => q.id === a)!.status = 'withdrawn';
    expect((await accept(vendor(), L.quoteReq, a)).status).toBe(409);
    expect(load(L.quoteReq).carrier_org_id).toBeNull();
    expect((await accept(adminA(), L.quoteReq, a)).status).toBe(403);
  });
});

describe('a direct accept', () => {
  const accept = (who: Record<string, string>, id: string, body: object = {}) => request(app).post(api(`/company/loads/${id}/accept`)).set(who).send(body);

  it('awards the load at the vendor\'s budget, or at the amount given, with an accepted quote', async () => {
    const res = await accept(adminA(), L.open);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ load: { carrier_org_id: ORG.companyA, status: 'approved', cost: 20000 }, quote: { status: 'accepted', amount_inr: 20000 } });
    expect(supabaseMock.rows('load_quotes').filter(q => q.load_id === L.open)).toHaveLength(1);
    expect(notesFor('vendor-1', 'request_approved')).toHaveLength(1);

    const cheaper = await accept(adminB(), L.chosenB, { amount_inr: 18000 });
    expect(cheaper.body.load).toMatchObject({ carrier_org_id: ORG.companyB, cost: 18000 });
  });

  it('declines the other companies\' quotes and makes the company\'s own live quote the accepted one', async () => {
    await quote(adminA(), L.open, { amount_inr: 21000 });
    await quote(adminB(), L.open, { amount_inr: 19500 });
    await accept(adminA(), L.open, { amount_inr: 20500 });
    const quotes = supabaseMock.rows('load_quotes').filter(q => q.load_id === L.open);
    expect(quotes.find(q => q.carrier_org_id === ORG.companyA)).toMatchObject({ status: 'accepted', amount_inr: 20500 });
    expect(quotes.find(q => q.carrier_org_id === ORG.companyB)!.status).toBe('declined');
    expect(quotes).toHaveLength(2);
    expect(notesFor('admin-b', 'quote_declined')).toHaveLength(1);
  });

  it('is refused when the vendor asked for quotes, when it is not visible, when it is taken, and with no amount', async () => {
    const asked = await accept(adminA(), L.quoteReq);
    expect(asked.status).toBe(409);
    expect(load(L.quoteReq).carrier_org_id).toBeNull();
    expect(supabaseMock.rows('load_quotes')).toHaveLength(0);
    expect((await accept(adminA(), L.chosenB)).status).toBe(404);
    expect((await accept(adminA(), L.held)).status).toBe(404);
    expect((await accept(adminA(), L.awardedA)).status).toBe(409);
    expect((await accept(adminB(), L.awardedA)).status).toBe(404);
    load(L.open).budget_inr = null;
    expect((await accept(adminA(), L.open)).status).toBe(400);
    expect((await accept(adminA(), L.open, { amount_inr: -5 })).status).toBe(400);
    expect((await accept(vendor(), L.open)).status).toBe(403);
  });

  it('lets only one of two companies win the same load', async () => {
    const first = await accept(adminA(), L.open);
    const second = await accept(adminB(), L.open);
    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(load(L.open).carrier_org_id).toBe(ORG.companyA);
    // The database function refuses a second award even if a company still holds a stale view of the load
    const { data, error } = await supabase.rpc('award_load', { p_load: L.open, p_quote: null, p_carrier: ORG.companyB, p_amount: 1, p_actor: uid('admin-b'), p_direct: true });
    expect(data).toBeNull();
    expect(error?.message).toContain('load_already_awarded');
  });

  it('is what the old "Accept and price" endpoint now does: it sets carrier_org_id for the acting company', async () => {
    const res = await request(app).put(api(`/vendor/shipment-request/${L.open}/approve`)).set(adminA()).send({ cost: 19999 });
    expect(res.status).toBe(200);
    expect(load(L.open)).toMatchObject({ carrier_org_id: ORG.companyA, status: 'approved', cost: 19999 });
    expect(supabaseMock.rows('load_quotes')[0]).toMatchObject({ carrier_org_id: ORG.companyA, status: 'accepted', amount_inr: 19999 });
    // A load that asked for quotes cannot be accepted this way either
    const asked = await request(app).put(api(`/vendor/shipment-request/${L.quoteReq}/approve`)).set(adminA()).send({ cost: 100 });
    expect(asked.status).toBe(409);
    expect(load(L.quoteReq).carrier_org_id).toBeNull();
    // And another company cannot take a load it cannot see
    expect((await request(app).put(api(`/vendor/shipment-request/${L.chosenB}/approve`)).set(adminA()).send({ cost: 100 })).status).toBe(404);
  });

  it('limits the old pending list to what the company may see, and a company cannot reject a load it only sees', async () => {
    const list = await request(app).get(api('/vendor/shipment-request/pending')).set(adminA());
    expect(list.body.map((r: any) => r.id).sort()).toEqual([L.open, L.quoteReq, L.awardedA].sort());
    const beta = await request(app).get(api('/vendor/shipment-request/pending')).set(adminB());
    expect(beta.body.map((r: any) => r.id).sort()).toEqual([L.open, L.chosenB, L.quoteReq].sort());
    const reject = (who: Record<string, string>, id: string) => request(app).put(api(`/vendor/shipment-request/${id}/reject`)).set(who).send({ reason: 'Not for us' });
    expect((await reject(adminA(), L.open)).status).toBe(409);
    expect((await reject(adminA(), L.chosenB)).status).toBe(404);
    expect((await reject(adminB(), L.awardedA)).status).toBe(404);
    expect(load(L.open).status).toBe('pending');
    expect((await reject(adminA(), L.awardedA)).status).toBe(200);
  });
});

describe('who is told about a new load', () => {
  const post = (body: object, who = vendor()) => request(app).post(api('/vendor/loads')).set(who).send(body);

  const withPosting = (vendorStatus = 'active') => {
    routingWorld({
      vendor_shipment_requests: [], load_items: [], vendor_profiles: [{ id: uid('vendor-1'), kyc_status: 'approved' }], ...goodsTables(),
    }, ORGS.map(o => (o.id === ORG.vendorV ? { ...o, status: vendorStatus } : { ...o })));
    let seq = 0;
    supabaseMock.onRpc('create_vendor_load', ({ p }: any) => {
      const row = { id: `c1000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, status: 'pending', created_at: new Date().toISOString(), carrier_org_id: null, ...p.load, load_number: `MRX-2026-${String(seq).padStart(5, '0')}` };
      supabaseMock.rows('vendor_shipment_requests').push(row);
      return { ...row, duplicate: false };
    });
  };
  const told = () => [...new Set(supabaseMock.rows('notifications').filter(n => n.type === 'vendor_request').map(n => n.user_id))].sort();
  const people = (...keys: string[]) => keys.map(uid).sort();

  it('open: the owners and admins of the companies serving the lane, not other companies, managers, drivers or platform-wide staff', async () => {
    withPosting();
    const res = await post(draft());
    expect(res.status).toBe(201);
    expect(res.body.load.routing).toBe('open');
    // Alpha's Mumbai depot serves the lane; Beta serves Delhi only. Alpha's owner (super-1) and admin (admin-a), nobody else.
    expect(told()).toEqual(people('super-1', 'admin-a'));
    expect(notesFor('admin-b', 'vendor_request')).toHaveLength(0);
    expect(notesFor('manager-a', 'vendor_request')).toHaveLength(0);
    expect(notesFor('driver-a', 'vendor_request')).toHaveLength(0);
  });

  it('open: every person of a long list of companies is told exactly once (they are told a batch at a time)', async () => {
    withPosting();
    const extra = Array.from({ length: 45 }, (_, i) => ({ org: `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, user: uid(`bulk-admin-${i}`) }));
    for (const e of extra) {
      supabaseMock.rows('organizations').push({ id: e.org, kind: 'logistic_company', name: `Bulk ${e.user}`, status: 'active', city: 'Mumbai', state: 'Maharashtra', profile: {} });
      supabaseMock.rows('users').push({ id: e.user, role: 'admin', name: 'Bulk', email: `${e.user}@example.test`, is_active: true });
      supabaseMock.rows('org_members').push({ org_id: e.org, user_id: e.user, role: 'admin', status: 'active' });
    }
    const res = await post(draft());
    expect(res.status).toBe(201);
    const counts = new Map<string, number>();
    for (const n of supabaseMock.rows('notifications').filter(n => n.type === 'vendor_request')) counts.set(n.user_id, (counts.get(n.user_id) ?? 0) + 1);
    for (const e of extra) expect(counts.get(e.user)).toBe(1);
  });

  it('open, with no company serving the lane: every active company', async () => {
    withPosting();
    await post(draft({ pickup_city: 'Chennai', delivery_city: 'Madurai', pickup_pincode: '600001', delivery_pincode: '625001' }));
    expect(told()).toEqual(people('super-1', 'admin-a', 'admin-b'));
  });

  it('chosen: only the chosen companies\' owners and admins, and the deadline is two hours when quotes were asked for', async () => {
    withPosting();
    const res = await post(draft({ routing: 'chosen', company_ids: [ORG.companyB], quote_requested: true }));
    expect(res.status).toBe(201);
    expect(told()).toEqual(people('admin-b'));
    expect(res.body.load).toMatchObject({ routing: 'chosen', company_ids: [ORG.companyB] });
    const ms = Date.parse(res.body.load.quote_deadline) - Date.now();
    expect(ms).toBeGreaterThan(2 * 3600_000 - 60_000);
    expect(ms).toBeLessThanOrEqual(2 * 3600_000);
    // No quote asked for: no deadline
    expect((await post(draft({ routing: 'chosen', company_ids: [ORG.companyB] }))).body.load.quote_deadline).toBeNull();
  });

  it('refuses a chosen load with no company, more than 10, or a company that is not an active logistic company', async () => {
    withPosting();
    expect((await post(draft({ routing: 'chosen', company_ids: [] }))).status).toBe(400);
    expect((await post(draft({ routing: 'chosen', company_ids: Array.from({ length: 11 }, () => ORG.companyA) }))).status).toBe(400);
    for (const bad of [ORG.vendorV, ORG.tplT, ORG.platform, 'c3000000-0000-4000-8000-0000000000aa']) {
      const res = await post(draft({ routing: 'chosen', company_ids: [ORG.companyA, bad] }));
      expect(res.status, bad).toBe(400);
    }
    supabaseMock.rows('organizations').find(o => o.id === ORG.companyB)!.status = 'suspended';
    expect((await post(draft({ routing: 'chosen', company_ids: [ORG.companyB] }))).status).toBe(400);
    expect(supabaseMock.rows('vendor_shipment_requests')).toHaveLength(0);
    expect(told()).toEqual([]);
  });

  it('open ignores company_ids; company_ids alone mean chosen', async () => {
    withPosting();
    expect((await post(draft({ routing: 'open', company_ids: [ORG.companyB] }))).body.load).toMatchObject({ routing: 'open', company_ids: [] });
    expect((await post(draft({ company_ids: [ORG.companyB] }))).body.load).toMatchObject({ routing: 'chosen', company_ids: [ORG.companyB] });
  });

  it('a vendor not yet verified tells nobody; the loads are announced, and the quote clock starts, when the KYC is approved', async () => {
    withPosting('pending');
    supabaseMock.rows('vendor_profiles')[0].kyc_status = 'submitted';
    const res = await post(draft({ routing: 'chosen', company_ids: [ORG.companyB], quote_requested: true }));
    expect(res.status).toBe(201);
    expect(res.body.load.metadata.hold).toBe('vendor_unverified');
    expect(res.body.load.quote_deadline).toBeNull();
    expect(told()).toEqual([]);
    // Held loads reach no company, even through the old pending list
    expect((await request(app).get(api('/vendor/shipment-request/pending')).set(adminB())).body).toEqual([]);

    expect(await releaseHeldLoads(uid('vendor-1'))).toBe(1);
    expect(told()).toEqual(people('admin-b'));
    const released = supabaseMock.rows('vendor_shipment_requests')[0];
    expect(released.metadata.hold).toBeUndefined();
    expect(Date.parse(released.quote_deadline)).toBeGreaterThan(Date.now() + 2 * 3600_000 - 60_000);
  });
});

describe('the documents carrier', () => {
  it('is the load\'s carrier_org_id before any vehicle is assigned, so the winning company can reach the load\'s documents', async () => {
    const docs = (who: Record<string, string>, id = L.awardedA) => request(app).get(api(`/loads/${id}/documents`)).set(who);
    const res = await docs(adminA());
    expect(res.status).toBe(200);
    expect(res.body.load).toMatchObject({ id: L.awardedA, viewer: 'carrier', carrier_org_id: ORG.companyA });
    expect((await docs(adminB())).status).toBe(404);
    expect((await docs(vendor())).body.load).toMatchObject({ viewer: 'vendor', carrier_org_id: ORG.companyA });
    // A load that is not awarded has no carrier: no company can open it
    expect((await docs(adminA(), L.open)).status).toBe(404);
  });

  it('prefers carrier_org_id over the manifest\'s and the vehicle\'s company', async () => {
    supabaseMock.rows('cargo_manifest').push({ id: 'aa110000-0000-4000-8000-0000000000e1', vendor_request_id: L.awardedA, carrier_org_id: ORG.companyB, vehicle_id: 'v1', status: 'scheduled', created_at: new Date().toISOString() });
    const res = await request(app).get(api(`/loads/${L.awardedA}/documents`)).set(adminA());
    expect(res.body.load.carrier_org_id).toBe(ORG.companyA);
    expect((await request(app).get(api(`/loads/${L.awardedA}/documents`)).set(adminB())).status).toBe(404);
  });

  it('opens the load page of a company that won it before it has a vehicle', async () => {
    const res = await request(app).get(api(`/vendor/loads/${L.awardedA}`)).set(adminA());
    expect(res.status).toBe(200);
    expect(res.body.load.id).toBe(L.awardedA);
    expect((await request(app).get(api(`/vendor/loads/${L.awardedA}`)).set(adminB())).status).toBe(404);
  });
});
