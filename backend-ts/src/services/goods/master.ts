/**
 * margixindia — The small goods reference tables (vehicle classes, goods categories, pin prefixes), read from the
 * database and kept in memory for 10 minutes. The platform admin edits them; no value here is hardcoded.
 */
import { supabase } from '../../core/supabase';
import { memoize } from '../../core/memo';
import { HSN_CACHE_TTL_MS } from './hsn-index';

export interface VehicleClass {
  key: string;
  name: string;
  min_t: number | null;
  max_t: number | null;
  best_for: string | null;
  notes: string | null;
  interstate_ok: boolean;
  is_reefer: boolean;
  is_open: boolean;
  is_tanker: boolean;
  sort: number;
}

export interface GoodsCategory {
  key: string;
  name: string;
  examples: string | null;
  hsn_range: string | null;
  default_rates: number[];
  eway_threshold_inr: number;
  is_hazmat: boolean;
  is_perishable: boolean;
  recommended_vehicle_class: string | null;
  sort: number;
}

export interface PincodePrefix {
  prefix: string;
  state_code: string;
  state_name: string;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export const loadVehicleClasses = memoize<VehicleClass[]>(HSN_CACHE_TTL_MS, async () => {
  const { data, error } = await supabase.from('vehicle_classes')
    .select('key, name, min_t, max_t, best_for, notes, interstate_ok, is_reefer, is_open, is_tanker, sort').order('sort');
  if (error) throw new Error(`Failed to read vehicle_classes: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    key: r.key, name: r.name, min_t: num(r.min_t), max_t: num(r.max_t), best_for: r.best_for ?? null, notes: r.notes ?? null,
    interstate_ok: r.interstate_ok !== false, is_reefer: !!r.is_reefer, is_open: !!r.is_open, is_tanker: !!r.is_tanker, sort: Number(r.sort) || 0,
  }));
});

export const loadGoodsCategories = memoize<GoodsCategory[]>(HSN_CACHE_TTL_MS, async () => {
  const { data, error } = await supabase.from('goods_categories')
    .select('key, name, examples, hsn_range, default_rates, eway_threshold_inr, is_hazmat, is_perishable, recommended_vehicle_class, sort').order('sort');
  if (error) throw new Error(`Failed to read goods_categories: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    key: r.key, name: r.name, examples: r.examples ?? null, hsn_range: r.hsn_range ?? null,
    default_rates: (r.default_rates ?? []).map(Number).filter(Number.isFinite),
    eway_threshold_inr: num(r.eway_threshold_inr) ?? 50000,
    is_hazmat: !!r.is_hazmat, is_perishable: !!r.is_perishable,
    recommended_vehicle_class: r.recommended_vehicle_class ?? null, sort: Number(r.sort) || 0,
  }));
});

/** prefix (3 digits) -> state, as one map. */
export const loadPincodePrefixes = memoize<Map<string, PincodePrefix>>(HSN_CACHE_TTL_MS, async () => {
  const { data, error } = await supabase.from('pincode_prefixes').select('prefix, state_code, state_name').limit(2000);
  if (error) throw new Error(`Failed to read pincode_prefixes: ${error.message}`);
  return new Map((data ?? []).map((r: any) => [r.prefix as string, { prefix: r.prefix, state_code: r.state_code, state_name: r.state_name }]));
});
