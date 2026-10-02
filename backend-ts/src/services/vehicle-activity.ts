/**
 * One definition of "on the road": a vehicle with a trip in progress (routes.status = 'active').
 * Today's "Vehicles on the road", the Fleet summary's "On trip" and the Fleet list all use it, so the
 * three screens give the same answer even when a vehicle's own status lags behind its trip.
 */
import { supabase } from '../core/supabase';
import { OWNED, scopeQuery } from '../core/org-scope';

/** Ids of the vehicles that have a trip in progress. */
export async function vehicleIdsOnActiveTrip(): Promise<Set<string>> {
  const { data, error } = await scopeQuery(supabase.from('routes').select('vehicle_id').eq('status', 'active'), OWNED.carrier);
  if (error) throw new Error(`Failed to read active trips: ${error.message}`);
  return new Set((data ?? []).map((r: { vehicle_id: string | null }) => r.vehicle_id).filter((id): id is string => !!id));
}

/** Statuses a vehicle with a trip in progress is shown as "on trip" from: it is working, whatever its own status says. */
export const WORKING_STATUSES = ['idle', 'available', 'on_route'];
