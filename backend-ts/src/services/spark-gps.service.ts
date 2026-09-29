/**
 * margixindia — SparkGPS Service
 * Ports: backend/app/services/spark_gps_service.py
 * 
 * Handles integration with the SparkGPS (Roadcast) API.
 * When credentials are not configured, sync is a no-op — nothing is
 * written to the database.
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
      console.warn('SparkGPS API Token or credentials missing. Sync skipped — nothing written.');
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

        if (vehicle && item.lat && item.lng) {
          const telemetryData = {
            vehicle_id: vehicle.id,
            latitude: parseFloat(item.lat || '0'),
            longitude: parseFloat(item.lng || '0'),
            speed_kmph: parseFloat(item.speed || '0'),
            heading: parseFloat(item.heading || '0'),
            fuel_level_pct: item.fuel != null && item.fuel !== '' && Number.isFinite(parseFloat(item.fuel)) ? parseFloat(item.fuel) : undefined,
          };

          // Update vehicle state. The position is written by ingestTelemetry below, which needs
          // the previous position to work out the distance driven.
          await supabase
            .from('vehicles')
            .update({
              last_sync: new Date().toISOString(),
              status: 'on_route',
            })
            .eq('id', vehicle.id);

          await TelemetryService.ingestTelemetry(telemetryData);
          syncedCount++;
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
}
