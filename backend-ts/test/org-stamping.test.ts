/**
 * New records carry their owner: the logistic company that runs them (carrier_org_id), the vendor they are
 * for (vendor_org_id) and, on an invoice, who issues it and who is billed (issuer_org_id, bill_to_org_id).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { COMPANY_SETTING } from './support/cargo-world';
import { testApp } from './support/test-app';
import { ORG, ORG_SETTINGS, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const NOW = new Date().toISOString();
const VEHICLE = 'a0000000-0000-4000-8000-0000000000e1';
const REQUEST = 'a0000000-0000-4000-8000-0000000000f1';

describe('a record made by a company\'s staff belongs to that company', () => {
  beforeEach(() => supabaseMock.reset(orgWorld({ vehicles: [] })));

  it('a vehicle', async () => {
    const body = { plate_number: 'MH12XY1001', vehicle_type: 'truck', capacity_kg: 3000 };
    expect((await request(app).post(api('/vehicles')).set(as('admin-b')).send(body)).status).toBe(201);
    expect(supabaseMock.rows('vehicles')[0].carrier_org_id).toBe(ORG.companyB);
    expect((await request(app).post(api('/vehicles')).set(as('admin-a')).send({ ...body, plate_number: 'MH12XY1002' })).status).toBe(201);
    expect(supabaseMock.rows('vehicles')[1].carrier_org_id).toBe(ORG.companyA);
  });

  it('follows the organisation the person is acting as', async () => {
    // super-1 sits in company A and the platform: acting as A stamps A
    const body = { plate_number: 'MH12XY1003', vehicle_type: 'truck', capacity_kg: 3000 };
    await request(app).post(api('/vehicles')).set(as('super-1', ORG.companyA)).send(body);
    expect(supabaseMock.rows('vehicles')[0].carrier_org_id).toBe(ORG.companyA);
  });

  it('a platform admin acting as the platform stamps nothing, so the database default company applies', async () => {
    await request(app).post(api('/vehicles')).set(as('super-1', ORG.platform)).send({ plate_number: 'MH12XY1004', vehicle_type: 'truck', capacity_kg: 3000 });
    expect(supabaseMock.rows('vehicles')[0]).not.toHaveProperty('carrier_org_id');
  });

  it('a driver pay rate', async () => {
    const res = await request(app).post(api('/driver-pay/rates')).set(as('admin-b')).send({ vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10, effective_from: '2026-01-01' });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('driver_pay_rates')[0].carrier_org_id).toBe(ORG.companyB);
  });

  it('a new rate in one company does not replace the other company\'s rate of the same day', async () => {
    supabaseMock.rows('driver_pay_rates').push({ id: 'pa1', vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10, effective_from: '2026-01-01', active: true, carrier_org_id: ORG.companyA });
    await request(app).post(api('/driver-pay/rates')).set(as('admin-b')).send({ vehicle_type: 'truck', per_trip_amount: 900, per_km_amount: 15, effective_from: '2026-01-01' });
    expect(supabaseMock.rows('driver_pay_rates').find(r => r.id === 'pa1')!.active).toBe(true);
  });

  it('an expense', async () => {
    const res = await request(app).post(api('/finance/expenses')).set(as('admin-b')).send({ category: 'fuel', amount: 1200, expense_date: NOW.slice(0, 10) });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('expenses')[0].carrier_org_id).toBe(ORG.companyB);
  });
});

describe('a load a vendor asked for', () => {
  it('becomes a manifest of the company that assigns the truck, for the vendor\'s organisation', async () => {
    supabaseMock.reset(orgWorld({
      vendor_shipment_requests: [{
        id: REQUEST, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, pickup_location: 'Bhiwandi', pickup_lat: 19.3, pickup_lng: 73.06,
        drop_location: 'Pune', drop_lat: 18.52, drop_lng: 73.85, required_capacity_kg: 400, status: 'approved', cost: 9000, assigned_vehicle_id: null, carrier_org_id: ORG.companyB,
      }],
      vehicles: [{ id: VEHICLE, driver_id: uid('driver-b'), status: 'available', capacity_kg: 1000, current_load_kg: 0, available_capacity_kg: 1000, carrier_org_id: ORG.companyB }],
      cargo_manifest: [],
    }));
    const res = await request(app).put(api(`/vendor/shipment-request/${REQUEST}/assign-vehicle`)).set(as('admin-b')).send({ vehicle_id: VEHICLE });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('cargo_manifest')[0]).toMatchObject({ carrier_org_id: ORG.companyB, vendor_org_id: ORG.vendorV });
  });
});

describe('an invoice', () => {
  it('is issued by the company that delivered and billed to the vendor\'s organisation', async () => {
    supabaseMock.reset(orgWorld({
      shipments: [{ id: 's1', tracking_id: 'RTX-S1', status: 'in_transit', priority: 'medium', origin_name: 'Hub', total_items: 1, total_weight_kg: 100, bid_id: 'bid-1', created_at: NOW, updated_at: NOW, metadata: {}, carrier_org_id: ORG.companyB }],
      capacity_bids: [{ id: 'bid-1', vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, bid_amount: 12500, status: 'won' }],
      vendor_profiles: [{ id: uid('vendor-1'), company_name: 'Acme Traders' }],
      shipment_hsn: [], shipment_logs: [], delivery_points: [], route_stops: [], routes: [], vehicles: [], cargo_manifest: [], vendor_shipment_requests: [], capacity_windows: [],
      invoices: [], expenses: [],
      system_settings: [...ORG_SETTINGS, COMPANY_SETTING],
    }));
    const res = await request(app).post(api('/cargo/custody')).set(as('admin-b'))
      .send({ ref: 'RTX-S1', kind: 'delivery', receiver_name: 'R. Sharma', reason: 'Receiver confirmed on the phone' });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ vendor_id: uid('vendor-1'), issuer_org_id: ORG.companyB, bill_to_org_id: ORG.vendorV });
  });
});
