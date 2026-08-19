/**
 * margixindia — Telemetry Service
 * Ports: backend/app/services/telemetry_service.py
 */
import { supabase } from '../core/supabase';
import { cacheSet, cacheGet } from '../core/redis';
import { wsManager } from '../core/websocket';
import type { Telemetry } from '../db/types';
import { v4 as uuidv4 } from 'uuid';

export class TelemetryService {
  /**
   * Ingests a telemetry data point:
   * 1. Verify vehicle exists
   * 2. Insert telemetry record
   * 3. Update vehicle live position
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
  }): Promise<Telemetry> {
    const vehicleId = data.vehicle_id;

    // 1. Fetch vehicle
    const { data: vehicle, error: vErr } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    if (vErr || !vehicle) {
      throw new Error(`Vehicle ${vehicleId} not found`);
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

    // 3. Update vehicle live position and fuel
    const vehicleUpdate: Record<string, any> = {
      latitude: data.latitude,
      longitude: data.longitude,
      last_heartbeat: timestamp,
    };

    if (data.fuel_level_pct !== undefined && data.fuel_level_pct !== null) {
      const capacity = vehicle.fuel_capacity_liters || 60.0;
      vehicleUpdate.current_fuel_liters = (data.fuel_level_pct / 100) * capacity;
    }

    await supabase.from('vehicles').update(vehicleUpdate).eq('id', vehicleId);

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
    });

    // 6. Speed alert
    if ((data.speed_kmph || 0) > 85.0) {
      await wsManager.broadcast({
        type: 'ALERT_WARNING',
        title: 'High Speed Alert',
        message: `Vehicle ${vehicle.plate_number} exceeding safety limit: ${data.speed_kmph?.toFixed(1)} km/h`,
        payload: { vehicle_id: vehicleId, plate_number: vehicle.plate_number },
      });
    }

    return telemetry as Telemetry;
  }
}
