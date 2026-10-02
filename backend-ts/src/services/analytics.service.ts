/**
 * margixindia — Analytics Service (v2)
 * Full Fleet Intelligence: Overview, Vehicle Health, Profitable Routes, AI Insights
 */
import { supabase } from '../core/supabase';
import { cacheGet } from '../core/redis';
import { indianDateKey, startOfIndianDay } from '../core/istDate';
import { getVehicleDriverStats } from './driver-performance.service';
import { selectIn } from './finance.service';
import { isPlaceholderPlate } from '../core/vehicles';
import { OWNED, isScoped, orgFilter, scopeQuery } from '../core/org-scope';

/**
 * Vendor loads (requests) of the active company. A request has no carrier column: the company runs it through the
 * cargo manifest made for it. Returns null when nothing is scoped (read the table as it is).
 */
async function companyRequestIds(): Promise<string[] | null> {
  if (!isScoped(OWNED.carrier)) return null;
  const { data, error } = await scopeQuery(supabase.from('cargo_manifest').select('vendor_request_id').not('vendor_request_id', 'is', null), OWNED.carrier);
  if (error) throw error;
  return [...new Set((data ?? []).map((m: any) => m.vendor_request_id as string))];
}

/** The vehicle ids of the active company; null when nothing is scoped. */
async function companyVehicleIds(): Promise<Set<string> | null> {
  if (!orgFilter(OWNED.carrier)) return null;
  const { data, error } = await scopeQuery(supabase.from('vehicles').select('id'), OWNED.carrier);
  if (error) throw error;
  return new Set((data ?? []).map((v: any) => v.id as string));
}

export const FUEL_PRICE_PER_LITER = 92; // INR

// vendor_shipment_requests statuses that count as backhaul revenue
const BACKHAUL_EARNING_STATUSES = ['completed', 'assigned'];

export class AnalyticsService {
  /**
   * When each delivery happened in `[startISO, endISO)`: shipments by the time their `delivered`
   * status was logged (a later edit to the row does not move it; a shipment with no log at all falls back
   * to its last update), plus vendor loads (cargo manifests) delivered in the range.
   *
   * What is counted depends on `unit`. A consignment split into lots is one shipment with its lots under it:
   *   - `shipments` (the default): a split counts once, as its master, when the whole of it is delivered;
   *     its lots are not counted on top. This is the figure Analytics calls "Shipments delivered".
   *   - `drops`: each lot counts on its own, and the master does not. A consignment that was never split is one drop.
   */
  static async deliveryTimes(startISO: string, endISO: string, unit: 'shipments' | 'drops' = 'shipments'): Promise<string[]> {
    const scoped = isScoped(OWNED.carrierAndVendor);
    const { data: logs, error: logErr } = await supabase
      .from('shipment_logs')
      .select('shipment_id, timestamp')
      .eq('status', 'delivered')
      .gte('timestamp', startISO)
      .lt('timestamp', endISO);
    if (logErr) throw logErr;
    const times = new Map<string, string>();
    for (const l of logs || []) if (!times.has(l.shipment_id)) times.set(l.shipment_id, l.timestamp);

    // `shipments` keeps masters and plain shipments (no parent); `drops` keeps lots and plain shipments (no master)
    const counted = (r: { is_master?: boolean | null; parent_shipment_id?: string | null }) =>
      unit === 'shipments' ? !r.parent_shipment_id : r.is_master !== true;
    if (times.size > 0) {
      const logged = await selectIn<{ id: string; is_master: boolean | null; parent_shipment_id: string | null }>('shipments', 'id', [...times.keys()], 'id, is_master, parent_shipment_id', q => scopeQuery(q, OWNED.carrierAndVendor));
      const byId = new Map(logged.map(r => [r.id, r]));
      for (const id of [...times.keys()]) {
        const row = byId.get(id);
        // A delivery log of another company's shipment is not ours (a shipment missing altogether stays, as before)
        if ((scoped && !row) || (row && !counted(row))) times.delete(id);
      }
    }

    // Delivered shipments changed in range that have no delivered log at all (older data)
    const { data: recent, error: recentErr } = await scopeQuery(supabase
      .from('shipments')
      .select('id, updated_at, is_master, parent_shipment_id')
      .eq('status', 'delivered')
      .gte('updated_at', startISO)
      .lt('updated_at', endISO), OWNED.carrierAndVendor);
    if (recentErr) throw recentErr;
    const unlogged = (recent || []).filter((r: any) => counted(r) && !times.has(r.id));
    if (unlogged.length > 0) {
      const logged = await selectIn<{ shipment_id: string }>('shipment_logs', 'shipment_id', unlogged.map((r: any) => r.id), 'shipment_id', q => q.eq('status', 'delivered'));
      const hasLog = new Set(logged.map(l => l.shipment_id));
      for (const r of unlogged) if (!hasLog.has(r.id)) times.set(r.id, r.updated_at);
    }

    const { data: manifests, error: manifestErr } = await scopeQuery(supabase
      .from('cargo_manifest')
      .select('id, updated_at, is_master, parent_manifest_id')
      .in('status', ['delivered', 'completed'])
      .gte('updated_at', startISO)
      .lt('updated_at', endISO), OWNED.carrierAndVendor);
    if (manifestErr) throw manifestErr;
    for (const m of manifests || []) {
      const keep = unit === 'shipments' ? !m.parent_manifest_id : m.is_master !== true;
      if (keep) times.set(`manifest:${m.id}`, m.updated_at);
    }
    return [...times.values()];
  }

  /** Vendor load requests: all of them, or (scoped) the ones the active company runs. */
  static async requestRows(columns: string, filter: (q: any) => any): Promise<{ data: any[] | null; error: any }> {
    const ids = await companyRequestIds();
    if (ids === null) return filter(supabase.from('vendor_shipment_requests').select(columns));
    try {
      return { data: await selectIn<any>('vendor_shipment_requests', 'id', ids, columns, filter), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FLEET OVERVIEW — today's operational figures, all counted from real rows
  // ──────────────────────────────────────────────────────────────────────────
  static async getFleetOverview(range?: { start: Date; end: Date }): Promise<Record<string, any>> {
    // Defaults to the Indian calendar "today" when no range is given, whatever timezone the server runs in.
    const { start, end } = range ?? { start: startOfIndianDay(0), end: startOfIndianDay(-1) };
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    // The fleet is counted the way Fleet's own summary counts it: placeholder vehicles (TEMP-…,
    // DRFT-…), archived and not-yet-approved ones are not fleet assets, and "idle" includes "available".
    const [
      { data: vehicleRows },
      { count: tripsToday },
      deliveredTimes,
      droppedTimes,
      { data: routesToday },
      { data: backhaulData },
    ] = await Promise.all([
      scopeQuery(supabase.from('vehicles').select('plate_number, status'), OWNED.carrier),
      scopeQuery(supabase.from('routes').select('id', { count: 'exact', head: true }).in('status', ['active', 'completed']).gte('created_at', startISO).lt('created_at', endISO), OWNED.carrier),
      AnalyticsService.deliveryTimes(startISO, endISO),
      AnalyticsService.deliveryTimes(startISO, endISO, 'drops'),
      // Planned distance of the routes dispatched in range
      scopeQuery(supabase.from('routes').select('total_distance_km').in('status', ['active', 'completed']).gte('created_at', startISO).lt('created_at', endISO), OWNED.carrier),
      // Backhaul revenue: agreed cost of vendor loads assigned or completed in range
      AnalyticsService.requestRows('cost', q => q.in('status', BACKHAUL_EARNING_STATUSES).gte('created_at', startISO).lt('created_at', endISO)),
    ]);
    const fleet = (vehicleRows || []).filter((v: any) => !isPlaceholderPlate(v.plate_number) && v.status !== 'archived' && v.status !== 'pending_approval');
    const totalVehicles = fleet.length;
    const runningVehicles = fleet.filter((v: any) => v.status === 'on_route').length;
    const idleVehicles = fleet.filter((v: any) => v.status === 'idle' || v.status === 'available').length;

    const totalDistanceToday = (routesToday || []).reduce((s: number, r: any) => s + (r.total_distance_km || 0), 0);

    const backhaulLoads = (backhaulData || []).filter((b: any) => b.cost != null);
    const backhaulRevenue = backhaulLoads.reduce((s: number, b: any) => s + (b.cost || 0), 0);

    // Revenue, fuel, maintenance and profit figures were removed: no invoice
    // is ever written and costs were flat per-route constants, so they were
    // always ₹0 or invented.
    return {
      trips_today: tripsToday || 0,
      // Shipments and vendor loads delivered; a consignment split into lots counts once (as its master)
      deliveries_today: deliveredTimes.length,
      // The same deliveries counted per drop: each lot of a split on its own
      delivered_drops: droppedTimes.length,
      running_vehicles: runningVehicles,
      idle_vehicles: idleVehicles,
      total_vehicles: totalVehicles,
      fleet_utilisation_pct: totalVehicles ? Math.round((runningVehicles / totalVehicles) * 100) : null,
      total_distance_km: Math.round(totalDistanceToday),
      backhaul_loads_today: backhaulLoads.length,
      backhaul_revenue: Math.round(backhaulRevenue),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DAILY ACTIVITY — routes dispatched and shipments delivered per day
  // ──────────────────────────────────────────────────────────────────────────
  static async getDailyActivity(range?: { start: Date; end: Date }, days = 14): Promise<{ date: string; trips: number; deliveries: number }[]> {
    let start: Date;
    let end: Date;
    if (range) {
      ({ start, end } = range);
      // Cap the bucketed span so a very wide custom range doesn't return hundreds of days.
      const maxSpanMs = 90 * 86_400_000;
      if (end.getTime() - start.getTime() > maxSpanMs) start = new Date(end.getTime() - maxSpanMs);
    } else {
      const span = Math.min(Math.max(Math.round(days) || 14, 1), 90);
      start = startOfIndianDay(span - 1);
      end = startOfIndianDay(-1);
    }
    const sinceISO = start.toISOString();
    const untilISO = end.toISOString();
    const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));

    const [{ data: routes, error: routesErr }, deliveredAt] = await Promise.all([
      scopeQuery(supabase.from('routes').select('created_at').in('status', ['active', 'completed']).gte('created_at', sinceISO).lt('created_at', untilISO), OWNED.carrier),
      AnalyticsService.deliveryTimes(sinceISO, untilISO),
    ]);
    if (routesErr) throw routesErr;

    const buckets = new Map<string, { trips: number; deliveries: number }>();
    for (let i = 0; i < dayCount; i++) {
      buckets.set(indianDateKey(new Date(start.getTime() + i * 86_400_000)), { trips: 0, deliveries: 0 });
    }
    (routes || []).forEach((r: any) => {
      const b = buckets.get(indianDateKey(new Date(r.created_at)));
      if (b) b.trips++;
    });
    deliveredAt.forEach((at: string) => {
      const b = buckets.get(indianDateKey(new Date(at)));
      if (b) b.deliveries++;
    });
    return Array.from(buckets, ([date, v]) => ({ date, ...v }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LIVE INSIGHTS — only conditions read from live data (no invented scores or trends)
  // ──────────────────────────────────────────────────────────────────────────
  /** The cached reroute suggestions, only those for the active company's vehicles. */
  static async rerouteSuggestions(): Promise<any[] | null> {
    const [raw, mine] = await Promise.all([cacheGet<any[]>('active_reroute_suggestions'), companyVehicleIds()]);
    return mine && raw ? raw.filter(s => mine.has(s.vehicle_id)) : raw;
  }

  static async getLiveInsights(): Promise<Record<string, any>[]> {
    const insights: Record<string, any>[] = [];

    // The three sources do not depend on each other: read them together
    const [routesRes, idleRes, suggestionsRaw] = await Promise.all([
      // Only what the insights read: the plate, and each stop's status, order and position
      scopeQuery(supabase
        .from('routes')
        .select('id, vehicle_id, vehicles(plate_number), route_stops(status, sequence, delivery_points(latitude, longitude))')
        .eq('status', 'active'), OWNED.carrier),
      scopeQuery(supabase.from('vehicles').select('id, plate_number, updated_at').eq('status', 'idle'), OWNED.carrier),
      AnalyticsService.rerouteSuggestions(),
    ]);
    const activeRoutes = routesRes.data as any[] | null;

    // 1. Delay risk from active routes. The latest position of every vehicle is read at once, not one route at a time
    const vehicleIds = [...new Set((activeRoutes ?? []).map((r: any) => r.vehicle_id).filter(Boolean))] as string[];
    const latestByVehicle = new Map<string, any>();
    await Promise.all(vehicleIds.map(async id => {
      const { data } = await supabase
        .from('telemetry')
        .select('latitude, longitude, speed_kmph')
        .eq('vehicle_id', id)
        .order('timestamp', { ascending: false })
        .limit(1);
      if (data?.[0]) latestByVehicle.set(id, data[0]);
    }));

    if (activeRoutes) {
      for (const route of activeRoutes) {
        const latestTelemetry = latestByVehicle.get(route.vehicle_id);
        if (!latestTelemetry) continue;

        const pendingStops = (route.route_stops || [])
          .filter((s: any) => s.status === 'pending')
          .sort((a: any, b: any) => a.sequence - b.sequence);

        const nextStop = pendingStops[0];
        const plate = route.vehicles?.plate_number || 'Unknown';

        // Delay risk insight
        if (nextStop?.delivery_points) {
          const dp = nextStop.delivery_points;
          const dist = Math.sqrt(
            Math.pow(latestTelemetry.latitude - dp.latitude, 2) +
            Math.pow(latestTelemetry.longitude - dp.longitude, 2)
          );
          if (dist > 0.05 && latestTelemetry.speed_kmph < 10) {
            insights.push({
              id: `delay_${route.vehicle_id}`,
              type: 'delay_risk',
              title: `High Delay Risk: ${plate}`,
              insight: `Vehicle is ${(dist * 111).toFixed(1)}km from next stop with low speed (${latestTelemetry.speed_kmph}km/h). Possible congestion detected.`,
              vehicle_id: route.vehicle_id,
              plate_number: plate,
              severity: 'high',
              icon: 'alert',
            });
          }
        }

        // Backhaul opportunity — return trip empty
        if (pendingStops.length === 0) {
          insights.push({
            id: `backhaul_${route.vehicle_id}`,
            type: 'backhaul_opportunity',
            title: `Return trip opportunity: ${plate}`,
            insight: `Truck ${plate} is likely to return empty. Open bidding for available capacity?`,
            vehicle_id: route.vehicle_id,
            plate_number: plate,
            severity: 'low',
            icon: 'opportunity',
          });
        }
      }
    }

    // 2. Idle vehicle alerts (vehicles with 'idle' status for extended time)
    const idleVehicles = idleRes.data;

    // A TEMP-/DRFT- placeholder is not a real vehicle, so it is never reported as idle
    for (const v of (idleVehicles || []).filter((x: any) => !isPlaceholderPlate(x.plate_number))) {
      const idleMs = Date.now() - new Date(v.updated_at).getTime();
      const idleDays = idleMs / (1000 * 60 * 60 * 24);
      if (idleDays >= 1) {
        insights.push({
          id: `idle_${v.id}`,
          type: 'idle_vehicle',
          title: `Idle Vehicle: ${v.plate_number}`,
          insight: `This truck has remained idle for ${Math.floor(idleDays)} day${Math.floor(idleDays) > 1 ? 's' : ''}. Consider reassignment or maintenance check.`,
          vehicle_id: v.id,
          plate_number: v.plate_number,
          severity: idleDays >= 3 ? 'high' : 'medium',
          icon: 'idle',
        });
      }
    }

    // 3. Reroute suggestions from Redis cache
    const suggestions = suggestionsRaw || [];
    for (const s of suggestions) {
      const fromTraffic = s.source === 'traffic';
      const saved = typeof s.saved_minutes === 'number' && s.saved_minutes > 0 ? s.saved_minutes : null;
      insights.push({
        id: `reroute_${s.vehicle_id}`,
        type: 'reroute_suggestion',
        title: fromTraffic ? `Traffic ahead: ${s.trigger}` : `Reroute: ${s.vehicle_id.substring(0, 8)}`,
        insight: saved !== null
          ? `Better path found! ${s.trigger}. Potential savings: ${saved} mins.`
          : `${s.trigger}. Open the trip to check for a better order.`,
        vehicle_id: s.vehicle_id,
        route_id: s.route_id,
        new_sequence: s.new_stop_sequence,
        saved_mins: saved,
        cause: s.trigger,
        engine: s.engine ?? null,
        incident_id: s.incident_id ?? null,
        delay_minutes: s.delay_minutes ?? null,
        severity: fromTraffic ? 'high' : 'medium',
        icon: 'reroute',
      });
    }

    // No synthetic "all clear" insight is injected when there is nothing to
    // report — an empty list here means no real anomaly was found, and the
    // UI is responsible for its own empty state (see D2).
    return insights;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FLEET STATS — original method kept for backward compat
  // ──────────────────────────────────────────────────────────────────────────
  static async getFleetStats(): Promise<Record<string, any>> {
    const [
      { count: deliveredCount },
      { count: activeVehicleCount },
      { count: totalRoutesCount },
      { count: completedRoutesCount },
    ] = await Promise.all([
      scopeQuery(supabase.from('shipments').select('id', { count: 'exact', head: true }).eq('status', 'delivered').neq('is_master', true), OWNED.carrierAndVendor),
      scopeQuery(supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('status', 'on_route'), OWNED.carrier),
      scopeQuery(supabase.from('routes').select('id', { count: 'exact', head: true }).in('status', ['active', 'completed']), OWNED.carrier),
      scopeQuery(supabase.from('routes').select('id', { count: 'exact', head: true }).eq('status', 'completed'), OWNED.carrier),
    ]);

    const totalDelivered = deliveredCount || 0;
    const activeVehicles = activeVehicleCount || 0;
    const totalRoutes = totalRoutesCount || 0;

    // On-time rate is approximated as the completion rate of dispatched
    // routes (no per-stop ETA/actual-arrival timestamps exist to compute a
    // true on-time %). Null — never a fabricated default — when there is no
    // route data yet.
    const onTimeRatePct = totalRoutes > 0 ? ((completedRoutesCount || 0) / totalRoutes) * 100 : null;

    // fuel savings %, fuel cost, CO2 saved and week-over-week deltas have no
    // real data source (no baseline-vs-actual fuel comparison, no historical
    // snapshot to diff against) — removed rather than fabricated (see D2).
    return {
      total_deliveries: totalDelivered,
      active_vehicles: activeVehicles,
      on_time_rate_pct: onTimeRatePct !== null ? parseFloat(onTimeRatePct.toFixed(1)) : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ACTIVE MISSIONS
  // ──────────────────────────────────────────────────────────────────────────
  static async getActiveMissions(): Promise<Record<string, any>[]> {
    const [routesRes, suggestionsRaw] = await Promise.all([
      scopeQuery(supabase
        .from('routes')
        .select('id, vehicle_id, status, vehicles(plate_number, last_sync), route_stops(status)')
        .in('status', ['active', 'pending']), OWNED.carrier),
      AnalyticsService.rerouteSuggestions(),
    ]);
    const activeRoutes = routesRes.data as any[] | null;

    if (!activeRoutes) return [];
    const suggestions = suggestionsRaw || [];

    const missions: Record<string, any>[] = [];
    const seenVehicles = new Set<string>();

    // One mission per vehicle; the latest position of each is read together, not one vehicle at a time
    const firstRoutes = activeRoutes.filter((route: any) => {
      if (seenVehicles.has(route.vehicle_id)) return false;
      seenVehicles.add(route.vehicle_id);
      return true;
    });
    const telemetryOf = new Map<string, any>();
    await Promise.all(firstRoutes.map(async (route: any) => {
      const { data } = await supabase
        .from('telemetry')
        .select('latitude, longitude, speed_kmph')
        .eq('vehicle_id', route.vehicle_id)
        .order('timestamp', { ascending: false })
        .limit(1);
      telemetryOf.set(route.vehicle_id, data?.[0]);
    }));

    for (const route of firstRoutes) {
      const tele = telemetryOf.get(route.vehicle_id);
      const stops = route.route_stops || [];
      const pending = stops.filter((s: any) => s.status === 'pending');
      const completed = stops.filter((s: any) => s.status === 'completed');

      const vehicleSuggestion = suggestions.find((s) => s.vehicle_id === route.vehicle_id);

      let aiScore = 98.4 - pending.length * 0.2;
      let status = route.status === 'active' ? 'on_route' : 'pending';
      if (vehicleSuggestion) {
        status = 'optimization_available';
        aiScore = 75.0 + vehicleSuggestion.saved_minutes / 2;
      }

      missions.push({
        vehicle_id: route.vehicle_id,
        route_id: route.id,
        plate_number: route.vehicles?.plate_number,
        status,
        progress_pct: stops.length > 0 ? (completed.length / stops.length) * 100 : 0,
        speed: tele?.speed_kmph || 0,
        last_location: tele ? [tele.latitude, tele.longitude] : null,
        last_sync: route.vehicles?.last_sync || null,
        remaining_stops: pending.length,
        ai_efficiency_score: Math.min(99.9, aiScore),
        sync_pulse: 'active',
        has_suggestion: !!vehicleSuggestion,
        potential_savings: vehicleSuggestion?.saved_minutes || 0,
      });
    }

    return missions;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DRIVER PERFORMANCE — per vehicle and its assigned driver
  // ──────────────────────────────────────────────────────────────────────────
  static async getDriverPerformance(): Promise<any[]> {
    const { data: vehicles, error } = await scopeQuery(supabase
      .from('vehicles')
      .select('id, plate_number, vehicle_type, status, driver_id')
      .neq('status', 'archived'), OWNED.carrier);

    if (error) throw error;
    if (!vehicles || vehicles.length === 0) return [];

    const vehicleIds = vehicles.map(v => v.id);

    const driverIds = vehicles.map(v => v.driver_id).filter(Boolean) as string[];
    // Routes, drivers and the driver stats depend only on the vehicles: read them together
    const [{ data: routesData, error: routesErr }, { data: usersData }, stats] = await Promise.all([
      supabase.from('routes').select('vehicle_id, status, total_distance_km').in('vehicle_id', vehicleIds),
      driverIds.length > 0
        ? supabase.from('users').select('id, full_name, email').in('id', driverIds)
        : Promise.resolve({ data: [] as any[] }),
      // Only figures that exist in the data: on-time % from planned vs actual stop
      // arrival, rating from staff ratings. Both are null until there is data.
      getVehicleDriverStats(vehicleIds),
    ]);
    if (routesErr) throw routesErr;

    const routesByVehicle: Record<string, any[]> = {};
    (routesData || []).forEach(r => {
      (routesByVehicle[r.vehicle_id] ||= []).push(r);
    });

    const usersMap: Record<string, any> = {};
    (usersData || []).forEach((u: any) => { usersMap[u.id] = u; });

    return vehicles.map((v: any) => {
      const vRoutes = routesByVehicle[v.id] || [];
      const finished = vRoutes.filter((r: any) => ['completed', 'cancelled'].includes(r.status));
      const completed = vRoutes.filter((r: any) => r.status === 'completed');
      const distance = completed.reduce((sum: number, r: any) => sum + (r.total_distance_km || 0), 0);
      const driver = v.driver_id ? usersMap[v.driver_id] : null;

      return {
        id: v.id,
        plate_number: v.plate_number,
        vehicle_type: v.vehicle_type,
        status: v.status,
        driver_name: driver?.full_name || null,
        total_routes: vRoutes.length,
        completed_routes: completed.length,
        // Share of finished routes that were completed rather than cancelled.
        completion_pct: finished.length > 0 ? Math.round((completed.length / finished.length) * 1000) / 10 : null,
        total_distance_km: Math.round(distance),
        ...stats.get(v.id)!,
      };
    }).sort((a, b) => b.completed_routes - a.completed_routes);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VENDOR PERFORMANCE
  // ──────────────────────────────────────────────────────────────────────────
  static async getVendorPerformance(): Promise<any[]> {
    // A company sees the vendors whose loads it runs; the platform sees them all
    const { data: requests, error: reqErr } = await AnalyticsService.requestRows('vendor_id, status, cost, cost_per_km', q => q);
    if (reqErr) throw reqErr;
    const scoped = (await companyRequestIds()) !== null;
    const { data: allVendors, error } = await supabase
      .from('vendor_profiles')
      .select('id, company_name, city, is_verified, kyc_status');

    if (error) throw error;
    if (!allVendors) return [];
    const seen = new Set((requests ?? []).map((r: any) => r.vendor_id));
    const vendors = scoped ? allVendors.filter((v: any) => seen.has(v.id)) : allVendors;

    return vendors.map((v: any) => {
      const vendorReqs = (requests || []).filter((r: any) => r.vendor_id === v.id);
      const total = vendorReqs.length;
      const fulfilled = vendorReqs.filter((r: any) => r.status === 'completed' || r.status === 'assigned').length;
      const costs = vendorReqs.filter((r: any) => r.cost).map((r: any) => r.cost);
      const avgCost = costs.length > 0 ? costs.reduce((a: number, b: number) => a + b, 0) / costs.length : 0;
      // SLA needs an attempted-vs-fulfilled base; with no requests yet there
      // is nothing real to report, so leave it null rather than a fake 100%.
      const sla = total > 0 ? (fulfilled / total) * 100 : null;

      // Real vendor status from the KYC workflow (pending/submitted/approved/
      // rejected), falling back to verification flag. No damage-rate or
      // carrier-category data exists anywhere, so those fields are removed
      // (see D2) instead of being hardcoded.
      const kycStatus: string | undefined = v.kyc_status;
      const status = kycStatus
        ? kycStatus.charAt(0).toUpperCase() + kycStatus.slice(1)
        : (v.is_verified ? 'Verified' : 'Pending');

      return {
        id: v.id,
        name: v.company_name,
        region: v.city || null,
        deliveries: fulfilled,
        sla: sla !== null ? parseFloat(sla.toFixed(1)) : null,
        costPerDelivery: costs.length > 0 ? Math.round(avgCost) : null,
        status,
        kyc_status: kycStatus || (v.is_verified ? 'verified' : 'pending'),
      };
    });
  }
}
