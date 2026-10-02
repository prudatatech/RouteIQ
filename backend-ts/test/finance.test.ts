import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { COMPANY_SETTING } from './support/cargo-world';
import { testApp } from './support/test-app';
import { InvoiceService } from '../src/services/invoice.service';
import { indianDateKey } from '../src/core/istDate';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const vendorAuth = (id = 'vendor-1') => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

const TODAY = indianDateKey(new Date());
const NOW = new Date().toISOString();

function shipment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, tracking_id: `RTX-${id.toUpperCase()}`, status: 'in_transit', priority: 'medium', origin_name: 'Bhiwandi Hub',
    total_items: 1, total_weight_kg: 100, bid_id: null, created_at: NOW, updated_at: NOW, metadata: {}, ...overrides,
  };
}

function baseFixtures(extra: Record<string, any[]> = {}) {
  return {
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
      { id: 'vendor-2', role: 'vendor', is_active: true },
    ],
    vendor_profiles: [{ id: 'vendor-1', company_name: 'Acme Logistics' }, { id: 'vendor-2', company_name: 'Other Co' }],
    shipments: [], shipment_hsn: [], shipment_logs: [], delivery_points: [], route_stops: [], routes: [], vehicles: [],
    capacity_bids: [], capacity_windows: [], cargo_manifest: [], vendor_shipment_requests: [],
    invoices: [], expenses: [], system_settings: [COMPANY_SETTING], ...extra,
  };
}

// Staff record a delivery as a custody event (a raw status PATCH to delivered is refused); a logged reason stands in for the photo
const markDelivered = (id: string) => request(app).post('/api/v1/cargo/custody').set(admin())
  .send({ ref: `RTX-${id.toUpperCase()}`, kind: 'delivery', receiver_name: 'R. Sharma', reason: 'Receiver confirmed on the phone' });

describe('invoice on delivery', () => {
  beforeEach(() => {
    supabaseMock.reset(baseFixtures({
      shipments: [shipment('s1', { bid_id: 'bid-1' }), shipment('s2'), shipment('s3', { bid_id: 'bid-lost' })],
      capacity_bids: [
        { id: 'bid-1', vendor_id: 'vendor-1', bid_amount: 12500, status: 'won' },
        { id: 'bid-lost', vendor_id: 'vendor-2', bid_amount: 9000, status: 'lost' },
      ],
      shipment_hsn: [{ id: 'h1', shipment_id: 's1', hsn_code: '1001', gst_rate: 12 }, { id: 'h2', shipment_id: 's1', hsn_code: '2002', gst_rate: 5 }],
    }));
  });

  it('creates an invoice from the accepted bid, with a month-based number and no GST on freight under the default reverse charge', async () => {
    const res = await markDelivered('s1');
    expect(res.status).toBe(201);
    const [inv] = supabaseMock.rows('invoices');
    expect(inv).toMatchObject({ shipment_id: 's1', vendor_id: 'vendor-1', amount: 12500, gst_rate: 0, gst_amount: 0, total: 12500, status: 'issued', price_source: 'bid', tax_mode: 'rcm_5' });
    const month = TODAY.slice(0, 7).replace('-', '');
    expect(inv.invoice_number).toBe(`INV-${month}-0001`);
  });

  it('numbers invoices in sequence within the month', async () => {
    const month = TODAY.slice(0, 7).replace('-', '');
    supabaseMock.rows('invoices').push({ id: 'old', invoice_number: `INV-${month}-0007`, shipment_id: 'x', status: 'paid' });
    await markDelivered('s1');
    expect(supabaseMock.rows('invoices').find(i => i.shipment_id === 's1')!.invoice_number).toBe(`INV-${month}-0008`);
  });

  it('does not invoice twice when a delivery is recorded again', async () => {
    await markDelivered('s1');
    await markDelivered('s1');
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
  });

  it('creates no invoice when there is no price, and the delivery still succeeds', async () => {
    expect((await markDelivered('s2')).status).toBe(201);
    expect((await markDelivered('s3')).status).toBe(201);
    expect(supabaseMock.rows('invoices')).toHaveLength(0);
  });

  it('invoices a vendor-load manifest from the request cost', async () => {
    supabaseMock.reset(baseFixtures({
      cargo_manifest: [
        { id: 'm1', vendor_request_id: 'r1', status: 'delivered' },
        { id: 'm2', vendor_request_id: 'r2', status: 'delivered' },
        { id: 'm3', vendor_request_id: null, status: 'delivered' },
      ],
      vendor_shipment_requests: [{ id: 'r1', vendor_id: 'vendor-1', cost: 8000 }, { id: 'r2', vendor_id: 'vendor-1', cost: null }],
    }));
    expect((await InvoiceService.createForManifest('m1')).status).toBe('created');
    expect((await InvoiceService.createForManifest('m1')).status).toBe('exists');
    expect((await InvoiceService.createForManifest('m2')).status).toBe('unpriced');
    expect((await InvoiceService.createForManifest('m3')).status).toBe('skipped');
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ manifest_id: 'm1', vendor_id: 'vendor-1', amount: 8000, gst_amount: 0, total: 8000, price_source: 'vendor_request' });
  });

  it('invoices through verify-pod', async () => {
    const res = await request(app).post('/api/v1/cargo/verify-pod').set(admin()).send({ tracking_id: 'RTX-S1', recipient_name: 'R. Sharma', reason: 'Receiver confirmed on the phone' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
  });
});

describe('invoice list and status', () => {
  beforeEach(() => {
    supabaseMock.reset(baseFixtures({
      shipments: [shipment('s1')],
      invoices: [
        { id: 'i1', invoice_number: 'INV-202609-0001', shipment_id: 's1', vendor_id: 'vendor-1', amount: 1000, gst_rate: 0, gst_amount: 0, total: 1000, status: 'issued', issued_at: NOW },
        { id: 'i2', invoice_number: 'INV-202609-0002', manifest_id: 'm1', vendor_id: 'vendor-2', amount: 500, gst_rate: 0, gst_amount: 0, total: 500, status: 'paid', issued_at: NOW },
      ],
    }));
  });

  it('lists invoices with reference and vendor name, filtered by status', async () => {
    const all = await request(app).get('/api/v1/finance/invoices').set(admin());
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(2);
    expect(all.body.find((i: any) => i.id === 'i1')).toMatchObject({ reference: 'RTX-S1', vendor_name: 'Acme Logistics' });
    const paid = await request(app).get('/api/v1/finance/invoices?status=paid').set(admin());
    expect(paid.body.map((i: any) => i.id)).toEqual(['i2']);
  });

  it('marks an issued invoice paid, once', async () => {
    const res = await request(app).put('/api/v1/finance/invoices/i1/pay').set(admin()).send({ method: 'bank' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ status: 'paid' });
    expect(supabaseMock.rows('invoices')[0].paid_at).toBeTruthy();
    expect((await request(app).put('/api/v1/finance/invoices/i1/pay').set(admin()).send({ method: 'bank' })).status).toBe(409);
  });

  it('voids an issued invoice but not a paid one', async () => {
    expect((await request(app).put('/api/v1/finance/invoices/i1/void').set(admin()).send({ reason: 'Wrong price' })).status).toBe(200);
    expect(supabaseMock.rows('invoices')[0].status).toBe('void');
    const paid = await request(app).put('/api/v1/finance/invoices/i2/void').set(admin()).send({ reason: 'Wrong price' });
    expect(paid.status).toBe(409);
    expect(paid.body.detail).toMatch(/already paid/);
  });

  it('answers 404 for an unknown invoice', async () => {
    expect((await request(app).put('/api/v1/finance/invoices/nope/pay').set(admin()).send({ method: 'bank' })).status).toBe(404);
  });

  it('is staff only', async () => {
    expect((await request(app).get('/api/v1/finance/invoices').set(vendorAuth())).status).toBe(403);
    expect((await request(app).get('/api/v1/finance/invoices')).status).toBe(401);
  });

  it('shows a vendor only their own invoices', async () => {
    const res = await request(app).get('/api/v1/vendor/invoices').set(vendorAuth('vendor-1'));
    expect(res.status).toBe(200);
    expect(res.body.map((i: any) => i.id)).toEqual(['i1']);
    expect(res.body[0].reference).toBe('RTX-S1');
  });

  it('backfills an invoice for a priced delivery that has none', async () => {
    supabaseMock.reset(baseFixtures({
      shipments: [shipment('s1', { status: 'delivered', bid_id: 'b1' }), shipment('s2', { status: 'delivered' }), shipment('s3')],
      capacity_bids: [{ id: 'b1', vendor_id: 'vendor-1', bid_amount: 700, status: 'won' }],
    }));
    const ok = await request(app).post('/api/v1/finance/invoices').set(admin()).send({ shipment_id: 's1' });
    expect(ok.status).toBe(201);
    expect((await request(app).post('/api/v1/finance/invoices').set(admin()).send({ shipment_id: 's2' })).status).toBe(422);
    expect((await request(app).post('/api/v1/finance/invoices').set(admin()).send({ shipment_id: 's3' })).status).toBe(409);
    expect((await request(app).post('/api/v1/finance/invoices').set(admin()).send({})).status).toBe(400);
  });
});

describe('expenses', () => {
  beforeEach(() => {
    supabaseMock.reset(baseFixtures({
      vehicles: [{ id: 'v1', plate_number: 'MH12AB1234' }],
      routes: [{ id: 'r1', vehicle_id: 'v1', status: 'completed' }],
    }));
  });
  const post = (body: Record<string, unknown>) => request(app).post('/api/v1/finance/expenses').set(admin()).send(body);

  it('adds, lists with filters, edits and deletes an expense', async () => {
    const created = await post({ vehicle_id: 'v1', route_id: 'r1', category: 'fuel', amount: '3200.50', expense_date: TODAY, litres: 35, note: ' Diesel ' });
    expect(created.status).toBe(201);
    expect(supabaseMock.rows('expenses')[0]).toMatchObject({ category: 'fuel', amount: 3200.5, litres: 35, note: 'Diesel', created_by: 'admin-1' });
    await post({ category: 'toll', amount: 400, expense_date: TODAY });

    const list = await request(app).get('/api/v1/finance/expenses').set(admin());
    expect(list.body).toHaveLength(2);
    expect(list.body.find((e: any) => e.category === 'fuel').plate_number).toBe('MH12AB1234');
    const fuel = await request(app).get('/api/v1/finance/expenses?category=fuel').set(admin());
    expect(fuel.body).toHaveLength(1);
    const byVehicle = await request(app).get('/api/v1/finance/expenses?vehicle_id=v1').set(admin());
    expect(byVehicle.body).toHaveLength(1);

    const id = created.body.id;
    const edited = await request(app).put(`/api/v1/finance/expenses/${id}`).set(admin()).send({ amount: 3300 });
    expect(edited.status).toBe(200);
    expect(supabaseMock.rows('expenses').find(e => e.id === id)!.amount).toBe(3300);
    expect((await request(app).delete(`/api/v1/finance/expenses/${id}`).set(admin())).status).toBe(204);
    expect(supabaseMock.rows('expenses')).toHaveLength(1);
    expect((await request(app).delete(`/api/v1/finance/expenses/${id}`).set(admin())).status).toBe(404);
  });

  it.each([
    [{ category: 'lunch', amount: 10, expense_date: TODAY }, /category/],
    [{ category: 'fuel', amount: 0, expense_date: TODAY }, /amount/],
    [{ category: 'fuel', amount: 10, expense_date: 'yesterday' }, /date/],
    [{ category: 'fuel', amount: 10, expense_date: '2999-01-01' }, /future/],
    [{ category: 'fuel', amount: 10, expense_date: TODAY, vehicle_id: 'ghost' }, /Vehicle not found/],
    [{ category: 'fuel', amount: 10, expense_date: TODAY, receipt_path: '../secrets' }, /Receipt/],
  ])('refuses invalid input %#', async (body, message) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(message);
    expect(supabaseMock.rows('expenses')).toHaveLength(0);
  });

  it('issues a signed upload URL for a receipt inside expenses/', async () => {
    const res = await request(app).post('/api/v1/finance/expenses/receipt-upload').set(admin()).send({ content_type: 'image/jpeg', size: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(/^expenses\/[\w-]+\/receipt_[\w-]+\.jpg$/);
    expect(supabaseMock.signedUploads[0]).toContain(res.body.path);
    expect((await request(app).post('/api/v1/finance/expenses/receipt-upload').set(admin()).send({ content_type: 'text/html', size: 10 })).status).toBe(415);
    expect((await request(app).post('/api/v1/finance/expenses/receipt-upload').set(admin()).send({ content_type: 'image/png', size: 99_000_000 })).status).toBe(413);
  });

  it('is staff only', async () => {
    expect((await request(app).post('/api/v1/finance/expenses').set(vendorAuth()).send({})).status).toBe(403);
  });
});

describe('fuel price setting', () => {
  it('reports nothing until set, then stores the price and lists rate per km', async () => {
    supabaseMock.reset(baseFixtures({ system_settings: [{ key: 'rate_per_km', value: { rate: 15 } }] }));
    const before = await request(app).get('/api/v1/finance/settings').set(admin());
    expect(before.body).toEqual({ fuel_price_per_litre: null, rate_per_km: 15 });
    const saved = await request(app).put('/api/v1/finance/settings').set(admin()).send({ fuel_price_per_litre: 94.5 });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ fuel_price_per_litre: 94.5, rate_per_km: 15 });
    expect((await request(app).put('/api/v1/finance/settings').set(admin()).send({ fuel_price_per_litre: -1 })).status).toBe(400);
    expect((await request(app).put('/api/v1/finance/settings').set(admin()).send({})).status).toBe(400);
  });
});

describe('profit and loss summary', () => {
  it('is empty and honest with no data', async () => {
    supabaseMock.reset(baseFixtures());
    const res = await request(app).get('/api/v1/finance/summary?from=' + TODAY + '&to=' + TODAY).set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revenue: 0, net_profit: 0, invoice_count: 0, profit_per_truck: null, cost_per_km: null, fuel: { price_missing: true } });
    expect(res.body.costs.total).toBe(0);
    expect(res.body.vehicles).toEqual([]);
    expect(res.body.routes).toEqual([]);
    expect(res.body.daily).toHaveLength(1);
  });

  function fixtures(fuelPrice: number | null, extra: Record<string, any[]> = {}) {
    return baseFixtures({
      vehicles: [
        { id: 'v1', plate_number: 'MH12AB1234', fuel_efficiency_kmpl: 4 },
        { id: 'v2', plate_number: 'MH14CD5678', fuel_efficiency_kmpl: 5 },
      ],
      routes: [
        { id: 'r1', vehicle_id: 'v1', status: 'completed', total_distance_km: 200, estimated_fuel_liters: 40, completed_at: NOW },
        { id: 'r2', vehicle_id: 'v2', status: 'completed', total_distance_km: 100, estimated_fuel_liters: null, completed_at: NOW },
      ],
      shipments: [shipment('s1', { status: 'delivered' })],
      delivery_points: [{ id: 'dp1', shipment_id: 's1' }],
      route_stops: [{ id: 'st1', route_id: 'r1', delivery_point_id: 'dp1' }],
      cargo_manifest: [{ id: 'm1', vehicle_id: 'v2', vendor_request_id: 'q1', pickup_location: 'Pune', drop_location: 'Mumbai' }],
      invoices: [
        { id: 'i1', shipment_id: 's1', vendor_id: 'vendor-1', amount: 10000, gst_amount: 1200, total: 11200, status: 'issued', issued_at: NOW },
        { id: 'i2', manifest_id: 'm1', vendor_id: 'vendor-1', amount: 6000, gst_amount: 0, total: 6000, status: 'paid', issued_at: NOW },
        { id: 'i3', shipment_id: 'sx', vendor_id: 'vendor-1', amount: 999, gst_amount: 0, total: 999, status: 'void', issued_at: NOW },
      ],
      expenses: [
        { id: 'e1', vehicle_id: 'v1', route_id: null, category: 'toll', amount: 500, expense_date: TODAY },
        { id: 'e2', vehicle_id: null, route_id: null, category: 'other', amount: 250, expense_date: TODAY },
      ],
      system_settings: fuelPrice == null ? [] : [{ key: 'fuel_price_per_litre', value: { price: fuelPrice } }],
      ...extra,
    });
  }
  const summary = () => request(app).get(`/api/v1/finance/summary?from=${TODAY}&to=${TODAY}`).set(admin());

  it('works out revenue, costs, fuel estimate, profit per truck and cost per km from real rows', async () => {
    supabaseMock.reset(fixtures(90));
    const { body } = await summary();
    expect(body.revenue).toBe(16000);
    expect(body.gst_collected).toBe(1200);
    expect(body.outstanding).toBe(11200);
    // r1: 40 L x 90 = 3600; r2: 100 km / 5 kmpl = 20 L x 90 = 1800
    expect(body.costs).toMatchObject({ recorded: 750, fuel_estimated: 5400, total: 6150 });
    expect(body.net_profit).toBe(9850);
    expect(body.distance_km).toBe(300);
    expect(body.cost_per_km).toBe(20.5);
    expect(body.active_trucks).toBe(2);
    expect(body.profit_per_truck).toBe(4925);
    expect(body.daily).toEqual([{ date: TODAY, revenue: 16000, costs: 6150, profit: 9850 }]);
    expect(body.vehicles.find((v: any) => v.plate_number === 'MH12AB1234')).toMatchObject({ revenue: 10000, costs: 4100, profit: 5900 });
    expect(body.routes[0]).toMatchObject({ route_id: 'r1', revenue: 10000, costs: 3600, profit: 6400, fuel_estimated: true });
    expect(body.corridors).toEqual([{ pickup: 'Pune', drop: 'Mumbai', revenue: 6000, loads: 1 }]);
    expect(body.fuel).toMatchObject({ price_per_litre: 90, price_missing: false, routes_covered_by_expenses: 0, routes_without_fuel_data: 0 });
  });

  it('leaves the fuel estimate out when there is no fuel price, and says so', async () => {
    supabaseMock.reset(fixtures(null));
    const { body } = await summary();
    expect(body.fuel.price_missing).toBe(true);
    expect(body.costs.fuel_estimated).toBe(0);
    expect(body.costs.total).toBe(750);
  });

  it('does not estimate fuel where a fuel expense already covers the route or the vehicle', async () => {
    const f = fixtures(90);
    f.expenses.push(
      { id: 'e3', vehicle_id: 'v1', route_id: 'r1', category: 'fuel', amount: 3000, expense_date: TODAY },
      { id: 'e4', vehicle_id: 'v2', route_id: null, category: 'fuel', amount: 1500, expense_date: TODAY },
    );
    supabaseMock.reset(f);
    const { body } = await summary();
    expect(body.costs.fuel_estimated).toBe(0);
    expect(body.costs.recorded).toBe(5250);
    expect(body.fuel.routes_covered_by_expenses).toBe(2);
  });

  it('counts routes with no fuel data instead of guessing', async () => {
    const f = fixtures(90);
    f.routes[1] = { id: 'r2', vehicle_id: 'v2', status: 'completed', total_distance_km: 0, estimated_fuel_liters: 0, completed_at: NOW };
    supabaseMock.reset(f);
    const { body } = await summary();
    expect(body.fuel.routes_without_fuel_data).toBe(1);
    expect(body.costs.fuel_estimated).toBe(3600);
  });

  it('lists deliveries with no invoice and whether one can be created', async () => {
    supabaseMock.reset(baseFixtures({
      shipments: [
        shipment('s1', { status: 'delivered', bid_id: 'b1' }),
        shipment('s2', { status: 'delivered' }),
        shipment('s3', { status: 'delivered', bid_id: 'b1' }),
      ],
      capacity_bids: [{ id: 'b1', vendor_id: 'vendor-1', bid_amount: 700, status: 'won' }],
      cargo_manifest: [
        { id: 'm1', status: 'delivered', vendor_request_id: 'q1', updated_at: NOW },
        { id: 'm2', status: 'delivered', vendor_request_id: null, updated_at: NOW },
      ],
      vendor_shipment_requests: [{ id: 'q1', vendor_id: 'vendor-1', cost: null }],
      invoices: [{ id: 'i1', shipment_id: 's3', amount: 700, status: 'issued', issued_at: NOW }],
    }));
    const res = await request(app).get(`/api/v1/finance/unpriced?from=${TODAY}&to=${TODAY}`).set(admin());
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((r: any) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(['m1', 's1', 's2']);
    expect(byId.s1.can_invoice).toBe(true);
    expect(byId.s2.can_invoice).toBe(false);
    expect(byId.m1.can_invoice).toBe(false);
  });
});

describe('3PL partner cost in the summary', () => {
  it('counts what partners charged for the loads they delivered in the range', async () => {
    supabaseMock.reset(baseFixtures({
      invoices: [{ id: 'i1', shipment_id: null, manifest_id: null, vendor_id: 'vendor-1', amount: 60000, gst_amount: 0, total: 60000, status: 'issued', issued_at: NOW }],
      tpl_orders: [
        { id: 'o1', status: 'delivered', agreed_amount: 41200, delivered_at: NOW },
        { id: 'o2', status: 'in_transit', agreed_amount: 9999, delivered_at: null },
        { id: 'o3', status: 'delivered', agreed_amount: 5000, delivered_at: '2020-01-01T00:00:00Z' },
      ],
    }));
    const res = await request(app).get('/api/v1/finance/summary').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.costs.by_category.find((c: any) => c.category === 'tpl_partner')).toMatchObject({ label: '3PL partners', amount: 41200 });
    expect(res.body.costs.recorded).toBe(41200);
    expect(res.body.net_profit).toBe(60000 - 41200);
  });
});
