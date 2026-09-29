import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { InvoiceService } from '../src/services/invoice.service';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const NOW = new Date().toISOString();

function shipment(id: string, overrides: Record<string, unknown> = {}) {
  return { id, tracking_id: `RTX-${id.toUpperCase()}`, status: 'delivered', bid_id: null, freight_charge: null, created_at: NOW, updated_at: NOW, metadata: {}, ...overrides };
}

function reset(shipments: Record<string, unknown>[], extra: Record<string, any[]> = {}) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'vendor-1', role: 'vendor', is_active: true }],
    shipments,
    shipment_hsn: [], shipment_logs: [], delivery_points: [], parcels: [], route_stops: [], routes: [], vehicles: [],
    capacity_bids: [], capacity_windows: [], cargo_manifest: [], vendor_shipment_requests: [], invoices: [], ...extra,
  });
}

describe('invoice from the freight charge', () => {
  it('prices a shipment from freight_charge when it has no bid', async () => {
    reset([shipment('s1', { freight_charge: 2500.5 })], { shipment_hsn: [{ id: 'h', shipment_id: 's1', hsn_code: '1001', gst_rate: 18 }] });
    expect((await InvoiceService.createForShipment('s1')).status).toBe('created');
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ shipment_id: 's1', vendor_id: null, amount: 2500.5, gst_rate: 18, gst_amount: 450.09, total: 2950.59, price_source: 'freight_charge' });
  });

  it('prefers the winning bid over the freight charge', async () => {
    reset([shipment('s1', { bid_id: 'b1', freight_charge: 999 })], { capacity_bids: [{ id: 'b1', vendor_id: 'vendor-1', bid_amount: 12000, status: 'won' }] });
    await InvoiceService.createForShipment('s1');
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ amount: 12000, vendor_id: 'vendor-1', price_source: 'bid' });
  });

  it('falls back to the freight charge when the bid was not won', async () => {
    reset([shipment('s1', { bid_id: 'b1', freight_charge: 700 })], { capacity_bids: [{ id: 'b1', vendor_id: 'vendor-1', bid_amount: 12000, status: 'lost' }] });
    await InvoiceService.createForShipment('s1');
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ amount: 700, vendor_id: null, price_source: 'freight_charge' });
  });

  it('writes no invoice when there is no price at all', async () => {
    reset([shipment('s1'), shipment('s2', { freight_charge: 0 })]);
    expect((await InvoiceService.createForShipment('s1')).status).toBe('unpriced');
    expect((await InvoiceService.createForShipment('s2')).status).toBe('unpriced');
    expect(supabaseMock.rows('invoices')).toHaveLength(0);
  });

  it('is created when the shipment is marked delivered', async () => {
    reset([shipment('s1', { status: 'in_transit', freight_charge: 1800 })]);
    const res = await request(app).patch('/api/v1/shipments/s1').set(admin()).send({ status: 'delivered', received_by: 'R. Sharma' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
  });

  it('shows a delivery with a freight charge as ready to invoice', async () => {
    reset([shipment('s1', { freight_charge: 1800 }), shipment('s2')]);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const res = await request(app).get(`/api/v1/finance/unpriced?from=${today}&to=${today}`).set(admin());
    const byId = Object.fromEntries(res.body.map((r: any) => [r.id, r.can_invoice]));
    expect(byId).toEqual({ s1: true, s2: false });
  });
});

describe('freight_charge on shipments', () => {
  const body = {
    origin_name: 'Hub', origin_address: 'Bhiwandi, Maharashtra', origin_lat: 19.3, origin_lng: 73.06,
    dest_name: 'Store', dest_address: 'Pune, Maharashtra', dest_lat: 18.5, dest_lng: 73.8,
    total_items: 1, total_weight_kg: 50,
  };
  const create = (extra: Record<string, unknown>) => request(app).post('/api/v1/shipments/').set(admin()).send({ ...body, ...extra });

  beforeEach(() => reset([]));

  it('is stored when the shipment is created', async () => {
    const res = await create({ freight_charge: 3200 });
    expect(res.status).toBeLessThan(300);
    expect(supabaseMock.rows('shipments')[0].freight_charge).toBe(3200);
  });

  it('stays empty when no price is given', async () => {
    await create({});
    expect(supabaseMock.rows('shipments')[0].freight_charge).toBeNull();
  });

  it('refuses a negative price', async () => {
    expect((await create({ freight_charge: -5 })).status).toBe(400);
    expect(supabaseMock.rows('shipments')).toHaveLength(0);
  });

  it('can be changed from the edit endpoint, and refuses bad values', async () => {
    reset([shipment('s1', { status: 'created' })]);
    const edit = (freight_charge: unknown) => request(app).patch('/api/v1/shipments/s1/edit').set(admin()).send({ freight_charge });
    expect((await edit(4100.456)).status).toBe(200);
    expect(supabaseMock.rows('shipments')[0].freight_charge).toBe(4100.46);
    expect((await edit(-1)).status).toBe(400);
    expect((await edit('abc')).status).toBe(400);
  });
});
