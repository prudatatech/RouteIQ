/**
 * Travel estimates for planning: road distance from the straight line and a
 * typical truck speed. Used where no routing service is worth calling (a passing
 * truck's arrival time, planned arrivals on stops inserted by an awarded bid).
 */
import { haversineKm, isValidPoint, LatLng, ROAD_FACTOR } from '../services/geo';

/** A coordinate pair from database values; a missing value (null or '') stays invalid instead of becoming 0. */
export const toPoint = (lat: unknown, lng: unknown): LatLng => ({
  lat: lat == null || lat === '' ? NaN : Number(lat),
  lng: lng == null || lng === '' ? NaN : Number(lng),
});

/** Average truck speed on Indian highways including short halts. */
export const AVERAGE_TRUCK_SPEED_KMH = 40;

/** Road distance in km between two points (straight line x road factor); null if either point is invalid. */
export function roadKm(from: Partial<LatLng> | null | undefined, to: Partial<LatLng> | null | undefined): number | null {
  if (!isValidPoint(from) || !isValidPoint(to)) return null;
  return Math.round(haversineKm(from, to) * ROAD_FACTOR * 10) / 10;
}

/** Minutes to drive between two points at the average truck speed; null if either point is invalid. */
export function travelMinutes(from: Partial<LatLng> | null | undefined, to: Partial<LatLng> | null | undefined): number | null {
  const km = roadKm(from, to);
  return km === null ? null : Math.max(1, Math.round((km / AVERAGE_TRUCK_SPEED_KMH) * 60));
}
