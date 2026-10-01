/**
 * UAT-020: the public tracking answer carries the public tracking code only (no shipment or vehicle
 * UUID), keeps the plate, and shows the live position only while the goods are on the road.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ID, cargoWorld, manifestRow, one, shipmentRow } from './support/cargo-world';

const app = testApp();
const track = (code: string) => request(app).get(`/api/v1/shipments/track/${code}`);
const TRACKING = shipmentRow(ID.s1).tracking_id;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The truck joined to its route (and to a load) the way the database returns it. */
const world = (over: Record<string, any[]> = {}) => {
  const base = cargoWorld(over);
  const truck = () => base.vehicles.find(v => v.id === ID.v1)!;
  for (const stop of base.route_stops) stop.routes = { ...(stop.routes as object), id: ID.route1, vehicles: truck() };
  for (const sh of base.shipments) sh.delivery_points = base.delivery_points.filter(d => d.shipment_id === sh.id);
  for (const m of base.cargo_manifest) m.vehicles = truck();
  return base;
};

beforeEach(() => supabaseMock.reset(world()));

describe('public tracking of a shipment', () => {
  it('has the tracking code and the plate, and no internal id', async () => {
    const res = await track(TRACKING);
    expect(res.status).toBe(200);
    expect(res.body.tracking_id).toBe(TRACKING);
    expect(res.body).not.toHaveProperty('id');
    expect(res.body.vehicle).not.toHaveProperty('id');
    expect(res.body.vehicle).toMatchObject({ plate_number: 'MH12AB0001' });
    expect(JSON.stringify(res.body)).not.toMatch(UUID);
  });

  it('shows the live position while in transit or out for delivery', async () => {
    for (const status of ['in_transit', 'out_for_delivery']) {
      one('shipments', ID.s1).status = status;
      const res = await track(TRACKING);
      expect(res.body.vehicle).toMatchObject({ lat: 18.6, lng: 73.8 });
    }
  });

  it('hides the position before pickup and after delivery, but keeps the plate', async () => {
    for (const status of ['assigned', 'delivered', 'cancelled']) {
      one('shipments', ID.s1).status = status;
      const res = await track(TRACKING);
      expect(res.status).toBe(200);
      expect(res.body.vehicle.plate_number).toBe('MH12AB0001');
      expect(res.body.vehicle.lat).toBeNull();
      expect(res.body.vehicle.lng).toBeNull();
      expect(res.body.eta_minutes).toBeNull();
    }
  });

  it('gives no road line for a delivered shipment', async () => {
    one('shipments', ID.s1).status = 'delivered';
    expect((await request(app).get(`/api/v1/shipments/track/${TRACKING}/route`)).status).toBe(404);
  });
});

describe('public tracking of a vendor load', () => {
  const code = 'CM-' + ID.m1.slice(0, 8).toUpperCase();

  it('has no internal ids, and a position only while in transit', async () => {
    const live = await track(code);
    expect(live.status).toBe(200);
    expect(live.body).not.toHaveProperty('id');
    expect(live.body.vehicle).not.toHaveProperty('id');
    expect(live.body.vehicle).toMatchObject({ plate_number: 'MH12AB0001', lat: 18.6, lng: 73.8 });
    expect(JSON.stringify(live.body)).not.toMatch(UUID);

    supabaseMock.reset(world({ cargo_manifest: [manifestRow(ID.m1, { status: 'delivered' })] }));
    const done = await track(code);
    expect(done.body.vehicle).toMatchObject({ plate_number: 'MH12AB0001', lat: null, lng: null });
  });
});
