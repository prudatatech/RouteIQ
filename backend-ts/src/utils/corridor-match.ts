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

/** A rate typed as "41200", "₹41,200" or "41200 per trip" as a number; null when there is no number. */
export function parseRate(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const rate = Number(match[0]);
  return rate > 0 ? rate : null;
}
