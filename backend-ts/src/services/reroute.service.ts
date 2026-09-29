/**
 * margixindia — reroute suggestions
 *
 * The suggestions cache is the one the insights list and the Optimize page
 * read. /optimize/incubate writes to it after asking the ML service to
 * evaluate a vehicle; traffic incidents write to it here.
 */
import { settings } from '../core/config';
import { cacheGet, cacheSet } from '../core/redis';
import { externalHttp } from '../core/http';

export const REROUTE_CACHE_KEY = 'active_reroute_suggestions';
const TTL_SECONDS = 3600;

export interface RerouteSuggestion {
  vehicle_id: string;
  route_id?: string;
  /** Why the suggestion exists, in plain words (for traffic: "Accident on NH48, +25 min"). */
  trigger: string;
  /** Minutes a better order saves; null when the ML service found no better order. */
  saved_minutes: number | null;
  new_stop_sequence?: string[] | null;
  incident_id?: string;
  delay_minutes?: number | null;
  source?: 'traffic' | 'ml';
}

/** Asks the ML service whether a better stop order exists. Null when it is unreachable or finds nothing. */
export async function evaluateReroute(vehicleId: string): Promise<{ saved_minutes: number; new_stop_sequence?: string[] } | null> {
  try {
    const decision: any = await externalHttp.postJson(`${settings.ML_SERVICE_URL}/evaluate-reroute`, { vehicle_id: vehicleId });
    return decision && typeof decision.saved_minutes === 'number' ? decision : null;
  } catch {
    return null;
  }
}

/**
 * Adds suggestions, replacing older ones for the same vehicle. Traffic
 * suggestions whose incident is no longer reported are dropped when
 * `activeIncidentIds` is given.
 */
export async function mergeRerouteSuggestions(add: RerouteSuggestion[], activeIncidentIds: Set<string> | null): Promise<void> {
  const existing = (await cacheGet<RerouteSuggestion[]>(REROUTE_CACHE_KEY)) || [];
  // One suggestion per vehicle: keep the one with the longest delay
  const byVehicle = new Map<string, RerouteSuggestion>();
  for (const s of add) {
    const prev = byVehicle.get(s.vehicle_id);
    if (!prev || (s.delay_minutes ?? 0) > (prev.delay_minutes ?? 0)) byVehicle.set(s.vehicle_id, s);
  }
  add = [...byVehicle.values()];
  const vehicles = new Set(byVehicle.keys());
  const kept = existing.filter(s => {
    if (vehicles.has(s.vehicle_id)) return false;
    if (activeIncidentIds && s.source === 'traffic' && s.incident_id && !activeIncidentIds.has(s.incident_id)) return false;
    return true;
  });
  await cacheSet(REROUTE_CACHE_KEY, [...add, ...kept], TTL_SECONDS);
}
