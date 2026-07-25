/**
 * RouteIQ — Telemetry Routes
 * Ports: backend/app/api/v1/endpoints/telemetry.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { cacheGet } from '../core/redis';
import { TelemetryCreateSchema } from '../schemas';
import { TelemetryService } from '../services/telemetry.service';
import { v4 as uuidv4 } from 'uuid';
import { wsManager } from '../core/websocket';
import crypto from 'crypto';

const router = Router();

// In-memory store for mobile sessions
const mobileSessions: Record<string, any> = {};

// ── POST / — Ingest telemetry ──────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = TelemetryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }

    const t = await TelemetryService.ingestTelemetry(parsed.data);
    res.status(201).json(t);
  } catch (e: any) {
    if (e.message.includes('not found')) {
      res.status(404).json({ detail: e.message });
    } else {
      res.status(500).json({ detail: `Telemetry Ingestion Failed: ${e.message}` });
    }
  }
});

// ── GET /:vehicle_id/history ───────────────────────────────
router.get('/:vehicle_id/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.vehicle_id;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);

    if (req.user!.role === 'driver') {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('driver_id')
        .eq('id', vehicleId)
        .single();
      if (!vehicle || vehicle.driver_id !== req.user!.user_id) {
        res.status(403).json({ detail: 'Not authorized to view this history' });
        return;
      }
    }

    const { data, error } = await supabase
      .from('telemetry')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) { res.status(500).json({ detail: error.message }); return; }
    res.json(data || []);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── PUT /sos/:id/resolve ──────────────────────────────────────
router.put('/sos/:id/resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    // Uses service_role key to bypass RLS
    const { error } = await supabase.from('sos_alerts').update({ status: 'resolved' }).eq('id', id);
    if (error) {
      res.status(500).json({ detail: error.message });
      return;
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /sos/config ───────────────────────────────────────────
router.get('/sos/config', requireAuth, async (req: Request, res: Response) => {
  // Mock config for driver app
  res.json({
    status: 'success',
    emergency_contacts: ['112', '100', '108'],
    escalation_timeout_mins: 5,
    auto_record_audio: false
  });
});

// ── POST /sos/trigger ─────────────────────────────────────────
router.post('/sos/trigger', requireAuth, async (req: Request, res: Response) => {
  try {
    const { lat, lng } = req.body;
    const userId = req.user?.user_id;

    // Get the driver's current vehicle
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('driver_id', userId)
      .single();

    if (vehicle) {
      // Insert SOS alert
      await supabase.from('sos_alerts').insert({
        vehicle_id: vehicle.id,
        driver_id: userId,
        latitude: lat,
        longitude: lng,
        alert_type: 'panic_button',
        description: 'Driver triggered SOS from mobile app',
        status: 'active'
      });
    }

    res.json({ status: 'success', message: 'SOS triggered successfully' });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /:vehicle_id/live ──────────────────────────────────
router.get('/:vehicle_id/live', requireAuth, async (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.vehicle_id;

    if (req.user!.role === 'driver') {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('driver_id')
        .eq('id', vehicleId)
        .single();
      if (!vehicle || vehicle.driver_id !== req.user!.user_id) {
        res.status(403).json({ detail: 'Not authorized to view live data' });
        return;
      }
    }

    const data = await cacheGet(`vehicle:live:${vehicleId}`);
    res.json(data || { error: 'No live data available' });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /stoppages ────────────────────────────────────────
router.post('/stoppages', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can report stoppages' });
      return;
    }

    const { data, error } = await supabase
      .from('vehicle_stoppages')
      .insert({
        vehicle_id: req.body.vehicle_id,
        latitude: req.body.lat,
        longitude: req.body.lng,
        reason: req.body.reason || 'unknown',
        start_time: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) { res.status(500).json({ detail: error.message }); return; }
    res.status(201).json({ status: 'stoppage_logged', id: data?.id });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /mobile-session ───────────────────────────────────
router.post('/mobile-session', requireAuth, async (req: Request, res: Response) => {
  try {
    const vehicleId = req.body.vehicle_id;
    const phone = req.body.phone || '';

    if (!vehicleId) {
      res.status(400).json({ detail: 'vehicle_id is required' });
      return;
    }

    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select('id, plate_number')
      .eq('id', vehicleId)
      .single();

    if (error || !vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }

    const sessionToken = crypto.randomBytes(16).toString('base64url');
    mobileSessions[sessionToken] = {
      vehicle_id: vehicleId,
      phone,
      plate: vehicle.plate_number,
      created_at: new Date().toISOString(),
      active: true,
    };

    res.json({
      token: sessionToken,
      vehicle_id: vehicleId,
      plate: vehicle.plate_number,
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /call-driver/:vehicle_id ──────────────────────────
router.post('/call-driver/:vehicle_id', requireAuth, requireRole('superadmin', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.vehicle_id;
    // Broadcast via Supabase Realtime so the specific driver app picks it up
    const channel = supabase.channel(`driver-confs-${vehicleId}`);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'INCOMING_DISPATCH_CALL',
          payload: { caller: req.user?.role || 'Dispatch' },
        }).then(() => {
          // Cleanup channel after sending
          supabase.removeChannel(channel);
        });
      }
    });

    res.json({ success: true, message: 'Call dispatched' });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /mobile-push/:session_token (no auth) ─────────────
router.post('/mobile-push/:session_token', async (req: Request, res: Response) => {
  try {
    const session = mobileSessions[req.params.session_token];
    if (!session || !session.active) {
      res.status(404).json({ detail: 'Invalid or expired tracking session' });
      return;
    }

    const vehicleId = session.vehicle_id;
    const lat = req.body.lat || req.body.latitude || 0;
    const lng = req.body.lng || req.body.longitude || 0;
    const speed = req.body.speed || 0;
    const heading = req.body.heading || 0;

    const telemetryData = {
      vehicle_id: vehicleId,
      latitude: lat,
      longitude: lng,
      speed_kmph: speed ? parseFloat((speed * 3.6).toFixed(1)) : 0, // m/s → km/h
      heading,
      fuel_level_pct: 100.0, // Not available from mobile
    };

    await TelemetryService.ingestTelemetry(telemetryData);

    // Also broadcast via WebSocket
    await wsManager.broadcast({
      type: 'TELEMETRY_UPDATE',
      data: {
        vehicle_id: vehicleId,
        lat,
        lng,
        speed: telemetryData.speed_kmph,
        source: 'mobile',
      },
    });

    res.json({ status: 'ok', vehicle_id: vehicleId });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /mobile-session/:session_token ─────────────────────
router.get('/mobile-session/:session_token', (req: Request, res: Response) => {
  const session = mobileSessions[req.params.session_token];
  if (!session) {
    res.status(404).json({ detail: 'Session not found' });
    return;
  }
  res.json(session);
});

// ── POST /driver-ping — React Native background GPS (Ola/Uber style) ──
router.post('/driver-ping', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can send location pings' });
      return;
    }

    const driverId = req.user!.user_id;

    // Find the driver's assigned vehicle
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, plate_number, status')
      .eq('driver_id', driverId)
      .single();

    if (!vehicle) {
      res.status(404).json({ detail: 'No vehicle assigned to this driver' });
      return;
    }

    // Support batch pings (offline queue replay)
    const pings = Array.isArray(req.body.pings) ? req.body.pings : [req.body];
    
    // Debug log
    require('fs').appendFileSync('pings_debug.log', JSON.stringify({ time: new Date().toISOString(), driverId, pings }) + '\\n');

    let processedCount = 0;
    let latestLat = 0;
    let latestLng = 0;
    let latestSpeed = 0;

    for (const ping of pings) {
      const lat = ping.lat || ping.latitude;
      const lng = ping.lng || ping.longitude;
      const speed = ping.speed || 0;
      const heading = ping.heading || 0;
      const accuracy = ping.accuracy || null;
      const timestamp = ping.timestamp || new Date().toISOString();

      if (!lat || !lng) {
         require('fs').appendFileSync('pings_debug.log', 'Skipped ping: no lat/lng\\n');
         continue;
      }

      // Convert speed from m/s (native GPS) to km/h if needed
      const speedKmph = speed > 50 ? speed : speed * 3.6; // assume m/s if < 50

      // Insert telemetry record
      await supabase.from('telemetry').insert({
        id: uuidv4(),
        vehicle_id: vehicle.id,
        latitude: lat,
        longitude: lng,
        speed_kmph: parseFloat(speedKmph.toFixed(1)),
        heading: heading,
        fuel_level_pct: ping.fuel_level_pct ?? null,
        timestamp,
      });

      // Also insert GPS point for history
      await supabase.from('gps_points').insert({
        id: uuidv4(),
        vehicle_id: vehicle.id,
        latitude: lat,
        longitude: lng,
        accuracy,
        recorded_at: timestamp,
      });

      latestLat = lat;
      latestLng = lng;
      latestSpeed = speedKmph;
      processedCount++;
    }

    if (processedCount > 0) {
      // Update vehicle live position
      await supabase.from('vehicles').update({
        latitude: latestLat,
        longitude: latestLng,
        last_heartbeat: new Date().toISOString(),
        status: latestSpeed > 2 ? 'on_route' : vehicle.status,
      }).eq('id', vehicle.id);

      // Cache in Redis
      const liveData = {
        vehicle_id: vehicle.id,
        lat: latestLat,
        lng: latestLng,
        speed: latestSpeed,
        timestamp: new Date().toISOString(),
      };
      const { cacheSet } = await import('../core/redis');
      await cacheSet(`vehicle:live:${vehicle.id}`, liveData, 120);

      // Broadcast to dashboard via WebSocket
      await wsManager.broadcast({
        type: 'TELEMETRY_UPDATE',
        data: liveData,
      });

      // ── Geofence Auto-Complete Check ──
      // Check if driver is within 50m of any pending delivery point
      const { data: activeRoutes } = await supabase
        .from('routes')
        .select('id, route_stops(id, delivery_point_id, sequence, status, delivery_points(id, name, latitude, longitude))')
        .eq('vehicle_id', vehicle.id)
        .eq('status', 'active');

      let geofenceAlert: any = null;

      if (activeRoutes && activeRoutes.length > 0) {
        for (const route of activeRoutes) {
          const pendingStops = (route.route_stops || [])
            .filter((s: any) => s.status === 'pending')
            .sort((a: any, b: any) => a.sequence - b.sequence);

          for (const stop of pendingStops) {
            const dpRaw = stop.delivery_points;
            const dp: any = Array.isArray(dpRaw) ? dpRaw[0] : dpRaw;
            if (!dp) continue;

            // Haversine distance check
            const R = 6371000; // meters
            const dLat = ((dp.latitude - latestLat) * Math.PI) / 180;
            const dLng = ((dp.longitude - latestLng) * Math.PI) / 180;
            const a = Math.sin(dLat / 2) ** 2 +
              Math.cos((latestLat * Math.PI) / 180) *
              Math.cos((dp.latitude * Math.PI) / 180) *
              Math.sin(dLng / 2) ** 2;
            const distMeters = 2 * R * Math.asin(Math.sqrt(a));

            if (distMeters <= 50) {
              geofenceAlert = {
                type: 'GEOFENCE_ARRIVAL',
                stop_id: stop.id,
                delivery_point_id: dp.id,
                delivery_point_name: dp.name,
                distance_meters: Math.round(distMeters),
                message: `You are ${Math.round(distMeters)}m from ${dp.name}. Did you deliver?`,
              };

              // Broadcast to admin dashboard too
              await wsManager.broadcast({
                type: 'GEOFENCE_ALERT',
                data: {
                  vehicle_id: vehicle.id,
                  plate_number: vehicle.plate_number,
                  alert_type: 'ARRIVAL',
                  delivery_point: dp.name,
                  distance_meters: Math.round(distMeters),
                },
              });

              break; // Only alert for the nearest pending stop
            }
          }
          if (geofenceAlert) break;
        }
      }

      // ── Speed Alert ──
      if (latestSpeed > 85.0) {
        await wsManager.broadcast({
          type: 'ALERT_WARNING',
          title: 'High Speed Alert',
          message: `Vehicle ${vehicle.plate_number} exceeding safety limit: ${latestSpeed.toFixed(1)} km/h`,
          payload: { vehicle_id: vehicle.id, plate_number: vehicle.plate_number },
        });
      }
    }

    // ── Adaptive Interval ──
    // Server controls how often the driver app should ping
    // Moving fast → every 10s, slow/idle → every 30s, stopped → every 60s
    let nextPingIntervalMs = 10000; // default 10s
    if (latestSpeed < 5) nextPingIntervalMs = 60000;       // stopped: 60s
    else if (latestSpeed < 20) nextPingIntervalMs = 30000;  // slow: 30s
    else if (latestSpeed < 50) nextPingIntervalMs = 15000;  // city: 15s
    // else: highway: 10s (default)

    // ── Pending commands for driver app (two-way sync) ──
    // Check if there are route changes the driver needs to know about
    let pendingCommands: any[] = [];
    const { data: driverRoutes } = await supabase
      .from('routes')
      .select('id, status, total_distance_km, total_duration_minutes')
      .eq('vehicle_id', vehicle?.id || '')
      .in('status', ['active', 'pending', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (driverRoutes && driverRoutes.length > 0) {
      pendingCommands.push({
        type: 'ACTIVE_ROUTE',
        route_id: driverRoutes[0].id,
        status: driverRoutes[0].status,
      });
    }

    res.json({
      status: 'ok',
      pings_processed: processedCount,
      next_ping_interval_ms: nextPingIntervalMs,
      vehicle_id: vehicle?.id,
      geofence_alert: null, // Will be populated if within 50m of a stop
      pending_commands: pendingCommands,
      server_time: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /driver-ping/break — Driver takes a break ──
router.post('/driver-ping/break', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can take a break' });
      return;
    }

    const { is_break } = req.body;
    
    // Find the vehicle assigned to this driver
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('driver_id', req.user!.user_id)
      .single();

    if (vehicle) {
      await supabase
        .from('vehicles')
        .update({ status: is_break ? 'idle' : 'on_route' })
        .eq('id', vehicle.id);
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /driver-ping/start-route — Driver starts journey ──
router.post('/driver-ping/start-route', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can start routes' });
      return;
    }
    
    const { route_id } = req.body;
    if (!route_id) {
      res.status(400).json({ detail: 'route_id is required' });
      return;
    }

    // Check if it's a cargo manifest
    const { data: manifest } = await supabase.from('cargo_manifest').select('id').eq('id', route_id).single();
    if (manifest) {
      await supabase.from('cargo_manifest').update({ status: 'in_transit' }).eq('id', route_id);
    } else {
      // Update route to active
      await supabase.from('routes').update({ status: 'active' }).eq('id', route_id);
    }
    
    // Also update vehicle to on_route
    const { data: route } = await supabase.from('routes').select('vehicle_id').eq('id', route_id).single();
    if (route?.vehicle_id) {
      await supabase.from('vehicles').update({ status: 'on_route' }).eq('id', route.vehicle_id);
    }

    res.json({ success: true, status: 'active' });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /driver-ping/complete-stop — Driver marks delivery complete ──
router.post('/driver-ping/complete-stop', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can complete stops' });
      return;
    }

    const { stop_id, status = 'completed', photo_url, signature_data, received_by, lat, lng } = req.body;
    if (!stop_id) {
      res.status(400).json({ detail: 'stop_id is required' });
      return;
    }

    // Check for cargo manifest stops
    if (stop_id.endsWith('_pickup') || stop_id.endsWith('_drop')) {
      const manifestId = stop_id.replace('_pickup', '').replace('_drop', '');
      const isPickup = stop_id.endsWith('_pickup');
      
      const { data: manifest } = await supabase.from('cargo_manifest').select('*').eq('id', manifestId).single();
      if (!manifest) { res.status(404).json({ detail: 'Manifest not found' }); return; }

      if (isPickup) {
        await supabase.from('cargo_manifest').update({ status: 'in_transit' }).eq('id', manifestId);
      } else {
        await supabase.from('cargo_manifest').update({ status: 'delivered' }).eq('id', manifestId);
        await supabase.from('vendor_shipment_requests').update({ status: 'completed' }).eq('id', manifest.vendor_request_id);
        await supabase.from('vehicles').update({ status: 'available' }).eq('id', manifest.vehicle_id);
      }

      // Broadcast completion
      await wsManager.broadcast({
        type: 'STOP_COMPLETED',
        data: { stop_id, route_id: manifestId, completed_by: req.user!.user_id },
      });

      res.json({
        status: 'completed',
        stop_id,
        route_id: manifestId,
        remaining_stops: isPickup ? 1 : 0,
        route_completed: !isPickup,
      });
      return;
    }

    // Update route stop status
    const { data: stop, error: stopErr } = await supabase
      .from('route_stops')
      .update({ status }) // 'completed' or 'failed'
      .eq('id', stop_id)
      .select('route_id, delivery_point_id')
      .single();

    if (stopErr || !stop) {
      res.status(404).json({ detail: 'Stop not found' });
      return;
    }

    // If this delivery point is linked to a shipment, update the shipment too
    const { data: dp } = await supabase
      .from('delivery_points')
      .select('shipment_id')
      .eq('id', stop.delivery_point_id)
      .single();

    if (dp?.shipment_id) {
      const { ShipmentService } = await import('../services/shipment.service');
      await ShipmentService.updateShipmentStatus(
        dp.shipment_id,
        status === 'completed' ? 'delivered' : 'exception',
        lat, lng,
        received_by || null,
        signature_data || null
      );
    }

    // Check if all stops on this route are now completed or failed
    const { data: remainingStops } = await supabase
      .from('route_stops')
      .select('id')
      .eq('route_id', stop.route_id)
      .eq('status', 'pending');

    if (!remainingStops || remainingStops.length === 0) {
      // All stops done → mark route as completed
      await supabase.from('routes').update({ status: 'completed' }).eq('id', stop.route_id);


      // Free up vehicle
      const { data: route } = await supabase
        .from('routes')
        .select('vehicle_id')
        .eq('id', stop.route_id)
        .single();

      if (route) {
        await supabase.from('vehicles').update({ status: 'available' }).eq('id', route.vehicle_id);
      }
    }

    // Broadcast completion to dashboard
    await wsManager.broadcast({
      type: 'STOP_COMPLETED',
      data: {
        stop_id,
        route_id: stop.route_id,
        delivery_point_id: stop.delivery_point_id,
        remaining_stops: remainingStops?.length || 0,
        completed_by: req.user!.user_id,
      },
    });

    res.json({
      status: 'completed',
      stop_id,
      route_id: stop.route_id,
      remaining_stops: remainingStops?.length || 0,
      route_completed: !remainingStops || remainingStops.length === 0,
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /driver-ping/my-route — Driver fetches their current active route ──
router.get('/driver-ping/my-route', requireAuth, async (req: Request, res: Response) => {
  try {
    console.log(`[my-route] Request from user:`, req.user?.user_id);
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can fetch their route' });
      return;
    }

    // Find driver's vehicle
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('driver_id', req.user!.user_id)
      .single();

    console.log(`[my-route] Found vehicle for driver:`, vehicle?.id);

    if (!vehicle) {
      res.status(404).json({ detail: 'No vehicle assigned' });
      return;
    }

    // Find active/pending route with full stop details
    const { data: route, error } = await supabase
      .from('routes')
      .select('*, route_stops(*, delivery_points(*)), depots(*)')
      .eq('vehicle_id', vehicle.id)
      .in('status', ['active', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error(`[my-route] Query result error:`, error.message, `route id:`, (route as any)?.id);
    }

    if (error || !route) {
      // Check for cargo manifest instead
      const { data: manifest, error: manifestErr } = await supabase
        .from('cargo_manifest')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .in('status', ['scheduled', 'in_transit'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (manifestErr || !manifest) {
        // No active route and no active manifest. 
        // Check for recently completed routes or delivered manifests
        const { data: compRoute } = await supabase
          .from('routes')
          .select('*, route_stops(*, delivery_points(*)), depots(*)')
          .eq('vehicle_id', vehicle.id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (compRoute) {
          const cStops = (compRoute.route_stops || [])
            .sort((a: any, b: any) => a.sequence - b.sequence)
            .map((s: any) => ({
              id: s.id,
              sequence: s.sequence,
              status: s.status,
              delivery_point: s.delivery_points ? {
                id: s.delivery_points.id,
                name: s.delivery_points.name,
                address: s.delivery_points.address,
                latitude: s.delivery_points.latitude,
                longitude: s.delivery_points.longitude,
                demand_kg: s.delivery_points.demand_kg,
              } : null,
            }));
          res.json({
            active: false,
            route: {
              id: compRoute.id,
              status: compRoute.status,
              stops: cStops,
              progress_pct: 100
            }
          });
          return;
        }

        const { data: compManifest } = await supabase
          .from('cargo_manifest')
          .select('*')
          .eq('vehicle_id', vehicle.id)
          .eq('status', 'delivered')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (compManifest) {
          res.json({
            active: false,
            is_manifest: true,
            route: {
              id: compManifest.id,
              status: 'completed',
              stops: [],
              progress_pct: 100
            }
          });
          return;
        }

        res.json({ active: false, message: 'No active route assigned' });
        return;
      }

      // Map manifest to route shape
      const mStatus = manifest.status === 'scheduled' ? 'pending' : 'in_progress';
      const manifestStops = [
        {
          id: manifest.id + '_pickup',
          sequence: 1,
          status: manifest.status === 'scheduled' ? 'pending' : 'completed',
          delivery_point: {
            id: manifest.id + '_pickup_dp',
            name: "Pickup: " + (manifest.pickup_location || '').substring(0, 20),
            address: manifest.pickup_location,
            latitude: manifest.pickup_lat,
            longitude: manifest.pickup_lng,
            demand_kg: manifest.capacity_kg
          }
        },
        {
          id: manifest.id + '_drop',
          sequence: 2,
          status: 'pending', // always pending until manifest is delivered
          delivery_point: {
            id: manifest.id + '_drop_dp',
            name: "Drop: " + (manifest.drop_location || '').substring(0, 20),
            address: manifest.drop_location,
            latitude: manifest.drop_lat,
            longitude: manifest.drop_lng,
            demand_kg: manifest.capacity_kg
          }
        }
      ];

      res.json({
        active: true,
        is_manifest: true,
        route: {
          id: manifest.id,
          status: mStatus,
          total_distance_km: 0,
          total_duration_minutes: 0,
          depot: null,
          stops: manifestStops,
          completed_stops: manifest.status === 'scheduled' ? 0 : 1,
          remaining_stops: manifest.status === 'scheduled' ? 2 : 1,
          progress_pct: manifest.status === 'scheduled' ? 0 : 50,
        },
      });
      return;
    }

    // Sort stops by sequence
    const stops = (route.route_stops || [])
      .sort((a: any, b: any) => a.sequence - b.sequence)
      .map((s: any) => ({
        id: s.id,
        sequence: s.sequence,
        status: s.status,
        delivery_point: s.delivery_points ? {
          id: s.delivery_points.id,
          name: s.delivery_points.name,
          address: s.delivery_points.address,
          latitude: s.delivery_points.latitude,
          longitude: s.delivery_points.longitude,
          demand_kg: s.delivery_points.demand_kg,
        } : null,
      }));

    res.json({
      active: true,
      route: {
        id: route.id,
        status: route.status,
        total_distance_km: route.total_distance_km,
        total_duration_minutes: route.total_duration_minutes,
        depot: route.depots ? {
          name: route.depots.name,
          latitude: route.depots.latitude,
          longitude: route.depots.longitude,
        } : null,
        stops,
        completed_stops: stops.filter((s: any) => s.status === 'completed').length,
        remaining_stops: stops.filter((s: any) => s.status === 'pending').length,
        progress_pct: stops.length > 0
          ? Math.round((stops.filter((s: any) => s.status === 'completed').length / stops.length) * 100)
          : 0,
      },
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
