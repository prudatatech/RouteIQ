/** Small geometry helpers shared by the pricing, traffic and weather services. */

export interface LatLng { lat: number; lng: number }

export function isValidPoint(p: Partial<LatLng> | null | undefined): p is LatLng {
  return !!p
    && typeof p.lat === 'number' && typeof p.lng === 'number'
    && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
    && !(p.lat === 0 && p.lng === 0);
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Road distance is longer than the straight line; 1.3 is the factor used when no routing service answers. */
export const ROAD_FACTOR = 1.3;

/** Shortest distance in km from `p` to the segment a-b (flat-earth approximation, fine for short segments). */
export function distanceToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110.57;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToPathKm(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineKm(p, path[0]);
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) best = Math.min(best, distanceToSegmentKm(p, path[i], path[i + 1]));
  return best;
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}
