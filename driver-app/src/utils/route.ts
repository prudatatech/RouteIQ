import type { DriverRoute, LatLng, MyRouteResponse, RouteStop } from '../types/route';

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371e3;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function pointCoord(point: { latitude?: unknown; longitude?: unknown } | null | undefined): LatLng | null {
  const lat = toNumber(point?.latitude);
  const lng = toNumber(point?.longitude);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

export const stopCoord = (stop: RouteStop | null | undefined) => pointCoord(stop?.delivery_point);

export const sortedStops = (route: DriverRoute | null | undefined): RouteStop[] =>
  [...(route?.stops ?? [])].sort((a, b) => a.sequence - b.sequence);

export const pendingStops = (route: DriverRoute | null | undefined) =>
  sortedStops(route).filter((s) => s.status === 'pending');

export function stopCounts(route: DriverRoute | null | undefined) {
  const stops = route?.stops ?? [];
  const completed = stops.filter((s) => s.status === 'completed').length;
  const failed = stops.filter((s) => s.status === 'failed').length;
  return { total: stops.length, completed, failed, done: completed + failed };
}

/** All stops handled, or the backend already marked the route completed. */
export function isRouteFinished(route: DriverRoute | null | undefined): boolean {
  if (!route) return false;
  if (route.status === 'completed') return true;
  const { total, done } = stopCounts(route);
  return total > 0 && done >= total;
}

export const isPickup = (stop: RouteStop | null | undefined) => stop?.stop_type === 'pickup';

/** Driver is treated as "at the stop" inside this radius (matches the POD geofence check). */
export const ARRIVAL_RADIUS_M = 200;

export type NextStep =
  | { kind: 'no_route' }
  | { kind: 'no_stops'; route: DriverRoute }
  | { kind: 'start'; route: DriverRoute }
  | { kind: 'enable_tracking'; route: DriverRoute; stop: RouteStop }
  | { kind: 'navigate'; route: DriverRoute; stop: RouteStop; distanceM: number | null }
  | { kind: 'arrived'; route: DriverRoute; stop: RouteStop; distanceM: number }
  | { kind: 'completed'; route: DriverRoute };

/** The one thing the driver should do next, derived from real route state. */
export function getNextStep(data: MyRouteResponse | null | undefined, isTracking: boolean, currentLoc: LatLng | null): NextStep {
  const route = data?.route;
  if (!route) return { kind: 'no_route' };
  if (isRouteFinished(route)) return { kind: 'completed', route };
  if (!data?.active) return { kind: 'no_route' };
  if (!route.stops?.length) return { kind: 'no_stops', route };
  if (route.status === 'pending') return { kind: 'start', route };

  const stop = pendingStops(route)[0];
  if (!stop) return { kind: 'completed', route };
  if (!isTracking) return { kind: 'enable_tracking', route, stop };

  const target = stopCoord(stop);
  const distanceM = target && currentLoc ? distanceMeters(currentLoc, target) : null;
  if (distanceM !== null && distanceM <= ARRIVAL_RADIUS_M) return { kind: 'arrived', route, stop, distanceM };
  return { kind: 'navigate', route, stop, distanceM };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(minutes: number): string {
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}
