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

export const FUEL_PRICE_PER_LITER = 92; // INR

export class AnalyticsService {
  /**
   * When each delivery happened in `[startISO, endISO)`: shipments by the time their `delivered`
   * status was logged (a later edit to the row does not move it; a shipment with no log at all falls back
   * to its last update), plus vendor loads (cargo manifests) delivered in the range.
   */
  static async deliveryTimes(startISO: string, endISO: string): Promise<string[]> {
    const { data: logs, error: logErr } = await supabase
      .from('shipment_logs')
      .select('shipment_id, timestamp')
      .eq('status', 'delivered')
      .gte('timestamp', startISO)
      .lt('timestamp', endISO);
    if (logErr) throw logErr;
    const times = new Map<string, string>();
    for (const l of logs || []) if (!times.has(l.shipment_id)) times.set(l.shipment_id, l.timestamp);

    // Delivered shipments changed in range that have no delivered log at all (older data)
    const { data: recent, error: recentErr } = await supabase
      .from('shipments')
      .select('id, updated_at')
      .eq('status', 'delivered')
      .gte('updated_at', startISO)
      .lt('updated_at', endISO);
    if (recentErr) throw recentErr;
    const unlogged = (recent || []).filter((r: any) => !times.has(r.id));
    if (unlogged.length > 0) {
      const logged = await selectIn<{ shipment_id: string }>('shipment_logs', 'shipment_id', unlogged.map((r: any) => r.id), 'shipment_id', q => q.eq('status', 'delivered'));
      const hasLog = new Set(logged.map(l => l.shipment_id));
      for (const r of unlogged) if (!hasLog.has(r.id)) times.set(r.id, r.updated_at);
    }

    const { data: manifests, error: manifestErr } = await supabase
      .from('cargo_manifest')
      .select('id, updated_at')
      .in('status', ['delivered', 'completed'])
      .gte('updated_at', startISO)
      .lt('updated_at', endISO);
    if (manifestErr) throw manifestErr;
    for (const m of manifests || []) times.set(`manifest:${m.id}`, m.updated_at);
    return [...times.values()];
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
    ] = await Promise.all([
      supabase.from('vehicles').select('plate_number, status'),
      supabase.from('routes').select('id', { count: 'exact', head: true }).in('status', ['active', 'completed']).gte('created_at', startISO).lt('created_at', endISO),
      AnalyticsService.deliveryTimes(startISO, endISO),
    ]);
    const fleet = (vehicleRows || []).filter((v: any) => !isPlaceholderPlate(v.plate_number) && v.status !== 'archived' && v.status !== 'pending_approval');
    const totalVehicles = fleet.length;
    const runningVehicles = fleet.filter((v: any) => v.status === 'on_route').length;
    const idleVehicles = fleet.filter((v: any) => v.status === 'idle' || v.status === 'available').length;

    // Planned distance of the routes dispatched in range
    const { data: routesToday } = await supabase
      .from('routes')
      .select('total_distance_km')
      .in('status', ['active', 'completed'])
      .gte('created_at', startISO)
      .lt('created_at', endISO);
    const totalDistanceToday = (routesToday || []).reduce((s: number, r: any) => s + (r.total_distance_km || 0), 0);

    // Backhaul revenue: agreed cost of vendor loads assigned or completed in range
    const { data: backhaulData } = await supabase
      .from('vendor_shipment_requests')
      .select('cost')
      .in('status', ['completed', 'assigned'])
      .gte('created_at', startISO)
      .lt('created_at', endISO);
    const backhaulLoads = (backhaulData || []).filter((b: any) => b.cost != null);
    const backhaulRevenue = backhaulLoads.reduce((s: number, b: any) => s + (b.cost || 0), 0);

    // Revenue, fuel, maintenance and profit figures were removed: no invoice
    // is ever written and costs were flat per-route constants, so they were
    // always ₹0 or invented.
    return {
      trips_today: tripsToday || 0,
      deliveries_today: deliveredTimes.length,
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
      supabase.from('routes').select('created_at').in('status', ['active', 'completed']).gte('created_at', sinceISO).lt('created_at', untilISO),
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
  static async getLiveInsights(): Promise<Record<string, any>[]> {
    const insights: Record<string, any>[] = [];

    // 1. Delay risk from active routes
    const { data: activeRoutes } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .eq('status', 'active');

    if (activeRoutes) {
      for (const route of activeRoutes) {
        const { data: telemetryData } = await supabase
          .from('telemetry')
          .select('*')
          .eq('vehicle_id', route.vehicle_id)
          .order('timestamp', { ascending: false })
          .limit(1);

        const latestTelemetry = telemetryData?.[0];
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
            title: `Backhaul Opportunity: ${plate}`,
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
    const { data: idleVehicles } = await supabase
      .from('vehicles')
      .select('id, plate_number, updated_at')
      .eq('status', 'idle');

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
    const suggestions = (await cacheGet<any[]>('active_reroute_suggestions')) || [];
    for (const s of suggestions) {
      const fromTraffic = s.source === 'traffic';
      const saved = typeof s.saved_minutes === 'number' && s.saved_minutes > 0 ? s.saved_minutes : null;
      insights.push({
        id: `reroute_${s.vehicle_id}`,
        type: 'reroute_suggestion',
        title: fromTraffic ? `Traffic ahead: ${s.trigger}` : `Reroute: ${s.vehicle_id.substring(0, 8)}`,
        insight: saved !== null
          ? `Better path found! ${s.trigger}. Potential savings: ${saved} mins.`
          : `${s.trigger}. Open the route to check for a better order.`,
        vehicle_id: s.vehicle_id,
        route_id: s.route_id,
        new_sequence: s.new_stop_sequence,
        saved_mins: saved,
        cause: s.trigger,
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
      supabase.from('shipments').select('id', { count: 'exact', head: true }).eq('status', 'delivered'),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('status', 'on_route'),
      supabase.from('routes').select('id', { count: 'exact', head: true }).in('status', ['active', 'completed']),
      supabase.from('routes').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
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
    const { data: activeRoutes } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .in('status', ['active', 'pending']);

    if (!activeRoutes) return [];

    const missions: Record<string, any>[] = [];
    const seenVehicles = new Set<string>();

    for (const route of activeRoutes) {
      if (seenVehicles.has(route.vehicle_id)) continue;
      seenVehicles.add(route.vehicle_id);

      const { data: telData } = await supabase
        .from('telemetry')
        .select('*')
        .eq('vehicle_id', route.vehicle_id)
        .order('timestamp', { ascending: false })
        .limit(1);

      const tele = telData?.[0];
      const stops = route.route_stops || [];
      const pending = stops.filter((s: any) => s.status === 'pending');
      const completed = stops.filter((s: any) => s.status === 'completed');

      const suggestions = (await cacheGet<any[]>('active_reroute_suggestions')) || [];
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
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, plate_number, vehicle_type, status, driver_id')
      .neq('status', 'archived');

    if (error) throw error;
    if (!vehicles || vehicles.length === 0) return [];

    const vehicleIds = vehicles.map(v => v.id);

    const { data: routesData, error: routesErr } = await supabase
      .from('routes')
      .select('vehicle_id, status, total_distance_km')
      .in('vehicle_id', vehicleIds);
    if (routesErr) throw routesErr;

    const routesByVehicle: Record<string, any[]> = {};
    (routesData || []).forEach(r => {
      (routesByVehicle[r.vehicle_id] ||= []).push(r);
    });

    const driverIds = vehicles.map(v => v.driver_id).filter(Boolean) as string[];
    const usersMap: Record<string, any> = {};
    if (driverIds.length > 0) {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, full_name, email')
        .in('id', driverIds);
      (usersData || []).forEach(u => { usersMap[u.id] = u; });
    }

    // Only figures that exist in the data: on-time % from planned vs actual stop
    // arrival, rating from staff ratings. Both are null until there is data.
    const stats = await getVehicleDriverStats(vehicleIds);

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
    const { data: vendors, error } = await supabase
      .from('vendor_profiles')
      .select('id, company_name, city, is_verified, kyc_status');

    if (error) throw error;
    if (!vendors) return [];

    const { data: requests } = await supabase
      .from('vendor_shipment_requests')
      .select('vendor_id, status, cost, cost_per_km');

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
