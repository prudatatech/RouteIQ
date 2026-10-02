/**
 * margixindia — Load type and vehicle class suggestion (PRD 7 and 7.1). Pure: the vehicle classes and goods
 * categories come from the database and are passed in.
 */
import type { GoodsCategory, VehicleClass } from './master';
import type { GoodsLine, LoadType, Suggested } from './types';

/** From this weight a load is a full truck load; below it, part (PTL). The large truck of PRD 7.1 starts at 5 t. */
export const FTL_MIN_KG = 5000;
/** A flatbed is suggested over a closed truck from this weight, for goods whose category recommends one. */
const OPEN_BODY_MIN_KG = 5000;

export const loadTypeFor = (weightKg: number): LoadType => (weightKg >= FTL_MIN_KG ? 'ftl' : 'ptl');

export interface VehicleNeeds {
  weight_kg: number;
  perishable: boolean;
  /** Over-dimensional cargo ("odc" in the special handling) needs an open body */
  odc: boolean;
  interstate: boolean;
  /** The category of the primary commodity */
  primary_category?: string | null;
}

const fits = (c: VehicleClass, weightKg: number) => c.max_t != null && c.max_t * 1000 >= weightKg;

/**
 * The vehicle class for a load: a reefer for perishables, an open body for ODC (or for heavy goods whose category
 * recommends one), otherwise the smallest closed truck that carries the weight (a mini truck is skipped for
 * interstate, it cannot run without a permit). capacity_t is the weight rounded up to half a tonne, and at least the
 * class minimum.
 */
export function suggestVehicle(needs: VehicleNeeds, classes: VehicleClass[], categories: GoodsCategory[] = []): Suggested {
  const load_type = loadTypeFor(needs.weight_kg);
  if (!(needs.weight_kg > 0) || !classes.length) return { load_type, vehicle_class: null, capacity_t: null };

  const ordered = [...classes].filter(c => !c.is_tanker).sort((a, b) => a.sort - b.sort);
  const recommended = categories.find(c => c.key === needs.primary_category)?.recommended_vehicle_class;
  const recommendedClass = recommended ? ordered.find(c => c.key === recommended) : undefined;

  let chosen: VehicleClass | undefined;
  if (needs.perishable) chosen = ordered.find(c => c.is_reefer);
  if (!chosen && needs.odc) chosen = ordered.find(c => c.is_open);
  if (!chosen && recommendedClass?.is_open && needs.weight_kg >= OPEN_BODY_MIN_KG && fits(recommendedClass, needs.weight_kg)) chosen = recommendedClass;
  if (!chosen) {
    const closed = ordered.filter(c => !c.is_reefer && !c.is_open && (c.interstate_ok || !needs.interstate));
    chosen = closed.find(c => fits(c, needs.weight_kg)) ?? closed[closed.length - 1] ?? ordered[ordered.length - 1];
  }
  const rounded = Math.ceil(needs.weight_kg / 500) / 2;
  return { load_type, vehicle_class: chosen.key, capacity_t: Math.max(rounded, chosen.min_t ?? 0) };
}

/** What a draft needs from the vehicle, read from its goods lines and special handling. */
export function vehicleNeedsOf(lines: GoodsLine[], special: string[], interstate: boolean, primaryCategory: string | null): VehicleNeeds {
  const handling = [...special, ...lines.flatMap(l => l.handling)].map(h => h.toLowerCase());
  return {
    weight_kg: lines.reduce((s, l) => s + l.weight_kg, 0),
    perishable: lines.some(l => l.perishable),
    odc: handling.includes('odc'),
    interstate,
    primary_category: primaryCategory,
  };
}
