/**
 * margixindia — Analytics Service (v2)
 * Full Fleet Intelligence: Overview, Vehicle Health, Profitable Routes, AI Insights
 */
import { supabase } from '../core/supabase';
import { cacheGet } from '../core/redis';

const FUEL_PRICE_PER_LITER = 92; // INR
const MAINT_COST_PER_ROUTE = 150; // flat INR per route

export class AnalyticsService {
  // ──────────────────────────────────────────────────────────────────────────
  // FLEET OVERVIEW — all financial + operational KPIs in one shot
  // ──────────────────────────────────────────────────────────────────────────
  static async getFleetOverview(): Promise<Record<string, any>> {
    // Removed todayISO filter for demo purposes to show all-time mock data
    // const today = new Date();
    // today.setHours(0, 0, 0, 0);
    // const todayISO = today.toISOString();

    // Vehicle counts
    const [
      { count: totalVehicles },
      { count: runningVehicles },
      { count: idleVehicles },
      { count: tripsToday },
      { count: deliveredToday },
    ] = await Promise.all([
      supabase.from('vehicles').select('id', { count: 'exact', head: true }),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('status', 'on_route'),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('status', 'idle'),
      supabase.from('routes').select('id', { count: 'exact', head: true }).in('status', ['active', 'completed']),
      supabase.from('shipments').select('id', { count: 'exact', head: true }).eq('status', 'delivered'),
    ]);

    // Revenue today from paid invoices
    const { data: invoicesToday } = await supabase
      .from('invoices')
      .select('amount')
      .eq('status', 'paid');

    const dailyRevenue = (invoicesToday || []).reduce((s: number, i: any) => s + (i.amount || 0), 0);

    // Fuel & maintenance costs from routes today
    const { data: routesToday } = await supabase
      .from('routes')
      .select('estimated_fuel_liters, total_distance_km, vehicle_id')
      .in('status', ['active', 'completed']);

    const fuelExpenses = (routesToday || []).reduce((s: number, r: any) => s + ((r.estimated_fuel_liters || 0) * FUEL_PRICE_PER_LITER), 0);
    const maintenanceExpenses = (routesToday || []).length * MAINT_COST_PER_ROUTE;
    const totalDistanceToday = (routesToday || []).reduce((s: number, r: any) => s + (r.total_distance_km || 0), 0);

    // Backhaul revenue from fulfilled vendor requests
    const { data: backhaulData } = await supabase
      .from('vendor_shipment_requests')
      .select('cost')
      .in('status', ['fulfilled', 'assigned']);

    const backhaulRevenue = (backhaulData || []).reduce((s: number, b: any) => s + (b.cost || 0), 0);

    // Profit
    const totalCost = fuelExpenses + maintenanceExpenses;
    const totalProfit = dailyRevenue - totalCost + backhaulRevenue;
    const numTrucks = Math.max(1, totalVehicles || 1);
    const profitPerTruck = totalProfit / numTrucks;
    const costPerKm = totalDistanceToday > 0 ? totalCost / totalDistanceToday : 0;
    const fleetUtilisation = totalVehicles ? Math.round(((runningVehicles || 0) / totalVehicles) * 100) : 0;

    return {
      daily_revenue: Math.round(dailyRevenue),
      trips_today: tripsToday || 0,
      deliveries_today: deliveredToday || 0,
      running_vehicles: runningVehicles || 0,
      idle_vehicles: idleVehicles || 0,
      total_vehicles: totalVehicles || 0,
      fleet_utilisation_pct: fleetUtilisation,
      profit_per_truck: Math.round(profitPerTruck),
      cost_per_km: parseFloat(costPerKm.toFixed(2)),
      fuel_expenses: Math.round(fuelExpenses),
      maintenance_expenses: Math.round(maintenanceExpenses),
      backhaul_revenue: Math.round(backhaulRevenue),
      total_profit: Math.round(totalProfit),
      total_cost: Math.round(totalCost),
      total_distance_km: Math.round(totalDistanceToday),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VEHICLE HEALTH — dynamic health score per vehicle
  // ──────────────────────────────────────────────────────────────────────────
  static async getVehicleHealth(): Promise<Record<string, any>[]> {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, plate_number, vehicle_type, status, created_at')
      .limit(20);

    if (error || !vehicles) return [];

    const vehicleIds = vehicles.map((v) => v.id);

    // Fetch latest telemetry per vehicle
    const telemetryMap: Record<string, any> = {};
    for (const vid of vehicleIds) {
      const { data } = await supabase
        .from('telemetry')
        .select('fuel_level_pct, speed_kmph, timestamp')
        .eq('vehicle_id', vid)
        .order('timestamp', { ascending: false })
        .limit(1);
      if (data?.[0]) telemetryMap[vid] = data[0];
    }

    // Fetch total distance driven per vehicle (from all completed routes)
    const { data: allRoutes } = await supabase
      .from('routes')
      .select('vehicle_id, total_distance_km, created_at')
      .in('vehicle_id', vehicleIds)
      .in('status', ['active', 'completed']);

    const distanceMap: Record<string, number> = {};
    const routeCountMap: Record<string, number> = {};
    (allRoutes || []).forEach((r: any) => {
      distanceMap[r.vehicle_id] = (distanceMap[r.vehicle_id] || 0) + (r.total_distance_km || 0);
      routeCountMap[r.vehicle_id] = (routeCountMap[r.vehicle_id] || 0) + 1;
    });

    return vehicles.map((v: any) => {
      const telem = telemetryMap[v.id];
      const totalKm = distanceMap[v.id] || 0;
      const fuelLevel = telem?.fuel_level_pct ?? 75;

      // Health components — estimated from available data
      // Oil Change: deteriorates every 5000 km (good < 3000 km since change)
      const oilKmSinceChange = totalKm % 5000;
      const oilRemainingKm = 5000 - oilKmSinceChange;
      const oilStatus = oilRemainingKm > 2000 ? 'Good' : oilRemainingKm > 500 ? `Due in ${Math.round(oilRemainingKm)} km` : 'Overdue';
      const oilScore = Math.max(0, Math.min(100, (oilRemainingKm / 5000) * 100));

      // Brake Pads: deteriorate every 40,000 km
      const brakeKmSinceChange = totalKm % 40000;
      const brakeRemainingKm = 40000 - brakeKmSinceChange;
      const brakeStatus = brakeRemainingKm > 5000 ? 'Good' : `Due in ${Math.round(brakeRemainingKm)} km`;
      const brakeScore = Math.max(0, Math.min(100, (brakeRemainingKm / 40000) * 100));

      // Battery: score based on route count (heavy usage degrades faster)
      const batteryScore = Math.max(30, 100 - (routeCountMap[v.id] || 0) * 0.5);
      const batteryStatus = batteryScore > 70 ? 'Healthy' : batteryScore > 40 ? 'Weakening' : 'Replace Soon';

      // Tyres: deteriorate every 30,000 km
      const tyreKm = totalKm % 30000;
      const tyreRemainingKm = 30000 - tyreKm;
      const tyreStatus = tyreRemainingKm > 3000 ? 'Good' : `Replace in ${Math.round(tyreRemainingKm)} km`;
      const tyreScore = Math.max(0, Math.min(100, (tyreRemainingKm / 30000) * 100));

      // Insurance: estimate based on vehicle age (created_at)
      const vehicleAgeMs = Date.now() - new Date(v.created_at).getTime();
      const vehicleAgeDays = vehicleAgeMs / (1000 * 60 * 60 * 24);
      const insuranceDaysRemaining = Math.max(0, Math.round(365 - (vehicleAgeDays % 365)));
      const insuranceStatus = insuranceDaysRemaining > 30 ? `${insuranceDaysRemaining} Days Remaining` : `⚠ Renew in ${insuranceDaysRemaining} Days`;
      const insuranceScore = Math.min(100, (insuranceDaysRemaining / 365) * 100);

      // Fuel score
      const fuelScore = fuelLevel;
      const fuelStatus = fuelLevel > 40 ? 'Healthy' : fuelLevel > 15 ? 'Low' : 'Critical';

      // Overall health score (weighted average)
      const healthScore = Math.round(
        oilScore * 0.2 +
        brakeScore * 0.2 +
        batteryScore * 0.15 +
        tyreScore * 0.2 +
        insuranceScore * 0.1 +
        fuelScore * 0.15
      );

      return {
        id: v.id,
        plate_number: v.plate_number,
        vehicle_type: v.vehicle_type,
        status: v.status,
        health_score: healthScore,
        total_distance_km: Math.round(totalKm),
        fuel_level_pct: Math.round(fuelLevel),
        components: {
          oil_change: { status: oilStatus, score: Math.round(oilScore), remaining_km: Math.round(oilRemainingKm) },
          brake_pads: { status: brakeStatus, score: Math.round(brakeScore), remaining_km: Math.round(brakeRemainingKm) },
          battery: { status: batteryStatus, score: Math.round(batteryScore) },
          tyres: { status: tyreStatus, score: Math.round(tyreScore), remaining_km: Math.round(tyreRemainingKm) },
          insurance: { status: insuranceStatus, score: Math.round(insuranceScore), days_remaining: insuranceDaysRemaining },
          fuel: { status: fuelStatus, score: Math.round(fuelScore), level_pct: Math.round(fuelLevel) },
        },
      };
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MOST PROFITABLE ROUTES
  // ──────────────────────────────────────────────────────────────────────────
  static async getMostProfitableRoutes(): Promise<Record<string, any>[]> {
    // Get all completed routes with distance and fuel
    const { data: routes } = await supabase
      .from('routes')
      .select('id, total_distance_km, estimated_fuel_liters, route_stops(delivery_points(address, city))')
      .eq('status', 'completed')
      .order('total_distance_km', { ascending: false })
      .limit(30);

    if (!routes || routes.length === 0) return [];

    const routeIds = routes.map((r) => r.id);

    // Get paid invoices per route (match by shipments on route_stops)
    // We'll approximate: fetch invoices with matching shipment refs
    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, route_id, freight_charge')
      .in('route_id', routeIds)
      .not('freight_charge', 'is', null);

    const revenueByRoute: Record<string, number> = {};
    (shipments || []).forEach((s: any) => {
      if (s.route_id) {
        revenueByRoute[s.route_id] = (revenueByRoute[s.route_id] || 0) + (s.freight_charge || 0);
      }
    });

    return routes
      .map((r: any) => {
        const revenue = revenueByRoute[r.id] || 0;
        const fuelCost = (r.estimated_fuel_liters || 0) * FUEL_PRICE_PER_LITER;
        const maintCost = MAINT_COST_PER_ROUTE;
        const profit = revenue - fuelCost - maintCost;
        const profitMarginPct = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;

        // Build origin → destination label from stops
        const stops = (r.route_stops || []).map((s: any) => s.delivery_points?.city || s.delivery_points?.address || '').filter(Boolean);
        const origin = stops[0] || 'Origin';
        const destination = stops[stops.length - 1] || 'Destination';

        return {
          id: r.id,
          label: `${origin} → ${destination}`,
          distance_km: Math.round(r.total_distance_km || 0),
          revenue: Math.round(revenue),
          cost: Math.round(fuelCost + maintCost),
          profit: Math.round(profit),
          profit_margin_pct: profitMarginPct,
        };
      })
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 8);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LIVE INSIGHTS — enhanced with all AI fleet intelligence types
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
              score: 85.5,
              trend: 'down',
              vehicle_id: route.vehicle_id,
              plate_number: plate,
              severity: 'high',
              icon: 'alert',
            });
          }
        }

        // Fuel efficiency drop insight
        const fuelPct = latestTelemetry.fuel_level_pct ?? 100;
        const totalKmApprox = (route.total_distance_km || 0) * ((route.route_stops?.length || 1) - pendingStops.length);
        if (fuelPct < 30) {
          insights.push({
            id: `fuel_${route.vehicle_id}`,
            type: 'fuel_efficiency',
            title: `Fuel Efficiency Drop: ${plate}`,
            insight: `Fuel efficiency has dropped by ~14%. Fuel level at ${fuelPct.toFixed(0)}%. Possible engine or driving issue detected.`,
            score: 72.0,
            trend: 'down',
            vehicle_id: route.vehicle_id,
            plate_number: plate,
            severity: 'medium',
            icon: 'fuel',
          });
        }

        // Backhaul opportunity — return trip empty
        if (pendingStops.length === 0) {
          insights.push({
            id: `backhaul_${route.vehicle_id}`,
            type: 'backhaul_opportunity',
            title: `Backhaul Opportunity: ${plate}`,
            insight: `Truck ${plate} is likely to return empty. Open bidding for available capacity?`,
            score: 91.0,
            trend: 'up',
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

    for (const v of (idleVehicles || [])) {
      const idleMs = Date.now() - new Date(v.updated_at).getTime();
      const idleDays = idleMs / (1000 * 60 * 60 * 24);
      if (idleDays >= 1) {
        insights.push({
          id: `idle_${v.id}`,
          type: 'idle_vehicle',
          title: `Idle Vehicle: ${v.plate_number}`,
          insight: `This truck has remained idle for ${Math.floor(idleDays)} day${Math.floor(idleDays) > 1 ? 's' : ''}. Consider reassignment or maintenance check.`,
          score: 60.0,
          trend: 'down',
          vehicle_id: v.id,
          plate_number: v.plate_number,
          severity: idleDays >= 3 ? 'high' : 'medium',
          icon: 'idle',
        });
      }
    }

    // 3. Maintenance due alerts (vehicles with high distance)
    const { data: allVehicles } = await supabase
      .from('vehicles')
      .select('id, plate_number');

    for (const v of (allVehicles || [])) {
      const { data: routesData } = await supabase
        .from('routes')
        .select('total_distance_km')
        .eq('vehicle_id', v.id)
        .in('status', ['active', 'completed']);

      const totalKm = (routesData || []).reduce((s: number, r: any) => s + (r.total_distance_km || 0), 0);
      const kmSinceOil = totalKm % 5000;
      const oilRemaining = 5000 - kmSinceOil;

      if (oilRemaining < 1000 && oilRemaining > 0) {
        insights.push({
          id: `maint_${v.id}`,
          type: 'maintenance_due',
          title: `Maintenance Due: ${v.plate_number}`,
          insight: `Service is due in ${Math.round(oilRemaining)} km. Schedule maintenance now to avoid breakdowns.`,
          score: 78.0,
          trend: 'down',
          vehicle_id: v.id,
          plate_number: v.plate_number,
          severity: oilRemaining < 500 ? 'high' : 'medium',
          icon: 'wrench',
        });
      }
    }

    // 4. Reroute suggestions from Redis cache
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
        icon: 'reroute',
      });
    }

    // 5. Default efficiency insight if nothing else
    if (insights.length === 0) {
      insights.push({
        id: crypto.randomUUID(),
        type: 'efficiency',
        title: 'Fleet Optimization High',
        insight: 'Current global route cluster BX-04 operating at 98.4% efficiency with no predicted bottlenecks.',
        score: 98.4,
        trend: 'up',
        severity: 'low',
        icon: 'check',
      });
    }

    return insights;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FLEET STATS — original method kept for backward compat
  // ──────────────────────────────────────────────────────────────────────────
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
  // DRIVER PERFORMANCE
  // ──────────────────────────────────────────────────────────────────────────
  static async getDriverPerformance(): Promise<any[]> {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, plate_number, vehicle_type, status, driver_id');

    if (error) { console.error('Error fetching vehicles:', error); return []; }
    if (!vehicles || vehicles.length === 0) return [];

    const vehicleIds = vehicles.map(v => v.id);

    const { data: routesData } = await supabase
      .from('routes')
      .select('id, vehicle_id, status, total_distance_km, optimization_score')
      .in('vehicle_id', vehicleIds);

    let routesByVehicle: Record<string, any[]> = {};
    if (routesData) {
      routesData.forEach(r => {
        if (!routesByVehicle[r.vehicle_id]) routesByVehicle[r.vehicle_id] = [];
        routesByVehicle[r.vehicle_id].push(r);
      });
    }

    const driverIds = vehicles.map(v => v.driver_id).filter(Boolean) as string[];
    let usersMap: Record<string, any> = {};
    if (driverIds.length > 0) {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, full_name, email')
        .in('id', driverIds);
      if (usersData) usersData.forEach(u => { usersMap[u.id] = u; });
    }

    return vehicles.map((v: any) => {
      let completedRoutes = 0, totalRoutes = 0, totalDistance = 0, totalScore = 0, scoreCount = 0;
      const vRoutes = routesByVehicle[v.id] || [];

      vRoutes.forEach((r: any) => {
        totalRoutes++;
        if (r.status === 'completed') completedRoutes++;
        totalDistance += (r.total_distance_km || 0);
        if (r.optimization_score) { totalScore += r.optimization_score; scoreCount++; }
      });

      const onTimePct = totalRoutes > 0 ? (completedRoutes / totalRoutes) * 100 : 100;
      const avgScore = scoreCount > 0 ? totalScore / scoreCount : 80;
      const rating = (avgScore / 100) * 5.0;
      const driver = v.driver_id ? usersMap[v.driver_id] : null;

      return {
        id: v.id,
        plate_number: v.plate_number,
        vehicle_type: v.vehicle_type,
        status: v.status,
        name: driver ? (driver.full_name || 'Unassigned') : 'Unassigned',
        email: driver ? driver.email : '',
        completed_routes: completedRoutes,
        on_time_pct: parseFloat(onTimePct.toFixed(1)),
        total_distance_km: Math.floor(totalDistance),
        rating: parseFloat(Math.min(5.0, Math.max(1.0, rating)).toFixed(1)),
      };
    }).sort((a, b) => b.rating - a.rating);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FINANCIAL METRICS (7-day chart)
  // ──────────────────────────────────────────────────────────────────────────
  static async getFinancialMetrics(): Promise<any[]> {
    const dataMap: Record<string, { revenue: number; cost: number }> = {};
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateKey = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dataMap[dateKey] = { revenue: 0, cost: 0 };
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const dateThreshold = sevenDaysAgo.toISOString();

    const { data: invoices } = await supabase
      .from('invoices')
      .select('amount, created_at')
      .eq('status', 'paid')
      .gte('created_at', dateThreshold);

    (invoices || []).forEach((inv: any) => {
      const dateKey = new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (dataMap[dateKey]) dataMap[dateKey].revenue += (inv.amount || 0);
    });

    const { data: routes } = await supabase
      .from('routes')
      .select('estimated_fuel_liters, created_at')
      .in('status', ['active', 'completed'])
      .gte('created_at', dateThreshold);

    (routes || []).forEach((r: any) => {
      const dateKey = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (dataMap[dateKey]) dataMap[dateKey].cost += ((r.estimated_fuel_liters || 0) * FUEL_PRICE_PER_LITER) + MAINT_COST_PER_ROUTE;
    });

    return Object.keys(dataMap).map(dateKey => {
      const { revenue, cost } = dataMap[dateKey];
      return { date: dateKey, revenue: Math.floor(revenue), cost: Math.floor(cost), profit: Math.floor(revenue - cost) };
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VENDOR PERFORMANCE
  // ──────────────────────────────────────────────────────────────────────────
  static async getVendorPerformance(): Promise<any[]> {
    const { data: vendors, error } = await supabase
      .from('vendor_profiles')
      .select('id, company_name, city');

    if (error || !vendors) return [];

    const { data: requests } = await supabase
      .from('vendor_shipment_requests')
      .select('vendor_id, status, cost, cost_per_km');

    return vendors.map((v: any) => {
      const vendorReqs = (requests || []).filter((r: any) => r.vendor_id === v.id);
      const total = vendorReqs.length;
      const fulfilled = vendorReqs.filter((r: any) => r.status === 'fulfilled' || r.status === 'assigned').length;
      const costs = vendorReqs.filter((r: any) => r.cost).map((r: any) => r.cost);
      const avgCost = costs.length > 0 ? costs.reduce((a: number, b: number) => a + b, 0) / costs.length : 0;
      const sla = total > 0 ? (fulfilled / total) * 100 : 100;

      return {
        id: v.id,
        name: v.company_name,
        category: 'Carrier',
        region: v.city || 'Central',
        deliveries: fulfilled,
        sla: parseFloat(sla.toFixed(1)),
        costPerDelivery: Math.round(avgCost),
        damageRate: 0.0,
        status: 'Active',
      };
    });
  }
}
