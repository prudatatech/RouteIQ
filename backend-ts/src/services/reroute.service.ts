/**
 * margixindia — reroute suggestions
 *
 * The suggestions cache is the one the insights list and the Optimize page
 * read. /optimize/incubate writes to it after asking the ML service to
 * evaluate a vehicle; traffic incidents write to it here.
 */
import { cacheGet, cacheSet } from '../core/redis';
import { logFallback, mlPost } from './optimizer/ml-client';
import { evaluateRerouteLocal, RerouteDecision } from './optimizer/reroute-local';

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

/** A better-order finding. Local findings carry the full figures; the ML service's carry what it reports. */
export type RerouteFinding = Partial<RerouteDecision> & { saved_minutes: number; new_stop_sequence?: string[] };

/** The ML service answers in seconds or not at all; do not hold up a request longer. */
const ML_REROUTE_TIMEOUT_MS = 5_000;
/** Below this the change is not worth a driver's attention (the ML service uses the same limit). */
const MIN_SAVED_MINUTES = 5;

/**
 * Whether a better stop order exists for the vehicle's open route. Asks the ML service and, when it
 * is not there, re-solves the remaining stops in-process. Null when nothing could be evaluated.
 */
export async function evaluateReroute(vehicleId: string): Promise<RerouteFinding | null> {
  try {
    const decision: any = await mlPost('/evaluate-reroute', { vehicle_id: vehicleId }, { timeoutMs: ML_REROUTE_TIMEOUT_MS });
    if (decision && typeof decision.saved_minutes === 'number') return { ...decision, engine: 'ml-service' };
  } catch (e) {
    logFallback('evaluate-reroute', e, 'the in-process re-solve');
  }
  try {
    const local = await evaluateRerouteLocal(vehicleId);
    if (!local.ok) return null;
    const { decision } = local;
    return decision.saved_minutes >= MIN_SAVED_MINUTES ? decision : { ...decision, saved_minutes: 0 };
  } catch (e) {
    console.warn('[optimizer] in-process reroute evaluation failed:', (e as Error).message);
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
