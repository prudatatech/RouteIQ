/**
 * RouteIQ — Intelligence Engine
 * Ports: backend/app/services/intelligence_engine.py
 * 
 * Processes incoming telemetry to trigger:
 * - ETA updates (via Mapbox Directions API with haversine fallback)
 * - Geofence arrival alerts
 * - AI reroute suggestions
 */
import { wsManager } from '../core/websocket';
import { settings } from '../core/config';

export class IntelligenceEngine {
  /**
   * Haversine distance in km between two lat/lng points.
   */
  static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
  }

  /**
   * Calls Mapbox Directions API and returns [distance_km, eta_minutes] or [null, null].
   */
  static async getMapboxEta(
    lat1: number, lon1: number, lat2: number, lon2: number
  ): Promise<[number | null, number | null]> {
    const token = settings.MAPBOX_ACCESS_TOKEN;
    if (!token) return [null, null];

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lon1},${lat1};${lon2},${lat2}?access_token=${token}`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data: any = await resp.json();
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const distKm = (route.distance || 0) / 1000.0;
          const durationMins = (route.duration || 0) / 60.0;
          return [distKm, durationMins];
        }
      }
    } catch (e: any) {
      console.error(`Failed to fetch Mapbox ETA: ${e.message}`);
    }
    return [null, null];
  }

  /**
   * Processes incoming telemetry to trigger ETA updates and geofence alerts.
   */
  static async processTelemetry(vehicleId: string, lat: number, lng: number, speedKmph: number): Promise<void> {
    try {
      // Simulated Geofence check against a mock destination
      const targetLat = 28.61;
      const targetLng = 77.23;

      // Mapbox API ETA Calculation
      let [distKm, etaMins] = await IntelligenceEngine.getMapboxEta(lat, lng, targetLat, targetLng);

      if (distKm === null || etaMins === null) {
        // Fallback to straight-line
        distKm = IntelligenceEngine.calculateDistance(lat, lng, targetLat, targetLng);
        etaMins = distKm > 0.5 ? (distKm / 40.0) * 60 : 0;
      }

      // Geofence: If within 500m (0.5km), trigger Arrival Alert
      if (distKm < 0.5) {
        await wsManager.broadcast({
          type: 'GEOFENCE_ALERT',
          data: {
            vehicle_id: vehicleId,
            alert_type: 'ARRIVAL',
            message: 'Vehicle has entered the destination geofence.',
            distance_km: parseFloat(distKm.toFixed(2)),
          },
        });
      }

      // AI Reroute Agent: Detect heavy traffic and suggest reroute
      if (speedKmph < 20 && distKm > 5 && Math.random() > 0.8) {
        await wsManager.broadcast({
          type: 'AI_REROUTE_SUGGESTION',
          data: {
            vehicle_id: vehicleId,
            message: 'Heavy traffic detected ahead. Alternative route available saving 32 mins.',
            time_saved_mins: 32,
            new_eta_mins: Math.max(1, Math.round(etaMins - 32)),
          },
        });
      }

      // Periodically broadcast ETA update
      await wsManager.broadcast({
        type: 'ETA_UPDATE',
        data: {
          vehicle_id: vehicleId,
          eta_minutes: Math.round(etaMins),
          remaining_km: parseFloat(distKm.toFixed(1)),
        },
      });
    } catch (e: any) {
      console.error(`Error in intelligence engine: ${e.message}`);
    }
  }
}
