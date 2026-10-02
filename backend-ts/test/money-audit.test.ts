/**
 * Money audit on the hosted test stage (docs/uat/findings/MONEY.md): what the walk found, kept from coming back.
 *  - PATCH /org stores the invoicing identity only the way Settings does (validated, one prefix per company)
 *  - an expense receipt is a file that was really uploaded and that no other expense holds
 *  - "Invoice not issued" tells the ISSUING company's admins, not whoever delivered
 *  - a company with nothing set is not invoiced under the platform-wide profile (only the default company is)
 *  - a settled partial delivery can be invoiced from the To price list
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { InvoiceService } from '../src/services/invoice.service';
import { getCompanyProfile, invoicePrefixFor } from '../src/services/company.service';
import { ID, auth, cargoWorld, shipmentRow } from './support/cargo-world';
import { ORG, ORGS, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const TODAY = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const SELLER_MH = '27AAPFU0939F1ZV';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('PATCH /org: the invoicing identity is validated like Settings does it', () => {
  beforeEach(() => supabaseMock.reset(orgWorld()));
  const patch = (who: string, org: string, body: object) => request(app).patch(api('/org')).set(as(who, org)).send(body);
  const profileOf = (org: string) => supabaseMock.rows('organizations').find(o => o.id === org)!.profile as Record<string, unknown>;

  it('refuses a made-up GST option, a bad IFSC and a bad prefix, and stores nothing', async () => {
    expect((await patch('admin-a', ORG.companyA, { profile: { gta_gst_option: 'banana' } })).status).toBe(400);
    expect((await patch('admin-a', ORG.companyA, { profile: { bank_ifsc: 'nope' } })).status).toBe(400);
    expect((await patch('admin-a', ORG.companyA, { profile: { invoice_prefix: 'x' } })).status).toBe(400);
    expect(profileOf(ORG.companyA)).toEqual({});
  });

  it('stores the prefix upper-case and trimmed, and the terms and bank as numbers and text', async () => {
    const res = await patch('admin-a', ORG.companyA, { profile: { invoice_prefix: ' mi1 ', payment_terms_days: 10, bank_name: 'HDFC Bank', gta_gst_option: 'fcm_5' } });
    expect(res.status).toBe(200);
    expect(profileOf(ORG.companyA)).toMatchObject({ invoice_prefix: 'MI1', payment_terms_days: 10, bank_name: 'HDFC Bank', gta_gst_option: 'fcm_5' });
  });

  it('two companies never share a prefix, in any case', async () => {
    await patch('admin-a', ORG.companyA, { profile: { invoice_prefix: 'MI1' } });
    expect((await patch('admin-b', ORG.companyB, { profile: { invoice_prefix: 'mi1' } })).status).toBe(409);
    expect(profileOf(ORG.companyB).invoice_prefix).toBeUndefined();
  });

  it('keeps other profile keys as they are and still merges them', async () => {
    supabaseMock.rows('organizations').find(o => o.id === ORG.companyA)!.profile = { settings: { fuel: 1 }, reject_reason: 'old' };
    await patch('admin-a', ORG.companyA, { profile: { invoice_prefix: 'ALP', note: 'hello' } });
    expect(profileOf(ORG.companyA)).toMatchObject({ settings: { fuel: 1 }, reject_reason: 'old', invoice_prefix: 'ALP', note: 'hello' });
  });
});

describe('a prefix a company gave up is not free', () => {
  beforeEach(() => supabaseMock.reset(orgWorld({
    // Alpha issued under BF (the prefix Beta's name would give) and has since changed its prefix to ALP
    organizations: ORGS.map(o => (o.id === ORG.companyA ? { ...o, profile: { invoice_prefix: 'ALP' } } : o.id === ORG.companyB ? { ...o, legal_name: 'Beta Freight LLP' } : { ...o })),
    invoice_counters: [{ org_id: ORG.companyA, prefix: 'BF', period: '202610', last_seq: 4 }],
  })));

  it('another company cannot take it, and a derived prefix skips it', async () => {
    const taken = await request(app).put(api('/finance/company')).set(as('admin-b', ORG.companyB)).send({ invoice_prefix: 'bf' });
    expect(taken.status).toBe(409);
    expect(await invoicePrefixFor(ORG.companyB)).toBe('BF2');
    // the company that used it may take it back
    expect((await request(app).put(api('/finance/company')).set(as('admin-a', ORG.companyA)).send({ invoice_prefix: 'bf' })).status).toBe(200);
  });
});

describe('expense receipts', () => {
  const orgs = () => orgWorld({ expenses: [], vehicles: [], routes: [] });
  beforeEach(() => supabaseMock.reset(orgs()));
  const post = (who: string, org: string, body: object) => request(app).post(api('/finance/expenses')).set(as(who, org)).send({ category: 'fuel', amount: 100, expense_date: TODAY, ...body });
  const upload = async (who: string, org: string) => (await request(app).post(api('/finance/expenses/receipt-upload')).set(as(who, org)).send({ content_type: 'image/png', size: 100 })).body.path as string;

  it('refuses a receipt path that was never uploaded', async () => {
    const res = await post('admin-a', ORG.companyA, { receipt_path: 'expenses/6f9619ff-8b86-4011-b42d-00c04fc964ff/receipt_6f9619ff-8b86-4011-b42d-00c04fc964fe.png' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/not uploaded/);
    expect(supabaseMock.rows('expenses')).toHaveLength(0);
  });

  it('accepts an uploaded receipt once, and refuses it on a second expense, of any company', async () => {
    const path = await upload('admin-a', ORG.companyA);
    const first = await post('admin-a', ORG.companyA, { receipt_path: path });
    expect([first.status, first.body.detail]).toEqual([201, undefined]);
    const again = await post('admin-a', ORG.companyA, { receipt_path: path });
    expect(again.status).toBe(400);
    expect(again.body.detail).toMatch(/already attached/);
    expect((await post('admin-b', ORG.companyB, { receipt_path: path })).status).toBe(400);
    expect(supabaseMock.rows('expenses')).toHaveLength(1);
  });

  it('an edit that keeps the receipt it has is fine', async () => {
    const path = await upload('admin-a', ORG.companyA);
    const made = await post('admin-a', ORG.companyA, { receipt_path: path });
    const edit = await request(app).put(api(`/finance/expenses/${made.body.id}`)).set(as('admin-a', ORG.companyA)).send({ amount: 150, receipt_path: path });
    expect(edit.status).toBe(200);
    expect(edit.body.amount).toBe(150);
  });
});

describe('invoicing a company that has no profile yet', () => {
  const SHIP_B = '50000000-0000-4000-8000-0000000000b1';
  const SHIP_A = '50000000-0000-4000-8000-0000000000a1';
  const world = (profiles: Record<string, Row>) => {
    const ships = [
      shipmentRow(SHIP_A, { status: 'delivered', bid_id: 'bid-a', carrier_org_id: ORG.companyA, tracking_id: 'RTX-A1' }),
      shipmentRow(SHIP_B, { status: 'delivered', bid_id: 'bid-b', carrier_org_id: ORG.companyB, tracking_id: 'RTX-B1' }),
    ];
    supabaseMock.reset(cargoWorld({
      ...orgWorld(),
      users: [...cargoWorld().users, ...orgWorld().users],
      organizations: ORGS.map(o => ({ ...o, profile: profiles[o.id] ?? {} })),
      shipments: ships,
      capacity_bids: [{ id: 'bid-a', vendor_id: ID.vendor, bid_amount: 1000, status: 'won' }, { id: 'bid-b', vendor_id: ID.vendor, bid_amount: 2000, status: 'won' }],
      vendor_profiles: [{ id: ID.vendor, company_name: 'Acme', gst_number: SELLER_MH }],
      system_settings: [
        ...orgWorld().system_settings,
        { key: 'company_profile', value: { value: { legal_name: 'Platform Co', gstin: SELLER_MH, state: 'Maharashtra' } } },
      ],
    }));
  };

  it('only the default company is issued under the platform-wide profile; another company with nothing set is refused', async () => {
    world({});
    expect(await getCompanyProfile(ORG.companyA)).toMatchObject({ legal_name: 'Platform Co' });
    expect(await getCompanyProfile(ORG.companyB)).toMatchObject({ legal_name: null, gstin: null });
    await expect(InvoiceService.createForShipment(SHIP_B)).rejects.toMatchObject({ status: 409, extra: { code: 'company_profile_incomplete' } });
    expect(supabaseMock.rows('invoices')).toHaveLength(0);
    await InvoiceService.createForShipment(SHIP_A);
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
  });

  it('"Invoice not issued" reaches the issuing company\'s admins (and the platform owner), not another company\'s', async () => {
    world({});
    await InvoiceService.onShipmentDelivered(SHIP_B);
    // the notice is sent in the background: wait for it
    await vi.waitFor(() => expect(supabaseMock.rows('notifications').filter(n => n.type === 'invoice_blocked')).not.toHaveLength(0));
    await new Promise(r => setTimeout(r, 50));
    const told = supabaseMock.rows('notifications').filter(n => n.type === 'invoice_blocked').map(n => n.user_id).sort();
    expect(told).toEqual([uid('admin-b'), uid('super-1')].sort());
    expect(supabaseMock.rows('notifications').find(n => n.type === 'invoice_blocked')!.data).toMatchObject({ link: '/admin/settings' });
  });
});

describe('a partial delivery in the To price list', () => {
  const partial = (over: Row = {}) => shipmentRow(ID.s1, {
    status: 'partially_delivered', pieces_total: 10, pieces_delivered: 6, pieces_short: 3, pieces_returned: 1, current_holder: 'consignee', current_vehicle_id: null, freight_charge: 5000.5, ...over,
  });
  const create = () => request(app).post(api('/finance/invoices')).set(auth.admin()).send({ shipment_id: ID.s1 });

  it('invoices a settled one for its price, with the short and refused pieces on the notes', async () => {
    supabaseMock.reset(cargoWorld({ shipments: [partial()], customer_bookings: [] }));
    const res = await create();
    expect(res.status).toBe(201);
    const inv = supabaseMock.rows('invoices')[0];
    expect(inv.amount).toBe(5000.5);
    expect(inv.notes).toMatch(/6 of 10 pieces delivered, 3 short, 1 refused or returned/);
  });

  it('says why when pieces are still on a vehicle, instead of "no price"', async () => {
    supabaseMock.reset(cargoWorld({ shipments: [partial({ pieces_delivered: 4, current_holder: 'vehicle', current_vehicle_id: ID.v1 })], customer_bookings: [] }));
    const res = await create();
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/still on a vehicle/);
    expect(supabaseMock.rows('invoices')).toHaveLength(0);
  });
});
