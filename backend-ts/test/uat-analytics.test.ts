/**
 * UAT-005 and UAT-015: Analytics revenue is the taxable value with GST shown apart, profit says when costs are
 * incomplete, and deliveries are counted one way (a split shipment once) with the drops counted beside it.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { costsIncomplete } from '../src/services/finance.service';
import { indianDateKey } from '../src/core/istDate';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const NOW = new Date().toISOString();
const TODAY = indianDateKey(new Date());
const users = [{ id: 'admin-1', role: 'admin', is_active: true }];

describe('costs status (UAT-005)', () => {
  it('says nothing when the fuel price is set and every trip has a cost', () => {
    expect(costsIncomplete(false, 0, 3)).toMatchObject({ complete: true, note: null });
  });

  it('names each gap, in the words shown next to profit', () => {
    expect(costsIncomplete(true, 7, 7).note).toBe('Costs incomplete: fuel price not set; 7 trips have no costs');
    expect(costsIncomplete(true, 0, 0).note).toBe('Costs incomplete: fuel price not set');
    expect(costsIncomplete(false, 1, 4).note).toBe('Costs incomplete: 1 trip has no costs');
  });
});

describe('GET /finance/summary: revenue before GST, and incomplete costs (UAT-005)', () => {
  const summary = () => request(app).get(`/api/v1/finance/summary?from=${TODAY}&to=${TODAY}`).set(admin());
  const world = (over: Record<string, any[]> = {}) => supabaseMock.reset({
    users,
    vehicles: [{ id: 'v1', plate_number: 'MH12AB1234', fuel_efficiency_kmpl: 4 }, { id: 'v2', plate_number: 'MH14CD5678', fuel_efficiency_kmpl: 5 }],
    routes: [
      { id: 'r1', vehicle_id: 'v1', status: 'completed', total_distance_km: 200, estimated_fuel_liters: 40, completed_at: NOW },
      { id: 'r2', vehicle_id: 'v2', status: 'completed', total_distance_km: 100, estimated_fuel_liters: 20, completed_at: NOW },
    ],
    invoices: [
      { id: 'i1', shipment_id: 's1', amount: 100000, gst_rate: 18, gst_amount: 18000, total: 118000, status: 'issued', issued_at: NOW },
      { id: 'i2', shipment_id: 's2', amount: 50000, gst_rate: 0, gst_amount: 0, total: 50000, status: 'issued', issued_at: NOW },
    ],
    shipments: [], delivery_points: [], route_stops: [], cargo_manifest: [], expenses: [], tpl_orders: [], system_settings: [],
    ...over,
  });

  it('revenue is the taxable value, GST is reported apart, and the basis is named', async () => {
    world();
    const { body } = await summary();
    expect(body.revenue).toBe(150000);
    expect(body.gst_collected).toBe(18000);
    expect(body.outstanding).toBe(168000);
    expect(body.revenue_basis).toBe('taxable_value');
  });

  it('with no fuel price and no expenses, profit is flagged: fuel price not set and every trip has no costs', async () => {
    world();
    const { body } = await summary();
    expect(body.net_profit).toBe(150000);
    expect(body.costs_status).toEqual({
      complete: false, fuel_price_missing: true, trips_without_costs: 2, trips_completed: 2,
      note: 'Costs incomplete: fuel price not set; 2 trips have no costs',
    });
  });

  it('a trip with an expense on it, or on its truck, is not counted as having no costs', async () => {
    world({ expenses: [{ id: 'e1', vehicle_id: 'v1', route_id: null, category: 'toll', amount: 500, expense_date: TODAY }] });
    const { body } = await summary();
    expect(body.costs_status).toMatchObject({ trips_without_costs: 1, note: 'Costs incomplete: fuel price not set; 1 trip has no costs' });
  });

  it('with the fuel price set and the trips costed, there is no note', async () => {
    world({ system_settings: [{ key: 'fuel_price_per_litre', value: { price: 90 } }] });
    const { body } = await summary();
    expect(body.costs_status).toMatchObject({ complete: true, fuel_price_missing: false, trips_without_costs: 0, note: null });
  });

  it('a set fuel price is still incomplete when a trip has no distance or litres to estimate from', async () => {
    world({
      system_settings: [{ key: 'fuel_price_per_litre', value: { price: 90 } }],
      routes: [{ id: 'r9', vehicle_id: 'v1', status: 'completed', total_distance_km: null, estimated_fuel_liters: null, completed_at: NOW }],
    });
    const { body } = await summary();
    expect(body.costs_status.note).toBe('Costs incomplete: 1 trip has no costs');
  });
});

describe('GET /analytics/fleet-overview: one definition of a delivery (UAT-015)', () => {
  const MASTER = 'm-split';
  const overview = () => request(app).get('/api/v1/analytics/fleet-overview').query({ from: TODAY, to: TODAY }).set(admin());

  function world() {
    const shipment = (id: string, over: Record<string, unknown> = {}) => ({ id, status: 'delivered', is_master: false, parent_shipment_id: null, updated_at: NOW, ...over });
    supabaseMock.reset({
      users,
      vehicles: [], routes: [], vendor_shipment_requests: [],
      shipments: [
        // One split consignment: a master with three lots, all delivered
        shipment(MASTER, { is_master: true }),
        shipment('lot-a', { parent_shipment_id: MASTER }),
        shipment('lot-b', { parent_shipment_id: MASTER }),
        shipment('lot-c', { parent_shipment_id: MASTER }),
        // Two plain shipments
        shipment('plain-1'),
        shipment('plain-2'),
        // A split still in progress: its delivered lot is a drop, but the shipment is not delivered yet
        shipment('open-master', { is_master: true, status: 'partially_delivered' }),
        shipment('open-lot-a', { parent_shipment_id: 'open-master' }),
        shipment('open-lot-b', { parent_shipment_id: 'open-master', status: 'in_transit' }),
      ],
      shipment_logs: [
        { id: 'l1', shipment_id: 'lot-a', status: 'delivered', timestamp: NOW },
        { id: 'l2', shipment_id: MASTER, status: 'delivered', timestamp: NOW },
        { id: 'l3', shipment_id: 'plain-1', status: 'delivered', timestamp: NOW },
      ],
      cargo_manifest: [
        { id: 'cm-1', status: 'delivered', is_master: false, parent_manifest_id: null, updated_at: NOW },
        { id: 'cm-master', status: 'delivered', is_master: true, parent_manifest_id: null, updated_at: NOW },
        { id: 'cm-lot-1', status: 'delivered', is_master: false, parent_manifest_id: 'cm-master', updated_at: NOW },
        { id: 'cm-lot-2', status: 'delivered', is_master: false, parent_manifest_id: 'cm-master', updated_at: NOW },
      ],
    });
  }

  it('counts a split once as its master, and its lots are not counted on top', async () => {
    world();
    // split master + plain-1 + plain-2 + vendor load cm-1 + vendor split cm-master
    expect((await overview()).body.deliveries_today).toBe(5);
  });

  it('counts the drops beside it: each lot on its own, the master not at all', async () => {
    world();
    // lot-a, lot-b, lot-c + open-lot-a + plain-1 + plain-2 + cm-1 + cm-lot-1 + cm-lot-2
    expect((await overview()).body.delivered_drops).toBe(9);
  });

  it('the daily chart adds up to the same shipments-delivered figure', async () => {
    world();
    const res = await request(app).get('/api/v1/analytics/daily-activity').query({ from: TODAY, to: TODAY }).set(admin());
    expect(res.status).toBe(200);
    expect(res.body.reduce((s: number, d: any) => s + d.deliveries, 0)).toBe(5);
  });
});
