/**
 * What the driver app needs beyond the current route to decide the "next action":
 * an SOS still open, whether documents block dispatch, and the trips waiting
 * behind the current one. GET /telemetry/driver-ping/my-status.
 */
import { supabase } from '../core/supabase';
import { OPEN_SOS_STATUSES } from './sos.service';
import { dispatchIssues, liveDocumentsByUser, type DispatchIssue } from './people-docs.service';
import { getPeopleSettings } from './people-settings.service';

export interface UpcomingTrip {
  id: string;
  stops: number;
  first_stop: string | null;
  created_at: string | null;
}

export interface DriverStatus {
  open_sos: { id: string; status: string; alert_type: string | null; created_at: string | null } | null;
  /** Non-empty only when the document setting is `block`: dispatch will not give this driver work. */
  dispatch_blocked: DispatchIssue[];
  upcoming: UpcomingTrip[];
}

interface RouteRow {
  id: string;
  status: string;
  created_at?: string | null;
  route_stops?: Array<{ status: string; sequence: number; delivery_points?: { name?: string | null } | null }> | null;
}

/**
 * The trips waiting behind the one my-route returns. my-route shows the newest active or
 * pending route that has stops, so that one is left out; the rest are listed oldest first,
 * as they were sent. A stop dispatch cancelled does not count.
 */
export function upcomingTrips(rows: RouteRow[]): UpcomingTrip[] {
  const withStops = rows
    .map(r => ({ ...r, stops: (r.route_stops ?? []).filter(s => s.status !== 'cancelled').sort((a, b) => a.sequence - b.sequence) }))
    .filter(r => r.stops.length > 0)
    .sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''));
  return withStops
    .slice(1)
    .filter(r => r.status === 'pending')
    .reverse()
    .map(r => ({ id: r.id, stops: r.stops.length, first_stop: r.stops[0].delivery_points?.name ?? null, created_at: r.created_at ?? null }));
}

export async function loadDriverStatus(driverId: string): Promise<DriverStatus> {
  const [{ data: vehicle }, { data: sos }] = await Promise.all([
    supabase.from('vehicles').select('id, capacity_kg, vehicle_type').eq('driver_id', driverId).maybeSingle(),
    supabase
      .from('sos_alerts')
      .select('id, status, alert_type, created_at')
      .eq('driver_id', driverId)
      .in('status', [...OPEN_SOS_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  const openSos = (sos ?? [])[0] ?? null;

  let dispatchBlocked: DispatchIssue[] = [];
  let upcoming: UpcomingTrip[] = [];
  if (vehicle) {
    const [settings, docs, person, routes] = await Promise.all([
      getPeopleSettings(),
      liveDocumentsByUser([driverId]),
      supabase.from('users').select('status').eq('id', driverId).maybeSingle(),
      supabase
        .from('routes')
        .select('id, status, created_at, route_stops(status, sequence, delivery_points(name))')
        .eq('vehicle_id', vehicle.id)
        .in('status', ['active', 'pending'])
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    if (settings.driver_document_enforcement === 'block') {
      dispatchBlocked = dispatchIssues({
        personStatus: person.data?.status ?? null,
        docs: docs.get(driverId),
        vehicle,
        graceDays: settings.licence_grace_days,
      }).issues;
    }
    upcoming = upcomingTrips((routes.data ?? []) as unknown as RouteRow[]);
  }

  return {
    open_sos: openSos ? { id: openSos.id, status: openSos.status, alert_type: openSos.alert_type ?? null, created_at: openSos.created_at ?? null } : null,
    dispatch_blocked: dispatchBlocked,
    upcoming,
  };
}
