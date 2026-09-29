import type { DriverRoute, RouteStop } from '../types/route';
import { sortedStops } from './route';

/** Same rule as the backend: trimmed, upper case, a tracking link reduced to its ID. */
export function normalizeParcelCode(raw: string): string {
  let code = (raw ?? '').trim();
  if (/^https?:\/\//i.test(code)) {
    const last = code.split(/[?#]/)[0].split('/').filter(Boolean).pop();
    if (last) {
      try {
        code = decodeURIComponent(last);
      } catch {
        code = last;
      }
    }
  }
  return code.replace(/\s+/g, '').toUpperCase();
}

export const sameParcelCode = (a: string, b: string) => !!a && !!b && normalizeParcelCode(a) === normalizeParcelCode(b);

/** Stops of the route whose parcel carries this code (a vendor load has a pickup and a drop). */
export function stopsForCode(route: DriverRoute | null | undefined, code: string): RouteStop[] {
  const wanted = normalizeParcelCode(code);
  if (!wanted) return [];
  return sortedStops(route).filter((s) => s.parcel?.code && normalizeParcelCode(s.parcel.code) === wanted);
}

export type ScanPlan =
  | { kind: 'not_on_route' }
  | { kind: 'already_done'; stop: RouteStop }
  | { kind: 'pickup'; stop: RouteStop | null; code: string }
  | { kind: 'delivery'; stop: RouteStop; isNext: boolean };

/**
 * What a scan means for this route: load the parcel, or check it against the
 * stop it belongs to. `pickedUp` holds codes the driver already scanned at
 * pickup on this phone, so a scan made offline is not treated as a pickup twice.
 */
export function planScan(route: DriverRoute | null | undefined, code: string, pickedUp: ReadonlySet<string>): ScanPlan {
  const stops = stopsForCode(route, code);
  if (stops.length === 0) return { kind: 'not_on_route' };

  const normalized = normalizeParcelCode(code);
  const first = stops[0];
  const isManifest = first.parcel?.kind === 'manifest';

  if (isManifest) {
    const pickupStop = stops.find((s) => s.parcel?.purpose === 'pickup');
    const dropStop = stops.find((s) => s.parcel?.purpose === 'delivery');
    if (pickupStop && pickupStop.status === 'pending' && !pickedUp.has(normalized)) {
      return { kind: 'pickup', stop: pickupStop, code: normalized };
    }
    if (dropStop && dropStop.status === 'pending') {
      return { kind: 'delivery', stop: dropStop, isNext: sortedStops(route).find((s) => s.status === 'pending')?.id === dropStop.id };
    }
    return { kind: 'already_done', stop: dropStop ?? first };
  }

  const stop = first;
  const notLoaded = first.parcel?.status === 'created' && !pickedUp.has(normalized);
  if (notLoaded && stop.status === 'pending') return { kind: 'pickup', stop: null, code: normalized };
  if (stop.status !== 'pending') return { kind: 'already_done', stop };
  return { kind: 'delivery', stop, isNext: sortedStops(route).find((s) => s.status === 'pending')?.id === stop.id };
}
