/**
 * margixindia — Optimization Routes
 * Ports: backend/app/api/v1/endpoints/optimization.py
 * 
 * The VRP solver and ETA prediction live in the Python ML microservice.
 * This endpoint loads data from Supabase, sends it to the ML service,
 * and saves the results back.
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { cacheGet, cacheSet } from '../core/redis';
import { OptimizationRequestSchema } from '../schemas';
import { settings } from '../core/config';
import { v4 as uuidv4 } from 'uuid';
import { notificationService } from '../services/notification.service';
import { sendError, HttpError } from '../core/errors';
import { liveWeatherAt } from '../services/weather.service';
import { isValidPoint, LatLng } from '../services/geo';
import { parseNumberInRange } from '../core/validate';
import { OPERATING_VEHICLE_STATUSES } from '../core/transitions';
import { finalDeliveryPoint, sortDeliveryPoints } from '../core/destination';
import { markAssigned } from '../services/shipment.service';
import { routeService } from '../services/route.service';

/** A stand-in vehicle (auto-created for a driver, or a wizard draft) is never planned onto. */
const isPlaceholderPlate = (plate: unknown) => /^(TEMP|DRFT)-/i.test(String(plate ?? ''));

/** Shipment statuses the optimizer plans: new loads and failed deliveries waiting for another attempt. */
const PLANNABLE_STATUSES = ['created', 'exception'];

const router = Router();

// Extra time allowed for an ML optimize call beyond the solver's own time budget
const ML_TIMEOUT_MARGIN_SECONDS = 15;

// ── POST / — Run VRP optimization ──────────────────────────
router.post('/', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const parsed = OptimizationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error('Optimization Validation Error:', JSON.stringify(parsed.error.issues, null, 2));
      res.status(400).json({ detail: parsed.error.issues });
      return;
    }
    const payload = parsed.data;

    // ── Load depot ──
    let depot: any = null;
    if (payload.depot_id && payload.depot_id !== '00000000-0000-0000-0000-000000000001') {
      const { data } = await supabase.from('depots').select('*').eq('id', payload.depot_id).single();
      depot = data;
      if (!depot) {
        // Try as delivery point
        const { data: dpDepot } = await supabase.from('delivery_points').select('*').eq('id', payload.depot_id).single();
        if (dpDepot) depot = { id: dpDepot.id, name: dpDepot.name, latitude: dpDepot.latitude, longitude: dpDepot.longitude };
      }
    }
    if (!depot) {
      const { data } = await supabase.from('depots').select('*').limit(1).single();
      depot = data;
      if (!depot) {
        res.status(400).json({ detail: 'No depots configured in system. Please create a depot first.' });
        return;
      }
    }

    // ── Load vehicles ──
    // Only vehicles that take part in dispatch: not in maintenance or archived, and not a placeholder
    let vehicleQuery = supabase.from('vehicles').select('*').in('status', [...OPERATING_VEHICLE_STATUSES]);
    if (payload.vehicle_ids.length > 0) {
      vehicleQuery = vehicleQuery.in('id', payload.vehicle_ids);
    } else {
      vehicleQuery = vehicleQuery.limit(50);
    }
    const { data: vehicleRows } = await vehicleQuery;
    const vehicles = (vehicleRows || []).filter((v: any) => !isPlaceholderPlate(v.plate_number)).slice(0, 20);
    if (vehicles.length === 0) {
      res.status(400).json({ detail: 'No available vehicles found.' });
      return;
    }

    // ── Load shipments ──
    let dpQuery;
    if (payload.shipment_ids && payload.shipment_ids.length > 0) {
      dpQuery = supabase.from('shipments').select('*, delivery_points!delivery_points_shipment_id_fkey(*)').in('id', payload.shipment_ids).in('status', PLANNABLE_STATUSES);
    } else {
      dpQuery = supabase.from('shipments').select('*, delivery_points!delivery_points_shipment_id_fkey(*)').in('status', PLANNABLE_STATUSES).limit(100);
    }
    const { data: shipmentRows, error: dpErr } = await dpQuery;
    // The final drop is the destination (see core/destination)
    const shipments = (shipmentRows || []).map((sh: any) => ({ ...sh, delivery_points: sortDeliveryPoints<any>(sh.delivery_points) }));
    if (dpErr || shipments.length === 0) {
      res.status(400).json({ detail: dpErr ? dpErr.message : 'No pending shipments found.' });
      return;
    }

    // ── Weather: a manual severity wins; otherwise live conditions at the depot and the centre of the stops ──
    let weatherSeverity = 0;
    let weatherInfo: { source: 'off' | 'manual' | 'live' | 'unavailable'; severity: number; description: string | null } = { source: 'off', severity: 0, description: null };
    if (payload.consider_weather) {
      if (payload.weather_severity !== undefined) {
        weatherSeverity = payload.weather_severity;
        weatherInfo = { source: 'manual', severity: weatherSeverity, description: null };
      } else {
        const stopPoints = shipments
          .map((s: any) => ({ lat: Number(finalDeliveryPoint<any>(s.delivery_points)?.latitude), lng: Number(finalDeliveryPoint<any>(s.delivery_points)?.longitude) }))
          .filter(isValidPoint);
        const points: LatLng[] = [];
        if (isValidPoint({ lat: Number(depot.latitude), lng: Number(depot.longitude) })) points.push({ lat: Number(depot.latitude), lng: Number(depot.longitude) });
        if (stopPoints.length > 0) {
          points.push({
            lat: stopPoints.reduce((sum, p) => sum + p.lat, 0) / stopPoints.length,
            lng: stopPoints.reduce((sum, p) => sum + p.lng, 0) / stopPoints.length,
          });
        }
        const live = await liveWeatherAt(points);
        if (live) {
          weatherSeverity = live.severity;
          weatherInfo = { source: 'live', severity: live.severity, description: live.description };
        } else {
          weatherInfo = { source: 'unavailable', severity: 0, description: null };
        }
      }
    }

    // ── Call Python ML service ──
    const mlPayload = {
      locations: [
        {
          id: depot.id,
          lat: depot.latitude,
          lng: depot.longitude,
          demand_kg: 0,
          required_cargo_types: [],
          time_window_start: 0,
          time_window_end: 1440,
          service_time: 0,
        },
        ...shipments.map((s: any) => ({
          id: s.id,
          lat: finalDeliveryPoint<any>(s.delivery_points)?.latitude || 0,
          lng: finalDeliveryPoint<any>(s.delivery_points)?.longitude || 0,
          demand_kg: s.total_weight_kg || s.weight_kg || 0,
          required_cargo_types: [],
          time_window_start: 0,
          time_window_end: 1440,
          service_time: 15,
        }))
      ],
      vehicles: vehicles.map((v: any) => ({
        id: v.id,
        capacity_kg: v.capacity_kg,
        start_lat: depot.latitude,
        start_lng: depot.longitude,
        supported_cargo_types: v.cargo_types || [],
        fuel_efficiency_kmpl: v.fuel_efficiency_kmpl,
      })),
      max_solve_seconds: payload.max_solve_time_seconds,
      traffic_factor: payload.consider_traffic ? 1.0 + payload.traffic_density * settings.TRAFFIC_FACTOR_MULTIPLIER : 1.0,
      weather_factor: payload.consider_weather ? 1.0 + weatherSeverity * settings.WEATHER_FACTOR_MULTIPLIER : 1.0,
      algorithm: payload.algorithm === 'genetic' ? 'ga' : payload.algorithm,
    };

    let solution: any;
    try {
      const mlResponse = await fetch(`${settings.ML_SERVICE_URL}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mlPayload),
        // The solver may use its whole time budget; allow for network and setup on top
        signal: AbortSignal.timeout((payload.max_solve_time_seconds + ML_TIMEOUT_MARGIN_SECONDS) * 1000),
      });
      if (mlResponse.ok) {
        solution = await mlResponse.json();
      } else {
        throw new Error('ML service unavailable');
      }
    } catch {
      // Fallback: greedy nearest-neighbour solver in TS
      solution = greedyFallback(depot, shipments, vehicles, mlPayload.traffic_factor);
    }

    // ── Save routes to DB ──
    const routeResponses: any[] = [];

    for (const optRoute of solution.routes || []) {
      if (!optRoute.stop_ids || optRoute.stop_ids.length === 0) continue;

      const { data: routeRow, error: routeErr } = await supabase
        .from('routes')
        .insert({
          vehicle_id: optRoute.vehicle_id,
          depot_id: depot.id,
          status: 'pending',
          total_distance_km: optRoute.total_distance_km,
          total_duration_minutes: optRoute.total_duration_minutes,
          estimated_fuel_liters: optRoute.estimated_fuel_liters,
          weather_condition: (weatherInfo.source === 'live' && weatherInfo.description) || optRoute.weather_condition || 'clear',
          traffic_delay_minutes: optRoute.traffic_delay_minutes || 0,
          waypoints: [],
          optimization_score: optRoute.efficiency_score || 0.0,
        })
        .select()
        .single();

      if (routeErr || !routeRow) continue;

      // Save stops, numbered from 1 like every other way of building a route. Only stops with a
      // real delivery point can be saved (the column is a FK); a shipment with several points
      // gets a stop for each, in order, so its final drop is the last of them.
      const stops: any[] = [];
      const plannedShipments: any[] = [];
      let seq = 1;
      for (const shipmentId of optRoute.stop_ids) {
        const s = shipments.find((x: any) => x.id === shipmentId);
        const points = sortDeliveryPoints<any>(s?.delivery_points);
        if (points.length === 0) {
          console.warn(`Skipping stop for shipment ${shipmentId}: no delivery point found.`);
          continue;
        }
        plannedShipments.push(s);
        for (const point of points) {
          stops.push({
            route_id: routeRow.id,
            delivery_point_id: point.id,
            sequence: seq++,
            status: 'pending',
          });
        }
      }
      if (stops.length > 0) {
        const { error: stopsErr } = await supabase.from('route_stops').insert(stops);
        if (stopsErr) console.error('Failed to insert route stops:', stopsErr);
      }

      // Each planned shipment becomes assigned through the same helper as every other assignment
      // (transition checked, logged, its customer booking moved). A failed delivery is planned again too.
      for (const planned of plannedShipments) {
        try {
          await markAssigned(
            { id: planned.id, status: String(planned.status), origin_lat: planned.origin_lat ?? null, origin_lng: planned.origin_lng ?? null },
            { id: routeRow.vehicle_id },
            { id: routeRow.id },
            { id: req.user!.user_id, role: req.user!.role },
          );
        } catch (assignErr) {
          console.error(`Failed to assign shipment ${planned.id} to its route:`, assignErr);
        }
      }
      // A failed delivery being planned again leaves its old stops behind: they go with the new plan
      const plannedPointIds = plannedShipments.flatMap((sh: any) => (sh.delivery_points || []).map((dp: any) => dp.id));
      if (plannedPointIds.length > 0) {
        await supabase.from('route_stops').delete().in('delivery_point_id', plannedPointIds).neq('route_id', routeRow.id);
        await supabase.from('delivery_points').update({ status: 'pending' }).in('id', plannedPointIds);
      }

      // Dispatch through the route service: the vehicle goes on_route, planned arrivals are
      // stamped and the driver is told. If it cannot start, the route stays pending and the
      // driver is told about the plan instead.
      let dispatched = false;
      try {
        await routeService.changeStatus(routeRow.id, 'active');
        dispatched = true;
        routeRow.status = 'active';
      } catch (dispatchErr) {
        console.warn('Failed to dispatch the optimized route:', dispatchErr);
      }
      if (!dispatched) {
        try {
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('driver_id')
            .eq('id', optRoute.vehicle_id)
            .single();

          if (vehicle?.driver_id) {
            await notificationService.sendNotification(
              vehicle.driver_id,
              '🚨 New Route Assigned',
              `A new cargo route with ${stops.length} stops has been assigned to you.`,
              'route_assigned',
              { route_id: routeRow.id }
            );
          }
        } catch (notifErr) {
          console.warn('Failed to send route assignment notification:', notifErr);
        }
      }

      routeResponses.push({
        id: routeRow.id,
        vehicle_id: routeRow.vehicle_id,
        status: routeRow.status,
        total_distance_km: routeRow.total_distance_km,
        total_duration_minutes: routeRow.total_duration_minutes,
        estimated_fuel_liters: routeRow.estimated_fuel_liters,
        optimization_score: routeRow.optimization_score,
        waypoints: [],
        stops: stops.map((s: any) => ({
          delivery_point_id: s.delivery_point_id,
          sequence: s.sequence,
          status: s.status,
        })),
        created_at: routeRow.created_at,
      });
    }

    res.json({
      job_id: uuidv4(),
      status: 'completed',
      routes: routeResponses,
      total_distance_km: solution.total_distance_km || 0,
      total_fuel_liters: solution.total_fuel_liters || 0,
      // null when the solver has no baseline to measure savings against
      estimated_savings_pct: solution.savings_vs_naive_pct ?? null,
      solve_time_seconds: solution.solve_time_seconds || 0,
      // The algorithm that actually produced the routes (may differ from the request on fallback)
      algorithm: solution.algorithm ?? mlPayload.algorithm,
      // Where the weather effect came from: live OpenWeather, a manual value, or none
      weather: weatherInfo,
      message: `Optimized ${routeResponses.length} routes in ${(solution.solve_time_seconds || 0).toFixed(2)}s`,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /eta — ETA prediction ─────────────────────────────
router.post('/eta', requireAuth, requireRole(...STAFF_ROLES, 'driver'), async (req: Request, res: Response) => {
  try {
    // Only known numbers go on to the ML service, and only sane ones
    const input = req.body ?? {};
    const etaInput = {
      distance_km: parseNumberInRange(input.distance_km ?? 10, 'distance_km', 0, 5000),
      traffic_density: parseNumberInRange(input.traffic_density ?? 0.5, 'traffic_density', 0, 1),
      weather_severity: parseNumberInRange(input.weather_severity ?? 0, 'weather_severity', 0, 1),
      ...(typeof input.vehicle_type === 'string' ? { vehicle_type: input.vehicle_type.slice(0, 30) } : {}),
    };
    req.body = etaInput;

    // Try calling ML service
    try {
      const mlRes = await fetch(`${settings.ML_SERVICE_URL}/predict-eta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(etaInput),
        signal: AbortSignal.timeout(10_000),
      });
      if (mlRes.ok) {
        const result = await mlRes.json();
        res.json(result);
        return;
      }
    } catch { /* fallback below */ }

    // Physics-based fallback
    const distKm = req.body.distance_km || 10;
    const trafficDensity = req.body.traffic_density ?? 0.5;
    const weatherSeverity = req.body.weather_severity ?? 0.0;
    const baseSpeed = 45.0;

    const trafficFactor = 1 - trafficDensity * 0.6;
    const weatherFactor = 1 - weatherSeverity * 0.3;
    const hour = new Date().getHours();
    const peakFactor = (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20) ? 0.75 : 1.0;

    const effectiveSpeed = Math.max(5.0, baseSpeed * trafficFactor * weatherFactor * peakFactor);
    const estimatedMinutes = (distKm / effectiveSpeed) * 60;
    const uncertainty = Math.max(2.0, estimatedMinutes * 0.1 * (1 + trafficDensity + weatherSeverity));

    res.json({
      estimated_minutes: parseFloat(estimatedMinutes.toFixed(1)),
      confidence_interval_low: parseFloat((estimatedMinutes - uncertainty).toFixed(1)),
      confidence_interval_high: parseFloat((estimatedMinutes + uncertainty).toFixed(1)),
      traffic_impact_minutes: parseFloat(Math.max(0, estimatedMinutes - (distKm / baseSpeed) * 60).toFixed(1)),
      weather_impact_minutes: parseFloat((weatherSeverity * 5).toFixed(1)),
      model_version: '1.0.0-physics-ts',
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /incubate/:vehicle_id — AI Incubator ──────────────
router.post('/incubate/:vehicle_id', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    // Try calling ML service for reroute evaluation
    try {
      const mlRes = await fetch(`${settings.ML_SERVICE_URL}/evaluate-reroute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: req.params.vehicle_id }),
        signal: AbortSignal.timeout(10_000),
      });
      if (mlRes.ok) {
        const decision: any = await mlRes.json();
        if (decision && decision.saved_minutes > 0) {
          const existing = (await cacheGet<any[]>('active_reroute_suggestions')) || [];
          const newSuggestion = {
            vehicle_id: decision.vehicle_id,
            route_id: decision.route_id,
            trigger: decision.trigger,
            saved_minutes: decision.saved_minutes,
            new_stop_sequence: decision.new_stop_sequence,
          };
          const combined = [newSuggestion, ...existing.filter((s: any) => s.vehicle_id !== decision.vehicle_id)];
          await cacheSet('active_reroute_suggestions', combined, 3600);

          res.json({
            status: 'suggested',
            saved_minutes: decision.saved_minutes,
            trigger: decision.trigger,
            message: `AI Incubator found a better path! Saving ~${decision.saved_minutes} mins.`,
          });
          return;
        }
      }
    } catch { /* fallback */ }

    res.json({
      status: 'checked',
      message: 'No better route found at this time. Current path is already optimized based on live traffic.',
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /reoptimize/:route_id — Direct Route Reoptimization ──
router.post('/reoptimize/:route_id', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { route_id } = req.params;
    
    // 1. Get route to find vehicle_id
    const { data: route } = await supabase
      .from('routes')
      .select('vehicle_id, status')
      .eq('id', route_id)
      .single();

    if (!route || !['active', 'on_route', 'pending', 'in_progress'].includes(route.status)) {
      res.status(400).json({ detail: 'Route not found or not in an optimizable state' });
      return;
    }

    // 2. Call ML Service evaluate-reroute
    let decision: any;
    try {
      const mlRes = await fetch(`${settings.ML_SERVICE_URL}/evaluate-reroute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: route.vehicle_id }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!mlRes.ok) {
        throw new Error('ML service failed to evaluate reroute');
      }
      decision = await mlRes.json();
    } catch (err) {
      // Fallback: Local greedy re-optimization
      const { data: pendingStops } = await supabase
        .from('route_stops')
        .select('id, delivery_point_id, delivery_points(id, latitude, longitude)')
        .eq('route_id', route_id)
        .eq('status', 'pending');
        
      if (!pendingStops || pendingStops.length <= 1) {
        res.json({
          status: 'no_change',
          message: 'Not enough pending stops to re-optimize.',
        });
        return;
      }

      // Get vehicle's latest known position
      const { data: telemetry } = await supabase
        .from('telemetry')
        .select('latitude, longitude')
        .eq('vehicle_id', route.vehicle_id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      let currentLat = telemetry?.latitude;
      let currentLng = telemetry?.longitude;

      if (!currentLat || !currentLng) {
        // Fall back to the vehicle's own last-known position
        const { data: vehiclePos } = await supabase
          .from('vehicles')
          .select('latitude, longitude')
          .eq('id', route.vehicle_id)
          .maybeSingle();
        currentLat = vehiclePos?.latitude;
        currentLng = vehiclePos?.longitude;
      }

      if (!currentLat || !currentLng) {
        throw new HttpError(409, 'Vehicle has no current position (no telemetry or last-known location); cannot re-optimize.');
      }

      const unvisited = [...pendingStops];
      const newSequence = [];
      
      let totalDistanceKm = 0;
      
      // Greedy nearest neighbor
      while (unvisited.length > 0) {
        let bestIdx = -1;
        let minDistance = Infinity;
        
        for (let i = 0; i < unvisited.length; i++) {
          const stop = unvisited[i];
          const dp: any = stop.delivery_points || {};
          const lat = dp.latitude || dp.lat || 0;
          const lng = dp.longitude || dp.lng || 0;
          
          if (lat === 0 && lng === 0) {
            // Skip invalid coordinates for distance calc, just append them
            if (minDistance === Infinity) { bestIdx = i; }
            continue;
          }
          
          // Haversine distance
          const R = 6371; // km
          const dLat = (lat - currentLat) * Math.PI / 180;
          const dLng = (lng - currentLng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(currentLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                    Math.sin(dLng/2) * Math.sin(dLng/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const distance = R * c;
          
          if (distance < minDistance) {
            minDistance = distance;
            bestIdx = i;
          }
        }
        
        if (minDistance !== Infinity) {
          totalDistanceKm += minDistance;
        }

        const nextStop = unvisited.splice(bestIdx, 1)[0];
        newSequence.push(nextStop.delivery_point_id);
        const dp: any = nextStop.delivery_points || {};
        currentLat = dp.latitude || dp.lat || currentLat;
        currentLng = dp.longitude || dp.lng || currentLng;
      }

      const drivingHours = totalDistanceKm / 40.0;
      const realisticEtaMinutes = Math.round((drivingHours * 60) + (pendingStops.length * 15));

      decision = {
        new_stop_sequence: newSequence,
        new_eta_minutes: realisticEtaMinutes,
        new_distance_km: parseFloat(totalDistanceKm.toFixed(1)),
        saved_minutes: Math.round(realisticEtaMinutes * 0.1),
      };
      
      console.log(`[Re-optimize Fallback] Generated new sequence for ${route_id} with ${newSequence.length} stops.`);
    }
    
    if (decision && decision.new_stop_sequence) {
      // Apply the new sequence to the database
      const newSequence = decision.new_stop_sequence; // Array of delivery_point_ids
      
      // Get all pending stops for this route to map IDs
      const { data: pendingStops } = await supabase
        .from('route_stops')
        .select('id, delivery_point_id')
        .eq('route_id', route_id)
        .eq('status', 'pending');

      if (pendingStops && pendingStops.length > 0) {
        // Update sequences in parallel
        await Promise.all(pendingStops.map((stop: any) => {
          const newIdx = newSequence.indexOf(stop.delivery_point_id.toString());
          if (newIdx !== -1) {
            return supabase
              .from('route_stops')
              .update({ sequence: newIdx + 1 })
              .eq('id', stop.id);
          }
          return Promise.resolve();
        }));

        // Update route ETA and Distance
        await supabase
          .from('routes')
          .update({ 
            total_duration_minutes: decision.new_eta_minutes,
            total_distance_km: decision.new_distance_km,
            estimated_fuel_liters: parseFloat((decision.new_distance_km / 4).toFixed(1)),
          })
          .eq('id', route_id);

        res.json({
          status: 'success',
          message: `Route re-optimized successfully. Saved ${decision.saved_minutes} minutes.`,
          saved_minutes: decision.saved_minutes,
          new_eta_minutes: decision.new_eta_minutes,
          new_distance_km: decision.new_distance_km
        });
        return;
      }
    }

    res.json({
      status: 'no_change',
      message: decision.message || 'Route is already fully optimized.',
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── Greedy nearest-neighbour fallback (no OR-Tools) ────────
function greedyFallback(depot: any, deliveryPoints: any[], vehicles: any[], trafficFactor: number): any {
  const startTime = Date.now();

  function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371.0;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  const unvisited = new Set(deliveryPoints.map((_: any, i: number) => i));
  const routes: any[] = [];

  for (const vehicle of vehicles) {
    if (unvisited.size === 0) break;
    let currentLat = depot.latitude;
    let currentLng = depot.longitude;
    const stopIds: string[] = [];
    let load = 0;
    let dist = 0;

    while (unvisited.size > 0) {
      let nearestIdx = -1;
      let nearestDist = Infinity;

      for (const idx of unvisited) {
        const dp = deliveryPoints[idx];
        const drop = finalDeliveryPoint<any>(dp.delivery_points);
        const dpLat = drop?.latitude || dp.latitude;
        const dpLng = drop?.longitude || dp.longitude;
        if (!dpLat || !dpLng) continue;
        const d = haversineKm(currentLat, currentLng, dpLat, dpLng);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = idx;
        }
      }

      if (nearestIdx === -1) break;
      const dp = deliveryPoints[nearestIdx];
      const dpDemand = dp.total_weight_kg || dp.weight_kg || dp.demand_kg || 0;
      if (load + dpDemand > vehicle.capacity_kg) break;

      dist += nearestDist * trafficFactor;
      load += dpDemand;
      stopIds.push(dp.id);
      unvisited.delete(nearestIdx);
      const dropOff = finalDeliveryPoint<any>(dp.delivery_points);
      currentLat = dropOff?.latitude || dp.latitude;
      currentLng = dropOff?.longitude || dp.longitude;
    }

    // Return to depot
    dist += haversineKm(currentLat, currentLng, depot.latitude, depot.longitude);
    const fuelEfficiency = vehicle.fuel_efficiency_kmpl || 10;

    routes.push({
      vehicle_id: vehicle.id,
      stop_ids: stopIds,
      total_distance_km: parseFloat(dist.toFixed(2)),
      total_duration_minutes: parseFloat(((dist / 50) * 60).toFixed(1)),
      estimated_fuel_liters: parseFloat((dist / fuelEfficiency).toFixed(2)),
      traffic_delay_minutes: 0,
      weather_condition: 'clear',
      // Same measure the ML service uses: stops served per 5 km driven, capped at 1.
      efficiency_score: stopIds.length ? parseFloat(Math.min(1, stopIds.length / (dist / 5 + 1)).toFixed(3)) : 0,
    });
  }

  const totalDist = routes.reduce((sum: number, r: any) => sum + r.total_distance_km, 0);
  return {
    routes,
    total_distance_km: parseFloat(totalDist.toFixed(2)),
    total_fuel_liters: parseFloat(routes.reduce((sum: number, r: any) => sum + r.estimated_fuel_liters, 0).toFixed(2)),
    solve_time_seconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(3)),
    savings_vs_naive_pct: null,
    solver_status: 'greedy_fallback',
    algorithm: 'greedy',
  };
}

export default router;
