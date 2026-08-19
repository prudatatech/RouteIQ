/**
 * margixindia — SparkGPS Service
 * Ports: backend/app/services/spark_gps_service.py
 * 
 * Handles integration with the SparkGPS (Roadcast) API.
 * Includes real-time telemetry sync and mock mode for demo.
 */
import { supabase } from '../core/supabase';
import { TelemetryService } from './telemetry.service';
import { settings } from '../core/config';

// Module-scoped token cache
let cachedToken: string = '';

export class SparkGPSService {
  /**
   * Polls SparkGPS API and updates internal telemetry.
   */
  static async fetchAndSync(): Promise<void> {
    // 1. Ensure we have a token
    let token = settings.SPARK_GPS_API_TOKEN || cachedToken;
    if (!token && settings.SPARK_GPS_USERNAME && settings.SPARK_GPS_PASSWORD) {
      token = (await SparkGPSService.getAccessToken()) || '';
    }

    if (!token) {
      console.warn('SparkGPS API Token or credentials missing. Falling back to mock sync.');
      await SparkGPSService.mockSyncForDemo();
      return;
    }

    try {
      // 1. Fetch from SparkGPS
      const externalData = await SparkGPSService.fetchFromApi(token);
      if (!externalData || externalData.length === 0) {
        console.log('No external data fetched from SparkGPS API.');
        return;
      }

      // 2. Get all margixindia vehicles to map by spark_id or plate number
      const { data: internalVehicles } = await supabase.from('vehicles').select('*');
      if (!internalVehicles) return;

      const sparkMap = new Map<string, any>();
      const plateMap = new Map<string, any>();
      for (const v of internalVehicles) {
        if (v.spark_id) sparkMap.set(v.spark_id, v);
        plateMap.set(v.plate_number.replace(/-/g, '').toUpperCase(), v);
      }

      // 3. Process and ingest
      let syncedCount = 0;
      const targetPlates = new Set(['HR38AC1276', 'HR38AC1658']);

      for (const item of externalData) {
        const deviceId = item.device_id || item.imei;
        const rawPlate = item.reg_no || '';
        const plate = rawPlate.replace(/-/g, '').toUpperCase();

        let vehicle: any = null;
        if (deviceId && sparkMap.has(deviceId)) {
          vehicle = sparkMap.get(deviceId);
        } else if (plateMap.has(plate)) {
          vehicle = plateMap.get(plate);
        }

        if (vehicle) {
          if (targetPlates.has(plate)) {
            console.log(`MATCH: Found hardware data for target vehicle ${rawPlate}`);
          }

          const telemetryData = {
            vehicle_id: vehicle.id,
            latitude: parseFloat(item.lat || '0'),
            longitude: parseFloat(item.lng || '0'),
            speed_kmph: parseFloat(item.speed || '0'),
            heading: parseFloat(item.heading || '0'),
            fuel_level_pct: parseFloat(item.fuel || '100'),
          };

          // Update vehicle state directly
          await supabase
            .from('vehicles')
            .update({
              latitude: telemetryData.latitude,
              longitude: telemetryData.longitude,
              last_sync: new Date().toISOString(),
              status: 'on_route',
            })
            .eq('id', vehicle.id);

          await TelemetryService.ingestTelemetry(telemetryData);
          syncedCount++;
        } else if (targetPlates.has(plate)) {
          console.warn(`MISS: Target plate ${rawPlate} found in API but no vehicle matched in database.`);
        }
      }

      if (syncedCount > 0) {
        console.log(`Successfully synced ${syncedCount} vehicles from SparkGPS.`);
      }
    } catch (e: any) {
      console.error(`Error syncing SparkGPS data: ${e.message}`);
    }
  }

  /**
   * Authenticates with SparkGPS using credentials to get a temporary token.
   */
  static async getAccessToken(): Promise<string | null> {
    const url = `${settings.SPARK_GPS_API_URL}/auth/login`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: settings.SPARK_GPS_USERNAME,
          password: settings.SPARK_GPS_PASSWORD,
        }),
      });

      if (response.ok) {
        const data: any = await response.json();
        const token = data.access_token || data.token;
        if (token) {
          cachedToken = token;
          return token;
        }
      }
      console.error(`SparkGPS Auth Failed: ${response.status}`);
    } catch (e: any) {
      console.error(`SparkGPS Auth Exception: ${e.message}`);
    }
    return null;
  }

  /**
   * Fetches live vehicle data from SparkGPS API.
   */
  static async fetchFromApi(token: string): Promise<any[]> {
    const url = `${settings.SPARK_GPS_API_URL}/vehicles/live`;
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data: any = await response.json();
        const rdata: any = data;
        return rdata.data || [];
      } else if (response.status === 401) {
        cachedToken = '';
        console.error('SparkGPS API Unauthorized. Clearing token for refresh.');
      } else {
        console.error(`SparkGPS API Error: ${response.status}`);
      }
    } catch (e: any) {
      console.error(`HTTP Request to SparkGPS failed: ${e.message}`);
    }
    return [];
  }

  /**
   * Simulates SparkGPS data for local testing.
   * Moves vehicles towards their next pending stop on active routes.
   */
  static async mockSyncForDemo(): Promise<void> {
    // Fetch active routes with vehicle and stops
    const { data: activeRoutes } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .eq('status', 'active');

    if (!activeRoutes || activeRoutes.length === 0) {
      console.log('No active routes found for mock sync.');
      return;
    }

    for (const route of activeRoutes) {
      // 1. Get current location from latest telemetry
      const { data: telData } = await supabase
        .from('telemetry')
        .select('latitude, longitude')
        .eq('vehicle_id', route.vehicle_id)
        .order('timestamp', { ascending: false })
        .limit(1);

      const latestTele = telData?.[0];
      let currLat = latestTele?.latitude || route.vehicles?.latitude || 28.6139;
      let currLng = latestTele?.longitude || route.vehicles?.longitude || 77.2090;

      // 2. Find next pending stop
      const stops = (route.route_stops || []).sort((a: any, b: any) => a.sequence - b.sequence);
      const nextStop = stops.find((s: any) => s.status === 'pending');

      let newLat: number, newLng: number, speed: number;

      if (nextStop?.delivery_points) {
        const targetLat = nextStop.delivery_points.latitude;
        const targetLng = nextStop.delivery_points.longitude;

        // Move slightly towards target (0.1 * distance per tick, capped)
        const stepLat = (targetLat - currLat) * 0.1;
        const stepLng = (targetLng - currLng) * 0.1;
        const limit = 0.005;

        newLat = currLat + Math.max(-limit, Math.min(limit, stepLat));
        newLng = currLng + Math.max(-limit, Math.min(limit, stepLng));
        speed = 45.0 + Math.floor(Math.random() * 25);
      } else {
        // No next stop — idle
        newLat = currLat + (Math.random() - 0.5) * 0.0002;
        newLng = currLng + (Math.random() - 0.5) * 0.0002;
        speed = 0;
      }

      // 3. Update vehicle and ingest telemetry
      await supabase
        .from('vehicles')
        .update({
          latitude: newLat,
          longitude: newLng,
          last_sync: new Date().toISOString(),
        })
        .eq('id', route.vehicle_id);

      await TelemetryService.ingestTelemetry({
        vehicle_id: route.vehicle_id,
        latitude: newLat,
        longitude: newLng,
        speed_kmph: speed,
        heading: Math.random() * 360,
      });
    }

    console.log(`Mock sync complete for ${activeRoutes.length} active routes.`);
  }
}
