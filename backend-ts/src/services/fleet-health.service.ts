/**
 * margixindia — Fleet Health Monitor
 * Ports: backend/app/services/fleet_health.py
 */
import { supabase } from '../core/supabase';
import { wsManager } from '../core/websocket';
import { runAlertSweep } from './alerts.service';
import { getAlertThresholds } from './alert-settings.service';
import { isPlaceholderPlate, lastSeenMs } from '../core/vehicles';

export class FleetHealthMonitor {
  private timeoutSeconds: number;
  private running: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(timeoutSeconds: number = 120) {
    this.timeoutSeconds = timeoutSeconds;
  }

  start(): void {
    this.running = true;
    console.log(`Fleet Health Monitor started (Timeout: ${this.timeoutSeconds}s)`);
    this.timer = setInterval(() => this.checkFleetHealth(), 25_000); // 25s
    // GPS lost and long idle on active routes, against the limits in system_settings
    this.sweepTimer = setInterval(() => {
      runAlertSweep().catch(e => console.error(`Alarm sweep failed: ${e.message}`));
    }, 60_000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    console.log('Fleet Health Monitor stopped.');
  }

  /**
   * One pass of the heartbeat monitor.
   *
   * A vehicle that has not sent a heartbeat for `timeoutSeconds` goes offline,
   * except:
   *  - placeholder vehicles (TEMP-…, DRFT-…), which are not fleet assets;
   *  - a vehicle whose GPS provider synced recently (last_sync);
   *  - a vehicle on an active route that was last seen within the GPS-lost
   *    window (the alarm settings): a short signal gap on the road is not an
   *    outage. The GPS-lost alarm takes over once the window is exceeded.
   * An offline vehicle that reports again returns to service: on_route while it
   * has an active route, otherwise available.
   */
  async checkFleetHealth(nowMs: number = Date.now()): Promise<void> {
    try {
      const thresholdMs = nowMs - this.timeoutSeconds * 1000;
      const thresholdDate = new Date(thresholdMs).toISOString();

      const { data: activeRoutes } = await supabase.from('routes').select('vehicle_id').eq('status', 'active');
      const onActiveRoute = new Set((activeRoutes ?? []).map((r: any) => r.vehicle_id));

      const { data: staleVehicles } = await supabase
        .from('vehicles')
        .select('id, plate_number, status, cargo_types, last_heartbeat, last_sync, carrier_org_id')
        .in('status', ['available', 'on_route', 'idle'])
        .not('last_heartbeat', 'is', null)
        .lt('last_heartbeat', thresholdDate);

      for (const vehicle of staleVehicles ?? []) {
        if (isPlaceholderPlate(vehicle.plate_number)) continue;
        const seen = lastSeenMs(vehicle);
        if (seen != null && seen >= thresholdMs) continue; // the GPS provider synced recently
        const limits = await getAlertThresholds(vehicle.carrier_org_id ?? null); // the company's own GPS-lost window
        if (onActiveRoute.has(vehicle.id) && seen != null && nowMs - seen <= limits.gps_lost_minutes * 60_000) continue;

        const cargoTypes: string[] = vehicle.cargo_types || [];
        const isHighPriority = cargoTypes.some((ct: string) =>
          ['cold_chain', 'hazardous'].includes(ct)
        );

        console.warn(`Vehicle ${vehicle.plate_number} (${vehicle.id}) timed out. Status: ${vehicle.status}`);

        // Mark offline
        await supabase.from('vehicles').update({ status: 'offline' }).eq('id', vehicle.id);

        // Broadcast disconnect
        const msgType = isHighPriority ? 'ALERT_CRITICAL' : 'VEHICLE_OFFLINE';
        await wsManager.broadcast({
          type: msgType,
          data: {
            vehicle_id: vehicle.id,
            plate_number: vehicle.plate_number,
            cargo_types: vehicle.cargo_types,
            reason: 'heartbeat_timeout',
            severity: isHighPriority ? 'critical' : 'info',
            message: isHighPriority
              ? `CRITICAL: ${vehicle.plate_number} (${(vehicle.cargo_types || ['general']).join(', ')}) has disconnected!`
              : `${vehicle.plate_number} went offline.`,
          },
        }, vehicle.carrier_org_id);
      }

      // Offline vehicles that are reporting again come back per their route
      const { data: offlineVehicles } = await supabase
        .from('vehicles')
        .select('id, plate_number, last_heartbeat, last_sync')
        .eq('status', 'offline');
      for (const vehicle of offlineVehicles ?? []) {
        if (isPlaceholderPlate(vehicle.plate_number)) continue;
        const seen = lastSeenMs(vehicle);
        if (seen == null || seen < thresholdMs) continue;
        await supabase
          .from('vehicles')
          .update({ status: onActiveRoute.has(vehicle.id) ? 'on_route' : 'available' })
          .eq('id', vehicle.id)
          .eq('status', 'offline');
      }
    } catch (e: any) {
      console.error(`Error in fleet health check: ${e.message}`);
    }
  }
}

export const fleetHealthMonitor = new FleetHealthMonitor();
