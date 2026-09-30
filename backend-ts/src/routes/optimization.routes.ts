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
import { isPlaceholderPlate } from '../core/vehicles';
import { planOptimization } from '../services/optimizer/optimize-engine';
import { predictEta } from '../services/optimizer/eta';
import { evaluateReroute } from '../services/reroute.service';
import { evaluateRerouteLocal } from '../services/optimizer/reroute-local';
import { logFallback, mlPost } from '../services/optimizer/ml-client';

/** A stand-in vehicle (auto-created for a driver, or a wizard draft) is never planned onto. */

/** Shipment statuses the optimizer plans: new loads and failed deliveries waiting for another attempt. */
const PLANNABLE_STATUSES = ['created', 'exception'];

const router = Router();

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
      dpQuery = supabase.from('shipments').select('*, delivery_points!delivery_points_shipment_id_fkey(*)').in('id', payload.shipment_ids).in('status', PLANNABLE_STATUSES).neq('is_master', true);
    } else {
      dpQuery = supabase.from('shipments').select('*, delivery_points!delivery_points_shipment_id_fkey(*)').in('status', PLANNABLE_STATUSES).neq('is_master', true).limit(100);
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

    // ML service first; when it is not reachable the in-process solver plans the routes
    const outcome = await planOptimization({
      depot,
      shipments,
      vehicles,
      mlPayload,
      considerTraffic: payload.consider_traffic,
      maxSolveSeconds: payload.max_solve_time_seconds,
    });
    const solution = outcome.solution;
    const viewByVehicle = new Map(outcome.routes.map(v => [v.vehicle_id, v]));

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

      // The route stays pending: the console shows the plan for review, and dispatching it from the
      // Routes page (routeService.changeStatus) puts the vehicle on route and stamps planned arrivals.
      // The driver hears about the plan now.
      try {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('driver_id')
          .eq('id', optRoute.vehicle_id)
          .single();

        if (vehicle?.driver_id) {
          await notificationService.sendNotification(
            vehicle.driver_id,
            'New route assigned',
            `A new route with ${stops.length} stops has been assigned to you.`,
            'route_assigned',
            { route_id: routeRow.id }
          );
        }
      } catch (notifErr) {
        console.warn('Failed to send route assignment notification:', notifErr);
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
        // The stops in the order chosen, and in the order they were booked, for the map
        plan: viewByVehicle.get(routeRow.vehicle_id)?.plan ?? [],
        before: viewByVehicle.get(routeRow.vehicle_id)?.before ?? null,
        saved_km: viewByVehicle.get(routeRow.vehicle_id)?.saved_km ?? null,
        saved_minutes: viewByVehicle.get(routeRow.vehicle_id)?.saved_minutes ?? null,
      });
    }

    res.json({
      job_id: uuidv4(),
      status: 'completed',
      routes: routeResponses,
      total_distance_km: solution.total_distance_km || 0,
      total_fuel_liters: solution.total_fuel_liters || 0,
      // null when the solver has no baseline to measure savings against
      estimated_savings_pct: solution.savings_vs_naive_pct ?? (outcome.beforeKm > 0 ? Math.round((outcome.savedKm / outcome.beforeKm) * 1000) / 10 : null),
      // Which engine produced the routes, and whether any distance is an estimate
      engine: outcome.engine,
      engine_note: outcome.engineNote,
      matrix_source: outcome.matrixSource,
      estimated: outcome.estimated,
      saved_km: outcome.savedKm,
      saved_minutes: outcome.savedMinutes,
      before_total_km: outcome.beforeKm,
      depot: { id: depot.id, name: depot.name ?? null, latitude: Number(depot.latitude), longitude: Number(depot.longitude) },
      unassigned: outcome.unassigned,
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
// Optional origin and destination ({ lat, lng }) let the fallback use a live-traffic road duration.
router.post('/eta', requireAuth, requireRole(...STAFF_ROLES, 'driver'), async (req: Request, res: Response) => {
  try {
    // Only known numbers go on to the ML service, and only sane ones
    const input = req.body ?? {};
    const point = (v: any): LatLng | undefined => {
      const p = { lat: Number(v?.lat), lng: Number(v?.lng) };
      return v && isValidPoint(p) ? p : undefined;
    };
    const etaInput = {
      distance_km: parseNumberInRange(input.distance_km ?? 10, 'distance_km', 0, 5000),
      traffic_density: parseNumberInRange(input.traffic_density ?? 0.5, 'traffic_density', 0, 1),
      weather_severity: parseNumberInRange(input.weather_severity ?? 0, 'weather_severity', 0, 1),
      ...(typeof input.vehicle_type === 'string' ? { vehicle_type: input.vehicle_type.slice(0, 30) } : {}),
      origin: point(input.origin),
      destination: point(input.destination),
    };
    res.json(await predictEta(etaInput));
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /incubate/:vehicle_id — AI Incubator ──────────────
router.post('/incubate/:vehicle_id', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    // ML service when it is there, otherwise the remaining stops are re-solved in-process
    const decision = await evaluateReroute(req.params.vehicle_id);
    if (decision && decision.saved_minutes > 0) {
      const existing = (await cacheGet<any[]>('active_reroute_suggestions')) || [];
      const newSuggestion = {
        vehicle_id: decision.vehicle_id ?? req.params.vehicle_id,
        route_id: decision.route_id,
        trigger: decision.trigger,
        saved_minutes: decision.saved_minutes,
        new_stop_sequence: decision.new_stop_sequence,
        engine: decision.engine,
        source: 'ml',
      };
      const combined = [newSuggestion, ...existing.filter((s: any) => s.vehicle_id !== newSuggestion.vehicle_id)];
      await cacheSet('active_reroute_suggestions', combined, 3600);

      res.json({
        status: 'suggested',
        saved_minutes: decision.saved_minutes,
        trigger: decision.trigger,
        engine: decision.engine,
        message: `AI Incubator found a better path! Saving ~${decision.saved_minutes} mins.`,
      });
      return;
    }

    res.json({
      status: 'checked',
      engine: decision?.engine ?? null,
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
      .maybeSingle();

    if (!route) {
      const { data: manifest } = await supabase.from('cargo_manifest').select('id').eq('id', route_id).maybeSingle();
      if (manifest) {
        res.status(409).json({ detail: 'A vendor load has one pickup and one drop, so there is nothing to optimize.' });
        return;
      }
    }
    if (!route || !['active', 'pending'].includes(route.status)) {
      res.status(400).json({ detail: 'Route not found or not in an optimizable state' });
      return;
    }

    // 2. ML service evaluate-reroute, or the in-process re-solve of the pending stops
    let decision: any;
    try {
      decision = await mlPost('/evaluate-reroute', { vehicle_id: route.vehicle_id }, { timeoutMs: 5_000 });
      decision.engine = 'ml-service';
    } catch (err) {
      logFallback('reoptimize', err, 'the in-process re-solve');
      const local = await evaluateRerouteLocal(route.vehicle_id, { routeId: route_id });
      if (!local.ok) {
        if (local.reason === 'no_position') {
          throw new HttpError(409, 'Vehicle has no current position (no telemetry or last-known location); cannot re-optimize.');
        }
        res.json({ status: 'no_change', message: 'Not enough pending stops to re-optimize.' });
        return;
      }
      decision = local.decision;
      // The re-solve measures the remaining stops only, so the route's totals move by what it saved
      const { data: totals } = await supabase.from('routes').select('total_distance_km, total_duration_minutes').eq('id', route_id).maybeSingle();
      const km = Number(totals?.total_distance_km) || 0;
      const min = Number(totals?.total_duration_minutes) || 0;
      decision.new_distance_km = km > 0 ? Math.round(Math.max(0, km - (decision.saved_km ?? 0)) * 10) / 10 : null;
      decision.new_eta_minutes = min > 0 ? Math.round(Math.max(0, min - decision.saved_minutes) * 10) / 10 : null;
    }

    if (decision && decision.new_stop_sequence) {
      // Apply the new sequence to the database
      const newSequence = decision.new_stop_sequence; // Array of delivery_point_ids

      // Get all pending stops for this route to map IDs
      const { data: pendingStops } = await supabase
        .from('route_stops')
        .select('id, delivery_point_id, sequence')
        .eq('route_id', route_id)
        .eq('status', 'pending')
        .order('sequence', { ascending: true });

      if (pendingStops && pendingStops.length > 0) {
        const oldSequence = pendingStops.map((s: any) => String(s.delivery_point_id));
        // Pending stops take the sequence numbers the pending stops already held, so
        // stops already completed keep their place at the front.
        const slots = pendingStops.map((s: any) => s.sequence).sort((a: number, b: number) => a - b);
        await Promise.all(pendingStops.map((stop: any) => {
          const newIdx = newSequence.indexOf(stop.delivery_point_id.toString());
          if (newIdx !== -1 && slots[newIdx] !== undefined) {
            return supabase
              .from('route_stops')
              .update({ sequence: slots[newIdx] })
              .eq('id', stop.id);
          }
          return Promise.resolve();
        }));

        // Update route ETA and Distance (when the new figures are known)
        if (typeof decision.new_eta_minutes === 'number' && typeof decision.new_distance_km === 'number') {
          await supabase
            .from('routes')
            .update({
              total_duration_minutes: decision.new_eta_minutes,
              total_distance_km: decision.new_distance_km,
              estimated_fuel_liters: parseFloat((decision.new_distance_km / 4).toFixed(1)),
            })
            .eq('id', route_id);
        }

        res.json({
          status: 'success',
          message: `Route re-optimized successfully. Saved ${decision.saved_minutes} minutes.`,
          engine: decision.engine,
          estimated: decision.estimated ?? null,
          saved_minutes: decision.saved_minutes,
          saved_km: decision.saved_km ?? null,
          new_eta_minutes: decision.new_eta_minutes,
          new_distance_km: decision.new_distance_km,
          old_distance_km: decision.old_distance_km ?? null,
          old_stop_sequence: oldSequence,
          new_stop_sequence: newSequence,
        });
        return;
      }
    }

    res.json({
      status: 'no_change',
      engine: decision?.engine ?? null,
      message: decision?.message || 'Route is already fully optimized.',
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
