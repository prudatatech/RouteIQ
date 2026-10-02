import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { CATEGORIES, goodsTables, hsnIndex, VEHICLE_CLASSES } from './support/goods-world';
import { assessLoad, AssessRefs, ESTIMATE_LABEL } from '../src/services/goods/assess';
import { RECOMMENDATION_RULES } from '../src/services/goods/recommendations';
import { computeTax, ewayRule, ewayThreshold, isHazmatMixed, primaryLine, resolveLines, taxBasis } from '../src/services/goods/tax';
import { loadTypeFor, suggestVehicle } from '../src/services/goods/vehicle';
import type { DraftItem, LoadDraft } from '../src/services/goods/types';

const MH = '27', DL = '07';
const index = hsnIndex();
const refs = (over: AssessRefs = {}): AssessRefs => ({ index, classes: VEHICLE_CLASSES, categories: CATEGORIES, pickupState: MH, deliveryState: DL, estimate: null, today: '2026-10-05', ...over });
const line = (product: string, hsn: string, weight_kg: number, declared_value: number, extra: Partial<DraftItem> = {}): DraftItem => ({ product_name: product, hsn_code: hsn, weight_kg, declared_value, ...extra });
const codesOf = (a: Awaited<ReturnType<typeof assessLoad>>) => a.recommendations.map(r => r.code);
const assess = (draft: Partial<LoadDraft>, over: AssessRefs = {}) => assessLoad({ items: [], ...draft }, refs(over));

// PRD 4.3 / 8.3: the four-product sample load
const PRD_ITEMS: DraftItem[] = [
  line('Wheat flour (maida)', '1101', 12500, 187500),
  line('Refined sunflower oil', '1512', 4000, 320000),
  line('Packaged spices', '0910', 800, 45000),
  line('Soap & detergent', '3401', 3600, 210000),
];

describe('GST per line (PRD 8.3)', () => {
  it('Maharashtra to Delhi: IGST, taxable 7,62,500, GST 56,050, total 8,18,550 at rates 0/5/5/18', async () => {
    const a = await assess({ items: PRD_ITEMS });
    expect(a.totals).toEqual({ weight_kg: 20900, declared_value: 762500, product_count: 4 });
    expect(a.tax).toMatchObject({ basis: 'inter', pickup_state: 'Maharashtra', delivery_state: 'Delhi', taxable: 762500, igst: 56050, cgst: 0, sgst: 0, gst_total: 56050, grand_total: 818550 });
    expect(a.tax.lines).toEqual([
      { product: 'Wheat flour (maida)', hsn: '1101', rate: 0, taxable: 187500, gst: 0 },
      { product: 'Refined sunflower oil', hsn: '1512', rate: 5, taxable: 320000, gst: 16000 },
      { product: 'Packaged spices', hsn: '0910', rate: 5, taxable: 45000, gst: 2250 },
      { product: 'Soap & detergent', hsn: '3401', rate: 18, taxable: 210000, gst: 37800 },
    ]);
    expect(a.tax.by_rate).toEqual([
      { rate: 0, taxable: 187500, gst: 0 },
      { rate: 5, taxable: 365000, gst: 18250 },
      { rate: 18, taxable: 210000, gst: 37800 },
    ]);
  });

  it('within one state: CGST and SGST split equally, no IGST', async () => {
    const a = await assess({ items: PRD_ITEMS }, { deliveryState: MH });
    expect(a.tax).toMatchObject({ basis: 'intra', cgst: 28025, sgst: 28025, igst: 0, gst_total: 56050, grand_total: 818550 });
  });

  it('one GST amount while a state is unknown', async () => {
    const a = await assess({ items: PRD_ITEMS }, { pickupState: null });
    expect(a.tax).toMatchObject({ basis: 'unknown', cgst: 0, sgst: 0, igst: 0, gst_total: 56050, grand_total: 818550 });
  });

  it('works in whole paise: no stray paisa on odd values', () => {
    const t = computeTax(resolveLines([line('Soap', '3401', 10, 100.01), line('Soap', '3401', 10, 200.03)], index), MH, MH);
    expect(t.cgst).toBe(t.sgst);
    expect(Math.round(t.grand_total * 100)).toBe(Math.round(t.taxable * 100) + Math.round(t.gst_total * 100));
    expect(Number.isInteger(Math.round(t.gst_total * 100))).toBe(true);
  });

  it('uses the rate the customer picked for a multi-rate code, else the default', () => {
    const [def] = resolveLines([line('Cement', '2523', 1000, 10000)], index);
    expect(def).toMatchObject({ rate: 12, rate_ambiguous: true, rates: [12, 28] });
    const [picked] = resolveLines([line('Cement', '2523', 1000, 10000, { gst_rate: 28 })], index);
    expect(picked).toMatchObject({ rate: 28, rate_ambiguous: false });
    const [bogus] = resolveLines([line('Cement', '2523', 1000, 10000, { gst_rate: 7 })], index);
    expect(bogus).toMatchObject({ rate: 12, rate_ambiguous: true });
  });

  it('keeps a typed rate for an HSN the master does not have', () => {
    const [l] = resolveLines([line('Odd thing', '99887766', 10, 1000, { gst_rate: 18 })], index);
    expect(l).toMatchObject({ hsn_known: false, rate: 18, rate_ambiguous: false });
  });

  it('taxBasis', () => {
    expect(taxBasis('27', '27')).toBe('intra');
    expect(taxBasis('27', '07')).toBe('inter');
    expect(taxBasis(null, '07')).toBe('unknown');
  });
});

describe('e-way bill rule', () => {
  const lines = (value: number, hsn = '3401') => resolveLines([line('Goods', hsn, 100, value)], index);

  it('is required only over the threshold', () => {
    expect(ewayRule(lines(50000)).required).toBe(false);
    expect(ewayRule(lines(50001)).required).toBe(true);
    expect(ewayRule(lines(762500))).toMatchObject({ required: true, threshold: 50000 });
    expect(ewayRule(lines(762500)).reason).toMatch(/7,62,500.*50,000/);
    expect(ewayRule(lines(0)).required).toBe(false);
  });

  it('adds the values of all lines', () => {
    expect(ewayRule(resolveLines([line('A', '3401', 1, 30000), line('B', '3401', 1, 30000)], index)).required).toBe(true);
  });

  it('is required at any value for hazardous goods', () => {
    const r = ewayRule(lines(100, '3604'));
    expect(r.required).toBe(true);
    expect(r.reason).toMatch(/hazardous/);
  });

  it('takes its threshold from the goods categories', () => {
    const cats = [{ ...CATEGORIES[0], eway_threshold_inr: 20000 }, CATEGORIES[5]];
    expect(ewayThreshold(resolveLines([line('Rice', '1006', 1, 1)], index), cats)).toBe(20000);
    expect(ewayThreshold(resolveLines([line('Soap', '3401', 1, 1)], index), cats)).toBe(50000);
    expect(ewayThreshold([], CATEGORIES)).toBe(50000);
  });

  it('an assessed load reports it', async () => {
    expect((await assess({ items: [line('Soap', '3401', 100, 49999)] })).eway).toMatchObject({ required: false, threshold: 50000 });
    expect((await assess({ items: [line('Soap', '3401', 100, 50001)] })).eway.required).toBe(true);
  });
});

describe('hazmat and the primary commodity', () => {
  it('any hazmat line makes the whole load hazmat_mixed', async () => {
    const mixed = await assess({ items: [line('Soap', '3401', 500, 90000), line('Crackers', '3604', 20, 1000)] });
    expect(mixed.hazmat_mixed).toBe(true);
    expect(mixed.eway.required).toBe(true);
    expect((await assess({ items: [line('Soap', '3401', 500, 900)] })).hazmat_mixed).toBe(false);
  });

  it('also by the product flag, the handling checkbox or the load-wide handling', async () => {
    expect((await assess({ items: [line('Paint', '3401', 5, 10, { is_hazmat: true })] })).hazmat_mixed).toBe(true);
    expect((await assess({ items: [line('Paint', '3401', 5, 10, { handling: ['hazmat'] })] })).hazmat_mixed).toBe(true);
    expect((await assess({ items: [line('Paint', '3401', 5, 10)], special_handling: ['hazmat'] })).hazmat_mixed).toBe(true);
    expect(isHazmatMixed(resolveLines([line('Soap', '3401', 5, 10)], index))).toBe(false);
  });

  it('the primary commodity is the largest value, ties broken by weight', () => {
    const lines = resolveLines(PRD_ITEMS, index);
    expect(primaryLine(lines)?.hsn).toBe('1512');
    const tied = resolveLines([line('Light', '3401', 10, 500), line('Heavy', '1006', 90, 500), line('Lighter', '0910', 5, 500)], index);
    expect(primaryLine(tied)?.product).toBe('Heavy');
    expect(primaryLine([])).toBeNull();
  });
});

describe('vehicle suggestion', () => {
  const need = (weight_kg: number, over = {}) => ({ weight_kg, perishable: false, odc: false, interstate: false, ...over });

  it('picks the smallest closed truck that carries the weight, and FTL from 5 tonnes', () => {
    expect(suggestVehicle(need(800), VEHICLE_CLASSES)).toEqual({ load_type: 'ptl', vehicle_class: 'mini_truck', capacity_t: 1 });
    expect(suggestVehicle(need(3000), VEHICLE_CLASSES)).toMatchObject({ load_type: 'ptl', vehicle_class: 'truck_14ft', capacity_t: 3 });
    expect(suggestVehicle(need(6000), VEHICLE_CLASSES)).toMatchObject({ load_type: 'ftl', vehicle_class: 'truck_17_20ft', capacity_t: 6 });
    expect(suggestVehicle(need(11000), VEHICLE_CLASSES)).toMatchObject({ vehicle_class: 'container_20ft', capacity_t: 11 });
    expect(suggestVehicle(need(13000), VEHICLE_CLASSES)).toMatchObject({ vehicle_class: 'container_32ft_sxl', capacity_t: 15 });
    expect(suggestVehicle(need(20900), VEHICLE_CLASSES)).toMatchObject({ vehicle_class: 'trailer_40ft', capacity_t: 21 });
  });

  it('skips the mini truck interstate', () => {
    expect(suggestVehicle(need(800, { interstate: true }), VEHICLE_CLASSES).vehicle_class).toBe('truck_14ft');
  });

  it('a reefer for perishables, an open body for ODC or heavy steel', () => {
    expect(suggestVehicle(need(3000, { perishable: true }), VEHICLE_CLASSES)).toMatchObject({ vehicle_class: 'reefer', capacity_t: 5 });
    expect(suggestVehicle(need(3000, { odc: true }), VEHICLE_CLASSES).vehicle_class).toBe('flatbed');
    expect(suggestVehicle(need(8000, { primary_category: 'steel_metal' }), VEHICLE_CLASSES, CATEGORIES).vehicle_class).toBe('flatbed');
    expect(suggestVehicle(need(2000, { primary_category: 'steel_metal' }), VEHICLE_CLASSES, CATEGORIES).vehicle_class).toBe('truck_14ft');
  });

  it('beyond the largest truck it still answers, and with no weight or no classes it suggests nothing', () => {
    expect(suggestVehicle(need(40000), VEHICLE_CLASSES).vehicle_class).toBe('trailer_40ft');
    expect(suggestVehicle(need(0), VEHICLE_CLASSES)).toEqual({ load_type: 'ptl', vehicle_class: null, capacity_t: null });
    expect(suggestVehicle(need(5000), []).vehicle_class).toBeNull();
    expect(loadTypeFor(4999)).toBe('ptl');
  });

  it('an assessed load carries the suggestion', async () => {
    const a = await assess({ items: PRD_ITEMS });
    expect(a.suggested).toEqual({ load_type: 'ftl', vehicle_class: 'trailer_40ft', capacity_t: 21 });
  });
});

describe('recommendation codes (PRD 5.2, 5.3)', () => {
  const only = async (code: string, draft: Partial<LoadDraft>, over: AssessRefs = {}) => (await assess(draft, over)).recommendations.find(r => r.code === code);

  it('has a rule for every code in the spec', () => {
    expect(Object.keys(RECOMMENDATION_RULES).sort()).toEqual([
      'budget_below_estimate', 'bulk_template', 'eway_required', 'hazmat_permit', 'hsn_ambiguous', 'interstate_igst', 'multi_rate',
      'no_value', 'perishable_reefer', 'ptl_heavy', 'same_city', 'same_day_pickup', 'weight_over_18t',
    ]);
  });

  it('hsn_ambiguous: "cement" suggests 2523, only while no HSN is chosen', async () => {
    const r = await only('hsn_ambiguous', { items: [{ product_name: 'cement', weight_kg: 100 }] });
    expect(r).toMatchObject({ severity: 'info', action: { field: 'items.0.hsn_code', value: '2523' } });
    expect(r?.message).toMatch(/HSN 2523/);
    expect(await only('hsn_ambiguous', { items: [line('cement', '2523', 100, 1)] })).toBeUndefined();
    expect(await only('hsn_ambiguous', { items: [{ product_name: 'ce' }] })).toBeUndefined();
    expect(await only('hsn_ambiguous', { items: [{ product_name: 'zzzzqqq' }] })).toBeUndefined();
  });

  it('multi_rate: medicine at 5% or 12% asks to select, until one is chosen', async () => {
    const r = await only('multi_rate', { items: [line('Medicine', '3004', 10, 1000)] });
    expect(r).toMatchObject({ severity: 'warn', action: { field: 'items.0.gst_rate' } });
    expect(r?.message).toMatch(/5% OR 12%/);
    expect(await only('multi_rate', { items: [line('Medicine', '3004', 10, 1000, { gst_rate: 12 })] })).toBeUndefined();
    expect(await only('multi_rate', { items: [line('Rice', '1006', 10, 1000)] })).toBeUndefined();
  });

  it('weight_over_18t: recommends a 22-wheel trailer above 18 t only', async () => {
    const r = await only('weight_over_18t', { items: [line('Rice', '1006', 18001, 1)] });
    expect(r).toMatchObject({ severity: 'warn', action: { field: 'vehicle_class', value: 'trailer_40ft' } });
    expect(r?.message).toMatch(/20T\+.*22-wheel/);
    expect(await only('weight_over_18t', { items: [line('Rice', '1006', 18000, 1)] })).toBeUndefined();
  });

  it('ptl_heavy: PTL above 15 t suggests FTL', async () => {
    const r = await only('ptl_heavy', { items: [line('Rice', '1006', 15001, 1)], load_type: 'ptl' });
    expect(r).toMatchObject({ action: { field: 'load_type', value: 'ftl' } });
    expect(await only('ptl_heavy', { items: [line('Rice', '1006', 15001, 1)], load_type: 'ftl' })).toBeUndefined();
    expect(await only('ptl_heavy', { items: [line('Rice', '1006', 15000, 1)], load_type: 'ptl' })).toBeUndefined();
    expect(await only('ptl_heavy', { items: [line('Rice', '1006', 15001, 1)] })).toBeUndefined();
  });

  it('interstate_igst: Mumbai to Delhi names the states; none within a state or while unknown', async () => {
    const r = await only('interstate_igst', { items: [line('Rice', '1006', 1, 1)] });
    expect(r?.message).toMatch(/Maharashtra to Delhi.*IGST/);
    expect(await only('interstate_igst', { items: [line('Rice', '1006', 1, 1)] }, { deliveryState: MH })).toBeUndefined();
    expect(await only('interstate_igst', { items: [line('Rice', '1006', 1, 1)] }, { deliveryState: null })).toBeUndefined();
  });

  it('eway_required: when the e-way bill applies', async () => {
    expect((await only('eway_required', { items: [line('Soap', '3401', 1, 60000)] }))?.message).toMatch(/E-Way Bill/);
    expect(await only('eway_required', { items: [line('Soap', '3401', 1, 40000)] })).toBeUndefined();
    expect(await only('eway_required', { items: [line('Crackers', '3604', 1, 10)] })).toBeDefined();
  });

  it('perishable_reefer: cold goods on a non-reefer, or with no vehicle chosen', async () => {
    const draft = { items: [line('Bananas', '0803', 2000, 1000)] };
    expect(await only('perishable_reefer', draft)).toMatchObject({ severity: 'warn', action: { field: 'vehicle_class', value: 'reefer' } });
    expect(await only('perishable_reefer', { ...draft, vehicle_class: 'container_20ft' })).toBeDefined();
    expect(await only('perishable_reefer', { ...draft, vehicle_class: 'reefer' })).toBeUndefined();
    expect(await only('perishable_reefer', { items: [line('Rice', '1006', 2000, 1)] })).toBeUndefined();
    expect((await assess(draft)).perishable).toBe(true);
  });

  it('hazmat_permit: hazardous goods', async () => {
    expect((await only('hazmat_permit', { items: [line('Crackers', '3604', 20, 10)] }))?.message).toMatch(/ADR/);
    expect(await only('hazmat_permit', { items: [line('Soap', '3401', 20, 10)] })).toBeUndefined();
  });

  it('same_city: ignores case and spacing', async () => {
    const draft = (a: string, b: string) => ({ items: [line('Rice', '1006', 1, 1)], pickup: { city: a }, delivery: { city: b } });
    expect(await only('same_city', draft('Mumbai', ' mumbai '))).toMatchObject({ severity: 'info' });
    expect(await only('same_city', draft('Mumbai', 'Delhi'))).toBeUndefined();
    expect(await only('same_city', { items: [] })).toBeUndefined();
  });

  it('same_day_pickup: only when the pickup is today', async () => {
    const draft = (date: string) => ({ items: [line('Rice', '1006', 1, 1)], pickup: { date } });
    expect((await only('same_day_pickup', draft('2026-10-05')))?.message).toMatch(/24 hours/);
    expect(await only('same_day_pickup', draft('2026-10-06'))).toBeUndefined();
  });

  it('no_value: products without any declared value', async () => {
    expect(await only('no_value', { items: [{ product_name: 'Rice', hsn_code: '1006', weight_kg: 10 }] })).toBeDefined();
    expect(await only('no_value', { items: [line('Rice', '1006', 10, 5)] })).toBeUndefined();
    expect(await only('no_value', { items: [] })).toBeUndefined();
  });

  it('bulk_template: three or more products', async () => {
    const three = [line('A', '1006', 1, 1), line('B', '1006', 1, 1), line('C', '1006', 1, 1)];
    expect(await only('bulk_template', { items: three })).toBeDefined();
    expect(await only('bulk_template', { items: three.slice(0, 2) })).toBeUndefined();
  });

  it('budget_below_estimate: compares the budget with the low end of the estimate', async () => {
    const estimate = { low: 18000, high: 24000, distance_km: 1400, label: ESTIMATE_LABEL };
    const draft = (budget_inr: number) => ({ items: [line('Rice', '1006', 1000, 1)], budget_inr });
    const r = await only('budget_below_estimate', draft(15000), { estimate });
    expect(r).toMatchObject({ severity: 'warn', action: { field: 'budget_inr', value: 18000 } });
    expect(r?.message).toMatch(/₹15,000.*₹18,000\+/);
    expect(await only('budget_below_estimate', draft(18000), { estimate })).toBeUndefined();
    expect(await only('budget_below_estimate', draft(15000), { estimate: null })).toBeUndefined();
    expect(await only('budget_below_estimate', { items: [line('Rice', '1006', 1000, 1)] }, { estimate })).toBeUndefined();
  });

  it('a clean small intrastate load raises none of them', async () => {
    const a = await assess({ items: [line('Rice', '1006', 500, 20000)], pickup: { city: 'Mumbai' }, delivery: { city: 'Pune' } }, { deliveryState: MH });
    expect(codesOf(a)).toEqual([]);
  });
});

describe('POST /public/loads/assist', () => {
  const app = testApp();
  beforeEach(() => supabaseMock.reset({ ...goodsTables(), system_settings: [{ key: 'rate_per_km', value: { rate: 20 } }] }));

  const draft = (over: Record<string, unknown> = {}) => ({
    items: PRD_ITEMS.map(i => ({ ...i, quantity: 1, unit: 'box' })),
    pickup: { city: 'Mumbai', pincode: '400001' },
    delivery: { city: 'Delhi', pincode: '110001' },
    ...over,
  });

  it('needs no sign-in and answers in the exact shape of the spec', async () => {
    const res = await request(app).post('/api/v1/public/loads/assist').send(draft());
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['estimate', 'eway', 'hazmat_mixed', 'perishable', 'recommendations', 'suggested', 'tax', 'totals']);
    expect(Object.keys(res.body.tax).sort()).toEqual(['basis', 'by_rate', 'cgst', 'delivery_state', 'delivery_state_code', 'grand_total', 'gst_total', 'igst', 'lines', 'pickup_state', 'pickup_state_code', 'sgst', 'taxable']);
    expect(Object.keys(res.body.eway).sort()).toEqual(['reason', 'required', 'threshold']);
    expect(Object.keys(res.body.suggested).sort()).toEqual(['capacity_t', 'load_type', 'vehicle_class']);
    expect(res.body.totals).toEqual({ weight_kg: 20900, declared_value: 762500, product_count: 4 });
    // states come from the pin codes: the full row for 400001, the prefix map for 110001
    expect(res.body.tax).toMatchObject({ basis: 'inter', pickup_state: 'Maharashtra', delivery_state: 'Delhi', igst: 56050, grand_total: 818550 });
    expect(res.body.eway.required).toBe(true);
    expect(res.body.estimate).toBeNull();
    expect(res.body.recommendations.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(['interstate_igst', 'eway_required', 'weight_over_18t', 'bulk_template']));
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('adds the freight estimate when both ends have coordinates, and compares the budget', async () => {
    const res = await request(app).post('/api/v1/public/loads/assist').send(draft({
      pickup: { city: 'Mumbai', pincode: '400001', lat: 19.07, lng: 72.87 },
      delivery: { city: 'Delhi', pincode: '110001', lat: 28.61, lng: 77.2 },
      budget_inr: 1000,
    }));
    expect(res.status).toBe(200);
    expect(res.body.estimate).toMatchObject({ label: 'Actual rate confirmed after carrier assignment' });
    expect(res.body.estimate.low).toBeGreaterThan(1000);
    expect(res.body.estimate.low).toBeLessThanOrEqual(res.body.estimate.high);
    expect(res.body.estimate.distance_km).toBeGreaterThan(1000);
    expect(res.body.recommendations.map((r: { code: string }) => r.code)).toContain('budget_below_estimate');
  });

  it('answers for a half-filled form', async () => {
    const res = await request(app).post('/api/v1/public/loads/assist').send({ items: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totals: { weight_kg: 0, declared_value: 0, product_count: 0 }, tax: { basis: 'unknown', grand_total: 0 }, eway: { required: false }, estimate: null });
  });

  it('rejects a malformed draft', async () => {
    const post = (b: unknown) => request(app).post('/api/v1/public/loads/assist').send(b as object);
    expect((await post({})).status).toBe(400);
    expect((await post({ items: Array.from({ length: 51 }, () => ({})) })).status).toBe(400);
    expect((await post({ items: [{ weight_kg: -1 }] })).status).toBe(400);
    expect((await post({ items: [], pickup: { pincode: '12' } })).status).toBe(400);
  });
});
