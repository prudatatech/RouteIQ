/**
 * RouteIQ — Traffic Simulation Routes
 * Ports: backend/app/api/v1/endpoints/traffic.py
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../core/auth';
import { cacheGet, cacheSet } from '../core/redis';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { v4 as uuidv4 } from 'uuid';

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

          if (pendingStops.length > 1) {
            // Simulate a reroute: reverse the next two pending stops
            const savedMinutes = Math.round(5 + severity * 20 + Math.random() * 10);
            const newSequence = pendingStops.map((s: any) => s.delivery_point_id).reverse();

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
    res.status(500).json({ detail: e.message });
  }
});

export default router;
