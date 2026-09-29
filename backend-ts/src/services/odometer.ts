/**
 * Odometer from GPS: the distance driven between two consecutive pings.
 */

export interface PingPoint {
  lat: number;
  lng: number;
  /** ISO time of the ping, when known. */
  at?: string | null;
}

const EARTH_RADIUS_KM = 6371;
/** Movement smaller than this between pings is GPS jitter, not driving. */
const MIN_SEGMENT_KM = 0.03;
/** A jump that would need more than this speed is a bad fix, not driving. */
const MAX_PLAUSIBLE_KMPH = 180;
/** With no timestamps to judge by, a single jump longer than this is ignored. */
const MAX_UNTIMED_SEGMENT_KM = 100;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Kilometres to add to the odometer for one step from `prev` to `next` (0 when it is noise). */
export function segmentKm(prev: PingPoint, next: PingPoint): number {
  const d = haversineKm(prev, next);
  if (!Number.isFinite(d) || d < MIN_SEGMENT_KM) return 0;
  const t0 = prev.at ? Date.parse(prev.at) : NaN;
  const t1 = next.at ? Date.parse(next.at) : NaN;
  if (Number.isFinite(t0) && Number.isFinite(t1)) {
    const hours = (t1 - t0) / 3_600_000;
    if (hours <= 0) return 0;
    return d / hours > MAX_PLAUSIBLE_KMPH ? 0 : d;
  }
  return d > MAX_UNTIMED_SEGMENT_KM ? 0 : d;
}

/** Total kilometres over a run of pings that starts at `start` (the last known position). */
export function pathKm(start: PingPoint | null, points: PingPoint[]): number {
  let total = 0;
  let prev = start;
  for (const p of points) {
    if (prev) total += segmentKm(prev, p);
    prev = p;
  }
  return total;
}

export const roundKm = (km: number) => Math.round(km * 10) / 10;
