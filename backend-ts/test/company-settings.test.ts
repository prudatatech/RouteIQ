/**
 * Phase 2: each logistic company has its own invoicing identity, invoice numbers and operational settings.
 *  - invoices are issued with the issuing company's prefix and sequence, and its seller details
 *  - the GST split compares the issuing company's state with the buyer's
 *  - settings fall back company -> platform default; one company's edits never reach another
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { InvoiceService } from '../src/services/invoice.service';
import { derivePrefix, getCompanyProfile, saveCompanyProfile, invoicePrefixFor } from '../src/services/company.service';
import { getPeopleSettings, savePeopleSettings } from '../src/services/people-settings.service';
import { getFinanceSettings } from '../src/services/finance.service';
import { readPricingSettings } from '../src/services/pricing.service';
import { ID, cargoWorld, one, shipmentRow } from './support/cargo-world';
import { ORG, ORGS, ORG_SETTINGS, as, orgWorld } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const BUYER_MH = '27AAACR5055K1Z7';
const BUYER_GJ = '24AAACC1206D1ZM';
const SELLER_MH = '27AAPFU0939F1ZV';
const SELLER_GJ = '24AAACC1206D1ZM';
const month = (() => { const d = new Date(Date.now() + 330 * 60_000); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

const orgRows = (profiles: Record<string, Record<string, unknown>>) =>
  ORGS.map(o => ({ ...o, profile: profiles[o.id] ?? {} }));

const ALPHA = { legal_name: 'Alpha Logistics Pvt Ltd', gstin: SELLER_MH, state: 'Maharashtra', address: 'Plot 1, Pune', sac_code: '996511', payment_terms_days: 30 };
const BETA = { legal_name: 'Beta Freight LLP', gstin: SELLER_GJ, state: 'Gujarat', address: 'Unit 9, Surat', sac_code: '996512', payment_terms_days: 7 };

/** Two delivered shipments per company, each with a won bid by the one vendor, billed at 18% GST. */
function twoCompanyWorld(profiles = { [ORG.companyA]: { ...ALPHA, invoice_prefix: 'ALP' }, [ORG.companyB]: BETA }, buyerGstin = BUYER_MH) {
  const rows = ['a1', 'a2', 'b1', 'b2'].map(k => shipmentRow(`50000000-0000-4000-8000-0000000000${k}`, {
    tracking_id: `RTX-${k.toUpperCase()}`, status: 'delivered', bid_id: `bid-${k}`, carrier_org_id: k.startsWith('a') ? ORG.companyA : ORG.companyB,
  }));
  supabaseMock.reset(cargoWorld({
    ...orgWorld(),
    users: [...cargoWorld().users, ...orgWorld().users],
    organizations: orgRows(profiles),
    shipments: rows,
    capacity_bids: rows.map((r, i) => ({ id: `bid-${r.tracking_id.slice(4).toLowerCase()}`, vendor_id: ID.vendor, bid_amount: 1000 * (i + 1), status: 'won' })),
    vendor_profiles: [{ id: ID.vendor, company_name: 'Acme Logistics', gst_number: buyerGstin, address: '12 MIDC Road', city: 'Pune' }],
    shipment_hsn: rows.map((r, i) => ({ id: `h${i}`, shipment_id: r.id, hsn_code: '8471', gst_rate: 18 })),
    system_settings: [...ORG_SETTINGS],
  }));
  return rows.map(r => r.id as string);
}

describe('invoice numbers belong to the issuing company', () => {
  it('each company counts from 0001 under its own prefix, in the month of issue', async () => {
    const [a1, a2, b1, b2] = twoCompanyWorld();
    for (const id of [a1, b1, a2, b2]) await InvoiceService.createForShipment(id);
    const byShipment = (id: string) => supabaseMock.rows('invoices').find(i => i.shipment_id === id)!;
    expect(byShipment(a1).invoice_number).toBe(`ALP-${month}-0001`);
    expect(byShipment(a2).invoice_number).toBe(`ALP-${month}-0002`);
    // Beta set no prefix: it is derived from the name ("Beta Freight LLP" -> BF) and then kept
    expect(byShipment(b1).invoice_number).toBe(`BF-${month}-0001`);
    expect(byShipment(b2).invoice_number).toBe(`BF-${month}-0002`);
    expect(supabaseMock.rows('organizations').find(o => o.id === ORG.companyB)!.profile.invoice_prefix).toBe('BF');
    const numbers = supabaseMock.rows('invoices').map(i => i.invoice_number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(byShipment(a1).issuer_org_id).toBe(ORG.companyA);
    expect(byShipment(b1).issuer_org_id).toBe(ORG.companyB);
  });

  it('keeps counting after the numbers already issued', async () => {
    const [a1] = twoCompanyWorld();
    supabaseMock.rows('invoices').push({ id: 'old', invoice_number: `ALP-${month}-0041`, shipment_id: 'x', status: 'paid', issuer_org_id: ORG.companyA });
    await InvoiceService.createForShipment(a1);
    expect(supabaseMock.rows('invoices').find(i => i.shipment_id === a1)!.invoice_number).toBe(`ALP-${month}-0042`);
  });

  it('a prefix two companies would share gets a digit, so numbers stay unique across the platform', async () => {
    twoCompanyWorld({ [ORG.companyA]: { ...ALPHA }, [ORG.companyB]: { ...BETA, legal_name: 'Alpha Freight Lines' } });
    expect(await invoicePrefixFor(ORG.companyA)).toBe('AL');
    expect(await invoicePrefixFor(ORG.companyB)).toBe('AFL');
    twoCompanyWorld({ [ORG.companyA]: { ...ALPHA, invoice_prefix: 'ABC' }, [ORG.companyB]: { ...BETA, legal_name: 'Alpha Beta Cargo' } });
    expect(await invoicePrefixFor(ORG.companyB)).toBe('ABC2');
  });

  it('derives the default prefix from the name', () => {
    expect(derivePrefix('MargixIndia Logistics')).toBe('MIL');
    expect(derivePrefix('Beta Freight Pvt Ltd')).toBe('BF');
    expect(derivePrefix('Sumeru')).toBe('SUM');
    expect(derivePrefix('')).toBe('INV');
  });
});

describe('the invoice uses the issuing company\'s profile', () => {
  it('the GST split compares the issuer\'s state with the buyer\'s: the same buyer is intra for one company and inter for another', async () => {
    const [a1, , b1] = twoCompanyWorld();
    await InvoiceService.createForShipment(a1);
    await InvoiceService.createForShipment(b1);
    const inv = (id: string) => supabaseMock.rows('invoices').find(i => i.shipment_id === id)!;
    const asAdmin = as('super-1', ORG.platform);
    const a = await request(app).get(api(`/invoices/${inv(a1).id}`)).set(asAdmin);
    const b = await request(app).get(api(`/invoices/${inv(b1).id}`)).set(asAdmin);
    expect(a.body.tax).toMatchObject({ basis: 'intra', cgst: 90, sgst: 90 });
    expect(b.body.tax).toMatchObject({ basis: 'inter' });
    // and the document names its own seller, bank terms and due date
    expect(a.body.seller).toMatchObject({ legal_name: ALPHA.legal_name, gstin: SELLER_MH });
    expect(b.body.seller).toMatchObject({ legal_name: BETA.legal_name, gstin: SELLER_GJ });
    expect(Date.parse(inv(a1).due_date) - Date.parse(inv(a1).issued_at)).toBe(30 * 86_400_000);
    expect(Date.parse(inv(b1).due_date) - Date.parse(inv(b1).issued_at)).toBe(7 * 86_400_000);
  });

  it('is not issued until the issuing company has its own name, GSTIN and state (409 from the company, not the platform)', async () => {
    const [a1, , b1] = twoCompanyWorld({ [ORG.companyA]: { ...ALPHA }, [ORG.companyB]: { legal_name: 'Beta Freight LLP' } });
    // the platform profile is complete, but it is not Beta's: Beta has a name, so it does not fall back
    supabaseMock.rows('system_settings').push({ key: 'company_profile', value: { value: { legal_name: 'Platform Co', gstin: SELLER_MH, state: 'Maharashtra' } } });
    await expect(InvoiceService.createForShipment(b1)).rejects.toMatchObject({ status: 409, extra: { missing: ['GSTIN', 'state'] } });
    await InvoiceService.createForShipment(a1);
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
  });

  it('GET and PUT /finance/company read and write the company the person acts for', async () => {
    twoCompanyWorld();
    const put = await request(app).put(api('/finance/company')).set(as('admin-b')).send({ legal_name: 'Beta Freight Pvt Ltd', upi_id: 'beta@upi', invoice_prefix: 'bet' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ legal_name: 'Beta Freight Pvt Ltd', gstin: SELLER_GJ, invoice_prefix: 'BET' });
    const a = await request(app).get(api('/finance/company')).set(as('admin-a'));
    expect(a.body).toMatchObject({ legal_name: ALPHA.legal_name, upi_id: null, invoice_prefix: 'ALP' });
    const row = supabaseMock.rows('organizations').find(o => o.id === ORG.companyB)!;
    expect(row).toMatchObject({ legal_name: 'Beta Freight Pvt Ltd', gstin: SELLER_GJ, state: 'Gujarat' });
    expect(row.profile).toMatchObject({ upi_id: 'beta@upi', invoice_prefix: 'BET', sac_code: '996512' });
    // a prefix another company has is refused
    const clash = await request(app).put(api('/finance/company')).set(as('admin-b')).send({ invoice_prefix: 'ALP' });
    expect(clash.status).toBe(409);
    // the platform-wide profile was not touched
    expect(supabaseMock.rows('system_settings').find(r => r.key === 'company_profile')).toBeUndefined();
  });
});

describe('the profile fallback', () => {
  beforeEach(() => twoCompanyWorld({ [ORG.companyA]: {}, [ORG.companyB]: BETA }));

  it('a company with nothing set uses the platform-wide profile; one with details uses its own', async () => {
    supabaseMock.rows('system_settings').push({ key: 'company_profile', value: { value: { legal_name: 'Platform Co', gstin: SELLER_MH, state: 'Maharashtra', payment_terms_days: 20 } } });
    expect(await getCompanyProfile(ORG.companyA)).toMatchObject({ legal_name: 'Platform Co', payment_terms_days: 20 });
    expect(await getCompanyProfile(ORG.companyB)).toMatchObject({ legal_name: BETA.legal_name, payment_terms_days: 7 });
    expect(await getCompanyProfile(null)).toMatchObject({ legal_name: 'Platform Co' });
  });

  it('saving for a company with nothing set writes only what was sent, never the platform profile', async () => {
    supabaseMock.rows('system_settings').push({ key: 'company_profile', value: { value: { legal_name: 'Platform Co', gstin: SELLER_MH } } });
    await saveCompanyProfile({ legal_name: 'Alpha Own' }, ORG.companyA);
    const row = supabaseMock.rows('organizations').find(o => o.id === ORG.companyA)!;
    expect(row.legal_name).toBe('Alpha Own');
    expect(row.gstin).toBeNull();
    expect(await getCompanyProfile(ORG.companyA)).toMatchObject({ legal_name: 'Alpha Own', gstin: null });
  });
});

describe('operational settings: company, then platform default', () => {
  const setting = (key: string, value: unknown) => ({ key, value });

  beforeEach(() => {
    supabaseMock.reset(orgWorld({
      organizations: orgRows({ [ORG.companyA]: { settings: { fuel_price_per_litre: 101, rate_per_km: 30, load_multiplier_fragile: 1.4, licence_grace_days: 10 } } }),
      system_settings: [
        ...ORG_SETTINGS,
        setting('fuel_price_per_litre', { price: 92 }), setting('rate_per_km', { rate: 20 }), setting('load_multiplier_fragile', '1.2'), setting('load_multiplier_heavy', '1.5'),
        setting('licence_grace_days', { value: 3 }), setting('document_retention_days', { value: 400 }),
        setting('dispatch_phone', { phone: '+919000000000' }),
      ],
    }));
  });

  it('the company\'s own value wins, key by key; the rest is the platform default', async () => {
    // outside a request the default company (A) is the scope
    expect(await getFinanceSettings()).toEqual({ fuel_price_per_litre: 101, rate_per_km: 30 });
    expect(await readPricingSettings(ORG.companyA)).toMatchObject({ fuel_price_per_litre: 101, rate_per_km: 30, load_multiplier_fragile: 1.4, load_multiplier_heavy: 1.5 });
    // company B set nothing: all platform defaults
    expect(await readPricingSettings(ORG.companyB)).toMatchObject({ fuel_price_per_litre: 92, rate_per_km: 20, load_multiplier_fragile: 1.2, load_multiplier_heavy: 1.5 });
    // the platform scope is the defaults
    expect(await readPricingSettings(null)).toMatchObject({ fuel_price_per_litre: 92, rate_per_km: 20 });
    expect(await getPeopleSettings({ orgId: ORG.companyA })).toMatchObject({ licence_grace_days: 10, document_retention_days: 400, driver_document_enforcement: 'warn' });
    expect(await getPeopleSettings({ orgId: ORG.companyB })).toMatchObject({ licence_grace_days: 3, document_retention_days: 400 });
  });

  it('the pricing settings endpoint shows and saves the company\'s own values, leaving the defaults alone', async () => {
    const before = await request(app).get(api('/pricing/settings')).set(as('admin-b'));
    expect(before.body.settings).toMatchObject({ rate_per_km: 20 });
    const put = await request(app).put(api('/pricing/settings')).set(as('admin-b')).send({ settings: { rate_per_km: 25, min_charge: 500 } });
    expect(put.status).toBe(200);
    expect(put.body.settings).toMatchObject({ rate_per_km: 25, min_charge: 500, load_multiplier_heavy: 1.5 });
    const a = await request(app).get(api('/pricing/settings')).set(as('admin-a'));
    expect(a.body.settings).toMatchObject({ rate_per_km: 30 });
    expect(a.body.settings.min_charge).toBeUndefined();
    expect(supabaseMock.rows('system_settings').find(r => r.key === 'rate_per_km')!.value).toEqual({ rate: 20 });
    expect(supabaseMock.rows('organizations').find(o => o.id === ORG.companyB)!.profile.settings).toEqual({ rate_per_km: 25, min_charge: 500 });
    // clearing a company's value returns it to the default
    const cleared = await request(app).put(api('/pricing/settings')).set(as('admin-b')).send({ settings: { rate_per_km: null } });
    expect(cleared.body.settings.rate_per_km).toBe(20);
  });

  it('fuel price, dispatch phone and people settings save per company; the platform org edits the defaults', async () => {
    expect((await request(app).put(api('/finance/settings')).set(as('admin-b')).send({ fuel_price_per_litre: 99.5 })).body.fuel_price_per_litre).toBe(99.5);
    expect((await request(app).get(api('/finance/settings')).set(as('admin-a'))).body.fuel_price_per_litre).toBe(101);
    expect((await request(app).put(api('/driver/dispatch-contact')).set(as('admin-b')).send({ phone: '+91 98765 43210' })).body.phone).toBe('+919876543210');
    // a driver of company B gets B's number, one of company A the platform default
    expect((await request(app).get(api('/driver/dispatch-contact')).set(as('driver-b'))).body.phone).toBe('+919876543210');
    expect((await request(app).get(api('/driver/dispatch-contact')).set(as('driver-a'))).body.phone).toBe('+919000000000');
    expect((await request(app).put(api('/people/settings')).set(as('admin-b')).send({ driver_document_enforcement: 'block', bank_change_cooldown_hours: 48 })).status).toBe(200);
    expect((await request(app).get(api('/people/settings')).set(as('admin-a'))).body).toMatchObject({ driver_document_enforcement: 'warn', bank_change_cooldown_hours: 24 });
    expect(await getPeopleSettings({ orgId: ORG.companyB })).toMatchObject({ driver_document_enforcement: 'block', bank_change_cooldown_hours: 48 });
    // acting as the platform edits the platform defaults
    expect((await request(app).put(api('/driver/dispatch-contact')).set(as('super-1', ORG.platform)).send({ phone: '+911100000000' })).body.phone).toBe('+911100000000');
    expect(supabaseMock.rows('system_settings').find(r => r.key === 'dispatch_phone')!.value).toEqual({ phone: '+911100000000' });
    await savePeopleSettings({}).catch(() => undefined);
    expect(one('organizations', ORG.companyA).profile.settings.fuel_price_per_litre).toBe(101);
  });
});
