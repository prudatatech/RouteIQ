import { beforeEach, describe, expect, it } from 'vitest';
import { supabaseMock } from './support/mock-supabase';
import { matchingService } from '../src/services/matching.service';
import { FleetHealthMonitor } from '../src/services/fleet-health.service';
import { clearThresholdCache } from '../src/services/alert-settings.service';

const NOW = Date.parse('2026-09-29T10:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe('matching counts dispatchable vehicles', () => {
  beforeEach(() => {
    supabaseMock.reset({
      shipments: [{ id: 'ship-1', origin_lat: 28.6, origin_lng: 77.2, required_vehicle_type: 'truck', metadata: {} }],
      vehicles: [
        { id: 'a', plate_number: 'DL01AA0001', status: 'available', vehicle_type: 'truck', latitude: 28.61, longitude: 77.21 },
        { id: 'b', plate_number: 'DL01AA0002', status: 'offline', vehicle_type: 'truck', latitude: 28.62, longitude: 77.21 },
        { id: 'c', plate_number: 'DL01AA0003', status: 'maintenance', vehicle_type: 'truck', latitude: 28.61, longitude: 77.22 },
        { id: 'd', plate_number: 'TEMP-ABC123', status: 'idle', vehicle_type: 'truck', latitude: 28.61, longitude: 77.2 },
        { id: 'e', plate_number: 'DL01AA0005', status: 'archived', vehicle_type: 'truck', latitude: 28.61, longitude: 77.2 },
      ],
    });
  });

  it('counts available and offline trucks, not maintenance, archived or placeholder ones', async () => {
    const result: any = await matchingService.computeAvailabilityScore('ship-1');
    expect(result.count ?? result.available_count).toBe(2);
  });
});

describe('heartbeat monitor', () => {
  const monitor = new FleetHealthMonitor(120);
  const vehicle = (over: Record<string, unknown>) => ({
    id: 'v1', plate_number: 'DL01AA0001', status: 'on_route', cargo_types: [], last_heartbeat: ago(5), last_sync: null, ...over,
  });
  const reset = (vehicles: Record<string, unknown>[], routes: Record<string, unknown>[] = []) => {
    clearThresholdCache();
    supabaseMock.reset({ vehicles, routes, system_settings: [] });
  };
  const status = (id = 'v1') => supabaseMock.rows('vehicles').find(v => v.id === id)!.status;

  it('marks a silent vehicle offline', async () => {
    reset([vehicle({ status: 'idle' })]);
    await monitor.checkFleetHealth(NOW);
    expect(status()).toBe('offline');
  });

  it('keeps a vehicle on an active route while it is inside the GPS-lost window', async () => {
    reset([vehicle({})], [{ id: 'r1', vehicle_id: 'v1', status: 'active' }]);
    await monitor.checkFleetHealth(NOW);
    expect(status()).toBe('on_route');
  });

  it('marks it offline once the GPS-lost window has passed', async () => {
    reset([vehicle({ last_heartbeat: ago(40) })], [{ id: 'r1', vehicle_id: 'v1', status: 'active' }]);
    await monitor.checkFleetHealth(NOW);
    expect(status()).toBe('offline');
  });

  it('does not mark a vehicle offline when its GPS provider synced recently', async () => {
    reset([vehicle({ status: 'idle', last_sync: ago(1) })]);
    await monitor.checkFleetHealth(NOW);
    expect(status()).toBe('idle');
  });

  it('leaves placeholder vehicles alone', async () => {
    reset([vehicle({ plate_number: 'TEMP-ABC123', status: 'idle', last_heartbeat: ago(60) })]);
    await monitor.checkFleetHealth(NOW);
    expect(status()).toBe('idle');
  });

  it('brings a reporting offline vehicle back: on_route with an active route, else available', async () => {
    reset(
      [vehicle({ id: 'v1', status: 'offline', last_heartbeat: ago(0.5) }), vehicle({ id: 'v2', plate_number: 'DL01AA0002', status: 'offline', last_heartbeat: ago(0.5) })],
      [{ id: 'r1', vehicle_id: 'v1', status: 'active' }],
    );
    await monitor.checkFleetHealth(NOW);
    expect(status('v1')).toBe('on_route');
    expect(status('v2')).toBe('available');
  });
});
