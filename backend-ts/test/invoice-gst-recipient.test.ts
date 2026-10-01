/**
 * UAT-004 and UAT-009: an invoice is refused until the seller is on record, always stores who it is billed to
 * (lots of a split shipment included), and adds its GST up in whole paise.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { InvoiceService } from '../src/services/invoice.service';
import { fromPaise, taxLines, taxableFromInclusive, toPaise, type TaxBasis } from '../src/core/gst';
import { INVOICE_PROFILE_MESSAGE } from '../src/services/company.service';
import { COMPANY_SETTING, ID, auth, cargoWorld, one, shipmentRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const now = () => new Date().toISOString();
const BUYER_GSTIN_MH = '27AAACR5055K1Z7';
const BUYER_GSTIN_GJ = '24AAACC1206D1ZM';
const MASTER = '51000000-0000-4000-8000-0000000000a0';
const LOT_A = '51000000-0000-4000-8000-0000000000a1';
const LOT_B = '51000000-0000-4000-8000-0000000000a2';
const LOT_C = '51000000-0000-4000-8000-0000000000b1';

function world(extra: Record<string, any[]> = {}) {
  supabaseMock.reset(cargoWorld({
    vendor_profiles: [{ id: ID.vendor, company_name: 'Acme Logistics', gst_number: BUYER_GSTIN_MH, address: '12 MIDC Road', city: 'Pune' }],
    ...extra,
  }));
  Object.assign(one('shipments', ID.s1), { status: 'delivered' });
}
const issued = () => supabaseMock.rows('invoices')[0];
const ALL_BASES: TaxBasis[] = ['intra', 'inter', 'unknown'];

describe('GST in integer paise (UAT-009)', () => {
  it('works one rounding step per tax line and adds up exactly', () => {
    // 1,27,118.64 at 18%: CGST and SGST are 9% each
    expect(taxLines(toPaise(127118.64), 18, 'intra')).toMatchObject({ taxable: 12711864, cgst: 1144068, sgst: 1144068, igst: 0, tax: 2288136, total: 15000000 });
    expect(taxLines(toPaise(127118.64), 18, 'inter')).toMatchObject({ igst: 2288136, cgst: 0, sgst: 0, total: 15000000 });
    expect(taxLines(toPaise(127118.64), 18, 'unknown')).toMatchObject({ gst: 2288136, total: 15000000 });
  });

  it('rounds half up on the taxable value, once per line', () => {
    // 5 paise at 18% is 0.9 paise: one line rounds to 1 paisa; two 9% lines are 0.45 paise each and round to 0
    expect(taxLines(5, 18, 'inter').igst).toBe(1);
    expect(taxLines(5, 18, 'intra')).toMatchObject({ cgst: 0, sgst: 0, tax: 0, total: 5 });
    expect(taxLines(toPaise(2500.5), 18, 'unknown')).toMatchObject({ gst: 45009, total: 295059 });
  });

  it('a price entered excluding GST: 1,50,000.00 before GST at 18% is 1,77,000.00 with no stray paise', () => {
    for (const basis of ALL_BASES) {
      const lines = taxLines(toPaise(150000), 18, basis);
      expect(fromPaise(lines.total)).toBe(177000);
      expect(lines.total).toBe(lines.taxable + lines.cgst + lines.sgst + lines.igst + lines.gst);
    }
  });

  it('a price entered including GST: 1,50,000 with GST in it is 1,27,118.64 + 22,881.36, not 1,50,000.04', () => {
    for (const basis of ALL_BASES) {
      const lines = taxableFromInclusive(toPaise(150000), 18, basis);
      expect(lines.exact).toBe(true);
      expect(fromPaise(lines.taxable)).toBe(127118.64);
      expect(fromPaise(lines.tax)).toBe(22881.36);
      expect(fromPaise(lines.total)).toBe(150000);
    }
  });

  it('never leaves a fraction of a paisa and always totals taxable + lines, across many amounts and rates', () => {
    for (const rate of [0, 5, 12, 18, 28, 2.5]) {
      for (const basis of ALL_BASES) {
        for (let paise = 1; paise < 400000; paise += 7919) {
          const lines = taxLines(paise, rate, basis);
          expect(Number.isInteger(lines.total)).toBe(true);
          expect(lines.total).toBe(lines.taxable + lines.cgst + lines.sgst + lines.igst + lines.gst);
          // the tax is within a paisa of the exact tax (two lines can each be half a paisa out)
          expect(Math.abs(lines.tax - (paise * rate) / 100)).toBeLessThanOrEqual(basis === 'intra' ? 1 : 0.5 + 1e-9);
        }
      }
    }
  });

  it('an inclusive amount is split exactly when it can be, else the closest total is returned', () => {
    for (let paise = 1000; paise < 200000; paise += 1013) {
      const lines = taxableFromInclusive(paise, 18, 'inter');
      expect(Math.abs(lines.total - paise)).toBeLessThanOrEqual(1);
      if (lines.exact) expect(lines.total).toBe(paise);
    }
  });

  it('issues an invoice whose paise add up exactly', async () => {
    world({ shipment_hsn: [{ id: 'h1', shipment_id: ID.s1, hsn_code: '8471', gst_rate: 18 }] });
    one('shipments', ID.s1).freight_charge = 127118.64;
    await InvoiceService.createForShipment(ID.s1);
    expect(issued()).toMatchObject({ amount: 127118.64, gst_amount: 22881.36, total: 150000 });
  });

  it('splits CGST and SGST equally for a buyer in the seller\'s state, and charges IGST for one in another', async () => {
    for (const [gstin, intra] of [[BUYER_GSTIN_MH, true], [BUYER_GSTIN_GJ, false]] as const) {
      world({ shipment_hsn: [{ id: 'h1', shipment_id: ID.s1, hsn_code: '8471', gst_rate: 18 }] });
      one('shipments', ID.s1).bid_id = 'b1';
      supabaseMock.rows('capacity_bids').push({ id: 'b1', vendor_id: ID.vendor, bid_amount: 10001.01, status: 'won' });
      supabaseMock.rows('vendor_profiles')[0].gst_number = gstin;
      await InvoiceService.createForShipment(ID.s1);
      // 18% of 10001.01 is 1800.1818: CGST and SGST 900.09 each, or IGST 1800.18
      expect(issued()).toMatchObject({ gst_amount: 1800.18, total: 11801.19 });
      const res = await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin());
      expect(res.body.tax).toMatchObject(intra ? { basis: 'intra', cgst: 900.09, sgst: 900.09 } : { basis: 'inter', igst: 1800.18 });
    }
  });
});

describe('no invoice without the seller on record (UAT-004 a)', () => {
  const price = (body: object) => request(app).post(api('/finance/unpriced/price')).set(auth.admin()).send(body);

  it('refuses with 409 and the Settings message, and does not save the price', async () => {
    world({ system_settings: [] });
    one('shipments', ID.s1).freight_charge = null;
    const res = await price({ kind: 'shipment', id: ID.s1, amount: 4200 });
    expect(res.status).toBe(409);
    expect(res.body.detail).toBe(INVOICE_PROFILE_MESSAGE);
    expect(res.body).toMatchObject({ code: 'company_profile_incomplete', settings_path: '/admin/settings', missing: ['company name', 'GSTIN', 'state'] });
    expect(one('shipments', ID.s1).freight_charge).toBeNull();
    expect(supabaseMock.rows('invoices')).toHaveLength(0);
  });

  it('names only what is missing, and counts the GSTIN as naming the state', async () => {
    world({ system_settings: [{ key: 'company_profile', value: { value: { legal_name: 'Margix' } } }] });
    const res = await price({ kind: 'shipment', id: ID.s1, amount: 100 });
    expect(res.status).toBe(409);
    expect(res.body.missing).toEqual(['GSTIN', 'state']);

    world({ system_settings: [{ key: 'company_profile', value: { value: { legal_name: 'Margix', gstin: '27AAPFU0939F1ZV' } } }] });
    one('shipments', ID.s1).freight_charge = null;
    expect((await price({ kind: 'shipment', id: ID.s1, amount: 100 })).status).toBe(201);
  });

  it('refuses the backfill too; a delivery is still recorded and is invoiced once Settings is filled in', async () => {
    world({ system_settings: [] });
    const res = await request(app).post(api('/finance/invoices')).set(auth.admin()).send({ shipment_id: ID.s1 });
    expect(res.status).toBe(409);
    await InvoiceService.onShipmentDelivered(ID.s1);
    expect(supabaseMock.rows('invoices')).toHaveLength(0);
    supabaseMock.rows('system_settings').push(COMPANY_SETTING);
    expect((await InvoiceService.createForShipment(ID.s1)).status).toBe('created');
  });
});

describe('every invoice stores who it is billed to (UAT-004 b, c)', () => {
  const get = (id: string) => request(app).get(api(`/invoices/${id}`)).set(auth.admin());

  it('stores the vendor: name, GSTIN, address and state', async () => {
    world();
    Object.assign(one('cargo_manifest', ID.m1), { status: 'delivered' });
    await InvoiceService.createForManifest(ID.m1);
    expect(issued().bill_to).toMatchObject({ kind: 'vendor', name: 'Acme Logistics', gstin: BUYER_GSTIN_MH, address: '12 MIDC Road, Pune', state: 'Maharashtra' });
    expect((await get(issued().id)).body.buyer).toMatchObject({ kind: 'vendor', name: 'Acme Logistics', gstin: BUYER_GSTIN_MH });
  });

  it('stores the booking customer, and keeps it when the customer later changes their name', async () => {
    world();
    await InvoiceService.createForShipment(ID.s1);
    expect(issued().bill_to).toMatchObject({ kind: 'customer', id: ID.customer, name: 'Meera Customer' });
    supabaseMock.rows('customers')[0].full_name = 'Someone Else';
    expect((await get(issued().id)).body.buyer.name).toBe('Meera Customer');
  });

  it('bills a shipment staff created with no vendor and no booking to its consignee, with GSTIN and drop address', async () => {
    world();
    Object.assign(one('shipments', ID.s2), { status: 'delivered', freight_charge: 5000, consignee_name: 'Shree Traders', consignee_gstin: BUYER_GSTIN_GJ, consignee_phone: '+919822200000' });
    await InvoiceService.createForShipment(ID.s2);
    const inv = supabaseMock.rows('invoices').find(i => i.shipment_id === ID.s2)!;
    expect(inv.bill_to).toMatchObject({ kind: 'consignee', name: 'Shree Traders', gstin: BUYER_GSTIN_GJ, address: 'Wakad, Pune', state: 'Gujarat' });
    expect((await get(inv.id)).body.buyer).toMatchObject({ name: 'Shree Traders', gstin: BUYER_GSTIN_GJ, state_code: '24' });
  });

  it('bills each lot of a split shipment to the party that lot goes to, and a lot of a booking to the booking customer', async () => {
    world({
      shipments: [
        shipmentRow(MASTER, { is_master: true, status: 'delivered', freight_share: 0 }),
        shipmentRow(LOT_A, { parent_shipment_id: MASTER, lot_seq: 1, status: 'delivered', freight_share: 60000, consignee_name: 'Lot A Traders', consignee_gstin: BUYER_GSTIN_MH }),
        shipmentRow(LOT_B, { parent_shipment_id: MASTER, lot_seq: 2, status: 'delivered', freight_share: 90000, consignee_name: 'Lot B Stores' }),
        shipmentRow(ID.s1, { status: 'delivered' }),
        shipmentRow(LOT_C, { parent_shipment_id: ID.s1, lot_seq: 1, status: 'delivered', freight_share: 1000 }),
      ],
      delivery_points: [
        { id: 'dp-a', shipment_id: MASTER, lot_shipment_id: LOT_A, name: 'A drop', address: 'Andheri, Mumbai', created_at: now() },
        { id: 'dp-b', shipment_id: MASTER, lot_shipment_id: LOT_B, name: 'B drop', address: 'Vashi, Navi Mumbai', created_at: now() },
      ],
    });
    for (const id of [LOT_A, LOT_B, LOT_C]) await InvoiceService.createForShipment(id);
    const [a, b, c] = supabaseMock.rows('invoices');
    expect(a.bill_to).toMatchObject({ kind: 'consignee', name: 'Lot A Traders', gstin: BUYER_GSTIN_MH, address: 'Andheri, Mumbai' });
    expect(b.bill_to).toMatchObject({ kind: 'consignee', name: 'Lot B Stores', gstin: null, address: 'Vashi, Navi Mumbai' });
    expect(c.bill_to).toMatchObject({ kind: 'customer', name: 'Meera Customer' });
  });

  it('stores nothing when no party is on record, and never invents one', async () => {
    world();
    Object.assign(one('shipments', ID.s2), { status: 'delivered', freight_charge: 5000 });
    await InvoiceService.createForShipment(ID.s2);
    const inv = supabaseMock.rows('invoices').find(i => i.shipment_id === ID.s2)!;
    expect(inv.bill_to ?? null).toBeNull();
    expect((await get(inv.id)).body.buyer).toMatchObject({ kind: 'unknown', name: null });
  });

  it('shows the recipient of an invoice issued before bill_to existed, from its booking or consignee, without changing the row', async () => {
    world();
    supabaseMock.rows('invoices').push(
      { id: 'old-1', invoice_number: 'INV-202609-0001', shipment_id: ID.s1, amount: 1000, gst_rate: 0, gst_amount: 0, total: 1000, status: 'issued', issued_at: now(), vendor_id: null },
      { id: 'old-2', invoice_number: 'INV-202609-0002', shipment_id: ID.s2, amount: 1000, gst_rate: 0, gst_amount: 0, total: 1000, status: 'issued', issued_at: now(), vendor_id: null },
    );
    Object.assign(one('shipments', ID.s2), { consignee_name: 'Old Consignee' });
    expect((await get('old-1')).body.buyer).toMatchObject({ kind: 'customer', name: 'Meera Customer' });
    expect((await get('old-2')).body.buyer).toMatchObject({ kind: 'consignee', name: 'Old Consignee', address: 'Wakad, Pune' });
    expect(supabaseMock.rows('invoices').every(i => i.bill_to === undefined)).toBe(true);

    const list = await request(app).get(api('/finance/invoices')).set(auth.admin());
    const names = Object.fromEntries(list.body.map((r: any) => [r.id, r.billed_to_name]));
    expect(names).toMatchObject({ 'old-1': 'Meera Customer', 'old-2': 'Old Consignee' });
  });
});
