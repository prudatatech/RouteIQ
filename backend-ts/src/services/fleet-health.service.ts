/**
 * RouteIQ — Fleet Health Monitor
 * Ports: backend/app/services/fleet_health.py
 */
import { supabase } from '../core/supabase';
import { wsManager } from '../core/websocket';

export class FleetHealthMonitor {
  private timeoutMinutes: number;
  private running: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(timeoutMinutes: number = 2) {
    this.timeoutMinutes = timeoutMinutes;
  }

  start(): void {
    this.running = true;
    console.log(`Fleet Health Monitor started (Timeout: ${this.timeoutMinutes}m)`);
    this.timer = setInterval(() => this.checkFleetHealth(), 30_000); // 30s
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    console.log('Fleet Health Monitor stopped.');
  }

  private async checkFleetHealth(): Promise<void> {
    try {
      const thresholdDate = new Date(Date.now() - this.timeoutMinutes * 60 * 1000).toISOString();

      const { data: staleVehicles } = await supabase
        .from('vehicles')
        .select('*')
        .in('status', ['available', 'on_route', 'idle'])
        .not('last_heartbeat', 'is', null)
        .lt('last_heartbeat', thresholdDate);

      if (!staleVehicles || staleVehicles.length === 0) return;

      for (const vehicle of staleVehicles) {
        const cargoTypes: string[] = vehicle.cargo_types || [];
        const isHighPriority = cargoTypes.some((ct: string) =>
          ['cold_chain', 'hazardous'].includes(ct)
        );

        console.warn(`Vehicle ${vehicle.plate_number} (${vehicle.id}) timed out. Marking OFFLINE.`);

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
        });
      }
    } catch (e: any) {
      console.error(`Error in fleet health check: ${e.message}`);
    }
  }
}

export const fleetHealthMonitor = new FleetHealthMonitor();
