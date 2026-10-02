/**
 * margixindia — Telemetry Service
 * Ports: backend/app/services/telemetry_service.py
 */
import { supabase } from '../core/supabase';
import { cacheSet, cacheGet } from '../core/redis';
import { wsManager } from '../core/websocket';
import type { Telemetry } from '../db/types';
import { v4 as uuidv4 } from 'uuid';
import { HttpError } from '../core/errors';
import { segmentKm } from './odometer';
import { evaluatePing } from './alerts.service';
import { recordGpsPoints, type GpsSource } from './gps-history.service';

export class TelemetryService {
  /**
   * Ingests a telemetry data point:
   * 1. Verify vehicle exists
   * 2. Insert telemetry record
   * 3. Update vehicle live position and record it in the GPS history
   * 4. Cache in Redis
   * 5. Broadcast via WebSocket
   * 6. Trigger alerts
   */
  static async ingestTelemetry(data: {
    vehicle_id: string;
    latitude: number;
    longitude: number;
    speed_kmph?: number;
    heading?: number;
    fuel_level_pct?: number;
    timestamp?: string;
    /** GPS accuracy in metres, when the device reports it. */
    accuracy?: number | null;
    /** Where the position came from, kept on the gps_points row. */
    source?: GpsSource;
  }): Promise<Telemetry> {
    const vehicleId = data.vehicle_id;

    // 1. Fetch vehicle
    const { data: vehicle, error: vErr } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    if (vErr || !vehicle) {
      throw new HttpError(404, `Vehicle ${vehicleId} not found`);
    }

    const timestamp = data.timestamp || new Date().toISOString();

    // 2. Insert telemetry record
    const { data: telemetry, error: tErr } = await supabase
      .from('telemetry')
      .insert({
        id: uuidv4(),
        vehicle_id: vehicleId,
        latitude: data.latitude,
        longitude: data.longitude,
        speed_kmph: data.speed_kmph || 0,
        heading: data.heading || 0,
        fuel_level_pct: data.fuel_level_pct ?? null,
        timestamp,
      })
      .select()
      .single();

    if (tErr || !telemetry) {
      throw new Error(`Failed to insert telemetry: ${tErr?.message}`);
    }

    // 3. Update vehicle live position, odometer and fuel
    const vehicleUpdate: Record<string, any> = {
      latitude: data.latitude,
      longitude: data.longitude,
      last_heartbeat: timestamp,
    };

    // Odometer: real distance since the last known position
    if (vehicle.latitude != null && vehicle.longitude != null) {
      const km = segmentKm(
        { lat: vehicle.latitude, lng: vehicle.longitude, at: vehicle.last_heartbeat },
        { lat: data.latitude, lng: data.longitude, at: timestamp },
      );
      if (km > 0) {
        vehicleUpdate.odometer_km = Math.round(((Number(vehicle.odometer_km) || 0) + km) * 1000) / 1000;
        vehicleUpdate.odometer_updated_at = timestamp;
      }
    }

    // Fuel: only when the device reported a level. The tank size is not guessed.
    if (data.fuel_level_pct !== undefined && data.fuel_level_pct !== null) {
      vehicleUpdate.fuel_level_pct = data.fuel_level_pct;
      vehicleUpdate.fuel_reported_at = timestamp;
      if (vehicle.fuel_capacity_liters) {
        vehicleUpdate.current_fuel_liters = (data.fuel_level_pct / 100) * vehicle.fuel_capacity_liters;
      }
    }

    await supabase.from('vehicles').update(vehicleUpdate).eq('id', vehicleId);

    // Track history: every accepted position also goes to gps_points (throttled)
    await recordGpsPoints(vehicleId, [{
      latitude: data.latitude,
      longitude: data.longitude,
      recorded_at: timestamp,
      accuracy: data.accuracy ?? null,
      speed_kmph: data.speed_kmph ?? null,
      heading: data.heading ?? null,
    }], data.source ?? 'telemetry');

    // 4. Cache latest position in Redis
    const liveData = {
      vehicle_id: vehicleId,
      lat: data.latitude,
      lng: data.longitude,
      speed: data.speed_kmph || 0,
      fuel: data.fuel_level_pct ?? null,
      timestamp,
    };

    await cacheSet(`vehicle:live:${vehicleId}`, liveData, 120);

    // 5. Broadcast to all dashboard clients
    await wsManager.broadcast({
      type: 'TELEMETRY_UPDATE',
      data: liveData,
    }, (vehicle as { carrier_org_id?: string | null }).carrier_org_id);

    // 6. Alarm rules (overspeed, low fuel) against the thresholds in system_settings
    await evaluatePing(
      { id: vehicleId, plate_number: vehicle.plate_number },
      { speedKmph: data.speed_kmph ?? null, fuelPct: data.fuel_level_pct ?? null },
    );

    return telemetry as Telemetry;
  }
}
