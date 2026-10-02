/**
 * GST on freight (GTA): a freight invoice is taxed at the transporter's rate, chosen by the issuing company
 * (gta_gst_option: rcm_5 reverse charge by default, fcm_5, fcm_18), never at the rate of the goods it carries.
 * Also the MRX load number on the invoice detail and PDF.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { InvoiceService } from '../src/services/invoice.service';
import { saveCompanyProfile, getCompanyProfile } from '../src/services/company.service';
import { gtaTerms } from '../src/core/gst';
import { buildInvoiceDetail } from '../src/services/invoice-detail.service';
import { renderInvoicePdf } from '../src/services/invoice-pdf.service';
import { COMPANY_SETTING, ID, auth, cargoWorld, one } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const SELLER = COMPANY_SETTING.value.value;
const BUYER_MH = '27AAACR5055K1Z7';
/** A goods rate nobody would charge as freight: if it ever shows up on an invoice the rule is broken. */
const GOODS_RATE = 28;

function world(option?: string) {
  supabaseMock.reset(cargoWorld({
    vendor_profiles: [{ id: ID.vendor, company_name: 'Acme Logistics', gst_number: BUYER_MH, address: '12 MIDC Road', city: 'Pune' }],
    system_settings: [{ key: 'company_profile', value: { value: { ...SELLER, ...(option ? { gta_gst_option: option } : {}) } } }],
    shipment_hsn: [{ id: 'h1', manifest_id: ID.m1, load_id: ID.request1, shipment_id: ID.s1, hsn_code: '8703', gst_rate: GOODS_RATE }],
  }));
  Object.assign(one('cargo_manifest', ID.m1), { status: 'delivered' });
  Object.assign(one('shipments', ID.s1), { status: 'delivered', freight_charge: 10000 });
  one('vendor_shipment_requests', ID.request1).metadata = { cargo: { gstRate: GOODS_RATE } };
}
const issued = () => supabaseMock.rows('invoices')[0];

describe('freight GST options', () => {
  it('the terms of each option', () => {
    expect(gtaTerms('rcm_5')).toEqual({ rate: 0, reverse_charge: true, reverse_charge_rate: 5 });
    expect(gtaTerms('fcm_5')).toMatchObject({ rate: 5, reverse_charge: false });
    expect(gtaTerms('fcm_18')).toMatchObject({ rate: 18, reverse_charge: false });
  });

  it.each([
    ['rcm_5', 0, 0, 8000],
    ['fcm_5', 5, 400, 8400],
    ['fcm_18', 18, 1440, 9440],
  ])('a vendor-load invoice under %s: rate %s, GST %s, total %s', async (option, rate, gst, total) => {
    world(option);
    await InvoiceService.createForManifest(ID.m1);
    expect(issued()).toMatchObject({ amount: 8000, gst_rate: rate, gst_amount: gst, total, tax_mode: option });
  });

  it('defaults to reverse charge when the company has not chosen', async () => {
    world();
    expect((await getCompanyProfile(null)).gta_gst_option).toBe('rcm_5');
    await InvoiceService.createForManifest(ID.m1);
    expect(issued()).toMatchObject({ gst_rate: 0, gst_amount: 0, total: 8000, tax_mode: 'rcm_5' });
  });

  it('never uses the goods rate as the freight rate, on a load or on a booking', async () => {
    for (const option of ['rcm_5', 'fcm_5', 'fcm_18']) {
      world(option);
      await InvoiceService.createForManifest(ID.m1);
      await InvoiceService.createForShipment(ID.s1);
      for (const inv of supabaseMock.rows('invoices')) {
        expect(inv.gst_rate).not.toBe(GOODS_RATE);
        expect(inv.gst_rate).toBe(gtaTerms(option as any).rate);
      }
    }
  });

  it('the company chooses the option in its profile, and a wrong value is refused', async () => {
    world();
    const saved = await saveCompanyProfile({ gta_gst_option: 'fcm_5' }, null);
    expect(saved.gta_gst_option).toBe('fcm_5');
    await expect(saveCompanyProfile({ gta_gst_option: 'fcm_12' }, null)).rejects.toThrow(/GST on freight/);
    await InvoiceService.createForManifest(ID.m1);
    expect(issued()).toMatchObject({ gst_rate: 5, tax_mode: 'fcm_5' });
  });

  it('an invoice keeps the amounts it was issued with when the company changes its option later', async () => {
    world('fcm_18');
    await InvoiceService.createForManifest(ID.m1);
    await saveCompanyProfile({ gta_gst_option: 'rcm_5' }, null);
    expect(issued()).toMatchObject({ gst_rate: 18, gst_amount: 1440, tax_mode: 'fcm_18' });
  });
});

describe('reverse charge on the invoice detail and PDF', () => {
  it('says the recipient pays the 5% under rcm_5 and lists the goods for reference', async () => {
    world('rcm_5');
    await InvoiceService.createForManifest(ID.m1);
    const res = await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin());
    expect(res.status).toBe(200);
    expect(res.body.reverse_charge).toEqual({ applies: true, rate: 5, note: 'Tax payable on reverse charge: Yes. GST 5% is payable by the recipient.' });
    expect(res.body.tax.basis).toBe('none');
    expect(res.body.goods).toEqual([{ hsn_code: '8703', description: null, gst_rate: GOODS_RATE }]);
    expect(res.body.lines[0].sac_code).toBe('9965');
  });

  it('shows no reverse-charge line for a forward charge, or for an invoice from before the option', async () => {
    world('fcm_5');
    await InvoiceService.createForManifest(ID.m1);
    const res = await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin());
    expect(res.body.reverse_charge).toEqual({ applies: false, rate: 0, note: null });
    Object.assign(issued(), { tax_mode: null });
    const old = await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin());
    expect(old.body.reverse_charge.applies).toBe(false);
  });

  it('the PDF carries the reverse-charge line only under rcm_5', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, s: any) { written.push(String(s)); return this; });
    try {
      world('rcm_5');
      await InvoiceService.createForManifest(ID.m1);
      await renderInvoicePdf(await buildInvoiceDetail(issued()));
      expect(written).toContain('Tax payable on reverse charge: Yes. GST 5% is payable by the recipient.');
      written.length = 0;
      world('fcm_18');
      await InvoiceService.createForManifest(ID.m1);
      await renderInvoicePdf(await buildInvoiceDetail(issued()));
      expect(written.some(t => /reverse charge/i.test(t))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the MRX load number on the invoice', () => {
  beforeEach(() => world('rcm_5'));

  it('detail and PDF show "Load MRX-..." when the invoice links to a vendor request with a load number', async () => {
    one('vendor_shipment_requests', ID.request1).load_number = 'MRX-2026-00042';
    await InvoiceService.createForManifest(ID.m1);
    const res = await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin());
    expect(res.body.load_number).toBe('MRX-2026-00042');
    const written: string[] = [];
    const spy = vi.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, s: any) { written.push(String(s)); return this; });
    try {
      await renderInvoicePdf(await buildInvoiceDetail(issued()));
    } finally {
      spy.mockRestore();
    }
    expect(written).toContain('Load MRX-2026-00042');
  });

  it('has none for a request without a load number, and for a booking', async () => {
    await InvoiceService.createForManifest(ID.m1);
    expect((await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin())).body.load_number).toBeNull();
    await InvoiceService.createForShipment(ID.s1);
    const ship = supabaseMock.rows('invoices').find(i => i.shipment_id === ID.s1)!;
    expect((await request(app).get(api(`/invoices/${ship.id}`)).set(auth.admin())).body.load_number).toBeNull();
  });
});
