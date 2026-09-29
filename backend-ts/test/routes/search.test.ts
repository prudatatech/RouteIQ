import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from '../support/mock-supabase';
import { testApp } from '../support/test-app';

const app = testApp();

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const admin = () => bearer(supabaseMock.signUserToken('admin-1'));
const superadmin = () => bearer(supabaseMock.signUserToken('superadmin-1'));
const driver = () => bearer(supabaseMock.signUserToken('driver-1'));

const SHIPMENT_ID = '11111111-1111-1111-1111-111111111111';
const MANIFEST_ID = '1234abcd-0000-0000-0000-000000000000';

function fixtures() {
  return {
    users: [
      { id: 'admin-1', role: 'admin', is_active: true, full_name: 'Admin One', email: 'admin1@example.com', phone: '9000000001' },
      { id: 'superadmin-1', role: 'superadmin', is_active: true, full_name: 'Super One', email: 'super1@example.com', phone: '9000000002' },
      { id: 'driver-1', role: 'driver', is_active: true, full_name: 'Driver One', email: 'driver1@example.com', phone: '9000000003' },
      { id: 'target-1', role: 'driver', is_active: true, full_name: 'Ravi Kumar', email: 'ravi.kumar@example.com', phone: '9876543210', created_at: '2026-09-20T00:00:00Z' },
    ],
    shipments: [
      { id: SHIPMENT_ID, tracking_id: 'RTX-ABC123', status: 'booked', origin_name: 'Warehouse A', origin_address: '123 Ring Road', created_at: '2026-09-20T00:00:00Z' },
    ],
    delivery_points: [],
    cargo_manifest: [
      { id: MANIFEST_ID, pickup_location: 'Pune Yard', drop_location: 'Mumbai Dock', status: 'active', created_at: '2026-09-20T00:00:00Z' },
    ],
    vehicles: [
      { id: 'v1', plate_number: 'MH12AB1234', driver_name: 'Suresh Patil', status: 'idle', created_at: '2026-09-20T00:00:00Z' },
    ],
    vendor_profiles: [
      { id: 'vendor-1', company_name: 'Acme Traders', gst_number: 'GSTACME01', city: 'Pune', created_at: '2026-09-20T00:00:00Z' },
    ],
    tpl_partners: [
      { id: 'partner-1', company_name: 'Northline 3PL', custom_id: 'northline_1', status: 'active', created_at: '2026-09-20T00:00:00Z' },
    ],
  };
}

beforeEach(() => {
  supabaseMock.reset(fixtures());
});

const search = (q: string, auth: Record<string, string>) => request(app).get('/api/v1/search').query({ q }).set(auth);

describe('GET /search', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'RTX' });
    expect(res.status).toBe(401);
  });

  it('is staff only', async () => {
    const res = await search('RTX', driver());
    expect(res.status).toBe(403);
  });

  it('ignores a query shorter than 2 characters', async () => {
    const res = await search('r', admin());
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual({ shipments: [], cargo_manifests: [], vehicles: [], vendors: [], partners: [], users: [] });
  });

  it('finds a shipment by tracking id', async () => {
    const res = await search('rtx-abc', admin());
    expect(res.status).toBe(200);
    expect(res.body.results.shipments).toEqual([
      expect.objectContaining({ id: SHIPMENT_ID, type: 'shipment', path: `/shipments?open=${SHIPMENT_ID}` }),
    ]);
  });

  it('finds a cargo manifest by its CM- display id', async () => {
    const res = await search('CM-1234ABCD', admin());
    expect(res.status).toBe(200);
    expect(res.body.results.cargo_manifests).toEqual([
      expect.objectContaining({ id: MANIFEST_ID, label: 'CM-1234ABCD', type: 'cargo_manifest' }),
    ]);
  });

  it('finds a cargo manifest by pickup/drop location', async () => {
    const res = await search('mumbai dock', admin());
    expect(res.body.results.cargo_manifests).toEqual([expect.objectContaining({ id: MANIFEST_ID })]);
  });

  it('finds a vehicle by plate number', async () => {
    const res = await search('mh12ab', admin());
    expect(res.body.results.vehicles).toEqual([expect.objectContaining({ id: 'v1', type: 'vehicle' })]);
  });

  it('finds a vendor by company name', async () => {
    const res = await search('acme', admin());
    expect(res.body.results.vendors).toEqual([expect.objectContaining({ id: 'vendor-1', type: 'vendor' })]);
  });

  it('finds a 3PL partner by company name', async () => {
    const res = await search('northline', admin());
    expect(res.body.results.partners).toEqual([expect.objectContaining({ id: 'partner-1', type: 'partner' })]);
  });

  it('finds a user by full name', async () => {
    const res = await search('ravi kumar', admin());
    expect(res.body.results.users).toEqual([expect.objectContaining({ id: 'target-1', type: 'user' })]);
  });

  it('does not search users by email or phone for a non-superadmin admin', async () => {
    const res = await search('ravi.kumar@example.com', admin());
    expect(res.body.results.users).toEqual([]);
  });

  it('searches users by email for a superadmin', async () => {
    const res = await search('ravi.kumar@example.com', superadmin());
    expect(res.body.results.users).toEqual([expect.objectContaining({ id: 'target-1' })]);
  });

  it('does not leak an unrelated row for a query containing %, _ or \'', async () => {
    const res = await search("rtx-abc123%_'", admin());
    expect(res.status).toBe(200);
    expect(res.body.results.shipments).toEqual([]);
    expect(res.body.results.vehicles).toEqual([]);
    expect(res.body.results.vendors).toEqual([]);
  });

  it('returns no results for a query that matches nothing', async () => {
    const res = await search('no-such-thing-anywhere', admin());
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual({ shipments: [], cargo_manifests: [], vehicles: [], vendors: [], partners: [], users: [] });
  });
});
