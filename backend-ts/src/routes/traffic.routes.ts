/**
 * margixindia — Traffic Simulation Routes
 * Ports: backend/app/api/v1/endpoints/traffic.py
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../core/auth';
import { cacheGet, cacheSet } from '../core/redis';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { v4 as uuidv4 } from 'uuid';
import { sendError } from '../core/errors';

const router = Router();

// ── POST /event — Create traffic event & trigger reroute ───
router.post('/event', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to simulate traffic events' });
      return;
    }

    const eventData = req.body;
    if (!eventData.lat || !eventData.lng) {
      res.status(400).json({ detail: 'Latitude and Longitude are required' });
      return;
    }

    // Process traffic event — find affected active routes near the event location
    const decisions: any[] = [];
    const eventLat = eventData.lat;
    const eventLng = eventData.lng;
    const radiusKm = eventData.radius_km || 2.0;
    const severity = eventData.severity || 0.5;
    const eventType = eventData.event_type || 'jam';

    // Haversine distance in km between two lat/lng points.
    const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };
    // Same driving-speed assumption used by the optimization service's
    // reoptimize fallback (backend-ts/src/routes/optimization.routes.ts).
    const AVG_SPEED_KMPH = 40;

    // Fetch active routes with vehicles and stops
    const { data: activeRoutes } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .eq('status', 'active');

    if (activeRoutes) {
      for (const route of activeRoutes) {
        // Check if vehicle is near the traffic event
        const vehicleLat = route.vehicles?.latitude || 0;
        const vehicleLng = route.vehicles?.longitude || 0;

        const dist = Math.sqrt(
          Math.pow((vehicleLat - eventLat) * 111, 2) +
          Math.pow((vehicleLng - eventLng) * 111 * Math.cos(vehicleLat * Math.PI / 180), 2)
        );

        if (dist <= radiusKm * 3) {
          // Vehicle is potentially affected
          const pendingStops = (route.route_stops || [])
            .filter((s: any) => s.status === 'pending')
            .sort((a: any, b: any) => a.sequence - b.sequence);

          if (pendingStops.length > 1 && vehicleLat && vehicleLng) {
            const stopCoord = (s: any) => {
              const dp = s.delivery_points || {};
              return { lat: dp.latitude ?? dp.lat ?? 0, lng: dp.longitude ?? dp.lng ?? 0 };
            };

            // Distance of the current (pre-event) stop order, starting from
            // the vehicle's live position.
            let originalKm = 0;
            {
              let curLat = vehicleLat, curLng = vehicleLng;
              for (const s of pendingStops) {
                const c = stopCoord(s);
                if (c.lat && c.lng) { originalKm += haversineKm(curLat, curLng, c.lat, c.lng); curLat = c.lat; curLng = c.lng; }
              }
            }

            // Real re-sequencing: greedy nearest-neighbour from the
            // vehicle's live position, same approach as the optimization
            // service's reoptimize fallback (read-only here — this only
            // proposes a suggestion, it does not write the new sequence).
            const unvisited = [...pendingStops];
            const newSequence: string[] = [];
            let optimizedKm = 0;
            let curLat = vehicleLat, curLng = vehicleLng;
            while (unvisited.length > 0) {
              let bestIdx = 0, bestDist = Infinity;
              for (let i = 0; i < unvisited.length; i++) {
                const c = stopCoord(unvisited[i]);
                if (!c.lat || !c.lng) continue;
                const d = haversineKm(curLat, curLng, c.lat, c.lng);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
              }
              const next = unvisited.splice(bestIdx, 1)[0];
              const c = stopCoord(next);
              if (c.lat && c.lng) { optimizedKm += bestDist === Infinity ? 0 : bestDist; curLat = c.lat; curLng = c.lng; }
              newSequence.push(next.delivery_point_id);
            }

            const savedKm = originalKm - optimizedKm;
            const savedMinutes = Math.round((savedKm / AVG_SPEED_KMPH) * 60);

            // Only surface a suggestion when the recomputed order is a real
            // improvement — no fabricated minimum savings.
            if (savedMinutes > 0) {
              decisions.push({
                vehicle_id: route.vehicle_id,
                route_id: route.id,
                trigger: `${eventType} detected at (${eventLat.toFixed(4)}, ${eventLng.toFixed(4)})`,
                saved_minutes: savedMinutes,
                new_stop_sequence: newSequence,
              });
            }
          }
        }
      }
    }

    // Store decisions in Redis for AI Hub
    if (decisions.length > 0) {
      const existing = (await cacheGet<any[]>('active_reroute_suggestions')) || [];
      const vehicleIds = new Set(decisions.map((d: any) => d.vehicle_id));
      const combined = [...decisions, ...existing.filter((s: any) => !vehicleIds.has(s.vehicle_id))];
      await cacheSet('active_reroute_suggestions', combined, 3600);
    }

    res.json({
      status: 'processed',
      event_type: eventType,
      reroute_suggestions_count: decisions.length,
      decisions: decisions.map((d: any) => ({
        vehicle_id: d.vehicle_id,
        saved_mins: d.saved_minutes,
        trigger: d.trigger,
      })),
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
