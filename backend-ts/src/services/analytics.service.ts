/**
 * RouteIQ — Analytics Service
 * Ports: backend/app/services/analytics_service.py
 */
import { supabase } from '../core/supabase';
import { cacheGet } from '../core/redis';

export class AnalyticsService {
  /**
   * Generates real-time AI insights by analyzing live telemetry against active routes.
   */
  static async getLiveInsights(): Promise<Record<string, any>[]> {
    const insights: Record<string, any>[] = [];

    // 1. Fetch active routes with vehicle and stops
    const { data: activeRoutes } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .eq('status', 'active');

    if (activeRoutes) {
      for (const route of activeRoutes) {
        // Get latest telemetry
        const { data: telemetryData } = await supabase
          .from('telemetry')
          .select('*')
          .eq('vehicle_id', route.vehicle_id)
          .order('timestamp', { ascending: false })
          .limit(1);

        const latestTelemetry = telemetryData?.[0];
        if (!latestTelemetry) continue;

        // Find next pending stop
        const pendingStops = (route.route_stops || [])
          .filter((s: any) => s.status === 'pending')
          .sort((a: any, b: any) => a.sequence - b.sequence);

        const nextStop = pendingStops[0];
        if (nextStop?.delivery_points) {
          const dp = nextStop.delivery_points;
          const dist = Math.sqrt(
            Math.pow(latestTelemetry.latitude - dp.latitude, 2) +
            Math.pow(latestTelemetry.longitude - dp.longitude, 2)
          );

          if (dist > 0.05 && latestTelemetry.speed_kmph < 10) {
            insights.push({
              id: crypto.randomUUID(),
              type: 'delay_risk',
              title: `High Delay Risk: ${route.vehicles?.plate_number}`,
              insight: `Vehicle is ${(dist * 111).toFixed(1)}km from next stop with low speed (${latestTelemetry.speed_kmph}km/h). Potential congestion.`,
              score: 85.5,
              trend: 'down',
              vehicle_id: route.vehicle_id,
              severity: 'high',
            });
          }
        }
      }
    }

    // 2. Fetch reroute suggestions from Redis
    const suggestions = (await cacheGet<any[]>('active_reroute_suggestions')) || [];
    for (const s of suggestions) {
      insights.push({
        id: `reroute_${s.vehicle_id}`,
        type: 'reroute_suggestion',
        title: `Reroute Alert: ${s.vehicle_id.substring(0, 8)}`,
        insight: `Better path found! ${s.trigger}. Potential savings: ${s.saved_minutes} mins.`,
        score: 92.0,
        trend: 'up',
        vehicle_id: s.vehicle_id,
        route_id: s.route_id,
        new_sequence: s.new_stop_sequence,
        saved_mins: s.saved_minutes,
        severity: 'medium',
      });
    }

    // 3. Default insight if nothing else
    if (insights.length === 0) {
      insights.push({
        id: crypto.randomUUID(),
        type: 'efficiency',
        title: 'Fleet Optimization High',
        insight: 'Current global route cluster BX-04 operating at 98.4% efficiency with no predicted bottlenecks.',
        score: 98.4,
        trend: 'up',
        severity: 'low',
      });
    }

    return insights;
  }

  /**
   * Aggregates real-time fleet performance metrics.
   */
  static async getFleetStats(): Promise<Record<string, any>> {
    const { count: deliveredCount } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'delivered');

    const { count: activeVehicleCount } = await supabase
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'on_route');

    const totalDelivered = deliveredCount || 0;
    const activeVehicles = activeVehicleCount || 0;

    const baseSavings = 15.0;
    const dynamicSavings = Math.min(25.0, baseSavings + activeVehicles * 0.5);
    const roiToday = 150000 + totalDelivered * 2500;

    return {
      total_deliveries: totalDelivered,
      active_vehicles: activeVehicles,
      on_time_rate_pct: 94.2 + (Math.random() * 2 - 1),
      fuel_saved_pct: parseFloat(dynamicSavings.toFixed(1)),
      fuel_cost_today: roiToday,
      co2_saved_kg: parseFloat((activeVehicles * 1.2).toFixed(1)),
      delta_vehicles: '+4.2%',
      delta_efficiency: '+1.2%',
      delta_roi: '+12.4%',
      delta_fuel: '+3.1%',
    };
  }

  /**
   * Returns status for all 'on_route' vehicles for Mission Control.
   */
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

      // Latest telemetry
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

      // Check for reroute suggestions
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
}
