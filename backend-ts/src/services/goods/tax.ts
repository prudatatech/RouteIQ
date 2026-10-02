/**
 * margixindia — Goods lines, GST per line, the e-way bill rule, hazmat and the primary commodity (PRD 3.4, 4.4, 8.3).
 * Pure functions: the HSN index and the reference tables are passed in. Tax is worked out in integer paise through
 * core/gst.ts taxLines and shown in rupees at the edge.
 */
import { fromPaise, GST_STATES, taxLines, toPaise, TaxBasis } from '../../core/gst';
import { HsnIndex, resolveHsn } from './hsn-index';
import type { GoodsCategory } from './master';
import type { DraftItem, EwayRule, GoodsLine, TaxByRate, TaxLine, TaxSummary } from './types';

/** The e-way bill value threshold when the goods categories do not say otherwise. */
export const DEFAULT_EWAY_THRESHOLD_INR = 50000;

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Looks each product up in the HSN master and settles its rate. */
export function resolveLines(items: DraftItem[], index: HsnIndex): GoodsLine[] {
  return items.map(item => {
    const hsn = (item.hsn_code ?? '').trim() || null;
    const entry = hsn ? resolveHsn(index, hsn)?.entry ?? null : null;
    const chosen = typeof item.gst_rate === 'number' && Number.isFinite(item.gst_rate) ? item.gst_rate : null;
    const rates = entry ? entry.gst_rates : chosen != null ? [chosen] : [];
    const picked = chosen != null && rates.includes(chosen);
    const handling = (item.handling ?? []).map(h => h.toLowerCase());
    return {
      product: (item.product_name ?? '').trim(),
      hsn,
      hsn_known: !!entry,
      rate: entry ? (picked ? chosen : entry.gst_rate) : chosen,
      rates,
      rate_ambiguous: !!entry && rates.length > 1 && !picked,
      weight_kg: finite(item.weight_kg),
      value: finite(item.declared_value),
      hazmat: !!item.is_hazmat || !!entry?.is_hazmat || handling.includes('hazmat'),
      perishable: !!item.is_perishable || !!entry?.is_perishable,
      eway_always: !!entry?.eway_always || !!item.is_hazmat || handling.includes('hazmat'),
      category: entry?.category ?? null,
      handling,
    };
  });
}

export const totalWeightKg = (lines: GoodsLine[]) => lines.reduce((s, l) => s + l.weight_kg, 0);
export const totalValue = (lines: GoodsLine[]) => fromPaise(lines.reduce((s, l) => s + toPaise(l.value), 0));

/** CGST+SGST inside one state, IGST between states, unknown until both states are known. */
export function taxBasis(pickupState: string | null, deliveryState: string | null): 'intra' | 'inter' | 'unknown' {
  if (!pickupState || !deliveryState) return 'unknown';
  return pickupState === deliveryState ? 'intra' : 'inter';
}

/** GST for every line at its own rate (PRD 4.4), added up by rate. The states are GST state codes; the summary carries their names. */
export function computeTax(lines: GoodsLine[], pickupState: string | null, deliveryState: string | null): TaxSummary {
  const basis = taxBasis(pickupState, deliveryState);
  const out: TaxLine[] = [];
  const byRate = new Map<number, { taxable: number; gst: number }>();
  let taxable = 0, cgst = 0, sgst = 0, igst = 0, gst = 0;
  for (const l of lines) {
    const rate = l.rate ?? 0;
    const t = taxLines(toPaise(l.value), rate, basis as TaxBasis);
    const lineGst = t.tax;
    out.push({ product: l.product, hsn: l.hsn, rate, taxable: fromPaise(t.taxable), gst: fromPaise(lineGst) });
    const slot = byRate.get(rate) ?? { taxable: 0, gst: 0 };
    slot.taxable += t.taxable;
    slot.gst += lineGst;
    byRate.set(rate, slot);
    taxable += t.taxable;
    cgst += t.cgst;
    sgst += t.sgst;
    igst += t.igst;
    gst += lineGst;
  }
  const by_rate: TaxByRate[] = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, taxable: fromPaise(v.taxable), gst: fromPaise(v.gst) }));
  return {
    basis, pickup_state: pickupState ? (GST_STATES[pickupState] ?? pickupState) : null, delivery_state: deliveryState ? (GST_STATES[deliveryState] ?? deliveryState) : null, lines: out, by_rate,
    taxable: fromPaise(taxable), cgst: fromPaise(cgst), sgst: fromPaise(sgst), igst: fromPaise(igst),
    gst_total: fromPaise(gst), grand_total: fromPaise(taxable + gst),
  };
}

/** The value threshold for these goods: the lowest positive one among their categories, else the default. */
export function ewayThreshold(lines: GoodsLine[], categories: GoodsCategory[]): number {
  const wanted = new Set(lines.map(l => l.category).filter(Boolean));
  const found = categories.filter(c => wanted.has(c.key) && c.eway_threshold_inr > 0).map(c => c.eway_threshold_inr);
  return found.length ? Math.min(...found) : DEFAULT_EWAY_THRESHOLD_INR;
}

/** E-way bill: required when the total value is over the threshold, or when any line is hazardous (any value). */
export function ewayRule(lines: GoodsLine[], threshold = DEFAULT_EWAY_THRESHOLD_INR): EwayRule {
  const value = totalValue(lines);
  const always = lines.find(l => l.eway_always);
  if (always) {
    return { required: true, threshold, reason: `Required at any value because ${always.product || 'a product'} is hazardous goods` };
  }
  if (value > threshold) {
    return { required: true, threshold, reason: `Required because the total value ${inr(value)} exceeds ${inr(threshold)}` };
  }
  return { required: false, threshold, reason: `Not required, the total value ${inr(value)} is within ${inr(threshold)}` };
}

/** Any hazardous line makes the whole load hazmat-mixed and limits it to hazmat-certified vehicles (PRD 4.4). */
export const isHazmatMixed = (lines: GoodsLine[]): boolean => lines.some(l => l.hazmat);

/** The primary commodity: the line of the highest value, ties broken by weight (then the first listed). */
export function primaryLine(lines: GoodsLine[]): GoodsLine | null {
  let best: GoodsLine | null = null;
  for (const l of lines) {
    if (!best || l.value > best.value || (l.value === best.value && l.weight_kg > best.weight_kg)) best = l;
  }
  return best;
}
