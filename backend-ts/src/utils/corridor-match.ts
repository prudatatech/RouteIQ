/**
 * Matching a 3PL partner's corridor to a load's pickup and drop.
 *
 * A corridor is named "origin-destination" (for example "DEL-BOM", "Pune to Mumbai"
 * or "Maharashtra - Gujarat"). Each side can be a city or a state. A side matches a
 * place when the place text (the address the vendor or staff typed) names that
 * city or state, ignoring case, spacing and punctuation. The three-letter lane codes
 * the onboarding form suggests are read as the city they stand for.
 */

/** Lane codes used in the corridor suggestions, and the city each stands for. */
const CITY_CODES: Record<string, string[]> = {
  del: ['delhi', 'new delhi'],
  bom: ['mumbai', 'bombay'],
  blr: ['bengaluru', 'bangalore'],
  maa: ['chennai', 'madras'],
  ccu: ['kolkata', 'calcutta'],
  hyd: ['hyderabad'],
  pnq: ['pune'],
  amd: ['ahmedabad'],
};

/** Names that mean the same place. */
const ALIASES: Record<string, string[]> = {
  bengaluru: ['bangalore'],
  bangalore: ['bengaluru'],
  mumbai: ['bombay'],
  chennai: ['madras'],
  kolkata: ['calcutta'],
};

/** Lower case, letters and digits only, single spaces. */
export function normalizePlace(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
    : '';
}

/** Splits "DEL-BOM", "Pune to Mumbai" or "Pune → Mumbai" into its two sides; null when it does not have exactly two. */
export function splitCorridorName(name: unknown): [string, string] | null {
  if (typeof name !== 'string') return null;
  const parts = name.split(/\s*(?:-|–|—|→|=>|>|\bto\b)\s*/i).map(p => p.trim()).filter(Boolean);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

/** Every spelling a corridor side can be matched on. */
function namesFor(side: string): string[] {
  const norm = normalizePlace(side);
  if (!norm) return [];
  return [norm, ...(CITY_CODES[norm] ?? []), ...(ALIASES[norm] ?? [])];
}

/** True when the place text names this corridor side as a whole word or phrase. */
export function placeMatchesSide(place: unknown, side: string): boolean {
  const text = ` ${normalizePlace(place)} `;
  if (text.trim() === '') return false;
  return namesFor(side).some(n => text.includes(` ${n} `));
}

/** True when the corridor runs from the pickup to the drop. */
export function corridorMatches(corridorName: unknown, pickup: unknown, drop: unknown): boolean {
  const sides = splitCorridorName(corridorName);
  if (!sides) return false;
  return placeMatchesSide(pickup, sides[0]) && placeMatchesSide(drop, sides[1]);
}

export type RateUnit = 'per_trip' | 'per_km';
export const RATE_UNITS: readonly RateUnit[] = ['per_trip', 'per_km'];

/** A corridor rate: what the partner charges, and whether that is for the whole trip or for each km. */
export interface CorridorRate {
  amount: number;
  unit: RateUnit;
}

/**
 * Reads a rate typed as plain text ("41200", "₹41,200", "1500.50 per trip", "₹22 per km").
 * Only text that is nothing but an amount (and optionally a unit) counts: a sentence such as
 * "Base + 12%" or "on request" has no rate and returns null, so it is never used to price a load.
 * With no unit written, the amount is per trip.
 */
export function parseLegacyRate(value: unknown): CorridorRate | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? { amount: value, unit: 'per_trip' } : null;
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:(?:per\s*|\/\s*)(trip|km))?$/i);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit: m[2]?.toLowerCase() === 'km' ? 'per_km' : 'per_trip' };
}

/** The numeric rate of a corridor row: the structured columns, else a legacy text that is only a number. */
export function corridorRate(row: { rate_amount?: unknown; rate_unit?: unknown; proposed_rate?: unknown }): CorridorRate | null {
  const amount = Number(row.rate_amount);
  if (row.rate_amount != null && Number.isFinite(amount) && amount > 0 && RATE_UNITS.includes(row.rate_unit as RateUnit)) {
    return { amount, unit: row.rate_unit as RateUnit };
  }
  return parseLegacyRate(row.proposed_rate);
}

/** What a load costs at this rate: the amount per trip, or the amount x km (null when the distance is not known). */
export function priceAtRate(rate: CorridorRate | null, distanceKm: number | null | undefined): number | null {
  if (!rate) return null;
  if (rate.unit === 'per_trip') return rate.amount;
  return distanceKm != null && distanceKm > 0 ? Math.round(rate.amount * distanceKm * 100) / 100 : null;
}

/** A rate typed as "41200", "₹41,200" or "41200 per trip" as a per-trip amount; null when it is not just an amount. */
export function parseRate(value: unknown): number | null {
  const rate = parseLegacyRate(value);
  return rate && rate.unit === 'per_trip' ? rate.amount : null;
}

/** A rate as it is shown: "₹41,200 per trip" or "₹22 per km". */
export function formatRate(rate: CorridorRate): string {
  return `₹${rate.amount.toLocaleString('en-IN')} ${rate.unit === 'per_km' ? 'per km' : 'per trip'}`;
}
