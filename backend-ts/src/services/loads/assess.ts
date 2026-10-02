/**
 * margixindia — Load assessment seam.
 *
 * `assessLoad(draft)` returns the shape of POST /public/loads/assist (docs/load-posting-design.md section 1):
 * totals, e-way bill need, tax by line and by rate, hazmat/perishable flags, a suggested load type and the
 * recommendations. Load posting calls it to recompute everything on the server, so client numbers are never trusted.
 *
 * // replaced by services/goods at merge
 * This is a minimal stand-in: totals, the e-way bill over ₹50,000 (or any hazmat line) and the tax basis by
 * comparing the draft's state codes, or, failing that, the first 2 digits of the two pin codes (a placeholder, not a
 * state lookup). No estimate, no recommendations, no vehicle recommendation.
 */
import { fromPaise, taxLines, toPaise } from '../../core/gst';

export const EWAY_THRESHOLD_INR = 50_000;

export interface AssessItem {
  product_name?: string | null;
  hsn_code?: string | null;
  gst_rate?: number | null;
  weight_kg?: number | null;
  declared_value?: number | null;
  is_hazmat?: boolean | null;
  is_perishable?: boolean | null;
}

export interface LoadDraftLike {
  items: AssessItem[];
  pickup_pincode?: string | null;
  delivery_pincode?: string | null;
  pickup_state_code?: string | null;
  delivery_state_code?: string | null;
  pickup_date?: string | null;
  load_type?: string | null;
  vehicle_class?: string | null;
  capacity_t?: number | null;
  budget_inr?: number | null;
}

export interface Recommendation {
  code: string;
  severity: 'info' | 'warn';
  message: string;
  action?: { field: string; value: unknown };
}

export interface LoadAssessment {
  totals: { weight_kg: number; declared_value: number; product_count: number };
  eway: { required: boolean; threshold: number; reason: string };
  tax: {
    basis: 'intra' | 'inter' | 'unknown';
    pickup_state: string | null;
    delivery_state: string | null;
    lines: Array<{ product: string; hsn: string | null; rate: number; taxable: number; gst: number }>;
    by_rate: Array<{ rate: number; taxable: number; gst: number }>;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    gst_total: number;
    grand_total: number;
  };
  hazmat_mixed: boolean;
  perishable: boolean;
  suggested: { load_type: 'ftl' | 'ptl'; vehicle_class: string | null; capacity_t: number };
  estimate: { low: number; high: number; distance_km: number; label: string } | null;
  recommendations: Recommendation[];
}

const PIN = /^\d{6}$/;
const positive = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** The tax basis: state codes when both are known, else the first 2 pin code digits (placeholder). */
function basisOf(d: LoadDraftLike): 'intra' | 'inter' | 'unknown' {
  const from = d.pickup_state_code || (PIN.test(d.pickup_pincode ?? '') ? d.pickup_pincode!.slice(0, 2) : null);
  const to = d.delivery_state_code || (PIN.test(d.delivery_pincode ?? '') ? d.delivery_pincode!.slice(0, 2) : null);
  if (!from || !to) return 'unknown';
  return from === to ? 'intra' : 'inter';
}

export function assessLoad(draft: LoadDraftLike): LoadAssessment {
  const items = draft.items ?? [];
  const basis = basisOf(draft);
  const weight = items.reduce((s, i) => s + positive(i.weight_kg), 0);
  const valuePaise = items.reduce((s, i) => s + toPaise(positive(i.declared_value)), 0);

  const lines = items.map(i => {
    const rate = positive(i.gst_rate);
    return { product: i.product_name ?? '', hsn: i.hsn_code ?? null, rate, t: taxLines(toPaise(positive(i.declared_value)), rate, basis) };
  });
  const sum = (pick: (t: ReturnType<typeof taxLines>) => number) => lines.reduce((s, l) => s + pick(l.t), 0);
  const byRate = new Map<number, { taxable: number; gst: number }>();
  for (const l of lines) {
    const row = byRate.get(l.rate) ?? { taxable: 0, gst: 0 };
    row.taxable += l.t.taxable;
    row.gst += l.t.tax;
    byRate.set(l.rate, row);
  }
  const taxable = sum(t => t.taxable);
  const gstTotal = sum(t => t.tax);

  const hazmat = items.some(i => i.is_hazmat);
  const overValue = valuePaise > toPaise(EWAY_THRESHOLD_INR);

  return {
    totals: { weight_kg: Math.round(weight * 100) / 100, declared_value: fromPaise(valuePaise), product_count: items.length },
    eway: {
      required: overValue || hazmat,
      threshold: EWAY_THRESHOLD_INR,
      reason: hazmat ? 'Hazardous goods need an e-way bill at any value'
        : overValue ? `Declared value is above ₹${EWAY_THRESHOLD_INR.toLocaleString('en-IN')}` : 'Declared value is within the limit',
    },
    tax: {
      basis,
      pickup_state: draft.pickup_state_code ?? null,
      delivery_state: draft.delivery_state_code ?? null,
      lines: lines.map(l => ({ product: l.product, hsn: l.hsn, rate: l.rate, taxable: fromPaise(l.t.taxable), gst: fromPaise(l.t.tax) })),
      by_rate: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, taxable: fromPaise(v.taxable), gst: fromPaise(v.gst) })),
      taxable: fromPaise(taxable),
      cgst: fromPaise(sum(t => t.cgst)),
      sgst: fromPaise(sum(t => t.sgst)),
      igst: fromPaise(sum(t => t.igst)),
      gst_total: fromPaise(gstTotal),
      grand_total: fromPaise(taxable + gstTotal),
    },
    hazmat_mixed: hazmat,
    perishable: items.some(i => i.is_perishable),
    suggested: {
      load_type: weight > 3000 ? 'ftl' : 'ptl',
      vehicle_class: draft.vehicle_class ?? null,
      capacity_t: Math.max(0.5, Math.ceil((weight / 1000) * 10) / 10),
    },
    estimate: null,
    recommendations: [],
  };
}
