/**
 * Fuel calculation engine. Pure functions: no database, no clock (callers pass `now`).
 *
 * Mileage uses the full-tank to full-tank method. A "segment" runs from one full fill to the
 * next full fill. The fuel burned in it is the litres of every fill after the first full fill
 * up to and including the closing full fill (partial fills in between are added up), and the
 * distance is the difference of the two odometer readings. km per litre = distance / litres.
 *
 * Anomalies are stored on each fill as a list of flag codes. Fills flagged as a duplicate or as
 * an odometer going backwards are left out of the mileage sums, because they would corrupt them.
 */
import { haversineKm } from './odometer';
import { indianDateKey } from '../core/istDate';

export type FuelFlag = 'no_bill' | 'low_mileage' | 'over_tank_capacity' | 'odometer_backwards' | 'duplicate' | 'far_from_gps';

export const FUEL_FLAGS: readonly FuelFlag[] = ['no_bill', 'low_mileage', 'over_tank_capacity', 'odometer_backwards', 'duplicate', 'far_from_gps'];

export const FLAG_LABELS: Record<FuelFlag, string> = {
  no_bill: 'No bill',
  low_mileage: 'Mileage much lower than usual',
  over_tank_capacity: 'More litres than the tank holds',
  odometer_backwards: 'Odometer lower than the earlier fill',
  duplicate: 'Possible duplicate entry',
  far_from_gps: 'Fill was far from the vehicle position',
};

/** Rolling mileage looks at this many of the latest segments. */
export const ROLLING_SEGMENTS = 5;
/** A segment needs this many earlier segments before it can be called a low-mileage outlier. */
export const MIN_HISTORY_SEGMENTS = 2;
/** Mileage more than this share below the vehicle's own rolling average is flagged. */
export const LOW_MILEAGE_DROP = 0.25;
/** Two fills of the same size (or amount) this close together are flagged as a duplicate. */
export const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
/** litres within this many litres count as the same size. */
export const DUPLICATE_LITRES_TOLERANCE = 0.5;
/** A fill this far from the nearest GPS point (in time and place) is flagged. */
export const FAR_FROM_GPS_KM = 5;
/** Only GPS points this close in time to the fill are compared. */
export const GPS_MATCH_WINDOW_MS = 30 * 60 * 1000;

export interface FuelFill {
  id: string;
  filled_at: string;
  litres: number;
  price_per_litre: number;
  total_amount: number;
  odometer_km: number | null;
  is_full_tank: boolean;
  bill_status: 'with_bill' | 'no_bill';
  fill_latitude?: number | null;
  fill_longitude?: number | null;
}

export interface GpsSample {
  lat: number;
  lng: number;
  /** ISO time. */
  at: string;
}

export class FuelInputError extends Error {}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};
export const round1 = (n: number) => round(n, 1);
export const round2 = (n: number) => round(n, 2);

// ── Litres, price and amount: any two give the third ────────────────────────

export interface Amounts {
  litres: number;
  price_per_litre: number;
  total_amount: number;
}

/**
 * Fills in whichever of litres, price per litre and total amount is missing. With all three the
 * amount must agree with litres x price (the price is rounded to paise, so a small gap is fine).
 */
export function resolveAmounts(input: { litres?: number | null; price_per_litre?: number | null; total_amount?: number | null }): Amounts {
  const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
  const { litres, price_per_litre: price, total_amount: total } = input;
  for (const [label, v] of [['Litres', litres], ['Price per litre', price], ['Total amount', total]] as const) {
    if (has(v) && v <= 0) throw new FuelInputError(`${label} must be more than 0`);
  }
  const given = [litres, price, total].filter(has).length;
  if (given < 2) throw new FuelInputError('Enter any two of litres, price per litre and total amount');

  if (has(litres) && has(price) && has(total)) {
    const expected = litres * price;
    if (Math.abs(expected - total) > Math.max(1, total * 0.01)) {
      throw new FuelInputError(`Litres x price is ${round2(expected)}, which does not match the total amount ${round2(total)}`);
    }
    return { litres: round2(litres), price_per_litre: round2(price), total_amount: round2(total) };
  }
  if (has(litres) && has(price)) return { litres: round2(litres), price_per_litre: round2(price), total_amount: round2(litres * price) };
  if (has(litres) && has(total)) return { litres: round2(litres), price_per_litre: round2(total / litres), total_amount: round2(total) };
  const l = total! / price!;
  return { litres: round2(l), price_per_litre: round2(price!), total_amount: round2(total!) };
}

// ── Segments: full fill to full fill ────────────────────────────────────────

export interface Segment {
  /** The earlier full fill. */
  anchor_id: string;
  /** The full fill that closes the segment; the mileage is stored on it. */
  closing_id: string;
  /** Every fill after the anchor up to and including the closing fill. */
  fill_ids: string[];
  distance_km: number;
  litres: number;
  /** Money spent on those fills. */
  cost: number;
  kmpl: number;
  closed_at: string;
}

const time = (f: { filled_at: string }) => Date.parse(f.filled_at);

/** Oldest first; same moment goes by odometer, and fills without a reading go last. */
export function sortFills<T extends FuelFill>(fills: T[]): T[] {
  return [...fills].sort((a, b) => {
    const dt = time(a) - time(b);
    if (dt !== 0) return dt;
    return (a.odometer_km ?? Infinity) - (b.odometer_km ?? Infinity);
  });
}

/**
 * Walks the fills oldest to newest and closes a segment at each full fill that has an earlier
 * full fill to measure from. Fills in `skip` are ignored. A reading lower than the last accepted
 * one is reported in `backwards` and ignored. A full fill without a reading cannot be measured
 * from or to, so it breaks the chain.
 */
export function computeSegments(fills: FuelFill[], skip: ReadonlySet<string> = new Set()): { segments: Segment[]; backwards: Set<string> } {
  const segments: Segment[] = [];
  const backwards = new Set<string>();
  let lastOdo: number | null = null;
  let anchor: { id: string; odo: number } | null = null;
  let pending: { ids: string[]; litres: number; cost: number } = { ids: [], litres: 0, cost: 0 };
  const reset = () => { pending = { ids: [], litres: 0, cost: 0 }; };

  for (const f of sortFills(fills)) {
    if (skip.has(f.id)) continue;
    const odo = f.odometer_km;
    if (odo != null) {
      if (lastOdo != null && odo < lastOdo) { backwards.add(f.id); continue; }
      lastOdo = odo;
    }
    if (!f.is_full_tank) {
      if (anchor) { pending.ids.push(f.id); pending.litres += f.litres; pending.cost += f.total_amount; }
      continue;
    }
    if (odo == null) { anchor = null; reset(); continue; }
    if (anchor) {
      pending.ids.push(f.id); pending.litres += f.litres; pending.cost += f.total_amount;
      const km = odo - anchor.odo;
      if (km > 0 && pending.litres > 0) {
        segments.push({
          anchor_id: anchor.id, closing_id: f.id, fill_ids: pending.ids,
          distance_km: round1(km), litres: round2(pending.litres), cost: round2(pending.cost),
          kmpl: round2(km / pending.litres), closed_at: f.filled_at,
        });
      }
    }
    anchor = { id: f.id, odo };
    reset();
  }
  return { segments, backwards };
}

/** Distance over litres of the given segments (a weighted average, so long runs count for more). */
export function averageKmpl(segments: Segment[]): number | null {
  const km = segments.reduce((s, x) => s + x.distance_km, 0);
  const litres = segments.reduce((s, x) => s + x.litres, 0);
  return litres > 0 && km > 0 ? round2(km / litres) : null;
}

export const rollingKmpl = (segments: Segment[], n = ROLLING_SEGMENTS): number | null => averageKmpl(segments.slice(-n));

// ── Anomalies ───────────────────────────────────────────────────────────────

/** Ids of fills that repeat an earlier fill (same litres or same amount) within the window. */
export function findDuplicates(fills: FuelFill[]): Set<string> {
  const sorted = sortFills(fills);
  const dupes = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const gap = time(sorted[i]) - time(sorted[j]);
      if (gap > DUPLICATE_WINDOW_MS) break;
      if (Math.abs(sorted[i].litres - sorted[j].litres) <= DUPLICATE_LITRES_TOLERANCE || sorted[i].total_amount === sorted[j].total_amount) {
        dupes.add(sorted[i].id);
        break;
      }
    }
  }
  return dupes;
}

/** The GPS sample closest in time to `atMs`, if one is within the match window. */
export function nearestGps(samples: GpsSample[], atMs: number): GpsSample | null {
  let best: GpsSample | null = null;
  let bestGap = GPS_MATCH_WINDOW_MS + 1;
  for (const s of samples) {
    const gap = Math.abs(Date.parse(s.at) - atMs);
    if (gap < bestGap) { best = s; bestGap = gap; }
  }
  return best;
}

export interface FillAnnotation {
  /** Set on the full fill that closes a segment. */
  distance_km: number | null;
  litres_used: number | null;
  mileage_kmpl: number | null;
  flags: FuelFlag[];
}

export interface FuelAnalysis {
  annotations: Map<string, FillAnnotation>;
  segments: Segment[];
}

/** Works out the stored mileage and the flags for every fill of one vehicle. */
export function analyzeFills(fills: FuelFill[], ctx: { tankCapacityLiters?: number | null; gps?: GpsSample[] } = {}): FuelAnalysis {
  const annotations = new Map<string, FillAnnotation>();
  for (const f of fills) annotations.set(f.id, { distance_km: null, litres_used: null, mileage_kmpl: null, flags: [] });
  const flag = (id: string, code: FuelFlag) => {
    const a = annotations.get(id)!;
    if (!a.flags.includes(code)) a.flags.push(code);
  };

  const duplicates = findDuplicates(fills);
  const { segments, backwards } = computeSegments(fills, duplicates);

  for (const id of duplicates) flag(id, 'duplicate');
  for (const id of backwards) flag(id, 'odometer_backwards');

  const capacity = ctx.tankCapacityLiters;
  for (const f of fills) {
    if (f.bill_status === 'no_bill') flag(f.id, 'no_bill');
    if (capacity != null && capacity > 0 && f.litres > capacity) flag(f.id, 'over_tank_capacity');
    if (f.fill_latitude != null && f.fill_longitude != null && ctx.gps?.length) {
      const near = nearestGps(ctx.gps, time(f));
      if (near && haversineKm({ lat: f.fill_latitude, lng: f.fill_longitude }, near) > FAR_FROM_GPS_KM) flag(f.id, 'far_from_gps');
    }
  }

  segments.forEach((seg, i) => {
    const a = annotations.get(seg.closing_id)!;
    a.distance_km = seg.distance_km;
    a.litres_used = seg.litres;
    a.mileage_kmpl = seg.kmpl;
    const history = segments.slice(Math.max(0, i - ROLLING_SEGMENTS), i);
    const usual = history.length >= MIN_HISTORY_SEGMENTS ? averageKmpl(history) : null;
    if (usual != null && seg.kmpl < usual * (1 - LOW_MILEAGE_DROP)) flag(seg.closing_id, 'low_mileage');
  });

  return { annotations, segments };
}

// ── Per-vehicle statistics ──────────────────────────────────────────────────

export interface FuelStats {
  fills: number;
  /** Fills without a bill. */
  no_bill_fills: number;
  /** Fills with an anomaly flag other than "no bill". */
  flagged_fills: number;
  rolling_avg_kmpl: number | null;
  last_kmpl: number | null;
  /** Fuel money per km over the rolling segments. */
  cost_per_km: number | null;
  month_spend: number;
  month_litres: number;
  month_fills: number;
  last_fill_at: string | null;
  /** Latest segments, oldest first, for a trend chart. */
  trend: { date: string; kmpl: number; distance_km: number }[];
}

const TREND_POINTS = 12;

/** `flags` is one flag list per fill; it defaults to the analysis, and callers can pass the stored flags instead. */
export function vehicleStats(fills: FuelFill[], analysis: FuelAnalysis, now: Date, flags: Iterable<readonly FuelFlag[]> = [...analysis.annotations.values()].map(a => a.flags)): FuelStats {
  const rolling = analysis.segments.slice(-ROLLING_SEGMENTS);
  const km = rolling.reduce((s, x) => s + x.distance_km, 0);
  const cost = rolling.reduce((s, x) => s + x.cost, 0);
  const monthKey = indianDateKey(now).slice(0, 7);
  const thisMonth = fills.filter(f => indianDateKey(new Date(f.filled_at)).slice(0, 7) === monthKey);
  const sorted = sortFills(fills);
  let noBill = 0;
  let flagged = 0;
  for (const list of flags) {
    if (list.includes('no_bill')) noBill++;
    if (list.some(x => x !== 'no_bill')) flagged++;
  }
  return {
    fills: fills.length,
    no_bill_fills: noBill,
    flagged_fills: flagged,
    rolling_avg_kmpl: rollingKmpl(analysis.segments),
    last_kmpl: analysis.segments.length ? analysis.segments[analysis.segments.length - 1].kmpl : null,
    cost_per_km: km > 0 ? round2(cost / km) : null,
    month_spend: round2(thisMonth.reduce((s, f) => s + f.total_amount, 0)),
    month_litres: round2(thisMonth.reduce((s, f) => s + f.litres, 0)),
    month_fills: thisMonth.length,
    last_fill_at: sorted.length ? sorted[sorted.length - 1].filled_at : null,
    trend: analysis.segments.slice(-TREND_POINTS).map(s => ({ date: s.closed_at, kmpl: s.kmpl, distance_km: s.distance_km })),
  };
}

// ── What the vehicle record is kept at ──────────────────────────────────────

/**
 * The vehicle columns the log keeps up to date: the rolling km per litre, and, when the newest
 * fill is a full tank and the tank size is known, the litres now in the tank.
 */
export function vehicleUpdate(fills: FuelFill[], analysis: FuelAnalysis, tankCapacityLiters: number | null | undefined): { fuel_efficiency_kmpl?: number; current_fuel_liters?: number } {
  const out: { fuel_efficiency_kmpl?: number; current_fuel_liters?: number } = {};
  const rolling = rollingKmpl(analysis.segments);
  if (rolling != null) out.fuel_efficiency_kmpl = rolling;
  const newest = sortFills(fills).at(-1);
  if (newest?.is_full_tank && tankCapacityLiters != null && tankCapacityLiters > 0) out.current_fuel_liters = round2(tankCapacityLiters);
  return out;
}
