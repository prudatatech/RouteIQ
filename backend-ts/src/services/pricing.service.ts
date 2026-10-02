import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { readEffectiveSettings, resolveScope, saveOverrides, type SettingsScope } from './company-settings.service';
import { getDrivingDistance, DistanceSource } from './distance.service';
import { getWeather, isConditions } from './weather.service';
import { haversineKm, isValidPoint, LatLng, midpoint, ROAD_FACTOR } from './geo';
import { DISPATCHABLE_STATUSES, isDispatchable } from '../core/vehicles';

/** Straight-line radius around the pickup used to count open loads and free vehicles. */
export const DEMAND_RADIUS_KM = 100;
/** Fewest past accepted prices needed before history shifts the price. */
export const MIN_HISTORY_SAMPLES = 3;
/** Past prices count as "similar" when their distance is within this share of the quoted distance. */
const BAND_SHARE = 0.3;
const BAND_MIN_KM = 50;

/** Defaults for tuning values staff can override with a setting. */
const DEFAULT_DEMAND_MAX_PCT = 10;
const DEFAULT_RANGE_PCT = 10;
const DEFAULT_WEATHER_SURCHARGE_PCT = 5;

const SETTING_KEY_RE = /^(rate_per_km(_[a-z0-9_]+)?|load_multiplier_[a-z0-9_]+|min_charge|per_kg_surcharge|fuel_price_per_litre|demand_adjustment_max_pct|price_range_pct|weather_surcharge_pct)$/;

export interface QuoteInput {
  pickup: LatLng & { label?: string | null };
  drop: LatLng & { label?: string | null };
  weight_kg: number;
  vehicle_type?: string | null;
  load_type?: string | null;
  date?: string | null;
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
  demand: { open_loads: number; available_vehicles: number; radius_km: number };
  history: { samples: number; median_per_km: number | null; band_km: [number, number] };
  weather: { checked: boolean; severe: boolean; description: string | null };
  generated_at: string;
}

export interface QuoteUnavailable {
  status: 'unavailable';
  reason: string;
  notes: string[];
}

export type QuoteOutcome = QuoteResult | QuoteUnavailable;

const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
const signed = (n: number) => `${n < 0 ? 'lowers' : 'adds'} ${inr(n)}`;
const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

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

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
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

async function countDemand(pickup: LatLng, vehicleType: string | null) {
  const near = (lat: unknown, lng: unknown) => {
    const p = { lat: Number(lat), lng: Number(lng) };
    return isValidPoint(p) && haversineKm(pickup, p) <= DEMAND_RADIUS_KM;
  };
  const [{ data: loads, error: loadErr }, { data: vehicles, error: vehErr }] = await Promise.all([
    supabase.from('vendor_shipment_requests').select('id, pickup_lat, pickup_lng').in('status', ['pending', 'approved', 'escalated']).limit(1000),
    supabase.from('vehicles').select('id, latitude, longitude, vehicle_type, status, plate_number').in('status', [...DISPATCHABLE_STATUSES]).limit(1000),
  ]);
  if (loadErr) throw new Error(loadErr.message);
  if (vehErr) throw new Error(vehErr.message);
  return {
    open_loads: (loads ?? []).filter(l => near(l.pickup_lat, l.pickup_lng)).length,
    available_vehicles: (vehicles ?? []).filter(v => isDispatchable(v) && near(v.latitude, v.longitude)
      && (!vehicleType || norm(String(v.vehicle_type ?? '')) === vehicleType)).length,
  };
}

/** Accepted prices per km on routes of a similar length: won bids and vendor requests that staff priced. */
async function acceptedRatesPerKm(distanceKm: number): Promise<number[]> {
  const band = Math.max(BAND_MIN_KM, distanceKm * BAND_SHARE);
  const inBand = (km: number) => Math.abs(km - distanceKm) <= band;
  const rates: number[] = [];

  const { data: bids, error: bidErr } = await supabase
    .from('capacity_bids').select('id, bid_amount, dropoff_point_id').eq('status', 'won').limit(300);
  if (bidErr) throw new Error(bidErr.message);
  const bidIds = (bids ?? []).map(b => b.id as string);
  if (bidIds.length > 0) {
    const pointIds = [...new Set((bids ?? []).map(b => b.dropoff_point_id).filter(Boolean))] as string[];
    const [{ data: shipments, error: shipErr }, { data: points, error: pointErr }] = await Promise.all([
      supabase.from('shipments').select('bid_id, origin_lat, origin_lng').in('bid_id', bidIds),
      supabase.from('delivery_points').select('id, latitude, longitude').in('id', pointIds),
    ]);
    if (shipErr) throw new Error(shipErr.message);
    if (pointErr) throw new Error(pointErr.message);
    const originByBid = new Map((shipments ?? []).map(s => [s.bid_id as string, s]));
    const pointById = new Map((points ?? []).map(p => [p.id as string, p]));
    for (const b of bids ?? []) {
      const o = originByBid.get(b.id as string);
      const d = pointById.get(b.dropoff_point_id as string);
      const amount = num(b.bid_amount);
      if (!o || !d || amount === null || amount <= 0) continue;
      const a = { lat: Number(o.origin_lat), lng: Number(o.origin_lng) };
      const z = { lat: Number(d.latitude), lng: Number(d.longitude) };
      if (!isValidPoint(a) || !isValidPoint(z)) continue;
      const km = haversineKm(a, z) * ROAD_FACTOR;
      if (km > 0 && inBand(km)) rates.push(amount / km);
    }
  }

  const { data: requests, error: reqErr } = await supabase
    .from('vendor_shipment_requests')
    .select('cost_per_km, pickup_lat, pickup_lng, drop_lat, drop_lng')
    .gt('cost_per_km', 0).limit(300);
  if (reqErr) throw new Error(reqErr.message);
  for (const r of requests ?? []) {
    const rate = num(r.cost_per_km);
    const a = { lat: Number(r.pickup_lat), lng: Number(r.pickup_lng) };
    const z = { lat: Number(r.drop_lat), lng: Number(r.drop_lng) };
    if (rate === null || rate <= 0 || !isValidPoint(a) || !isValidPoint(z)) continue;
    if (inBand(haversineKm(a, z) * ROAD_FACTOR)) rates.push(rate);
  }
  return rates;
}

async function averageKmpl(vehicleType: string | null): Promise<number | null> {
  if (!vehicleType) return null;
  const { data, error } = await supabase.from('vehicles').select('vehicle_type, fuel_efficiency_kmpl').gt('fuel_efficiency_kmpl', 0).limit(1000);
  if (error) throw new Error(error.message);
  const vals = (data ?? []).filter(v => norm(String(v.vehicle_type ?? '')) === vehicleType)
    .map(v => Number(v.fuel_efficiency_kmpl)).filter(n => n > 0);
  return vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : null;
}

function isToday(date: string | null | undefined): boolean {
  if (!date) return true;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return true;
  return d.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
}

export const pricingService = {
  async quote(input: QuoteInput, ctx: { userId?: string; role?: string; source?: string; /** false: compute only, store nothing (guest quotes) */ persist?: boolean } = {}): Promise<QuoteOutcome> {
    if (!isValidPoint(input.pickup) || !isValidPoint(input.drop)) throw new HttpError(400, 'Pickup and drop need valid coordinates');
    if (!Number.isFinite(input.weight_kg) || input.weight_kg <= 0) throw new HttpError(400, 'Weight must be more than 0 kg');

    const vehicleType = input.vehicle_type ? norm(input.vehicle_type) : null;
    const loadType = input.load_type ? norm(input.load_type) : null;
    const notes: string[] = [];
    const factors: QuoteFactor[] = [];

    const [cfg, distance, demand] = await Promise.all([
      readPricingSettings(),
      getDrivingDistance(input.pickup, input.drop),
      countDemand(input.pickup, vehicleType),
    ]);
    const km = distance.km;
    if (distance.is_estimate) notes.push('Distance is an estimate (straight line x 1.3) because no routing service answered.');

    const history = await acceptedRatesPerKm(km);
    const sorted = [...history].sort((a, b) => a - b);
    const useHistory = sorted.length >= MIN_HISTORY_SAMPLES;
    const historyMedian = useHistory ? quantile(sorted, 0.5) : null;
    const band = Math.max(BAND_MIN_KM, km * BAND_SHARE);

    // 1. Rate card
    const cardRate = (vehicleType && cfg[`rate_per_km_${vehicleType}`]) || cfg.rate_per_km || null;
    if (cardRate === null && !useHistory) {
      return {
        status: 'unavailable',
        reason: 'No rate card is set and there are too few accepted prices on similar distances. Ask staff to set the rate per km.',
        notes,
      };
    }
    let cardPrice = 0;
    if (cardRate !== null) {
      cardPrice = km * cardRate;
      const which = vehicleType && cfg[`rate_per_km_${vehicleType}`] ? `the ${input.vehicle_type} rate` : 'the standard rate';
      factors.push({ key: 'rate_card', code: 'rate_card', label: 'Rate card', detail: `${km.toLocaleString('en-IN')} km at ${inr(cardRate)} per km (${which}).`, amount_inr: Math.round(cardPrice) });
    } else {
      notes.push('No rate card is set, so the price comes from past accepted prices only.');
    }

    // 2. Weight
    let subtotal = cardPrice;
    if (cardRate !== null && cfg.per_kg_surcharge) {
      const add = input.weight_kg * cfg.per_kg_surcharge;
      subtotal += add;
      factors.push({ key: 'weight', code: 'weight', label: 'Weight', detail: `${input.weight_kg.toLocaleString('en-IN')} kg at ${inr(cfg.per_kg_surcharge)} per kg ${signed(add)}.`, amount_inr: Math.round(add) });
    }

    // 3. Load type
    const loadMult = loadType ? cfg[`load_multiplier_${loadType}`] : undefined;
    if (cardRate !== null && loadMult && loadMult !== 1) {
      const add = subtotal * (loadMult - 1);
      subtotal += add;
      factors.push({ key: 'load_type', code: 'load_type', label: 'Load type', detail: `${input.load_type} loads are priced at ${loadMult} times the base ${signed(add)}.`, amount_inr: Math.round(add) });
    }

    // 4. Demand near the pickup
    const maxAdj = (cfg.demand_adjustment_max_pct ?? DEFAULT_DEMAND_MAX_PCT) / 100;
    const { open_loads, available_vehicles } = demand;
    let price = subtotal;
    if (cardRate !== null) {
      if (open_loads + available_vehicles === 0) {
        factors.push({ key: 'demand', code: 'demand', label: 'Demand near pickup', detail: `No open loads or free vehicles within ${DEMAND_RADIUS_KM} km of pickup, so no adjustment.`, amount_inr: 0 });
      } else {
        const balance = (open_loads - available_vehicles) / (open_loads + available_vehicles);
        const add = subtotal * balance * maxAdj;
        price += add;
        const mood = open_loads > available_vehicles ? 'More loads than free vehicles' : open_loads < available_vehicles ? 'More free vehicles than loads' : 'Loads and free vehicles are balanced';
        factors.push({ key: 'demand', code: 'demand', label: 'Demand near pickup', detail: `${mood} within ${DEMAND_RADIUS_KM} km of pickup (${open_loads} open loads, ${available_vehicles} free vehicles) ${add === 0 ? 'so no adjustment' : signed(add)}.`, amount_inr: Math.round(add) });
      }
    }

    // 5. Past accepted prices
    if (useHistory && historyMedian !== null) {
      const fromHistory = historyMedian * km;
      const blended = cardRate !== null ? (price + fromHistory) / 2 : fromHistory;
      const add = blended - price;
      price = blended;
      factors.push({
        key: 'history',
        code: 'history',
        label: 'Past accepted prices',
        detail: `${sorted.length} accepted prices on trips of ${Math.round(km - band)} to ${Math.round(km + band)} km averaged ${inr(historyMedian)} per km${cardRate !== null ? `; the price is halfway between that and the rate card` : ''}${cardRate !== null ? ` (${signed(add)})` : ''}.`,
        amount_inr: cardRate !== null ? Math.round(add) : Math.round(blended),
      });
    } else {
      notes.push(`Fewer than ${MIN_HISTORY_SAMPLES} accepted prices on similar distances, so past prices were not used.`);
    }

    // 6. Weather (only when OpenWeather says it is severe, and only for a pickup today)
    let weather: QuoteResult['weather'] = { checked: false, severe: false, description: null };
    if (!isToday(input.date)) {
      notes.push('Weather was not checked because the pickup is not today.');
    } else {
      const w = await getWeather(midpoint(input.pickup, input.drop));
      if (!w.configured) notes.push('Weather was not checked because OpenWeather is not set up.');
      else if (!isConditions(w)) notes.push('Weather was not checked because the weather service did not answer.');
      else {
        weather = { checked: true, severe: w.severe, description: w.description };
        if (w.severe) {
          const pct = (cfg.weather_surcharge_pct ?? DEFAULT_WEATHER_SURCHARGE_PCT) / 100;
          const add = price * pct;
          price += add;
          factors.push({ key: 'weather', code: 'weather', label: 'Severe weather', detail: `${w.description} reported along the route ${signed(add)}.`, amount_inr: Math.round(add) });
        }
      }
    }

    // 7. Minimum charge
    if (cfg.min_charge && price < cfg.min_charge) {
      const add = cfg.min_charge - price;
      price = cfg.min_charge;
      factors.push({ key: 'min_charge', code: 'min_charge', label: 'Minimum charge', detail: `The price was below the minimum charge of ${inr(cfg.min_charge)} ${signed(add)}.`, amount_inr: Math.round(add) });
    }

    // Range: spread of past prices when there is enough history, otherwise a set percentage
    const rangePct = (cfg.price_range_pct ?? DEFAULT_RANGE_PCT) / 100;
    let low = price * (1 - rangePct);
    let high = price * (1 + rangePct);
    if (useHistory) {
      const spread = { low: quantile(sorted, 0.25) * km, high: quantile(sorted, 0.75) * km };
      if (spread.high > spread.low) { low = Math.min(price, spread.low); high = Math.max(price, spread.high); }
    }

    // Fuel floor: the low end never drops below the fuel for the trip
    const kmpl = await averageKmpl(vehicleType);
    if (cfg.fuel_price_per_litre && kmpl) {
      const fuel = (km / kmpl) * cfg.fuel_price_per_litre;
      const floored = low < fuel;
      if (floored) low = fuel;
      factors.push({ key: 'fuel', code: 'fuel', label: 'Fuel cost', detail: `About ${inr(fuel)} of fuel for ${km.toLocaleString('en-IN')} km (${kmpl.toFixed(1)} km per litre at ${inr(cfg.fuel_price_per_litre)} per litre)${floored ? '; the low end was raised to cover it' : ''}.`, amount_inr: 0 });
      if (price < fuel) price = fuel;
    } else if (!cfg.fuel_price_per_litre) {
      notes.push('Fuel cost was not checked because no fuel price is set.');
    } else {
      notes.push('Fuel cost was not checked because there is no mileage for this vehicle type.');
    }
    if (high < price) high = price;
    if (low > price) low = price;

    const suggested = Math.round(price);
    const result: QuoteResult = {
      status: 'ok',
      quote_id: null,
      distance_km: km,
      distance_source: distance.source,
      distance_is_estimate: distance.is_estimate,
      low: Math.round(low),
      suggested,
      high: Math.round(high),
      per_km_suggested: km > 0 ? Math.round((suggested / km) * 100) / 100 : 0,
      factors,
      notes,
      demand: { open_loads, available_vehicles, radius_km: DEMAND_RADIUS_KM },
      history: { samples: sorted.length, median_per_km: historyMedian !== null ? Math.round(historyMedian * 100) / 100 : null, band_km: [Math.round(km - band), Math.round(km + band)] },
      weather,
      generated_at: new Date().toISOString(),
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
      distance_source: distance.source,
      low_inr: result.low, suggested_inr: result.suggested, high_inr: result.high,
      factors: result.factors,
    }).select('id').single();
    if (error) console.error('[pricing] Could not store the quote:', error.message);
    else result.quote_id = saved.id;
    return result;
  },

  /**
   * The lowest price worth accepting for a load: the low end of the engine's quote
   * for this pickup, drop and weight. Null when the engine has no answer (no rate
   * card and too little history), in which case no minimum can be enforced.
   */
  async minimumFor(pickup: LatLng, drop: LatLng, weightKg: number, ctx: { userId?: string; role?: string } = {}): Promise<number | null> {
    try {
      const q = await pricingService.quote({ pickup, drop, weight_kg: weightKg }, { ...ctx, source: 'capacity_bid' });
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
