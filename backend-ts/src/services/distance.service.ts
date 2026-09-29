import { settings } from '../core/config';
import { externalHttp } from '../core/http';
import { MapplsService } from './mappls.service';
import { haversineKm, isValidPoint, LatLng, ROAD_FACTOR } from './geo';

export type DistanceSource = 'mappls' | 'google' | 'estimate';

export interface DrivingDistance {
  km: number;
  source: DistanceSource;
  /** True when the number is straight-line distance x 1.3, not a routed distance. */
  is_estimate: boolean;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

/**
 * Driving distance between two points. Tries Mappls, then Google Directions,
 * then falls back to straight-line distance x 1.3 and says so.
 */
export async function getDrivingDistance(a: LatLng, b: LatLng): Promise<DrivingDistance> {
  if (!isValidPoint(a) || !isValidPoint(b)) throw new Error('Both points need valid coordinates');

  if (settings.MAPPLS_CLIENT_ID && settings.MAPPLS_CLIENT_SECRET) {
    try {
      const data = await MapplsService.getRouting(a, b);
      const meters = data?.routes?.[0]?.distance;
      if (typeof meters === 'number' && meters > 0) return { km: round1(meters / 1000), source: 'mappls', is_estimate: false };
    } catch (e) {
      console.warn('[distance] Mappls failed, trying the next source:', (e as Error).message);
    }
  }

  if (settings.GOOGLE_MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&key=${encodeURIComponent(settings.GOOGLE_MAPS_API_KEY)}`;
      const data = await externalHttp.getJson<any>(url);
      const meters = data?.status === 'OK' ? data.routes?.[0]?.legs?.[0]?.distance?.value : undefined;
      if (typeof meters === 'number' && meters > 0) return { km: round1(meters / 1000), source: 'google', is_estimate: false };
    } catch (e) {
      console.warn('[distance] Google Directions failed, using an estimate:', (e as Error).message);
    }
  }

  return { km: round1(haversineKm(a, b) * ROAD_FACTOR), source: 'estimate', is_estimate: true };
}
