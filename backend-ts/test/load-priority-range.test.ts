/**
 * Priority and the recommended freight range (docs/order-routing.md): the server works the range out on create, a company
 * books inside it, the board is ordered by priority, and a high priority load goes first to the biggest network.
 * The database is the mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { L, loadRow, notesFor, routingWorld } from './support/routing-world';
import { draft } from './support/load-draft';
import { goodsTables } from './support/goods-world';
import { marketFreightService } from '../src/services/goods/freight';
import { networkSizeScorer, notifyCompanies, rankCompanies } from '../src/services/loads/order-routing';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const adminA = () => as('admin-a', ORG.companyA);
const adminB = () => as('admin-b', ORG.companyB);
const accept = (who: Record<string, string>, id: string, body: object = {}) => request(app).post(api(`/company/loads/${id}/accept`)).set(who).send(body);
const okQuote = (low: number, high: number) => ({ status: 'ok', low, high, distance_km: 1400, suggested: (low + high) / 2 }) as any;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('posting a load', () => {
  let seq = 0;
  function world() {
    seq = 0;
    supabaseMock.reset(orgWorld({ vendor_profiles: [{ id: uid('vendor-1'), kyc_status: 'approved' }], vendor_shipment_requests: [], load_items: [], cargo_manifest: [], ...goodsTables() }));
    supabaseMock.rpcHandlers.set('create_vendor_load', ({ p }: any) => {
      const row = { id: randomUUID(), status: 'pending', created_at: new Date().toISOString(), ...p.load, load_number: `MRX-2026-${String(++seq).padStart(5, '0')}` };
      supabaseMock.rows('vendor_shipment_requests').push(row);
      p.items.forEach((i: any, n: number) => supabaseMock.rows('load_items').push({ id: randomUUID(), load_id: row.id, line_no: n + 1, ...i }));
      return { ...row, duplicate: false };
    });
  }
  const post = (body: unknown) => request(app).post(api('/vendor/loads')).set(as('vendor-1')).send(body as object);
  beforeEach(world);

  it('works the recommended range out on the server (whole rupees) and ignores a range the client sends', async () => {
    const quote = vi.spyOn(marketFreightService, 'estimate').mockResolvedValue(okQuote(41234.4, 52999.6));
    const res = await post(draft({ price_min_inr: 1, price_max_inr: 2 }));
    expect(res.status).toBe(201);
    expect(quote).toHaveBeenCalledTimes(1);
    const { load } = supabaseMock.rpcCalls[0].args.p;
    expect(load.price_min_inr).toBe(41234);
    expect(load.price_max_inr).toBe(53000);
    expect(res.body).toMatchObject({ priority: 'medium', price_min_inr: 41234, price_max_inr: 53000 });
  });

  it('leaves the range empty (and still posts) when no estimate can be made', async () => {
    vi.spyOn(marketFreightService, 'estimate').mockRejectedValue(new Error('routing down'));
    const res = await post(draft());
    expect(res.status).toBe(201);
    const { load } = supabaseMock.rpcCalls[0].args.p;
    expect(load.price_min_inr).toBeNull();
    expect(load.price_max_inr).toBeNull();
    expect(res.body.price_min_inr).toBeNull();
  });

  it('puts a newly posted vendor load into the logistic company New loads board immediately', async () => {
    vi.spyOn(marketFreightService, 'estimate').mockResolvedValue(okQuote(1000, 2000));
    const made = await post(draft());
    expect(made.status).toBe(201);
    const board = await request(app).get(api('/company/loads/market?tab=new')).set(adminA());
    expect(board.status).toBe(200);
    expect(board.body.items.find((load: any) => load.id === made.body.id)).toMatchObject({ status: 'pending', price_min_inr: 1000, price_max_inr: 2000 });
  });

  it('defaults the priority to medium, stores the one given, and refuses an unknown one', async () => {
    vi.spyOn(marketFreightService, 'estimate').mockResolvedValue(okQuote(1000, 2000));
    expect((await post(draft())).status).toBe(201);
    expect(supabaseMock.rpcCalls[0].args.p.load.priority).toBe('medium');
    const high = await post(draft({ priority: 'high' }));
    expect(high.body.priority).toBe('high');
    expect(supabaseMock.rpcCalls[1].args.p.load.priority).toBe('high');
    expect((await post(draft({ priority: 'urgent' }))).status).toBe(400);
  });

  it('is a direct-book load when the form sends no quote request and no budget', async () => {
    vi.spyOn(marketFreightService, 'estimate').mockResolvedValue(okQuote(1000, 2000));
    await post(draft());
    const { load } = supabaseMock.rpcCalls[0].args.p;
    expect(load.quote_requested).toBe(false);
    expect(load.budget_inr).toBeNull();
  });

  it('repost keeps the priority, and the vendor views show it with the range', async () => {
    vi.spyOn(marketFreightService, 'estimate').mockResolvedValue(okQuote(1000, 2000));
    const made = await post(draft({ priority: 'low' }));
    const again = await request(app).post(api(`/vendor/loads/${made.body.id}/repost`)).set(as('vendor-1'));
    expect(again.status).toBe(200);
    expect(again.body.draft.priority).toBe('low');
    const one = await request(app).get(api(`/vendor/loads/${made.body.id}`)).set(as('vendor-1'));
    expect(one.body.load).toMatchObject({ priority: 'low', price_min_inr: 1000, price_max_inr: 2000 });
    const mine = await request(app).get(api('/vendor/loads/mine')).set(as('vendor-1'));
    expect(mine.body.items[0]).toMatchObject({ priority: 'low', price_min_inr: 1000, price_max_inr: 2000 });
    const board = await request(app).get(api('/vendor/loads')).set(as('vendor-1'));
    expect(board.body.find((l: any) => l.id === made.body.id)).toMatchObject({ priority: 'low', price_min_inr: 1000, price_max_inr: 2000 });
  });
});

describe('booking inside the range', () => {
  beforeEach(() => {
    routingWorld();
    Object.assign(supabaseMock.rows('vendor_shipment_requests').find(r => r.id === L.open)!, { budget_inr: null, price_min_inr: 18000, price_max_inr: 24000 });
  });

  it('awards at an amount inside the range, bounds included', async () => {
    const res = await accept(adminA(), L.open, { amount_inr: 24000 });
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ status: 'accepted', amount_inr: 24000 });
  });

  it('refuses an amount outside the range, or none, with the range in the message', async () => {
    for (const body of [{ amount_inr: 17999 }, { amount_inr: 24001 }, {}]) {
      const res = await accept(adminA(), L.open, body);
      expect(res.status).toBe(400);
      expect(res.body.detail ?? res.body.error ?? JSON.stringify(res.body)).toMatch(/18,000.*24,000/);
    }
    expect(supabaseMock.rows('vendor_shipment_requests').find(r => r.id === L.open)!.carrier_org_id).toBeNull();
  });

  it('keeps the old behaviour for a load without a range (budget, or the amount given)', async () => {
    const res = await accept(adminA(), L.chosenB, {});
    expect(res.status).toBe(404); // chosen for Beta, not Alpha
    const ok = await accept(adminB(), L.chosenB, {});
    expect(ok.status).toBe(200);
    expect(ok.body.quote.amount_inr).toBe(20000);
  });
});

describe('the board', () => {
  it('orders by priority, then pickup date, then newest, and shows the range', async () => {
    routingWorld({
      vendor_shipment_requests: [
        loadRow(L.open, { priority: 'low', pickup_date: '2026-12-01', price_min_inr: 100, price_max_inr: 200 }),
        loadRow(L.chosenB, { priority: 'high', pickup_date: '2026-12-09', routing: 'open' }),
        loadRow(L.awardedA, { priority: 'high', pickup_date: '2026-12-03', status: 'approved', carrier_org_id: ORG.companyB }),
        loadRow(L.held, { priority: 'medium', pickup_date: '2026-12-02', metadata: { hold: 'vendor_unverified' } }),
        loadRow(L.quoteReq, { priority: 'medium', pickup_date: '2026-12-02', created_at: '2099-01-01T00:00:00Z' }),
        loadRow(L.cancelled, { priority: 'medium', pickup_date: '2026-12-02', status: 'cancelled' }),
      ],
    });
    const res = await request(app).get(api('/company/loads/market?tab=new')).set(adminA());
    expect(res.status).toBe(200);
    // held, cancelled and the awarded load are not on the board
    expect(res.body.items.map((i: any) => i.id)).toEqual([L.chosenB, L.quoteReq, L.open]);
    expect(res.body.items[2]).toMatchObject({ priority: 'low', price_min_inr: 100, price_max_inr: 200 });
    expect(res.body.items[0]).not.toHaveProperty('network_vehicles');
    const one = await request(app).get(api(`/company/loads/${L.open}`)).set(adminA());
    expect(one.body).toMatchObject({ priority: 'low', price_min_inr: 100, price_max_inr: 200 });
  });

  it('shows the network size to platform staff only', async () => {
    routingWorld({ vehicles: [{ id: 'v1', carrier_org_id: ORG.companyA, status: 'idle' }, { id: 'v2', carrier_org_id: ORG.companyA, status: 'archived' }] });
    const staff = await request(app).get(api('/company/loads/market')).set(as('super-1', ORG.companyA));
    expect(staff.status).toBe(200);
    expect(staff.body.items[0].network_vehicles).toBe(1);
    const company = await request(app).get(api('/company/loads/market')).set(adminA());
    expect(company.body.items[0]).not.toHaveProperty('network_vehicles');
  });
});

describe('ranking by network size', () => {
  const vehicle = (org: string, status = 'idle') => ({ id: randomUUID(), carrier_org_id: org, status });
  const affiliation = (company: string, tpl: string, status = 'active') => ({ company_id: company, tpl_id: tpl, status });

  it('counts own active vehicles plus those of active affiliated 3PL partners', async () => {
    routingWorld({
      vehicles: [vehicle(ORG.companyA), vehicle(ORG.companyA, 'archived'), vehicle(ORG.companyB), vehicle(ORG.tplT), vehicle(ORG.tplT), vehicle(ORG.tplT, 'pending_approval')],
      tpl_affiliations: [affiliation(ORG.companyB, ORG.tplT), affiliation(ORG.companyA, ORG.tplT, 'paused')],
    });
    const sizes = await networkSizeScorer([ORG.companyA, ORG.companyB]);
    expect(sizes.get(ORG.companyA)).toBe(1);
    expect(sizes.get(ORG.companyB)).toBe(3);
    expect((await rankCompanies([ORG.companyA, ORG.companyB])).map(r => r.id)).toEqual([ORG.companyB, ORG.companyA]);
  });

  it('breaks a tie the same way every time', async () => {
    routingWorld({ vehicles: [] });
    const a = await rankCompanies([ORG.companyB, ORG.companyA]);
    const b = await rankCompanies([ORG.companyA, ORG.companyB]);
    expect(a.map(r => r.id)).toEqual(b.map(r => r.id));
  });

  it('tells a high priority load to the biggest network first and marks it urgent; medium and low are told with their priority', async () => {
    routingWorld({ vehicles: [vehicle(ORG.companyB), vehicle(ORG.companyB), vehicle(ORG.companyA)] });
    // Both companies are sent the load (a chosen load; an open one goes to the companies serving its lane)
    const both = { routing: 'chosen', company_ids: [ORG.companyA, ORG.companyB] };
    const high = loadRow(L.open, { priority: 'high', load_number: 'MRX-1', ...both });
    await notifyCompanies(high);
    const order = supabaseMock.rows('notifications').map(r => r.user_id);
    // Beta (2 vehicles) is told before Alpha (1): Beta's owner first, every Alpha person after
    expect(order[0]).toBe(uid('admin-b'));
    expect(order.indexOf(uid('admin-a'))).toBeGreaterThan(order.indexOf(uid('admin-b')));
    const n = notesFor('admin-b', 'vendor_request')[0];
    expect(n.title).toMatch(/^Urgent/);
    expect(n.data).toMatchObject({ priority: 'high', urgent: true });

    await notifyCompanies(loadRow(L.quoteReq, { priority: 'low', load_number: 'MRX-2', ...both }));
    const low = notesFor('admin-a', 'vendor_request').find(x => x.data.load_number === 'MRX-2')!;
    expect(low.data).toMatchObject({ priority: 'low' });
    expect(low.data.urgent).toBeUndefined();
    expect(low.title).not.toMatch(/Urgent/);
  });
});
