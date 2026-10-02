/**
 * Tenancy audit (area 6): the cargo board (/cargo/shipments, /cargo/open-loads, /cargo/security-alerts, pooling,
 * the old resolve-alert and verify-pod) read and changed every company's rows. Each company now sees and touches only
 * its own, another company's id is a 404 exactly like an id nobody has, and an id that cannot exist (not a uuid) is a
 * 404 instead of a database error on the fleet alert and fuel routes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld } from './support/org-world';
import { clearAllMemos } from '../src/core/memo';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const NOW = new Date().toISOString();

const U = {
  vA: 'a1000000-0000-4000-8000-000000000001', vB: 'b1000000-0000-4000-8000-000000000001',
  sA: '51000000-0000-4000-8000-0000000000a1', sB: '51000000-0000-4000-8000-0000000000b1',
  alA: 'a1e00000-0000-4000-8000-0000000000a1', alB: 'a1e00000-0000-4000-8000-0000000000b1',
  dA: 'd0000000-0000-4000-8000-0000000000a1', dB: 'd0000000-0000-4000-8000-0000000000b1',
  flB: 'f1000000-0000-4000-8000-0000000000b1', ghost: '99999999-0000-4000-8000-000000000999',
};
const ids = (body: any) => (Array.isArray(body) ? body : []).map((r: any) => r.id).sort();

const vehicle = (id: string, org: string, plate: string): Row => ({ id, plate_number: plate, vehicle_type: 'truck', capacity_kg: 5000, status: 'available', carrier_org_id: org, created_at: NOW });
const shipment = (id: string, org: string, track: string): Row => ({
  id, tracking_id: track, status: 'created', priority: 'medium', origin_name: 'Hub', total_weight_kg: 100, created_at: NOW, updated_at: NOW,
  metadata: {}, carrier_org_id: org, is_master: false, origin_lat: 19.1, origin_lng: 73.1,
});

beforeEach(() => {
  clearAllMemos();
  supabaseMock.reset({
    ...orgWorld(),
    vehicles: [vehicle(U.vA, ORG.companyA, 'MH01AA0001'), vehicle(U.vB, ORG.companyB, 'MH01BB0001')],
    shipments: [shipment(U.sA, ORG.companyA, 'RTX-ALPHA1'), shipment(U.sB, ORG.companyB, 'RTX-BETA1')],
    maintenance_alerts: [
      { id: U.alA, vehicle_id: U.vA, alert_type: 'overspeed', severity: 'high', description: 'Fast', is_resolved: false, status: 'open', is_test: false, occurrences: 1, created_at: NOW, carrier_org_id: ORG.companyA },
      { id: U.alB, vehicle_id: U.vB, alert_type: 'overspeed', severity: 'high', description: 'Fast', is_resolved: false, status: 'open', is_test: false, occurrences: 1, created_at: NOW, carrier_org_id: ORG.companyB },
    ],
    depots: [
      { id: U.dA, name: 'Alpha yard', address: 'A', latitude: 19.1, longitude: 72.9, carrier_org_id: ORG.companyA },
      { id: U.dB, name: 'Beta yard', address: 'B', latitude: 28.6, longitude: 77.2, carrier_org_id: ORG.companyB },
    ],
    delivery_points: [], route_stops: [], tpl_orders: [], tpl_offers: [], capacity_windows: [], cargo_manifest: [],
    vehicle_fuel_logs: [{ id: U.flB, vehicle_id: U.vB, filled_at: NOW, litres: 60, price_per_litre: 100, total_amount: 6000, flags: [], bill_path: null, created_at: NOW }],
  });
});

describe('cargo board: lists', () => {
  it('GET /cargo/shipments lists only the active company\'s shipments', async () => {
    const a = await request(app).get(api('/cargo/shipments')).set(as('admin-a'));
    const b = await request(app).get(api('/cargo/shipments')).set(as('admin-b'));
    expect(ids(a.body)).toEqual([U.sA]);
    expect(ids(b.body)).toEqual([U.sB]);
  });

  it('GET /cargo/shipments lists everything for the platform admin acting as the platform', async () => {
    const p = await request(app).get(api('/cargo/shipments')).set(as('super-1', ORG.platform));
    expect(ids(p.body)).toEqual([U.sA, U.sB].sort());
  });

  it('GET /cargo/open-loads shows a company only its own waiting shipments', async () => {
    const a = await request(app).get(api('/cargo/open-loads')).set(as('admin-a'));
    const b = await request(app).get(api('/cargo/open-loads')).set(as('admin-b'));
    expect(a.status).toBe(200);
    expect(ids(a.body)).toEqual([U.sA]);
    expect(ids(b.body)).toEqual([U.sB]);
  });

  it('GET /cargo/security-alerts shows a company only its own alarms', async () => {
    const a = await request(app).get(api('/cargo/security-alerts')).set(as('admin-a'));
    const b = await request(app).get(api('/cargo/security-alerts')).set(as('admin-b'));
    expect(ids(a.body)).toEqual([U.alA]);
    expect(ids(b.body)).toEqual([U.alB]);
  });
});

describe('cargo board: actions on another company\'s rows', () => {
  it('POST /cargo/resolve-alert/:id is a 404 for another company\'s alarm, the same as for an id nobody has, and changes nothing', async () => {
    const foreign = await request(app).post(api(`/cargo/resolve-alert/${U.alB}`)).set(as('admin-a'));
    const ghost = await request(app).post(api(`/cargo/resolve-alert/${U.ghost}`)).set(as('admin-a'));
    expect(foreign.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect(foreign.body).toEqual(ghost.body);
    expect(supabaseMock.rows('maintenance_alerts').find(r => r.id === U.alB)!.is_resolved).toBe(false);
    const own = await request(app).post(api(`/cargo/resolve-alert/${U.alA}`)).set(as('admin-a'));
    expect(own.status).toBe(200);
  });

  it('POST /cargo/optimize-pooling with another company\'s vehicle is a 404', async () => {
    const res = await request(app).post(api('/cargo/optimize-pooling')).set(as('admin-a')).send({ shipment_ids: [U.sA, U.sB], vehicle_id: U.vB });
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('Vehicle not found');
  });

  it('POST /cargo/verify-pod for another company\'s shipment is a 404 and delivers nothing', async () => {
    const res = await request(app).post(api('/cargo/verify-pod')).set(as('admin-a')).send({ tracking_id: 'RTX-BETA1', recipient_name: 'Bob', reason: 'handed over at gate' });
    expect(res.status).toBe(404);
    expect(supabaseMock.rows('shipments').find(r => r.id === U.sB)!.status).toBe('created');
  });
});

describe('an id that cannot exist is a 404, not a database error', () => {
  it.each([
    ['post', '/fleet/alerts/x/resolve'],
    ['post', '/fleet/alerts/x/acknowledge'],
    ['put', '/fleet/fuel-logs/x'],
    ['delete', '/fleet/fuel-logs/x'],
    ['get', '/fleet/fuel-logs/x/bill-url'],
    ['get', '/fleet/vehicles/x/health'],
    ['post', '/cargo/resolve-alert/x'],
  ] as const)('%s %s', async (method, path) => {
    const res = await (request(app) as any)[method](api(path)).set(as('admin-a')).send({});
    expect(res.status).toBe(404);
  });

  it('GET /fleet/fuel-logs/:id/bill-url answers a company that does not run the vehicle exactly like a missing entry', async () => {
    const foreign = await request(app).get(api(`/fleet/fuel-logs/${U.flB}/bill-url`)).set(as('admin-a'));
    const ghost = await request(app).get(api(`/fleet/fuel-logs/${U.ghost}/bill-url`)).set(as('admin-a'));
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(ghost.body);
  });
});

describe('a case is raised only on a vehicle the company runs', () => {
  it('POST /cargo/exceptions naming another company\'s vehicle is a 404 and writes nothing', async () => {
    supabaseMock.reset({ ...orgWorld(), vehicles: [vehicle(U.vA, ORG.companyA, 'MH01AA0001'), vehicle(U.vB, ORG.companyB, 'MH01BB0001')], cargo_exceptions: [], cargo_exception_items: [], notifications: [] });
    const foreign = await request(app).post(api('/cargo/exceptions')).set(as('admin-a')).send({ type: 'damage', severity: 'low', vehicle_id: U.vB, description: 'not ours' });
    expect(foreign.status).toBe(404);
    expect(supabaseMock.rows('cargo_exceptions')).toHaveLength(0);
    const own = await request(app).post(api('/cargo/exceptions')).set(as('admin-a')).send({ type: 'damage', severity: 'low', vehicle_id: U.vA, description: 'ours' });
    expect(own.status).toBe(201);
    const malformed = await request(app).post(api('/cargo/exceptions')).set(as('admin-a')).send({ type: 'damage', vehicle_id: 'x', description: 'bad id' });
    expect(malformed.status).toBe(404);
  });
});
