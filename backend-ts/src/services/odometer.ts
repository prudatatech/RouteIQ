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

/** A ping less accurate than this (metres) is not used for distance. */
export const MAX_ACCURACY_M = 100;
/** After this many bad fixes in a row the path restarts from the latest one, so one bad anchor cannot stall it. */
const MAX_CONSECUTIVE_REJECTED = 5;

export interface CleanPath {
  km: number;
  /** Pings that moved the path forward. */
  accepted: number;
  /** Pings dropped as GPS spikes (an impossible jump). Jitter is not counted here. */
  rejected: number;
}

/**
 * Distance over ordered pings, for syncing the odometer from history.
 * Unlike `pathKm` (one step at a time as pings arrive), the last good position stays the
 * reference while a ping is noise, so a single bad fix does not cost the legs on either side:
 *  - movement under the jitter limit from the reference is ignored (it does not move the reference);
 *  - a jump that would need more than the plausible speed is a spike and is skipped.
 * Pings need no particular order; they are sorted by time first.
 */
export function cleanPathKm(anchor: PingPoint | null, points: PingPoint[]): CleanPath {
  const ordered = [...points].sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0;
    const tb = b.at ? Date.parse(b.at) : 0;
    return ta - tb;
  });
  let km = 0;
  let accepted = 0;
  let rejected = 0;
  let bad = 0;
  let ref = anchor;
  for (const p of ordered) {
    if (!ref) { ref = p; continue; }
    const d = haversineKm(ref, p);
    if (!Number.isFinite(d)) { rejected++; continue; }
    if (d < MIN_SEGMENT_KM) continue;
    const step = segmentKm(ref, p);
    if (step > 0) {
      km += step;
      accepted++;
      bad = 0;
      ref = p;
    } else {
      rejected++;
      bad++;
      if (bad >= MAX_CONSECUTIVE_REJECTED) { ref = p; bad = 0; }
    }
  }
  return { km, accepted, rejected };
}
