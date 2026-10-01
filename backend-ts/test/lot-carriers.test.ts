import { beforeEach, describe, expect, it } from 'vitest';
import { supabaseMock } from './support/mock-supabase';
import { addLotCarriers } from '../src/services/lot-carriers';

describe('addLotCarriers: vehicle, driver and drop of a split master\'s lots', () => {
  beforeEach(() => {
    supabaseMock.reset({
      shipments: [{ id: 'lot-a', eway_bill_ref: '1234 5678 9012' }, { id: 'lot-b' }, { id: 'lot-c' }],
      delivery_points: [
        { id: 'dp-a', shipment_id: 'lot-a', name: 'Patna', created_at: '2026-09-01T10:00:00Z' },
        { id: 'dp-b', shipment_id: 'lot-b', name: null, address: 'Ranchi, Jharkhand', created_at: '2026-09-01T10:00:00Z' },
        { id: 'dp-c', shipment_id: 'lot-c', name: 'Gaya', created_at: '2026-09-01T10:00:00Z' },
      ],
      route_stops: [
        { id: 'rs-a', route_id: 'r-1', delivery_point_id: 'dp-a' },
        { id: 'rs-b', route_id: 'r-1', delivery_point_id: 'dp-b' },
        { id: 'rs-x', route_id: 'r-cancelled', delivery_point_id: 'dp-c' },
      ],
      routes: [
        { id: 'r-1', vehicle_id: 'veh-1', status: 'completed' },
        { id: 'r-cancelled', vehicle_id: 'veh-2', status: 'cancelled' },
      ],
      vehicles: [
        { id: 'veh-1', plate_number: 'JH10AL0303', driver_name: 'MUNNA' },
        { id: 'veh-2', plate_number: 'DL01AL0010', driver_name: 'Vishal' },
      ],
    });
  });

  it('reads a delivered lot\'s vehicle from its trip stop, and skips cancelled trips', async () => {
    const summary = { lots: [{ id: 'lot-a', current_vehicle_id: null }, { id: 'lot-b' }, { id: 'lot-c' }] as any[] };
    await addLotCarriers('shipment', [summary]);
    expect(summary.lots[0]).toMatchObject({ plate_number: 'JH10AL0303', driver_name: 'MUNNA', drop: 'Patna', eway_bill_ref: '1234 5678 9012' });
    expect(summary.lots[1]).toMatchObject({ plate_number: 'JH10AL0303', driver_name: 'MUNNA', drop: 'Ranchi, Jharkhand', eway_bill_ref: null });
    expect(summary.lots[2]).toMatchObject({ plate_number: null, driver_name: null, drop: 'Gaya' });
  });

  it('falls back to the lot\'s current vehicle', async () => {
    const summary = { lots: [{ id: 'lot-c', current_vehicle_id: 'veh-2' }] as any[] };
    await addLotCarriers('shipment', [summary]);
    expect(summary.lots[0]).toMatchObject({ plate_number: 'DL01AL0010', driver_name: 'Vishal' });
  });

  it('reads a vendor load\'s lots from the load itself', async () => {
    supabaseMock.rows('cargo_manifest').push({ id: 'm-1', vehicle_id: 'veh-1', drop_location: 'Kolkata' });
    const summary = { lots: [{ id: 'm-1' }] as any[] };
    await addLotCarriers('manifest', [summary]);
    expect(summary.lots[0]).toMatchObject({ plate_number: 'JH10AL0303', drop: 'Kolkata' });
  });
});
