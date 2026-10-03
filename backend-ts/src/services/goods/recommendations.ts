/**
 * margixindia — The smart recommendation engine (PRD 5.2 and 5.3). One pure function per recommendation code; each
 * takes the assessed load (`RecommendCtx`) and returns a recommendation or null. `buildRecommendations` runs them all.
 */
import type { HsnHit } from './hsn-index';
import type { VehicleClass } from './master';
import { inr } from './tax';
import type { Estimate, EwayRule, GoodsLine, LoadType, Recommendation, Suggested, TaxSummary } from './types';

/** The thresholds of PRD 5.2, in kilograms. */
export const HEAVY_LOAD_KG = 18000;
export const PTL_MAX_KG = 15000;
export const BULK_TEMPLATE_MIN_PRODUCTS = 3;

export interface RecommendCtx {
  lines: GoodsLine[];
  /** For a line with no HSN yet: what the search found for its product name (same order as `lines`) */
  hsnHints: HsnHit[][];
  total_weight_kg: number;
  total_value: number;
  tax: TaxSummary;
  eway: EwayRule;
  hazmat_mixed: boolean;
  perishable: boolean;
  /** What the customer chose; null until chosen */
  load_type: LoadType | null;
  vehicle_class: string | null;
  vehicle_classes: VehicleClass[];
  suggested: Suggested;
  pickup_city: string | null;
  delivery_city: string | null;
  pickup_date: string | null;
  /** The Indian calendar day, YYYY-MM-DD */
  today: string;
  budget_inr: number | null;
  estimate: Estimate | null;
}

export type Rule = (ctx: RecommendCtx) => Recommendation | null;

const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
const stateName = (name: string | null, fallback: string) => name ?? fallback;
const ratesText = (rates: number[]) => rates.map(r => `${r}%`).join(' OR ');

/** The first typed product with no HSN yet that the master can suggest a code for ("cement" -> 2523). */
export const hsnAmbiguous: Rule = ctx => {
  for (let i = 0; i < ctx.lines.length; i++) {
    const hit = !ctx.lines[i].hsn ? ctx.hsnHints[i]?.[0] : undefined;
    if (!hit) continue;
    return {
      code: 'hsn_ambiguous', severity: 'info',
      message: `HSN ${hit.hsn_code} · ${hit.description} · ${ratesText(hit.gst_rates)} GST. Did you mean this for "${ctx.lines[i].product}"?`,
      action: { field: `items.${i}.hsn_code`, value: hit.hsn_code },
    };
  }
  return null;
};

/** An HSN with several GST rates and none chosen yet (PRD 3.4). */
export const multiRate: Rule = ctx => {
  const i = ctx.lines.findIndex(l => l.rate_ambiguous);
  if (i < 0) return null;
  const l = ctx.lines[i];
  return {
    code: 'multi_rate', severity: 'warn',
    message: `HSN ${l.hsn} has more than one GST rate (${ratesText(l.rates)}). Please select the applicable one for ${l.product || 'this product'}.`,
    action: { field: `items.${i}.gst_rate`, value: l.rates[0] },
  };
};

/** Over 18 tonnes: a 20 t+ vehicle, a 22-wheel trailer. */
export const weightOver18t: Rule = ctx => {
  if (!(ctx.total_weight_kg > HEAVY_LOAD_KG)) return null;
  const trailer = ctx.vehicle_classes.filter(c => !c.is_tanker && !c.is_reefer && !c.is_open && (c.min_t ?? 0) >= 20).sort((a, b) => a.sort - b.sort)[0];
  return {
    code: 'weight_over_18t', severity: 'warn',
    message: 'Your load may require a 20T+ vehicle. We recommend a 22-wheel trailer.',
    ...(trailer ? { action: { field: 'vehicle_class', value: trailer.key } } : {}),
  };
};

/** PTL chosen for more than 15 tonnes. */
export const ptlHeavy: Rule = ctx => {
  if (ctx.load_type !== 'ptl' || !(ctx.total_weight_kg > PTL_MAX_KG)) return null;
  return {
    code: 'ptl_heavy', severity: 'warn',
    message: 'This weight is usually a Full Truck Load. Would you like to switch to FTL?',
    action: { field: 'load_type', value: 'ftl' },
  };
};

/** Different pickup and delivery states: IGST, not CGST+SGST. */
export const interstateIgst: Rule = ctx => {
  if (ctx.tax.basis !== 'inter') return null;
  return {
    code: 'interstate_igst', severity: 'info',
    message: `This load crosses states (${stateName(ctx.tax.pickup_state, 'pickup')} to ${stateName(ctx.tax.delivery_state, 'delivery')}). IGST applies, not CGST+SGST.`,
  };
};

/** The e-way bill applies: over the value threshold, or hazardous goods. */
export const ewayRequired: Rule = ctx => {
  if (!ctx.eway.required) return null;
  return {
    code: 'eway_required', severity: 'info',
    message: `An e-Way Bill is needed (${ctx.eway.reason.startsWith('Required at any value') ? 'hazardous goods' : `value above ${inr(ctx.eway.threshold)}`}). You or the company add it after a carrier is assigned.`,
  };
};

/** Perishables on a vehicle that is not a reefer (or none chosen yet). */
export const perishableReefer: Rule = ctx => {
  if (!ctx.perishable) return null;
  const chosen = ctx.vehicle_classes.find(c => c.key === ctx.vehicle_class);
  if (chosen?.is_reefer) return null;
  const reefer = ctx.vehicle_classes.find(c => c.is_reefer);
  return {
    code: 'perishable_reefer', severity: 'warn',
    message: 'Cold chain vehicle recommended. Select a Reefer truck in the transport type.',
    ...(reefer ? { action: { field: 'vehicle_class', value: reefer.key } } : {}),
  };
};

/** A hazardous product on the load. */
export const hazmatPermit: Rule = ctx => {
  if (!ctx.hazmat_mixed) return null;
  return {
    code: 'hazmat_permit', severity: 'warn',
    message: 'Special permit required. The driver ADR card and hazmat placards will be verified. Only hazmat-certified vehicles can carry this load.',
  };
};

/** The same pickup and delivery city. */
export const sameCity: Rule = ctx => {
  if (!same(ctx.pickup_city, ctx.delivery_city)) return null;
  return {
    code: 'same_city', severity: 'info',
    message: 'Pickup and delivery city are the same. Is this a local, intra-city delivery?',
  };
};


/** Products listed but no goods value entered. */
export const noValue: Rule = ctx => {
  if (!ctx.lines.length || ctx.total_value > 0) return null;
  return {
    code: 'no_value', severity: 'info',
    message: 'Entering goods value helps generate accurate freight quotes and the e-Way Bill.',
  };
};

/** Three or more products: the bulk template. */
export const bulkTemplate: Rule = ctx => {
  if (ctx.lines.length < BULK_TEMPLATE_MIN_PRODUCTS) return null;
  return {
    code: 'bulk_template', severity: 'info',
    message: 'You can download a template to fill in bulk and upload. It saves time for repeat loads.',
  };
};

/** The freight budget is under the low end of the market estimate (PRD 5.3). */
export const budgetBelowEstimate: Rule = ctx => {
  if (!ctx.estimate || ctx.budget_inr == null || !(ctx.budget_inr > 0) || ctx.budget_inr >= ctx.estimate.low) return null;
  return {
    code: 'budget_below_estimate', severity: 'warn',
    message: `Your budget (${inr(ctx.budget_inr)}) is below the market estimate. We recommend adjusting to ${inr(ctx.estimate.low)}+.`,
    action: { field: 'budget_inr', value: ctx.estimate.low },
  };
};

/** A mini truck chosen for a load that crosses states: it cannot run interstate without a permit. */
export const miniTruckInterstate: Rule = ctx => {
  if (ctx.tax.basis !== 'inter') return null;
  const chosen = ctx.vehicle_classes.find(c => c.key === ctx.vehicle_class);
  if (!chosen || chosen.interstate_ok) return null;
  const alt = ctx.suggested.vehicle_class && ctx.suggested.vehicle_class !== chosen.key ? ctx.vehicle_classes.find(c => c.key === ctx.suggested.vehicle_class && c.interstate_ok) : undefined;
  return {
    code: 'mini_truck_interstate', severity: 'warn',
    message: `${chosen.name} can't run interstate without a permit. This load crosses states, so choose a larger vehicle.`,
    ...(alt ? { action: { field: 'vehicle_class', value: alt.key } } : {}),
  };
};

/** Every rule by its recommendation code, in the order they are shown. */
export const RECOMMENDATION_RULES: Record<string, Rule> = {
  hsn_ambiguous: hsnAmbiguous,
  multi_rate: multiRate,
  weight_over_18t: weightOver18t,
  ptl_heavy: ptlHeavy,
  interstate_igst: interstateIgst,
  eway_required: ewayRequired,
  perishable_reefer: perishableReefer,
  hazmat_permit: hazmatPermit,
  same_city: sameCity,
  no_value: noValue,
  bulk_template: bulkTemplate,
  budget_below_estimate: budgetBelowEstimate,
  mini_truck_interstate: miniTruckInterstate,
};

export function buildRecommendations(ctx: RecommendCtx): Recommendation[] {
  return Object.values(RECOMMENDATION_RULES).map(rule => rule(ctx)).filter((r): r is Recommendation => r !== null);
}
