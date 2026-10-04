/**
 * margixindia — The load assistant (POST /public/loads/assist): totals, GST per line, the e-way bill rule, hazmat,
 * the suggested vehicle, the freight estimate and the recommendations for a draft load. `assessLoad` is exported so
 * the load submission service recomputes the same numbers server-side (client figures are never trusted).
 */
import { z } from 'zod';
import { GST_STATES } from '../../core/gst';
import { indianDateKey } from '../../core/istDate';
import { marketFreightService } from './freight';
import { HsnHit, HsnIndex, loadHsnIndex, searchHsn } from './hsn-index';
import { GoodsCategory, loadGoodsCategories, loadVehicleClasses, VehicleClass } from './master';
import { lookupPincode } from './pincode';
import { buildRecommendations } from './recommendations';
import { computeTax, ewayRule, ewayThreshold, isHazmatMixed, primaryLine, resolveLines, totalValue, totalWeightKg } from './tax';
import type { DraftPlace, Estimate, LoadAssessment, LoadDraft } from './types';
import { suggestVehicle, vehicleNeedsOf } from './vehicle';

export { ESTIMATE_LABEL } from './freight';
/** At most this many lines are asked for an HSN suggestion (the search is the costly part). */
const HINT_LINES = 10;

const text = (max: number) => z.string().trim().max(max).nullish();
const place = z.object({
  city: text(80),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Pin code must be 6 digits').nullish().or(z.literal('').transform(() => null)),
  state_code: z.string().trim().regex(/^[0-9]{2}$/).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullish(),
});
const item = z.object({
  product_name: text(200),
  hsn_code: z.string().trim().max(10).nullish(),
  gst_rate: z.number().min(0).max(100).nullish(),
  quantity: z.number().min(0).max(1e9).nullish(),
  unit: text(30),
  weight_kg: z.number().min(0).max(1_000_000).nullish(),
  declared_value: z.number().min(0).max(1e11).nullish(),
  handling: z.array(z.string().trim().max(30)).max(10).nullish(),
  is_hazmat: z.boolean().nullish(),
  is_perishable: z.boolean().nullish(),
});

/**
 * The web form and POST /vendor/loads send a flat body (pickup_city, pickup_pincode, ...); the assistant reads
 * nested places. Accepts either and returns the nested draft (extra keys are dropped by the schema).
 */
export function toNestedDraft(body: any): unknown {
  if (!body || typeof body !== 'object' || body.pickup || body.delivery) return body;
  const place = (side: 'pickup' | 'delivery') => ({
    city: body[`${side}_city`] ?? null,
    pincode: body[`${side}_pincode`] ?? null,
    state_code: body[`${side}_state_code`] ?? null,
    lat: body[`${side}_lat`] ?? null,
    lng: body[`${side}_lng`] ?? null,
    date: body[`${side}_date`] ?? null,
  });
  return { ...body, pickup: place('pickup'), delivery: place('delivery') };
}

/** The draft load the assistant accepts: at most 50 products (docs/load-posting-design.md section 2). */
export const LoadDraftSchema = z.object({
  items: z.array(item).max(50),
  pickup: place.nullish(),
  delivery: place.nullish(),
  load_type: z.enum(['ftl', 'ptl']).nullish(),
  vehicle_class: z.string().trim().max(40).nullish(),
  capacity_t: z.number().min(0).max(100).nullish(),
  special_handling: z.array(z.string().trim().max(30)).max(10).nullish(),
  budget_inr: z.number().min(0).max(1e9).nullish(),
});

/** What `assessLoad` takes from outside the draft; every part defaults to a database read. */
export interface AssessRefs {
  index?: HsnIndex;
  classes?: VehicleClass[];
  categories?: GoodsCategory[];
  /** GST state codes of the two ends; looked up from the pin codes when omitted */
  pickupState?: string | null;
  deliveryState?: string | null;
  /** null: no estimate */
  estimate?: Estimate | null;
  /** The Indian calendar day, YYYY-MM-DD */
  today?: string;
}

const validState = (code: string | null | undefined) => (code && GST_STATES[code] ? code : null);

/** The pin code decides the state (the client's code can be stale or wrong); the client's code is used only when the pin is unknown. */
export async function stateOfPlace(p: DraftPlace | null | undefined): Promise<string | null> {
  if (!p) return null;
  const fromPin = p.pincode ? validState((await lookupPincode(p.pincode))?.state_code) : null;
  return fromPin ?? validState(p.state_code);
}

/** The same owner-provided reference range is used by the guest form and by server-side load creation. */
export async function estimateFreight(draft: LoadDraft, weightKg: number, vehicleClass: string | null, classes?: VehicleClass[]): Promise<Estimate | null> {
  const a = draft.pickup, b = draft.delivery;
  if (!(weightKg > 0) || a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null;
  try {
    const vehicle = (classes ?? await loadVehicleClasses()).find(v => v.key === vehicleClass);
    return await marketFreightService.estimate(draft, weightKg, vehicle);
  } catch {
    return null;
  }
}

/**
 * Everything the form needs while it is being filled in. Never throws for a half-filled draft: missing values
 * simply leave the matching part empty (unknown tax basis, no estimate, no suggestion).
 */
export async function assessLoad(draft: LoadDraft, refs: AssessRefs = {}): Promise<LoadAssessment> {
  const [index, classes, categories, pickupState, deliveryState] = await Promise.all([
    refs.index ?? loadHsnIndex(),
    refs.classes ?? loadVehicleClasses(),
    refs.categories ?? loadGoodsCategories(),
    refs.pickupState !== undefined ? refs.pickupState : stateOfPlace(draft.pickup),
    refs.deliveryState !== undefined ? refs.deliveryState : stateOfPlace(draft.delivery),
  ]);

  const lines = resolveLines(draft.items ?? [], index);
  const tax = computeTax(lines, pickupState, deliveryState);
  const weight = totalWeightKg(lines);
  const value = totalValue(lines);
  const special = (draft.special_handling ?? []).map(h => h.toLowerCase());
  const primary = primaryLine(lines);
  const hazmat_mixed = isHazmatMixed(lines) || special.includes('hazmat');
  const perishable = lines.some(l => l.perishable);
  const suggested = suggestVehicle(vehicleNeedsOf(lines, special, tax.basis === 'inter', primary?.category ?? null), classes, categories);
  const estimate = refs.estimate !== undefined ? refs.estimate : await estimateFreight(draft, weight, draft.vehicle_class ?? suggested.vehicle_class, classes);
  const eway = ewayRule(special.includes('hazmat') ? lines.map(l => ({ ...l, eway_always: true })) : lines, ewayThreshold(lines, categories));

  const hsnHints: HsnHit[][] = lines.map((l, i) => (!l.hsn && l.product.length >= 3 && i < HINT_LINES ? searchHsn(index, l.product) : []));

  const recommendations = buildRecommendations({
    lines, hsnHints, total_weight_kg: weight, total_value: value, tax, eway, hazmat_mixed, perishable,
    load_type: draft.load_type ?? null, vehicle_class: draft.vehicle_class ?? null, vehicle_classes: classes, suggested,
    pickup_city: draft.pickup?.city ?? null, delivery_city: draft.delivery?.city ?? null,
    pickup_date: draft.pickup?.date ?? null, today: refs.today ?? indianDateKey(new Date()),
    budget_inr: draft.budget_inr ?? null, estimate,
  });

  return {
    totals: { weight_kg: weight, declared_value: value, product_count: lines.length },
    eway, tax: { ...tax, pickup_state_code: pickupState, delivery_state_code: deliveryState },
    hazmat_mixed, perishable, suggested, estimate, recommendations,
  };
}
