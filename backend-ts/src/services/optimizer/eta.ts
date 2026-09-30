/**
 * margixindia — ETA prediction: ML service, then a traffic-aware Mapbox duration
 * (when origin and destination are given), then a physics estimate.
 */
import { settings } from '../../core/config';
import { externalHttp } from '../../core/http';
import { isValidPoint, LatLng } from '../geo';
import { logFallback, mlPost } from './ml-client';

export interface EtaInput {
  distance_km: number;
  traffic_density: number;
  weather_severity: number;
  vehicle_type?: string;
  origin?: LatLng;
  destination?: LatLng;
}

const ML_ETA_TIMEOUT_MS = 5_000;
const BASE_SPEED_KMPH = 45;
const r1 = (n: number) => parseFloat(n.toFixed(1));

/** Bad weather slows the whole trip the same way in every engine. */
function weatherSlowdown(severity: number): number {
  return 1 - severity * 0.3;
}

/** Live-traffic driving time between two points from Mapbox, or null without a token or a route. */
async function mapboxEta(input: EtaInput): Promise<Record<string, unknown> | null> {
  if (!settings.MAPBOX_ACCESS_TOKEN || !input.origin || !input.destination) return null;
  if (!isValidPoint(input.origin) || !isValidPoint(input.destination)) return null;
  const { origin: a, destination: b } = input;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${a.lng},${a.lat};${b.lng},${b.lat}`
    + `?overview=false&access_token=${encodeURIComponent(settings.MAPBOX_ACCESS_TOKEN)}`;
  const data = await externalHttp.getJson<any>(url, 8_000);
  const route = data?.routes?.[0];
  if (!route || typeof route.duration !== 'number') return null;

  const trafficMin = route.duration / 60;
  const typicalMin = typeof route.duration_typical === 'number' ? route.duration_typical / 60 : null;
  const minutes = trafficMin / weatherSlowdown(input.weather_severity);
  const uncertainty = Math.max(2, minutes * 0.1);
  return {
    estimated_minutes: r1(minutes),
    confidence_interval_low: r1(minutes - uncertainty),
    confidence_interval_high: r1(minutes + uncertainty),
    traffic_impact_minutes: typicalMin == null ? null : r1(Math.max(0, trafficMin - typicalMin)),
    weather_impact_minutes: r1(minutes - trafficMin),
    distance_km: r1(route.distance / 1000),
    model_version: 'mapbox-driving-traffic',
  };
}

function physicsEta(input: EtaInput): Record<string, unknown> {
  const trafficFactor = 1 - input.traffic_density * 0.6;
  const hour = new Date().getHours();
  const peakFactor = (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20) ? 0.75 : 1.0;
  const speed = Math.max(5, BASE_SPEED_KMPH * trafficFactor * weatherSlowdown(input.weather_severity) * peakFactor);
  const minutes = (input.distance_km / speed) * 60;
  const uncertainty = Math.max(2, minutes * 0.1 * (1 + input.traffic_density + input.weather_severity));
  return {
    estimated_minutes: r1(minutes),
    confidence_interval_low: r1(minutes - uncertainty),
    confidence_interval_high: r1(minutes + uncertainty),
    traffic_impact_minutes: r1(Math.max(0, minutes - (input.distance_km / BASE_SPEED_KMPH) * 60)),
    weather_impact_minutes: r1(input.weather_severity * 5),
    model_version: '1.0.0-physics-ts',
  };
}

export async function predictEta(input: EtaInput): Promise<Record<string, unknown>> {
  try {
    const { origin, destination, ...forMl } = input;
    void origin; void destination;
    const result = await mlPost<Record<string, unknown>>('/predict-eta', forMl, { timeoutMs: ML_ETA_TIMEOUT_MS });
    return { ...result, engine: 'ml-service' };
  } catch (e) {
    logFallback('predict-eta', e, input.origin && input.destination && settings.MAPBOX_ACCESS_TOKEN ? 'a Mapbox traffic duration' : 'the physics estimate');
  }
  try {
    const routed = await mapboxEta(input);
    if (routed) return { ...routed, engine: 'fallback-road-matrix' };
  } catch (e) {
    console.warn('[optimizer] Mapbox ETA failed, using the physics estimate:', (e as Error).message);
  }
  return { ...physicsEta(input), engine: 'fallback-estimated' };
}
