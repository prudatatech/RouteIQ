/**
 * UAT role findings on public tracking: ROL-07 (a multi-drop booking names each lot's drop and truck
 * after delivery, and the drops) and ROL-12 (a cancelled booking's history has no partner step).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ID, NOW, cargoWorld, shipmentRow } from './support/cargo-world';

const app = testApp();
const track = (code: string) => request(app).get(`/api/v1/shipments/track/${code}`);
const MASTER = '51000000-0000-4000-8000-0000000000a0';
const LOT_A = '51000000-0000-4000-8000-0000000000a1';
const LOT_B = '51000000-0000-4000-8000-0000000000a2';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const lot = (id: string, label: string, seq: number) => shipmentRow(id, {
  tracking_id: `RTX-MULTI-${label}`, parent_shipment_id: MASTER, lot_label: label, lot_seq: seq, status: 'delivered', current_holder: 'consignee',
  current_vehicle_id: null, total_items: 5, pieces_total: 5, pieces_delivered: 5,
});

describe('public tracking of a delivered multi-drop booking (ROL-07)', () => {
  beforeEach(() => {
    const truck = (id: string) => ({ id, plate_number: id === ID.v1 ? 'MH12AB0001' : 'MH12AB0002', vehicle_type: 'truck', driver_name: 'Secret Driver' });
    supabaseMock.reset(cargoWorld({
      shipments: [
        { ...shipmentRow(MASTER, { tracking_id: 'RTX-MULTI', is_master: true, status: 'delivered', current_holder: 'consignee', current_vehicle_id: null, pieces_total: 10, pieces_delivered: 10 }), delivery_points: [] },
        lot(LOT_A, 'A', 1), lot(LOT_B, 'B', 2),
      ],
      delivery_points: [
        { id: 'dp-a', shipment_id: LOT_A, name: 'Patna store', address: 'Patna, Bihar', latitude: 25.6, longitude: 85.1, created_at: NOW },
        { id: 'dp-b', shipment_id: LOT_B, name: 'Ranchi store', address: 'Ranchi, Jharkhand', latitude: 23.3, longitude: 85.3, created_at: NOW },
      ],
      routes: [{ id: 'r-a', vehicle_id: ID.v1, status: 'completed' }, { id: 'r-b', vehicle_id: ID.v2, status: 'completed' }],
      route_stops: [
        { id: 'st-a', route_id: 'r-a', delivery_point_id: 'dp-a', sequence: 1, status: 'completed' },
        { id: 'st-b', route_id: 'r-b', delivery_point_id: 'dp-b', sequence: 1, status: 'completed' },
      ],
      vehicles: [{ ...truck(ID.v1), id: ID.v1, status: 'available' }, { ...truck(ID.v2), id: ID.v2, status: 'available' }],
      cargo_manifest: [],
    }));
  });

  it('gives the drops, and each lot its destination and carrier, without ids or driver names', async () => {
    const res = await track('RTX-MULTI');
    expect(res.status).toBe(200);
    expect(res.body.drops).toEqual([{ name: 'Patna store', address: 'Patna, Bihar' }, { name: 'Ranchi store', address: 'Ranchi, Jharkhand' }]);
    expect(res.body.destination).toMatchObject({ name: 'Ranchi store' });
    expect(res.body.lots).toEqual([
      expect.objectContaining({ tracking_id: 'RTX-MULTI-A', label: 'A', status: 'delivered', pieces_delivered: 5, destination: { name: 'Patna store', address: 'Patna, Bihar' }, vehicle: { plate_number: 'MH12AB0001', type: 'truck' } }),
      expect.objectContaining({ tracking_id: 'RTX-MULTI-B', destination: { name: 'Ranchi store', address: 'Ranchi, Jharkhand' }, vehicle: { plate_number: 'MH12AB0002', type: 'truck' } }),
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(UUID);
    expect(JSON.stringify(res.body)).not.toContain('Secret Driver');
  });
});

describe('the public history of a cancelled booking (ROL-12)', () => {
  const log = (index: number, status: string) => ({ id: `l${index}`, shipment_id: ID.s1, index, status, timestamp: new Date(Date.parse(NOW) + index * 1000).toISOString(), metadata_json: {} });

  it('leaves out the partner step', async () => {
    supabaseMock.reset(cargoWorld());
    const row = supabaseMock.rows('shipments').find(s => s.id === ID.s1)!;
    Object.assign(row, { status: 'cancelled', shipment_logs: [log(0, 'created'), log(1, 'escalated'), log(2, 'cancelled')], delivery_points: [] });
    const res = await track(row.tracking_id as string);
    expect(res.body.history.map((h: any) => h.status)).toEqual(['created', 'cancelled']);
  });
});
