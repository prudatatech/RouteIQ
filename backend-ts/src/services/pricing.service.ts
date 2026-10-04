import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { readEffectiveSettings, resolveScope, saveOverrides, type SettingsScope } from './company-settings.service';
import type { DistanceSource } from './distance.service';
import { marketFreightService, resolveFreightVehicle } from './goods/freight';
import type { Estimate } from './goods/types';
import { isValidPoint, LatLng } from './geo';

const SETTING_KEY_RE = /^(rate_per_km(_[a-z0-9_]+)?|load_multiplier_[a-z0-9_]+|min_charge|per_kg_surcharge|fuel_price_per_litre|demand_adjustment_max_pct|price_range_pct|weather_surcharge_pct)$/;

export interface QuoteInput {
  pickup: LatLng & { label?: string | null };
  drop: LatLng & { label?: string | null };
  weight_kg: number;
  vehicle_type?: string | null;
  load_type?: string | null;
  date?: string | null;
  vehicle_capacity_t?: number | null;
  body_type?: string | null;
}

export interface QuoteFactor {
  key: string;
  /** Stable machine code (rate_card, weight, load_type, demand, history, weather, min_charge, fuel) so apps can show their own translated label; `label` stays English for web and staff. */
  code: string;
  label: string;
  detail: string;
  /** Change to the price in rupees (negative lowers it); 0 when the factor is informational. */
  amount_inr: number;
}

export interface QuoteResult {
  status: 'ok';
  quote_id: string | null;
  distance_km: number;
  distance_source: DistanceSource;
  distance_is_estimate: boolean;
  low: number;
  suggested: number;
  high: number;
  per_km_suggested: number;
  factors: QuoteFactor[];
  notes: string[];
  basis?: Estimate['basis'];
  generated_at: string;
}

export interface QuoteUnavailable {
  status: 'unavailable';
  reason: string;
  notes: string[];
}

export type QuoteOutcome = QuoteResult | QuoteUnavailable;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  // Settings are JSON: the live rate card is stored as {"rate": 45} (the driver app reads
  // value.rate); newer settings may be a bare number or {"value": n}.
  if (typeof v === 'object') {
    const o = v as { rate?: unknown; value?: unknown; price?: unknown };
    return num(o.rate ?? o.value ?? o.price);
  }
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/^"|"$/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * The rate card in effect for the company the request acts for: its own rates, multipliers and fuel price where it
 * set them, the platform defaults (system_settings) for the rest. Acting as the platform: the defaults.
 */
export async function readPricingSettings(scope?: SettingsScope): Promise<Record<string, number>> {
  const rows = await readEffectiveSettings(k => SETTING_KEY_RE.test(k), scope);
  const out: Record<string, number> = {};
  for (const [key, value] of rows) {
    const n = num(value);
    if (n !== null) out[key] = n;
  }
  return out;
}

/**
 * Staff edit the rate card here. A null value removes the setting: for a company that returns it to the platform
 * default, as the platform it removes the default itself. A company's changes stay in its own organization row.
 */
export async function savePricingSettings(changes: Record<string, number | null>): Promise<Record<string, number>> {
  for (const [key, value] of Object.entries(changes)) {
    if (!SETTING_KEY_RE.test(key)) throw new HttpError(400, `"${key}" is not a pricing setting`);
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new HttpError(400, `"${key}" must be a number of 0 or more`);
    }
  }
  const scope = await resolveScope();
  if (scope) {
    await saveOverrides(scope, changes);
    return readPricingSettings(scope);
  }
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      const { error } = await supabase.from('system_settings').delete().eq('key', key);
      if (error) throw new Error(error.message);
      continue;
    }
    const { data: existing, error: readErr } = await supabase.from('system_settings').select('key').eq('key', key).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const { error } = existing
      ? await supabase.from('system_settings').update({ value: String(value), updated_at: now }).eq('key', key)
      : await supabase.from('system_settings').insert({ key, value: String(value), updated_at: now });
    if (error) throw new Error(error.message);
  }
  return readPricingSettings(scope);
}

export const pricingService = {
  async quote(input: QuoteInput, ctx: { userId?: string; role?: string; source?: string; /** false: compute only, store nothing (guest quotes) */ persist?: boolean } = {}): Promise<QuoteOutcome> {
    if (!isValidPoint(input.pickup) || !isValidPoint(input.drop)) throw new HttpError(400, 'Pickup and drop need valid coordinates');
    if (!Number.isFinite(input.weight_kg) || input.weight_kg <= 0) throw new HttpError(400, 'Weight must be more than 0 kg');

    const vehicle = await resolveFreightVehicle(input.vehicle_type, input.weight_kg, input.vehicle_capacity_t, input.body_type ?? (input.load_type === 'cold_chain' ? 'reefer' : null));
    const loadType = ['part', 'ptl'].includes(input.load_type ?? '') ? 'ptl' : 'ftl';
    const estimate = await marketFreightService.estimate({ items: [], pickup: input.pickup, delivery: input.drop, load_type: loadType }, input.weight_kg, vehicle);
    if (!estimate?.basis || estimate.suggested === undefined) return {
      status: 'unavailable', reason: 'No reference price is available for this truck, capacity and trip. Choose a supported truck class; refrigerated, tanker, bike and car rates have not been supplied.', notes: [],
    };
    const basis = estimate.basis;
    const km = estimate.distance_km;
    const notes = ['Base freight only. Freight GST, tolls, loading, unloading and other extras are separate.'];
    if (basis.distance_is_estimate) notes.push('Distance is estimated from the pickup and delivery locations because no road directions were available.');
    if (!input.vehicle_type || ['truck', 'van'].includes(input.vehicle_type.toLowerCase())) notes.push('The reference truck class follows the cargo weight unless a truck capacity is supplied.');
    if (loadType === 'ptl') notes.push('Whole-vehicle reference for a part load. The logistic company confirms the shared-space price.');
    const decimal = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const result: QuoteResult = {
      status: 'ok', quote_id: null, distance_km: km,
      distance_source: basis.distance_source ?? 'estimate', distance_is_estimate: basis.distance_is_estimate,
      low: estimate.low, suggested: estimate.suggested, high: estimate.high,
      per_km_suggested: basis.midpoint_per_km, basis,
      factors: [{ key: 'rate_card', code: 'rate_card', label: 'Reference rate band',
        detail: `${basis.vehicle_name}: ${decimal(km)} km × ₹${decimal(basis.min_per_km)}–₹${decimal(basis.max_per_km)} per km. Midpoint ₹${decimal(basis.midpoint_per_km)} per km.`, amount_inr: estimate.suggested }],
      notes, generated_at: new Date().toISOString(),
    };

    if (ctx.persist === false) return result;

    // Keep the quote for audit and to learn which prices get accepted
    const { data: saved, error } = await supabase.from('price_quotes').insert({
      user_id: ctx.userId ?? null,
      role: ctx.role ?? null,
      source: ctx.source ?? null,
      pickup_lat: input.pickup.lat, pickup_lng: input.pickup.lng, pickup_label: input.pickup.label ?? null,
      drop_lat: input.drop.lat, drop_lng: input.drop.lng, drop_label: input.drop.label ?? null,
      weight_kg: input.weight_kg,
      vehicle_type: input.vehicle_type ?? null,
      load_type: input.load_type ?? null,
      pickup_date: input.date ?? null,
      distance_km: km,
      distance_source: result.distance_source,
      low_inr: result.low, suggested_inr: result.suggested, high_inr: result.high,
      factors: result.factors,
    }).select('id').single();
    if (error) console.error('[pricing] Could not store the quote:', error.message);
    else result.quote_id = saved.id;
    return result;
  },

  /**
   * The lowest price worth accepting for a load: the low end of the engine's quote
   * for this pickup, drop and weight. Null when the shared reference has no answer.
   */
  async minimumFor(pickup: LatLng, drop: LatLng, weightKg: number, ctx: { userId?: string; role?: string; vehicle_type?: string | null; vehicle_capacity_t?: number | null; body_type?: string | null } = {}): Promise<number | null> {
    try {
      const q = await pricingService.quote({ pickup, drop, weight_kg: weightKg, vehicle_type: ctx.vehicle_type, vehicle_capacity_t: ctx.vehicle_capacity_t, body_type: ctx.body_type, load_type: 'ptl' }, { ...ctx, source: 'capacity_bid' });
      return q.status === 'ok' ? q.low : null;
    } catch (e) {
      console.error('[pricing] Minimum bid check failed:', e);
      return null;
    }
  },

  /** Record the price that was actually agreed, so later quotes can learn from it. */
  async recordOutcome(quoteId: string, outcome: { accepted_amount: number; request_id?: string | null }): Promise<void> {
    if (!Number.isFinite(outcome.accepted_amount) || outcome.accepted_amount <= 0) return;
    const { error } = await supabase.from('price_quotes').update({
      accepted_inr: outcome.accepted_amount,
      accepted_at: new Date().toISOString(),
      request_id: outcome.request_id ?? null,
    }).eq('id', quoteId);
    if (error) console.error('[pricing] Could not record the quote outcome:', error.message);
  },
};
