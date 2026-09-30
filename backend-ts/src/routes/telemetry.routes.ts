/**
 * margixindia — Telemetry Routes
 * Ports: backend/app/api/v1/endpoints/telemetry.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES, isStaff, canAccessVehicle, canAccessRoute, canAccessRouteStop, canAccessManifest } from '../core/ownership';
import { consumeRateLimit, rateLimitByIp, rateLimitByUser } from '../core/rate-limit';
import { cacheGet } from '../core/redis';
import { TelemetryCreateSchema } from '../schemas';
import { TelemetryService } from '../services/telemetry.service';
import { v4 as uuidv4 } from 'uuid';
import { wsManager } from '../core/websocket';
import crypto from 'crypto';
import { HttpError, sendError } from '../core/errors';
import { notificationService } from '../services/notification.service';
import {
  routeService, setOperatingVehicleStatus, holdVehicleAfterSos, manifestRouteStops, operatingStatusFor,
  releaseVehicleLoad, OPEN_MANIFEST_STATUSES,
} from '../services/route.service';
import { CARGO_MANIFEST_TRANSITIONS, OPERATING_VEHICLE_STATUSES, assertTransition } from '../core/transitions';
import { parseCoordinate } from '../core/validate';
import { pathKm, type PingPoint } from '../services/odometer';
import { evaluatePing } from '../services/alerts.service';
import { recordGpsPoints, type GpsFix } from '../services/gps-history.service';
import { idempotent } from '../core/idempotency';
import { transitionSos } from '../services/sos.service';
import { loadDriverStatus } from '../services/driver-status.service';
import { loadShipmentParcels, wasDeliveryScanned } from '../services/parcel.service';
import { isPodPathFor } from '../services/pod.service';
import { recordCustody, DELIVERY_FAILURE_REASONS, type CustodyInput } from '../services/cargo/custody.service';
import { CONDITIONS, codeOf, resolveRef } from '../services/cargo/consignment';

const router = Router();

// In-memory store for mobile tracking sessions (capability URLs shared with drivers)
const MOBILE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const mobileSessions: Record<string, { vehicle_id: string; phone: string; plate: string; created_at: string; expires_at: number; active: boolean }> = {};

function getMobileSession(token: string) {
  const session = mobileSessions[token];
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    delete mobileSessions[token];
    return null;
  }
  return session;
}

// ── POST / — Ingest telemetry ──────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = TelemetryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }
    if (!(await canAccessVehicle(req.user!, parsed.data.vehicle_id))) {
      res.status(403).json({ detail: 'Not authorized for this vehicle' });
      return;
    }

    const t = await TelemetryService.ingestTelemetry(parsed.data);
    res.status(201).json(t);
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── GET /:vehicle_id/history ───────────────────────────────
router.get('/:vehicle_id/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.vehicle_id;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);

    if (!(await canAccessVehicle(req.user!, vehicleId))) {
      res.status(403).json({ detail: 'Not authorized to view this history' });
      return;
    }

    const { data, error } = await supabase
      .from('telemetry')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json(data || []);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PUT /sos/:id/acknowledge, PUT /sos/:id/resolve, POST /sos/:id/cancel ──────
// active → acknowledged (someone is handling it) → resolved, or cancelled (a false alarm) from
// either open state. The rules live in services/sos.service.ts; repeating a step the alert is
// already in succeeds, and a step it cannot take is a 409 that names the current status.
function sosTransition(next: 'acknowledged' | 'resolved') {
  return async (req: Request, res: Response) => {
    try {
      const { changed } = await transitionSos(req.params.id, next);
      res.json({ success: true, status: next, changed });
    } catch (e: any) {
      sendError(req, res, e);
    }
  };
}

router.put('/sos/:id/acknowledge', requireAuth, requireRole(...STAFF_ROLES), sosTransition('acknowledged'));
router.put('/sos/:id/resolve', requireAuth, requireRole(...STAFF_ROLES), sosTransition('resolved'));

// Cancel: the driver withdraws their own alert from the app (a mistake, or the trouble passed),
// or staff close one as a false alarm. Staff are told when a driver cancels.
router.post('/sos/:id/cancel', requireAuth, requireRole('driver', ...STAFF_ROLES), idempotent('sos-cancel'), async (req: Request, res: Response) => {
  try {
    const byDriver = req.user!.role === 'driver';
    const { alert, changed } = await transitionSos(req.params.id, 'cancelled', byDriver ? { driverId: req.user!.user_id } : {});
    if (changed && byDriver) {
      try {
        const { data: vehicle } = alert.vehicle_id
          ? await supabase.from('vehicles').select('plate_number, driver_name').eq('id', alert.vehicle_id).maybeSingle()
          : { data: null };
        await notificationService.notifyStaff(
          'SOS cancelled',
          `${vehicle?.driver_name ?? 'The driver'} on ${vehicle?.plate_number ?? 'a vehicle'} cancelled their SOS. It was raised by mistake or is no longer needed.`,
          'sos',
          { alert_id: alert.id, vehicle_id: alert.vehicle_id, cancelled: true },
        );
      } catch (e) {
        console.error('[telemetry] SOS cancel notification failed:', e);
      }
    }
    res.json({ success: true, status: 'cancelled', changed });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /sos/trigger ─────────────────────────────────────────
// Optional alert_type lets the driver say what kind of emergency it is.
const SOS_TYPES = ['panic_button', 'accident', 'breakdown', 'medical', 'theft', 'other'];
router.post('/sos/trigger', requireAuth, idempotent('sos-trigger'), rateLimitByUser('sos-trigger', 10, 10 * 60), async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can raise an SOS' });
      return;
    }
    const userId = req.user!.user_id;
    const lat = parseCoordinate(req.body?.lat, 'lat', 90);
    const lng = parseCoordinate(req.body?.lng, 'lng', 180);
    const alertType = SOS_TYPES.includes(req.body?.alert_type) ? req.body.alert_type : 'panic_button';
    const note = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 500) : '';

    // Get the driver's current vehicle
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, plate_number, driver_name')
      .eq('driver_id', userId)
      .single();

    // Never report success for an SOS that was not recorded
    if (!vehicle) {
      res.status(404).json({ detail: 'No vehicle assigned to this driver, so the SOS could not be raised' });
      return;
    }

    const { data: created, error: sosErr } = await supabase.from('sos_alerts').insert({
      vehicle_id: vehicle.id,
      driver_id: userId,
      latitude: lat,
      longitude: lng,
      alert_type: alertType,
      description: note || 'Driver triggered SOS from mobile app',
      status: 'active'
    }).select('id').single();
    if (sosErr) throw new Error(`Failed to record SOS: ${sosErr.message}`);

    // Staff hear about it in their bell as well as on the SOS screen. A failed
    // notification must not undo the alert.
    try {
      await notificationService.notifyStaff(
        'SOS',
        `${vehicle.driver_name ?? 'A driver'} on ${vehicle.plate_number ?? 'a vehicle'} triggered an SOS (${alertType.replace('_', ' ')}).`,
        'sos',
        { alert_id: created?.id ?? null, vehicle_id: vehicle.id },
      );
    } catch (e) {
      console.error('[telemetry] SOS notification failed:', e);
    }

    res.json({ status: 'success', message: 'SOS triggered successfully', id: created?.id ?? null });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PATCH /sos/:id/details ────────────────────────────────────
// The driver adds what happened to the alert they already raised, instead of
// raising a second one. Only their own alert, and only while it is active.
const SOS_SEVERITIES = ['serious', 'minor'];
router.patch('/sos/:id/details', requireAuth, idempotent('sos-details'), async (req: Request, res: Response) => {
  try {
    const update: Record<string, string> = {};
    if (req.body.alert_type !== undefined) {
      if (!SOS_TYPES.includes(req.body.alert_type)) {
        res.status(400).json({ detail: 'Unknown alert_type' });
        return;
      }
      update.alert_type = req.body.alert_type;
    }
    if (req.body.description !== undefined) {
      if (typeof req.body.description !== 'string') {
        res.status(400).json({ detail: 'description must be text' });
        return;
      }
      const note = req.body.description.trim().slice(0, 500);
      if (note) update.description = note;
    }
    if (req.body.severity !== undefined) {
      if (!SOS_SEVERITIES.includes(req.body.severity)) {
        res.status(400).json({ detail: 'severity must be serious or minor' });
        return;
      }
      update.severity = req.body.severity;
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ detail: 'Nothing to update' });
      return;
    }

    const { data, error } = await supabase
      .from('sos_alerts')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('driver_id', req.user!.user_id)
      .eq('status', 'active')
      .select('id, vehicle_id, alert_type, severity');
    if (error) throw error;
    if (!data || data.length === 0) {
      res.status(404).json({ detail: 'No active alert of yours with this id' });
      return;
    }
    // A serious breakdown or accident takes the vehicle out of dispatch; it keeps reporting its position.
    const [alert] = data as any[];
    await holdVehicleAfterSos(alert.vehicle_id, update.alert_type ?? alert.alert_type, update.severity ?? alert.severity, alert.id, { id: req.user!.user_id, role: req.user!.role });
    res.json({ success: true, id: req.params.id });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:vehicle_id/live ──────────────────────────────────
router.get('/:vehicle_id/live', requireAuth, async (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.vehicle_id;

    if (!(await canAccessVehicle(req.user!, vehicleId))) {
      res.status(403).json({ detail: 'Not authorized to view live data' });
      return;
    }

    const data = await cacheGet(`vehicle:live:${vehicleId}`);
    res.json(data || { error: 'No live data available' });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /stoppages ────────────────────────────────────────
router.post('/stoppages', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isStaff(req.user) && req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can report stoppages' });
      return;
    }
    if (!req.body.vehicle_id || !(await canAccessVehicle(req.user!, req.body.vehicle_id))) {
      res.status(403).json({ detail: 'Not authorized for this vehicle' });
      return;
    }

    const lat = parseCoordinate(req.body.lat, 'lat', 90);
    const lng = parseCoordinate(req.body.lng, 'lng', 180);
    const reason = typeof req.body.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim().slice(0, 100) : 'unknown';

    const { data, error } = await supabase
      .from('vehicle_stoppages')
      .insert({
        vehicle_id: req.body.vehicle_id,
        latitude: lat,
        longitude: lng,
        reason,
        start_time: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;
    res.status(201).json({ status: 'stoppage_logged', id: data?.id });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /mobile-session ───────────────────────────────────
router.post('/mobile-session', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
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
      expires_at: Date.now() + MOBILE_SESSION_TTL_MS,
      active: true,
    };

    res.json({
      token: sessionToken,
      vehicle_id: vehicleId,
      plate: vehicle.plate_number,
    });
  } catch (e: any) {
    sendError(req, res, e);
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
    sendError(req, res, e);
  }
});

// ── POST /mobile-push/:session_token (no auth) ─────────────
router.post('/mobile-push/:session_token', rateLimitByIp('mobile-push', 300, 60), async (req: Request, res: Response) => {
  try {
    const token = req.params.session_token;
    const session = getMobileSession(token);
    if (!session || !session.active) {
      res.status(404).json({ detail: 'Invalid or expired tracking session' });
      return;
    }
    if (!(await consumeRateLimit(`mobile-push:${token}`, 5, 5))) {
      res.status(429).json({ detail: 'Too many location updates' });
      return;
    }

    const vehicleId = session.vehicle_id;
    const lat = Number(req.body.lat ?? req.body.latitude);
    const lng = Number(req.body.lng ?? req.body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.status(400).json({ detail: 'Valid lat/lng are required' });
      return;
    }
    const speed = Number(req.body.speed) || 0;
    const heading = Number(req.body.heading) || 0;

    const telemetryData = {
      vehicle_id: vehicleId,
      latitude: lat,
      longitude: lng,
      speed_kmph: speed ? parseFloat((speed * 3.6).toFixed(1)) : 0, // m/s → km/h
      heading,
      accuracy: Number(req.body.accuracy) || null,
      source: 'phone_link' as const,
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
    sendError(req, res, e);
  }
});

// ── GET /mobile-session/:session_token ─────────────────────
router.get('/mobile-session/:session_token', rateLimitByIp('mobile-session-lookup', 60, 60), (req: Request, res: Response) => {
  const session = getMobileSession(req.params.session_token);
  if (!session) {
    res.status(404).json({ detail: 'Session not found' });
    return;
  }
  res.json({ vehicle_id: session.vehicle_id, plate: session.plate, active: session.active });
});

const MAX_PINGS_PER_REQUEST = 200;
const PING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PING_MAX_FUTURE_MS = 5 * 60 * 1000;

/** The time a ping was taken, or now when it is missing, unreadable, from the future or older than a week. */
function pingTimestamp(value: unknown): string {
  const now = Date.now();
  const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(parsed) || parsed > now + PING_MAX_FUTURE_MS || parsed < now - PING_MAX_AGE_MS) return new Date(now).toISOString();
  return new Date(parsed).toISOString();
}

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
      .select('id, plate_number, status, current_load_kg, latitude, longitude, last_heartbeat, odometer_km')
      .eq('driver_id', driverId)
      .single();

    if (!vehicle) {
      res.status(404).json({ detail: 'No vehicle assigned to this driver' });
      return;
    }

    // Support batch pings (offline queue replay)
    const pings = Array.isArray(req.body.pings) ? req.body.pings : [req.body];
    if (pings.length > MAX_PINGS_PER_REQUEST) {
      res.status(400).json({ detail: `Send at most ${MAX_PINGS_PER_REQUEST} location points at a time` });
      return;
    }

    let processedCount = 0;
    let latestLat = 0;
    let latestLng = 0;
    let latestSpeed = 0;
    let latestFuelPct: number | null = null;
    let geofenceAlert: any = null;
    const drivenPoints: PingPoint[] = [];
    const fixes: GpsFix[] = [];

    for (const ping of pings) {
      const lat = Number(ping?.lat ?? ping?.latitude);
      const lng = Number(ping?.lng ?? ping?.longitude);
      const speed = Number(ping?.speed) || 0;
      const heading = Number(ping?.heading) || 0;
      const accuracy = ping?.accuracy == null ? null : Number(ping.accuracy) || null;
      const timestamp = pingTimestamp(ping?.timestamp);

      // Skip points that are not real positions (missing, out of range, or 0,0)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
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

      fixes.push({ latitude: lat, longitude: lng, recorded_at: timestamp, accuracy, speed_kmph: parseFloat(speedKmph.toFixed(1)), heading });

      latestLat = lat;
      latestLng = lng;
      latestSpeed = speedKmph;
      if (ping.fuel_level_pct != null && Number.isFinite(Number(ping.fuel_level_pct))) latestFuelPct = Number(ping.fuel_level_pct);
      drivenPoints.push({ lat, lng, at: timestamp });
      processedCount++;
    }

    if (processedCount > 0) {
      // Track history: every ping of the batch goes to gps_points (throttled)
      await recordGpsPoints(vehicle.id, fixes, 'driver_app');

      // Odometer: real distance from the last known position through every ping in this batch
      const start = vehicle.latitude != null && vehicle.longitude != null
        ? { lat: vehicle.latitude, lng: vehicle.longitude, at: vehicle.last_heartbeat }
        : null;
      const drivenKm = pathKm(start, [...drivenPoints].sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!)));

      // Update vehicle live position
      await supabase.from('vehicles').update({
        latitude: latestLat,
        longitude: latestLng,
        last_heartbeat: new Date().toISOString(),
        ...(drivenKm > 0 ? {
          odometer_km: Math.round(((Number(vehicle.odometer_km) || 0) + drivenKm) * 1000) / 1000,
          odometer_updated_at: new Date().toISOString(),
        } : {}),
        // The status follows the vehicle's work (an active route or a load on board); maintenance,
        // archived and a break are left as they are
        status: await operatingStatusFor(vehicle.id, String(vehicle.status)),
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

      // ── Alarm rules (overspeed against the limit in system_settings) ──
      await evaluatePing({ id: vehicle.id, plate_number: vehicle.plate_number }, { speedKmph: latestSpeed, fuelPct: latestFuelPct });
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
      .in('status', ['active', 'pending'])
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
      geofence_alert: geofenceAlert,
      pending_commands: pendingCommands,
      server_time: new Date().toISOString(),
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /driver-ping/break — Driver takes a break ──
router.post('/driver-ping/break', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can take a break' });
      return;
    }

    const isBreak = req.body?.is_break;
    if (typeof isBreak !== 'boolean') {
      res.status(400).json({ detail: 'is_break must be true or false' });
      return;
    }

    // Find the vehicle assigned to this driver
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, status')
      .eq('driver_id', req.user!.user_id)
      .maybeSingle();

    // A vehicle in maintenance or archived stays that way; only staff change those. Coming back
    // from a break, the vehicle is on route only if it has work; otherwise it is available.
    if (vehicle) {
      const next = isBreak ? 'idle' : await operatingStatusFor(vehicle.id, String(vehicle.status), { resume: true });
      if (next === 'idle' || next === 'on_route' || next === 'available') await setOperatingVehicleStatus(vehicle.id, next);
    }

    res.json({ success: true });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

/** The consignments a route carries: its shipments (through its stops), or the vendor load itself. */
async function routeConsignments(routeId: string): Promise<({ shipment_id: string } | { manifest_id: string })[]> {
  const { data: manifest } = await supabase.from('cargo_manifest').select('id').eq('id', routeId).maybeSingle();
  if (manifest) return [{ manifest_id: manifest.id }];
  const { data: stops } = await supabase.from('route_stops').select('delivery_point_id').eq('route_id', routeId);
  const pointIds = [...new Set((stops ?? []).map((s: any) => s.delivery_point_id).filter(Boolean))];
  if (pointIds.length === 0) return [];
  const { data: points } = await supabase.from('delivery_points').select('shipment_id').in('id', pointIds);
  return [...new Set((points ?? []).map((p: any) => p.shipment_id).filter(Boolean))].map(id => ({ shipment_id: id as string }));
}

// ── POST /driver-ping/accept-route — the driver accepts a job ──
// The server record of acceptance: an `accepted` custody event for each consignment on the route
// (once per driver and consignment, so a resend from the offline queue records nothing new).
router.post('/driver-ping/accept-route', requireAuth, idempotent('accept-route'), async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers accept routes' });
      return;
    }
    const { route_id } = req.body ?? {};
    if (typeof route_id !== 'string' || !route_id) {
      res.status(400).json({ detail: 'route_id is required' });
      return;
    }
    if (!(await canAccessRoute(req.user!, route_id))) {
      res.status(403).json({ detail: 'Not authorized for this route' });
      return;
    }
    const actor = { id: req.user!.user_id, role: req.user!.role };
    let accepted = 0;
    for (const ref of await routeConsignments(route_id)) {
      const c = await resolveRef(ref);
      if (['delivered', 'returned', 'lost', 'cancelled', 'completed'].includes(c.rawStatus)) continue;
      const column = c.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
      const { data: already } = await supabase
        .from('cargo_custody_events').select('id').eq(column, c.id).eq('kind', 'accepted').eq('driver_id', actor.id).limit(1);
      if (already && already.length > 0) continue;
      await recordCustody(c, { kind: 'accepted', notes: `Accepted route ${route_id}` }, actor, { via: 'accept_route' });
      accepted++;
    }
    res.json({ route_id, accepted });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /driver-ping/start-route — Driver starts journey ──
router.post('/driver-ping/start-route', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can start routes' });
      return;
    }

    const { route_id } = req.body ?? {};
    if (typeof route_id !== 'string' || !route_id) {
      res.status(400).json({ detail: 'route_id is required' });
      return;
    }
    if (!(await canAccessRoute(req.user!, route_id))) {
      res.status(403).json({ detail: 'Not authorized for this route' });
      return;
    }

    // A vendor load is not moved by starting the journey: the driver sets off for the pickup, and the
    // load goes in transit when the pickup is completed. A load that is finished or cancelled cannot be started.
    const { data: manifest } = await supabase.from('cargo_manifest').select('id, status, vehicle_id').eq('id', route_id).maybeSingle();
    if (manifest) {
      if (!(OPEN_MANIFEST_STATUSES as readonly string[]).includes(manifest.status)) {
        assertTransition(CARGO_MANIFEST_TRANSITIONS, 'load', manifest.status, 'in_transit');
      }
      await setOperatingVehicleStatus(manifest.vehicle_id, 'on_route');
    } else {
      await routeService.changeStatus(route_id, 'active');
    }

    // Goods already on board set off with the route: they are in transit from here
    const actor = { id: req.user!.user_id, role: req.user!.role };
    for (const ref of await routeConsignments(route_id)) {
      try {
        const c = await resolveRef(ref);
        if (c.kind === 'shipment' && c.holder === 'vehicle' && c.status === 'picked_up') {
          await recordCustody(c, { kind: 'departed', notes: 'Route started' }, actor, { via: 'start_route' });
        }
      } catch (e) {
        console.error(`[telemetry] Departure of ${JSON.stringify(ref)} was not recorded:`, e);
      }
    }

    res.json({ success: true, status: 'active' });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /driver-ping/complete-stop — Driver marks delivery complete ──
const MAX_SIGNATURE_CHARS = 400_000;

/**
 * The last stop of a route is done: the route completes through the same path staff use, which frees
 * the vehicle only if it has no other active route or load. A route the driver never started is
 * started first, so it goes pending, active, completed like any other.
 */
async function completeRouteAfterLastStop(routeId: string): Promise<void> {
  const { data: route } = await supabase.from('routes').select('status').eq('id', routeId).maybeSingle();
  if (!route || !['pending', 'active'].includes(route.status)) return;
  if (route.status === 'pending') {
    try {
      await routeService.changeStatus(routeId, 'active');
    } catch {
      // e.g. the vehicle went into maintenance after an SOS: the delivery still counts
      const now = new Date().toISOString();
      await supabase.from('routes').update({ status: 'active', started_at: now, updated_at: now }).eq('id', routeId).eq('status', 'pending');
    }
  }
  await routeService.changeStatus(routeId, 'completed');
}

/** The message a driver sees for a delivery dispatch has cancelled. */
const CANCELLED_BY_DISPATCH = 'This delivery was cancelled by dispatch.';

/**
 * What a completed or failed stop means for the goods. The older request shape (status
 * completed or failed) still works; the delivery sheet adds `outcome` and the counts.
 */
const STOP_OUTCOMES = ['delivered', 'delivered_with_remarks', 'partial', 'refused', 'not_delivered'] as const;
type StopOutcome = typeof STOP_OUTCOMES[number];

function outcomeKind(outcome: StopOutcome | undefined, status: 'completed' | 'failed'): 'delivery' | 'partial_delivery' | 'refused' | 'undelivered' {
  if (outcome === 'partial') return 'partial_delivery';
  if (outcome === 'refused') return 'refused';
  if (outcome === 'not_delivered') return 'undelivered';
  if (outcome === 'delivered' || outcome === 'delivered_with_remarks') return 'delivery';
  return status === 'completed' ? 'delivery' : 'undelivered';
}

/** A whole number from the body, or undefined; a 400 for anything else. */
function optionalCount(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100_000) throw new HttpError(400, `${label} must be a whole number`);
  return value;
}

router.post('/driver-ping/complete-stop', requireAuth, idempotent('complete-stop'), async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can complete stops' });
      return;
    }

    const { stop_id, photo_url, signature_url, signature_data, received_by } = req.body ?? {};
    const outcome = req.body?.outcome as StopOutcome | undefined;
    if (outcome !== undefined && !(STOP_OUTCOMES as readonly string[]).includes(outcome)) {
      res.status(400).json({ detail: `outcome must be one of: ${STOP_OUTCOMES.join(', ')}` });
      return;
    }
    // The outcome decides the stop's status when it is given; otherwise the older `status` field does
    const status: 'completed' | 'failed' = outcome
      ? (outcome === 'refused' || outcome === 'not_delivered' ? 'failed' : 'completed')
      : (req.body?.status ?? 'completed');
    if (typeof stop_id !== 'string' || !stop_id) {
      res.status(400).json({ detail: 'stop_id is required' });
      return;
    }
    if (status !== 'completed' && status !== 'failed') {
      res.status(400).json({ detail: 'status must be completed or failed' });
      return;
    }
    if (received_by !== undefined && received_by !== null && (typeof received_by !== 'string' || received_by.length > 200)) {
      res.status(400).json({ detail: 'received_by must be a name of up to 200 characters' });
      return;
    }
    if (signature_data !== undefined && signature_data !== null && (typeof signature_data !== 'string' || signature_data.length > MAX_SIGNATURE_CHARS)) {
      res.status(400).json({ detail: 'The signature is too large' });
      return;
    }
    // Proof-of-delivery files must be ones this stop's signed upload URLs produced
    const photoPaths: string[] = Array.isArray(req.body?.photo_paths) ? req.body.photo_paths : [];
    if (photoPaths.length > 10) {
      res.status(400).json({ detail: 'At most 10 photos' });
      return;
    }
    for (const [field, value] of [['photo_url', photo_url], ['signature_url', signature_url], ...photoPaths.map(p => ['photo_paths', p] as const)] as const) {
      if (value != null && !isPodPathFor(value, stop_id)) {
        res.status(400).json({ detail: `${field} is not an upload for this stop` });
        return;
      }
    }
    const allPhotos = [...(photo_url ? [photo_url as string] : []), ...photoPaths.filter(p => p !== photo_url)];
    const lat = parseCoordinate(req.body?.lat, 'lat', 90) ?? undefined;
    const lng = parseCoordinate(req.body?.lng, 'lng', 180) ?? undefined;
    // Why a stop failed, kept in the custody record and the shipment's tamper-evident log
    const { reason, note } = req.body;
    if (reason !== undefined && !(DELIVERY_FAILURE_REASONS as readonly string[]).includes(reason)) {
      res.status(400).json({ detail: 'Unknown reason' });
      return;
    }
    const condition = req.body?.condition ?? null;
    if (condition !== null && !(CONDITIONS as readonly string[]).includes(condition)) {
      res.status(400).json({ detail: `condition must be one of: ${CONDITIONS.join(', ')}` });
      return;
    }
    if (outcome === 'delivered_with_remarks' && (!condition || condition === 'good')) {
      res.status(400).json({ detail: 'Choose the condition of the goods for a delivery with remarks' });
      return;
    }
    const pieces = optionalCount(req.body?.pieces, 'pieces');
    const piecesRefused = optionalCount(req.body?.pieces_refused, 'pieces_refused');
    const piecesShort = optionalCount(req.body?.pieces_short, 'pieces_short');
    const piecesDamaged = optionalCount(req.body?.pieces_damaged, 'pieces_damaged');
    const otp = typeof req.body?.otp === 'string' ? req.body.otp : null;
    const noteText = typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : null;
    const kind = outcomeKind(outcome, status);
    const actor = { id: req.user!.user_id, role: req.user!.role };
    const custodyInput: CustodyInput = {
      kind,
      pieces: pieces ?? null,
      pieces_refused: piecesRefused ?? null,
      pieces_short: piecesShort ?? null,
      pieces_damaged: piecesDamaged ?? null,
      condition,
      otp,
      photo_paths: status === 'completed' ? allPhotos : [],
      signature_path: status === 'completed' ? signature_url ?? null : null,
      receiver_name: received_by || null,
      reason: kind === 'refused' || kind === 'undelivered' ? (reason ?? 'other') : (reason ?? null),
      notes: noteText,
      lat: lat ?? null,
      lng: lng ?? null,
    };
    // The driver app's older shape (no outcome) keeps its evidence rules
    const legacyEvidence = outcome === undefined;

    // Check for cargo manifest stops
    if (stop_id.endsWith('_pickup') || stop_id.endsWith('_drop')) {
      const manifestId = stop_id.replace('_pickup', '').replace('_drop', '');
      const isPickup = stop_id.endsWith('_pickup');
      if (!(await canAccessManifest(req.user!, manifestId))) {
        res.status(403).json({ detail: 'Not authorized for this stop' });
        return;
      }

      const { data: manifest } = await supabase.from('cargo_manifest').select('*').eq('id', manifestId).single();
      if (!manifest) { res.status(404).json({ detail: 'Manifest not found' }); return; }

      if (status === 'failed') {
        // A failed drop is an undelivered attempt: the load goes to exception and its case tells the vendor
        if (!isPickup && ['in_transit', 'exception'].includes(manifest.status)) {
          await recordCustody({ manifest_id: manifestId }, custodyInput, actor, { via: 'complete_stop', stopId: stop_id });
        }
        await notificationService.notifyStaff(
          'Driver could not complete a stop',
          `A driver could not complete the ${isPickup ? 'pickup' : 'drop'} of a vendor load${reason ? ` (${String(reason).replace(/_/g, ' ')})` : ''}.`,
          'stop_failed',
          { manifest_id: manifestId, driver_id: req.user!.user_id },
        ).catch(e => console.error('[telemetry] failed-stop notification failed:', e));
        res.json({ status: 'failed', stop_id, route_id: manifestId, remaining_stops: 1, route_completed: false });
        return;
      }

      if (manifest.status === 'cancelled') throw new HttpError(409, CANCELLED_BY_DISPATCH);

      const target = isPickup ? 'in_transit' : 'delivered';
      // Pickup comes first and each step happens once: a repeat of the step already recorded
      // succeeds without billing or moving load again.
      let firstTime = false;
      if (manifest.status !== target) {
        if (!isPickup && manifest.status === 'scheduled') throw new HttpError(409, 'Complete the pickup before the drop.');
        const result = await recordCustody(
          { manifest_id: manifestId },
          isPickup ? { kind: 'pickup', pieces: pieces ?? null, condition, seal_number: req.body?.seal_number ?? null, lat: lat ?? null, lng: lng ?? null, notes: noteText } : custodyInput,
          actor,
          { via: 'complete_stop', stopId: stop_id, legacyEvidence },
        );
        firstTime = !result.already;
      }

      if (firstTime) {
        // Broadcast completion
        await wsManager.broadcast({
          type: 'STOP_COMPLETED',
          data: { stop_id, route_id: manifestId, completed_by: req.user!.user_id },
        });
      }

      // What is left for this vehicle: each load still to be delivered has a drop, and one still waiting has a pickup
      let remaining = 0;
      if (manifest.vehicle_id) {
        const { data: open } = await supabase
          .from('cargo_manifest').select('id, status').eq('vehicle_id', manifest.vehicle_id).in('status', [...OPEN_MANIFEST_STATUSES]);
        remaining = (open ?? []).reduce((n: number, m: any) => n + (m.status === 'scheduled' ? 2 : 1), 0);
      }

      res.json({
        status: 'completed',
        stop_id,
        route_id: manifestId,
        remaining_stops: remaining,
        route_completed: remaining === 0,
      });
      return;
    }

    // Ownership is checked before anything is written
    if (!(await canAccessRouteStop(req.user!, stop_id))) {
      res.status(403).json({ detail: 'Not authorized for this stop' });
      return;
    }

    const { data: current, error: currentErr } = await supabase
      .from('route_stops')
      .select('id, status, route_id, delivery_point_id, routes(status, vehicle_id)')
      .eq('id', stop_id)
      .maybeSingle();
    if (currentErr) throw currentErr;
    if (!current) {
      res.status(404).json({ detail: 'Stop not found' });
      return;
    }
    const routeRaw = current.routes as { status?: string; vehicle_id?: string } | { status?: string; vehicle_id?: string }[] | null | undefined;
    const routeInfo = Array.isArray(routeRaw) ? routeRaw[0] : routeRaw;
    const routeStatus = routeInfo?.status;
    if (routeStatus && !['pending', 'active'].includes(routeStatus)) {
      throw new HttpError(409, `This route is ${routeStatus.replace('_', ' ')}, so its stops can't be changed.`);
    }
    // Dispatch may have cancelled this delivery: nothing is recorded for it, and the stop is closed
    // so the route is not held open by a delivery that will never happen
    if (current.status === 'cancelled') throw new HttpError(409, CANCELLED_BY_DISPATCH);
    if (current.status === 'pending') {
      const { data: stopPoint } = await supabase.from('delivery_points').select('shipment_id').eq('id', current.delivery_point_id).maybeSingle();
      if (stopPoint?.shipment_id) {
        const { data: cancelledShipment } = await supabase
          .from('shipments').select('status').eq('id', stopPoint.shipment_id).maybeSingle();
        if (cancelledShipment?.status === 'cancelled') {
          await supabase.from('route_stops').update({ status: 'cancelled' }).eq('id', stop_id).eq('status', 'pending');
          const { data: stillPending } = await supabase.from('route_stops').select('id').eq('route_id', current.route_id).eq('status', 'pending');
          if (!stillPending || stillPending.length === 0) await completeRouteAfterLastStop(current.route_id);
          throw new HttpError(409, CANCELLED_BY_DISPATCH);
        }
      }
    }
    // A stop is decided once: a repeat of the same answer succeeds without changing anything
    const repeat = current.status === status;
    if (!repeat && current.status !== 'pending') {
      throw new HttpError(409, `This stop is already ${current.status}.`);
    }

    // If this delivery point is linked to a shipment, the goods are settled first (custody), so a
    // delivery the rules refuse (a wrong OTP, a piece mismatch) leaves the stop untouched
    const { data: dp } = await supabase
      .from('delivery_points')
      .select('shipment_id')
      .eq('id', current.delivery_point_id)
      .single();

    if (!repeat && dp?.shipment_id) {
      const parcelVerified = status === 'completed' ? await wasDeliveryScanned(dp.shipment_id, req.user!.user_id, stop_id) : undefined;
      const { data: goods } = await supabase.from('shipments').select('status').eq('id', dp.shipment_id).maybeSingle();
      // Completing the return stop of goods being returned is the return delivery
      const input: CustodyInput = goods?.status === 'returning' && status === 'completed'
        ? { kind: 'return_delivery', pieces: pieces ?? null, receiver_name: received_by || null, photo_paths: allPhotos, signature_path: signature_url ?? null, lat: lat ?? null, lng: lng ?? null, notes: noteText }
        : custodyInput;
      try {
        await recordCustody({ shipment_id: dp.shipment_id }, input, actor, {
          via: 'complete_stop',
          stopId: stop_id,
          impliedPickup: true,
          legacyEvidence,
          logMetadata: {
            ...(parcelVerified !== undefined ? { parcel_verified: parcelVerified } : {}),
            ...(status === 'failed' && reason ? { failure_reason: reason } : {}),
            ...(status === 'failed' && noteText ? { failure_note: noteText } : {}),
            ...(status === 'completed' && signature_data ? { signature_captured: true } : {}),
          },
        });
        if (status === 'completed' && typeof signature_data === 'string' && signature_data) {
          await supabase.from('shipments').update({ signature_data }).eq('id', dp.shipment_id);
        }
      } catch (e) {
        // The shipment was already settled another way (for example proof of delivery by
        // dispatch); the stop itself is still recorded.
        const settled = ['delivered', 'cancelled', 'returned', 'lost'].includes(String(goods?.status));
        if (!(e instanceof HttpError && e.status === 409 && settled)) throw e;
      }
    }

    // Update route stop status, only while it is still pending
    let stop: { route_id: string; delivery_point_id: string } = current;
    if (!repeat) {
      const { data: claimed, error: stopErr } = await supabase
        .from('route_stops')
        .update({
          status, // 'completed' or 'failed'
          ...(status === 'completed' ? { actual_arrival_at: new Date().toISOString() } : {}),
          ...(status === 'completed' && allPhotos[0] ? { photo_url: allPhotos[0] } : {}),
          ...(status === 'completed' && signature_url ? { signature_url } : {}),
        })
        .eq('id', stop_id)
        .eq('status', 'pending')
        .select('route_id, delivery_point_id')
        .maybeSingle();
      if (stopErr) throw stopErr;
      if (!claimed) throw new HttpError(409, 'This stop was just changed by someone else. Refresh and try again.');
      stop = claimed;
    }

    // Check if all stops on this route are now completed or failed
    const { data: remainingStops } = await supabase
      .from('route_stops')
      .select('id')
      .eq('route_id', stop.route_id)
      .eq('status', 'pending');

    if (!remainingStops || remainingStops.length === 0) {
      // All stops done: the route completes through the shared status path
      if (!repeat) await completeRouteAfterLastStop(stop.route_id);
    } else if (!repeat && status === 'completed' && dp?.shipment_id && routeInfo?.vehicle_id) {
      // A delivery takes its goods off the truck (a failed or refused one stays on it)
      const { data: shipment } = await supabase.from('shipments').select('total_weight_kg, pieces_total, pieces_delivered').eq('id', dp.shipment_id).maybeSingle();
      const weight = Number(shipment?.total_weight_kg) || 0;
      const share = kind === 'partial_delivery' && Number(shipment?.pieces_total) > 0 ? (Number(shipment?.pieces_delivered) || 0) / Number(shipment!.pieces_total) : 1;
      await releaseVehicleLoad(routeInfo.vehicle_id, Math.round(weight * share * 100) / 100);
    }

    // Tell dispatch a delivery failed, with what they need to follow it up
    if (!repeat && status === 'failed') {
      await notificationService.notifyStaff(
        'Driver could not complete a stop',
        `A driver could not complete a delivery${reason ? ` (${String(reason).replace(/_/g, ' ')})` : ''}.`,
        'stop_failed',
        { route_id: stop.route_id, shipment_id: dp?.shipment_id ?? null },
      ).catch(e => console.error('[telemetry] failed-stop notification failed:', e));
    }

    // Broadcast completion to dashboard
    if (!repeat) {
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
    }

    res.json({
      status,
      stop_id,
      route_id: stop.route_id,
      remaining_stops: remainingStops?.length || 0,
      route_completed: !remainingStops || remainingStops.length === 0,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /driver-ping/my-status — what else blocks or waits behind the current trip ──
router.get('/driver-ping/my-status', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can fetch their status' });
      return;
    }
    res.json(await loadDriverStatus(req.user!.user_id));
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /driver-ping/my-route — Driver fetches their current active route ──
router.get('/driver-ping/my-route', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers can fetch their route' });
      return;
    }

    // Find driver's vehicle
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, status')
      .eq('driver_id', req.user!.user_id)
      .maybeSingle();

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
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error(`[my-route] Query result error:`, error.message, `route id:`, (route as any)?.id);
    }

    // Stale: if route exists but has 0 stops, ignore it and fall through to manifest.
    // (Deletion is a side effect that must not happen on a GET; a write path should clean these up.)
    const hasStops = route && (route.route_stops || []).length > 0;
    if (error || !route || !hasStops) {
      // Vendor loads instead: every open one for this vehicle, in the order to drive them
      const { data: openLoads } = await supabase
        .from('cargo_manifest')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .in('status', [...OPEN_MANIFEST_STATUSES])
        .order('created_at', { ascending: true });
      const manifests = (openLoads ?? []).sort((x: any, y: any) => {
        // A load already on the truck is delivered first; then the waiting ones, oldest first
        const rank = (m: any) => (m.status === 'in_transit' ? 0 : 1);
        return rank(x) - rank(y) || Date.parse(x.created_at ?? '') - Date.parse(y.created_at ?? '');
      });
      const manifest = manifests[0];

      if (!manifest) {
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

      // The loads become one route of pickup and drop stops. The journey counts as started once
      // the driver has set off (the vehicle is on route) or a load is already on the truck.
      const journeyStarted = vehicle.status === 'on_route' || manifests.some((m: any) => m.status === 'in_transit');
      const manifestStops = manifests.flatMap((m: any, i: number) => manifestRouteStops(m, i * 2 + 1).map(st => ({
        id: st.id,
        sequence: st.sequence,
        status: st.status,
        delivery_point: st.delivery_points,
        parcel: {
          kind: 'manifest',
          // A load lot's code is its master's with the label (CM-XXXXXXXX-B), as printed on the parcel
          code: codeOf('manifest', m),
          status: m.status,
          purpose: st.id.endsWith('_pickup') ? 'pickup' : 'delivery',
        },
      })));
      const doneStops = manifestStops.filter(st => st.status === 'completed').length;

      res.json({
        active: true,
        is_manifest: true,
        route: {
          id: manifest.id,
          manifest_ids: manifests.map((m: any) => m.id),
          status: journeyStarted ? 'active' : 'pending',
          total_distance_km: 0,
          total_duration_minutes: 0,
          depot: null,
          stops: manifestStops,
          completed_stops: doneStops,
          remaining_stops: manifestStops.length - doneStops,
          progress_pct: Math.round((doneStops / manifestStops.length) * 100),
        },
      });
      return;
    }

    // Sort stops by sequence
    const shipmentParcels = await loadShipmentParcels(
      (route.route_stops || []).map((s: any) => s.delivery_points?.shipment_id).filter(Boolean),
    );
    const stops = (route.route_stops || [])
      // A delivery dispatch cancelled is no longer the driver's to make
      .filter((s: any) => s.status !== 'cancelled' && shipmentParcels.get(s.delivery_points?.shipment_id)?.status !== 'cancelled')
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
          // Lots (docs/cargo-plan.md): a drop made for one lot carries its pieces and its own consignee
          pieces: s.delivery_points.pieces ?? null,
          consignee_name: s.delivery_points.consignee_name ?? null,
          consignee_phone: s.delivery_points.consignee_phone ?? null,
          lot_shipment_id: s.delivery_points.lot_shipment_id ?? null,
        } : null,
        // The code on the parcel for this stop (its tracking ID), for scan checks in the app
        parcel: shipmentParcels.get(s.delivery_points?.shipment_id)
          ? { kind: 'shipment', code: shipmentParcels.get(s.delivery_points?.shipment_id)!.tracking_id, status: shipmentParcels.get(s.delivery_points?.shipment_id)!.status, purpose: 'delivery' }
          : null,
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
    sendError(req, res, e);
  }
});

export default router;
