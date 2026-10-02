/**
 * Shipment documents, the rules on their own: per-kind validation, LR numbering, the pre-dispatch checklist,
 * the settlement maths in paise, version diffs and the PDFs.
 */
import { describe, expect, it } from 'vitest';
import { DOC_KINDS } from '../src/services/documents/kinds';
import { normaliseDocument, parseFields } from '../src/services/documents/schemas';
import { formatLrNumber, lrPrefixOf } from '../src/services/documents/numbering';
import { EWAY_THRESHOLD_INR, evaluateChecklist, ewayRequirement, type ChecklistInput, type ChecklistItem } from '../src/services/documents/checklist';
import { computeBalance, settlementView, toPaise, type SettlementRow } from '../src/services/documents/settlement';
import { diffDocument } from '../src/services/documents/documents.service';
import { documentFileName, renderDocumentPdf } from '../src/services/documents/pdf';

const bad = (fn: () => unknown, pattern: RegExp) => {
  try {
    fn();
  } catch (e: any) {
    expect(e.status).toBe(400);
    expect(e.message).toMatch(pattern);
    return;
  }
  throw new Error('expected a 400');
};

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('document fields by kind', () => {
  it('knows every kind and accepts an empty record for all but the e-way bill', () => {
    expect(DOC_KINDS).toHaveLength(11);
    for (const kind of DOC_KINDS.filter(k => k !== 'eway_bill')) expect(() => parseFields(kind, {})).not.toThrow();
    bad(() => parseFields('eway_bill', {}), /ewb_number/);
  });

  it('e-way bill: 12 digits, validity required, vehicle number normalised, GSTIN and distance checked', () => {
    const ok = { ewb_number: '123456789012', vehicle_number: 'mh 12 ab-1234', transporter_id: '27aaacr5055k1z7', approx_distance_km: 420 };
    expect(parseFields('eway_bill', ok)).toMatchObject({ ewb_number: '123456789012', vehicle_number: 'MH12AB1234', transporter_id: '27AAACR5055K1Z7' });
    bad(() => parseFields('eway_bill', { ewb_number: '12345678901' }), /12 digits/);
    bad(() => parseFields('eway_bill', { ewb_number: '1234567890123' }), /12 digits/);
    bad(() => parseFields('eway_bill', { ewb_number: '12345678901a' }), /12 digits/);
    bad(() => parseFields('eway_bill', { ...ok, transporter_id: 'SHORT' }), /transporter_id/);
    bad(() => parseFields('eway_bill', { ...ok, approx_distance_km: -3 }), /approx_distance_km/);
    bad(() => normaliseDocument('eway_bill', { fields: ok }), /valid_until is required/);
    const doc = normaliseDocument('eway_bill', { fields: ok, valid_until: '2026-10-05T18:00:00Z' });
    expect(doc).toMatchObject({ number: '123456789012', valid_until: '2026-10-05T18:00:00.000Z' });
    // The number may be given on its own; both must agree
    expect(normaliseDocument('eway_bill', { number: '123456789012', fields: {}, valid_until: '2026-10-05' }).fields.ewb_number).toBe('123456789012');
    bad(() => normaliseDocument('eway_bill', { number: '999999999999', fields: ok, valid_until: '2026-10-05' }), /must equal/);
  });

  it('invoice, bill of supply and challan: a number is required; GSTINs, lines and values are checked', () => {
    for (const kind of ['tax_invoice', 'bill_of_supply', 'delivery_challan'] as const) {
      bad(() => normaliseDocument(kind, { fields: {} }), /number is required/);
      expect(normaliseDocument(kind, { number: 'INV-1', doc_date: '2026-10-01', fields: { seller_name: 'Acme', total_value: 75000 } })).toMatchObject({ number: 'INV-1', doc_date: '2026-10-01' });
    }
    bad(() => parseFields('tax_invoice', { seller_gstin: '27' }), /GSTIN/);
    bad(() => parseFields('tax_invoice', { total_value: -1 }), /total_value/);
    bad(() => parseFields('tax_invoice', { goods_lines: [{ quantity: 2 }] }), /goods_lines\.0\.description/);
    expect(parseFields('tax_invoice', { goods_lines: [{ description: 'Cement', hsn: '2523', quantity: 10, value: 4500 }], unknown_key: 1 })).not.toHaveProperty('unknown_key');
  });

  it('LR: payment terms, packages and weights are checked', () => {
    expect(parseFields('lr', { payment_terms: 'to_pay', packages: 12, actual_weight_kg: 5200.5, freight_amount: 25000, vehicle_number: 'MH 12 AB 1234' })).toMatchObject({ payment_terms: 'to_pay', vehicle_number: 'MH12AB1234' });
    bad(() => parseFields('lr', { payment_terms: 'cash' }), /payment_terms/);
    bad(() => parseFields('lr', { packages: 1.5 }), /packages/);
    bad(() => parseFields('lr', { actual_weight_kg: -1 }), /actual_weight_kg/);
  });

  it('freight sheet, POD, loading/unloading, damage and closure reports validate their amounts and lists', () => {
    expect(parseFields('freight_sheet', { total_freight: 25000, paid_advance: 10000, amount_to_pay: 15000, payment_terms: 'paid' })).toMatchObject({ amount_to_pay: 15000 });
    bad(() => parseFields('freight_sheet', { paid_advance: -5 }), /paid_advance/);
    expect(parseFields('pod', { delivered_at: '2026-10-02T10:00:00Z', receiver_name: 'Store', delivered_quantity: 10 })).toMatchObject({ receiver_name: 'Store' });
    bad(() => parseFields('pod', { delivered_at: 'not a date' }), /delivered_at/);
    bad(() => parseFields('pod', { photo_paths: Array(11).fill('loads/x/a.jpg') }), /photo_paths/);
    expect(parseFields('loading_report', { loaded_quantity: 10, weight_kg: 900, events: [{ kind: 'pickup', pieces: 10, condition: null }] }).events).toHaveLength(1);
    bad(() => parseFields('unloading_report', { loaded_quantity: -1 }), /loaded_quantity/);
    expect(parseFields('damage_report', { exception_type: 'damage', affected_quantity: 2, items: [{ pieces_affected: 2, condition: 'damaged_goods' }] }).items).toHaveLength(1);
    bad(() => parseFields('damage_report', { affected_quantity: -2 }), /affected_quantity/);
    expect(parseFields('trip_closure', { final_freight: 25000, balance_payable: -50, extra_charges: [{ label: 'Toll', amount: 300, approved: true }] }).balance_payable).toBe(-50);
    bad(() => parseFields('trip_closure', { extra_charges: [{ label: 'Toll', amount: 300 }] }), /approved/);
  });
});

describe('LR and freight sheet numbers', () => {
  it('formats <prefix>-YYYY-NNNNN', () => {
    expect(formatLrNumber('LR', 2026, 1)).toBe('LR-2026-00001');
    expect(formatLrNumber('ALP', 2026, 12345)).toBe('ALP-2026-12345');
    expect(formatLrNumber('FS', 2027, 99999)).toBe('FS-2027-99999');
  });
  it('takes the company prefix when it is valid, else LR', () => {
    expect(lrPrefixOf({ profile: { lr_prefix: 'alp' } })).toBe('ALP');
    expect(lrPrefixOf({ profile: { lr_prefix: 'too long prefix!' } })).toBe('LR');
    expect(lrPrefixOf({ profile: {} })).toBe('LR');
    expect(lrPrefixOf(null)).toBe('LR');
  });
});

// ── The checklist ───────────────────────────────────────────────────────────────────────────────────
const doc = (kind: string, over: Record<string, any> = {}) => ({ id: `d-${kind}`, kind, status: 'final', number: `${kind}-1`, valid_until: null, fields: {}, ...over }) as any;
const vehicle = (over: Record<string, any> = {}) => ({
  plate_number: 'MH12AB1234', capacity_kg: 5000, vehicle_type: 'truck',
  rc_expiry: day(400), insurance_expiry: day(200), fitness_expiry: day(200), puc_expiry: day(100), permit_expiry: null, ...over,
});
const goodLicence = { status: 'valid' as const, in_grace: false, classes: [] };
const input = (over: Partial<ChecklistInput> = {}): ChecklistInput => ({
  accepted: true, eway: { required: false, reason: null }, docs: [doc('tax_invoice')], vehicle: vehicle(),
  driver: { name: 'Ravi', licence: goodLicence }, ...over,
});
const item = (items: ChecklistItem[], key: string) => items.find(i => i.key === key);

describe('e-way bill requirement', () => {
  it('is required over Rs 50,000, at any value for hazardous goods, or when the load says so', () => {
    expect(EWAY_THRESHOLD_INR).toBe(50_000);
    expect(ewayRequirement({ declaredValue: 50_000 }).required).toBe(false);
    expect(ewayRequirement({ declaredValue: 50_001 }).required).toBe(true);
    expect(ewayRequirement({ declaredValue: 100, hazmat: true }).required).toBe(true);
    expect(ewayRequirement({ declaredValue: 100, flagged: true }).required).toBe(true);
    expect(ewayRequirement({ declaredValue: null }).required).toBe(false);
  });
});

describe('pre-dispatch checklist rules', () => {
  it('a complete movement has no issues', () => {
    const items = evaluateChecklist(input({ docs: [doc('tax_invoice'), doc('lr')] }));
    expect(items.filter(i => ['missing', 'expired', 'inconsistent'].includes(i.status))).toEqual([]);
    expect(item(items, 'eway_bill')?.status).toBe('not_required');
  });

  it('flags a missing invoice or challan, and any one of the three kinds satisfies it', () => {
    expect(item(evaluateChecklist(input({ docs: [] })), 'invoice')).toMatchObject({ status: 'missing', required: true });
    for (const kind of ['tax_invoice', 'bill_of_supply', 'delivery_challan']) {
      expect(item(evaluateChecklist(input({ docs: [doc(kind)] })), 'invoice')?.status).toBe('ok');
    }
    // A cancelled invoice does not count
    expect(item(evaluateChecklist(input({ docs: [doc('tax_invoice', { status: 'cancelled' })] })), 'invoice')?.status).toBe('missing');
  });

  it('requires an e-way bill when the goods need one, and flags it missing', () => {
    const required = { required: true, reason: 'Declared value is over Rs 50,000' };
    expect(item(evaluateChecklist(input({ eway: required })), 'eway_bill')).toMatchObject({ status: 'missing', required: true });
    const ok = evaluateChecklist(input({ eway: required, docs: [doc('tax_invoice'), doc('eway_bill', { number: '123456789012', valid_until: new Date(Date.now() + 86_400_000).toISOString(), fields: { vehicle_number: 'MH12AB1234' } })] }));
    expect(item(ok, 'eway_bill')?.status).toBe('ok');
    expect(item(ok, 'eway_bill_vehicle')?.status).toBe('ok');
  });

  it('flags an expired e-way bill', () => {
    const items = evaluateChecklist(input({ eway: { required: true, reason: 'x' }, docs: [doc('eway_bill', { number: '123456789012', valid_until: new Date(Date.now() - 3_600_000).toISOString(), fields: { vehicle_number: 'MH12AB1234' } })] }));
    expect(item(items, 'eway_bill')).toMatchObject({ status: 'expired' });
    // A status already set to expired counts too
    expect(item(evaluateChecklist(input({ docs: [doc('eway_bill', { status: 'expired' })] })), 'eway_bill')?.status).toBe('expired');
  });

  it('flags an e-way bill that names another vehicle than the assigned one', () => {
    const wrong = evaluateChecklist(input({ docs: [doc('eway_bill', { valid_until: new Date(Date.now() + 86_400_000).toISOString(), fields: { vehicle_number: 'MH14XY9999' } })] }));
    expect(item(wrong, 'eway_bill_vehicle')).toMatchObject({ status: 'inconsistent' });
    expect(item(wrong, 'eway_bill_vehicle')?.message).toMatch(/MH14XY9999.*MH12AB1234/);
    // Spacing and case do not matter
    const same = evaluateChecklist(input({ docs: [doc('eway_bill', { valid_until: new Date(Date.now() + 86_400_000).toISOString(), fields: { vehicle_number: 'mh12 ab 1234' } })] }));
    expect(item(same, 'eway_bill_vehicle')?.status).toBe('ok');
    // No vehicle number on the e-way bill: Part B is missing
    const none = evaluateChecklist(input({ eway: { required: true, reason: 'x' }, docs: [doc('eway_bill', { valid_until: new Date(Date.now() + 86_400_000).toISOString() })] }));
    expect(item(none, 'eway_bill_vehicle')?.status).toBe('missing');
  });

  it('needs the LR once a company has accepted, not before', () => {
    expect(item(evaluateChecklist(input({ accepted: false, vehicle: null, driver: null })), 'lr')?.status).toBe('not_required');
    expect(item(evaluateChecklist(input({})), 'lr')).toMatchObject({ status: 'missing', required: true });
    expect(item(evaluateChecklist(input({ docs: [doc('lr')] })), 'lr')?.status).toBe('ok');
  });

  it('reads the vehicle documents from the vehicle: expired, missing, expiring soon, optional permit', () => {
    const items = evaluateChecklist(input({ vehicle: vehicle({ insurance_expiry: day(-1), puc_expiry: null, fitness_expiry: day(5), permit_expiry: day(-30) }) }));
    expect(item(items, 'vehicle_insurance')?.status).toBe('expired');
    expect(item(items, 'vehicle_puc')?.status).toBe('missing');
    expect(item(items, 'vehicle_fitness')?.status).toBe('expiring');
    expect(item(items, 'vehicle_rc')?.status).toBe('ok');
    expect(item(items, 'vehicle_permit')?.status).toBe('expired');
    expect(item(evaluateChecklist(input()), 'vehicle_permit')?.status).toBe('not_required');
    // No vehicle yet after acceptance
    expect(item(evaluateChecklist(input({ vehicle: null, driver: null })), 'vehicle')?.status).toBe('missing');
  });

  it('checks the driver licence', () => {
    expect(item(evaluateChecklist(input({ driver: null })), 'driver_licence')?.status).toBe('missing');
    expect(item(evaluateChecklist(input({ driver: { name: 'Ravi', licence: { status: 'missing', in_grace: false, classes: [] } } })), 'driver_licence')?.status).toBe('missing');
    expect(item(evaluateChecklist(input({ driver: { name: 'Ravi', licence: { status: 'expired', in_grace: false, classes: [] } } })), 'driver_licence')?.status).toBe('expired');
    expect(item(evaluateChecklist(input({ driver: { name: 'Ravi', licence: { status: 'expired', in_grace: true, classes: [] } } })), 'driver_licence')?.status).toBe('expiring');
    // A heavy vehicle needs a heavy licence class
    const heavy = evaluateChecklist(input({ vehicle: vehicle({ capacity_kg: 12000 }), driver: { name: 'Ravi', licence: { status: 'valid', in_grace: false, classes: ['LMV'] } } }));
    expect(item(heavy, 'driver_licence')?.status).toBe('inconsistent');
    expect(item(evaluateChecklist(input()), 'driver_licence')?.status).toBe('ok');
  });
});

// ── Settlement maths ────────────────────────────────────────────────────────────────────────────────
describe('settlement maths in integer paise', () => {
  const base = { agreed_freight: 2_500_000, advance_paid: 1_000_000, extra_charges: [] as any[], deductions: [] as any[] };

  it('balance = freight + approved extras - deductions - advance; unapproved extras are excluded', () => {
    expect(computeBalance(base)).toBe(1_500_000);
    const extras = [
      { label: 'Toll', amount: 300_000, approved_at: '2026-10-02T10:00:00Z', approved_by: 'u1' },
      { label: 'Waiting', amount: 500_000 },
    ];
    expect(computeBalance({ ...base, extra_charges: extras })).toBe(1_800_000);
    expect(computeBalance({ ...base, extra_charges: extras, deductions: [{ label: 'Damage', amount: 50_000 }] })).toBe(1_750_000);
    // An advance larger than the freight leaves a negative balance (to be refunded)
    expect(computeBalance({ ...base, advance_paid: 3_000_000 })).toBe(-500_000);
  });

  it('converts rupees to paise without float drift', () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(19.99)).toBe(1999);
    expect(toPaise(1.005)).toBe(101);
    expect(Number.isInteger(toPaise(123456.78))).toBe(true);
  });

  it('shows rupees at the edge with the totals and the balance', () => {
    const row = { id: 's', load_id: 'l', shipment_id: null, carrier_org_id: 'c', vendor_org_id: null, ...base, balance: 0, payment_terms: 'to_pay', payment_status: 'pending', pod_document_id: null, status: 'open', closed_at: null, closed_by: null, created_by: null, created_at: 't', updated_at: 't',
      extra_charges: [{ label: 'Toll', amount: 300_050, approved_at: 'x' }, { label: 'Wait', amount: 100_000 }],
      deductions: [{ label: 'Short', amount: 25_000, reason: 'two cartons' }] } as SettlementRow;
    const v = settlementView(row);
    expect(v).toMatchObject({ agreed_freight: 25000, advance_paid: 10000, approved_extras_total: 3000.5, pending_extras_total: 1000, deductions_total: 250, balance: 17750.5 });
    expect(v.extra_charges.map(e => [e.idx, e.approved])).toEqual([[0, true], [1, false]]);
  });
});

describe('version diffs', () => {
  it('lists changed columns and fields as from/to', () => {
    const before = { number: 'A', status: 'final', fields: { vehicle_number: 'MH12AB1234', approx_distance_km: 100 } } as any;
    const after = { number: 'A', status: 'final', fields: { vehicle_number: 'MH14XY9999', approx_distance_km: 100, transporter_name: 'Alpha' } } as any;
    expect(diffDocument(before, after)).toEqual({
      'fields.vehicle_number': { from: 'MH12AB1234', to: 'MH14XY9999' },
      'fields.transporter_name': { from: null, to: 'Alpha' },
    });
    expect(diffDocument(before, before)).toEqual({});
  });
});

// ── PDFs ────────────────────────────────────────────────────────────────────────────────────────────
const issuer = { name: 'Alpha Logistics Pvt Ltd', address: 'Plot 1, Pune, Maharashtra', gstin: '27AAPFU0939F1ZV', phone: '+91 98765 00000' };
const SAMPLES: Record<string, Record<string, any>> = {
  lr: { issuer, load_number: 'VR-AB000001', consignor_name: 'Acme Traders', consignee_name: 'Shree Stores', pickup_address: 'Pune', delivery_address: 'Mumbai', vehicle_number: 'MH12AB1234', driver_name: 'Ravi', goods_description: 'Cement bags', packages: 120, actual_weight_kg: 5200, route: 'Pune to Mumbai', freight_amount: 25000, payment_terms: 'to_pay' },
  freight_sheet: { issuer, lr_number: 'LR-2026-00001', vehicle_number: 'MH12AB1234', from_location: 'Pune', to_location: 'Mumbai', total_freight: 25000, paid_advance: 10000, amount_to_pay: 15000, payment_terms: 'to_pay' },
  pod: { issuer, delivered_at: '2026-10-02T10:00:00Z', receiver_name: 'Store manager', delivered_quantity: 118, shortage_quantity: 2, complete: true, photo_paths: ['cargo/x/photo.jpg'] },
  loading_report: { issuer, occurred_at: '2026-10-01T08:00:00Z', loaded_quantity: 120, weight_kg: 5200, events: [{ at: '2026-10-01T08:00:00Z', kind: 'pickup', pieces: 120, weight_kg: 5200, condition: 'good', receiver_name: null, notes: null }] },
  unloading_report: { issuer, occurred_at: '2026-10-02T10:00:00Z', loaded_quantity: 118, confirmed_by: 'Store manager', events: [{ at: '2026-10-02T10:00:00Z', kind: 'delivery', pieces: 118, weight_kg: null, condition: 'damaged_goods', receiver_name: 'Store manager', notes: 'Two cartons wet' }] },
  damage_report: { issuer, exception_type: 'damage', affected_quantity: 2, description: 'Two cartons wet', report_date: '2026-10-02', responsible_person: 'Asha', items: [{ exception_code: 'EXC-1', type: 'damage', pieces_affected: 2, weight_affected_kg: 40, condition: 'wet', note: 'Rain' }] },
  trip_closure: { issuer, final_delivery_status: 'Delivered', final_freight: 25000, additional_charges: 3000, deductions_total: 500, advance_paid: 10000, balance_payable: 17500, closure_date: '2026-10-03', payment_status: 'pending', extra_charges: [{ label: 'Toll', amount: 3000, approved: true }, { label: 'Waiting', amount: 1000, approved: false }], deductions: [{ label: 'Short', amount: 500, reason: 'two cartons' }] },
};

describe('generated PDFs', () => {
  for (const [kind, fields] of Object.entries(SAMPLES)) {
    it(`${kind} renders a non-empty PDF`, async () => {
      const buf = await renderDocumentPdf({ kind: kind as any, number: kind === 'lr' ? 'LR-2026-00001' : null, doc_date: '2026-10-02', status: 'final', version: 1, fields });
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(1000);
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    });
  }
  it('also renders a draft with almost nothing recorded', async () => {
    const buf = await renderDocumentPdf({ kind: 'pod', number: null, doc_date: null, status: 'draft', version: 1, fields: {} });
    expect(buf.length).toBeGreaterThan(500);
  });
  it('names the file after the document number', () => {
    expect(documentFileName({ kind: 'lr', number: 'LR-2026-00001', id: 'abcdef12-0000' })).toBe('LR-2026-00001.pdf');
    expect(documentFileName({ kind: 'pod', number: null, id: 'abcdef12-0000' })).toBe('pod-abcdef12.pdf');
  });
});
