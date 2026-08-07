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

  /**
   * Returns top profitable routes. (Mock data)
   */
  static async getProfitableRoutes(): Promise<Record<string, any>[]> {
    return [
      { id: 'R-01', route_name: 'Delhi - Mumbai Expr', revenue: 120500, cost: 45000, profit_margin: 62.6, status: 'Active' },
      { id: 'R-02', route_name: 'Bangalore - Chennai', revenue: 85000, cost: 32000, profit_margin: 62.3, status: 'Active' },
      { id: 'R-03', route_name: 'Hyderabad - Pune', revenue: 94000, cost: 41000, profit_margin: 56.3, status: 'Pending' },
      { id: 'R-04', route_name: 'Kolkata - Patna', revenue: 67000, cost: 31000, profit_margin: 53.7, status: 'Active' },
      { id: 'R-05', route_name: 'Ahmedabad - Surat', revenue: 45000, cost: 22000, profit_margin: 51.1, status: 'Completed' },
    ];
  }

  /**
   * Returns driver performance metrics. (Mock data)
   */
  static async getDriverPerformance(): Promise<Record<string, any>[]> {
    return [
      { id: 'D-101', name: 'Rajesh Kumar', rating: 4.8, trips: 142, on_time_pct: 98.2, safety_score: 95 },
      { id: 'D-102', name: 'Suresh Singh', rating: 4.6, trips: 89, on_time_pct: 94.5, safety_score: 91 },
      { id: 'D-103', name: 'Amit Patel', rating: 4.9, trips: 210, on_time_pct: 99.1, safety_score: 98 },
      { id: 'D-104', name: 'Vikram Sharma', rating: 4.3, trips: 56, on_time_pct: 88.4, safety_score: 82 },
      { id: 'D-105', name: 'Manoj Yadav', rating: 4.7, trips: 115, on_time_pct: 96.0, safety_score: 93 },
    ];
  }

  /**
   * Returns high-level financial summary metrics. (Mock data)
   */
  static async getFinancials(): Promise<Record<string, any>> {
    return {
      total_revenue: 2540000,
      total_expenses: 1240000,
      net_profit: 1300000,
      fuel_costs: 450000,
      maintenance_costs: 120000,
      yoy_growth_pct: 14.5,
      monthly_trend: [
        { month: 'Jan', revenue: 300000, profit: 150000 },
        { month: 'Feb', revenue: 320000, profit: 160000 },
        { month: 'Mar', revenue: 350000, profit: 180000 },
        { month: 'Apr', revenue: 340000, profit: 170000 },
        { month: 'May', revenue: 380000, profit: 190000 },
        { month: 'Jun', revenue: 420000, profit: 210000 },
      ]
    };
  }

  /**
   * Returns vehicle health and maintenance alerts. (Mock data)
   */
  static async getVehicleHealth(): Promise<Record<string, any>[]> {
    return [
      { id: 'V-001', plate_number: 'KA-01-HH-1234', health_score: 98, status: 'Good', next_service: '2026-10-15', alerts: 0 },
      { id: 'V-002', plate_number: 'MH-12-AB-9876', health_score: 82, status: 'Warning', next_service: '2026-08-20', alerts: 1 },
      { id: 'V-003', plate_number: 'DL-04-CC-5555', health_score: 65, status: 'Critical', next_service: '2026-08-10', alerts: 3 },
      { id: 'V-004', plate_number: 'TN-09-PQ-1111', health_score: 95, status: 'Good', next_service: '2026-11-01', alerts: 0 },
      { id: 'V-005', plate_number: 'GJ-01-XY-9999', health_score: 88, status: 'Good', next_service: '2026-09-12', alerts: 0 },
    ];
  }

  /**
   * Returns generic fleet overview stats. (Mock data)
   */
  static async getFleetOverview(): Promise<Record<string, any>> {
    return {
      total_fleet_size: 150,
      active_vehicles: 112,
      in_maintenance: 8,
      idle_vehicles: 30,
      utilization_rate_pct: 74.6,
      average_daily_km: 245,
    };
  }

  /**
   * Returns 3PL / Vendor performance metrics. (Mock data)
   */
  static async getVendorPerformance(): Promise<Record<string, any>[]> {
    return [
      { id: 'VEN-01', name: 'FastLogistics Inc', rating: 4.8, active_contracts: 12, compliance_score: 98 },
      { id: 'VEN-02', name: 'Global Freight Co', rating: 4.5, active_contracts: 8, compliance_score: 92 },
      { id: 'VEN-03', name: 'Express Movers', rating: 4.2, active_contracts: 5, compliance_score: 85 },
      { id: 'VEN-04', name: 'City Cargo', rating: 4.7, active_contracts: 15, compliance_score: 95 },
      { id: 'VEN-05', name: 'National Transports', rating: 3.9, active_contracts: 3, compliance_score: 78 },
    ];
  }
}
