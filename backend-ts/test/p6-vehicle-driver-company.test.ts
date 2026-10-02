/**
 * Tenancy audit (area 6): a vehicle's driver belongs to the company that runs the vehicle. Company B could put company
 * A's driver on its own vehicle by their phone number (or by id) and rename them through it; a driver B created from a
 * vehicle form was left in the default company. Now only a member of the acting company can be linked, and a new
 * driver joins the company that added them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { clearAllMemos } from '../src/core/memo';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const NOW = new Date().toISOString();
const VB = 'b1000000-0000-4000-8000-000000000001';
const body = (extra: Record<string, unknown> = {}) => ({ plate_number: 'MH12XY9999', vehicle_type: 'truck', capacity_kg: 3000, ...extra });

beforeEach(() => {
  clearAllMemos();
  supabaseMock.reset({
    ...orgWorld(),
    vehicles: [{ id: VB, plate_number: 'MH01BB0001', vehicle_type: 'truck', capacity_kg: 5000, status: 'available', carrier_org_id: ORG.companyB, created_at: NOW }],
    routes: [], sos_alerts: [], cargo_manifest: [],
  });
});

describe('putting a driver on a vehicle', () => {
  it('refuses another company\'s driver by phone number (409) and leaves them alone', async () => {
    const res = await request(app).post(api('/vehicles')).set(as('admin-b')).send(body({ driver_name: 'Ravi', driver_phone: '9876500001' }));
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/not in your company/i);
    expect(supabaseMock.rows('vehicles').filter(v => v.driver_id === uid('driver-a'))).toHaveLength(0);
  });

  it('refuses another company\'s driver by id on edit (404, like an unknown person), and ignores one on create', async () => {
    const created = await request(app).post(api('/vehicles')).set(as('admin-b')).send(body({ driver_id: uid('driver-a') }));
    expect([201, 404]).toContain(created.status);
    expect(supabaseMock.rows('vehicles').filter(v => v.driver_id === uid('driver-a'))).toHaveLength(0);
    const edited = await request(app).patch(api(`/vehicles/${VB}`)).set(as('admin-b')).send({ driver_id: uid('driver-a') });
    expect(edited.status).toBe(404);
    expect(supabaseMock.rows('vehicles').find(v => v.id === VB)!.driver_id ?? null).toBeNull();
  });

  it('does not rename another company\'s driver through an edit of its own vehicle', async () => {
    const edited = await request(app).patch(api(`/vehicles/${VB}`)).set(as('admin-b')).send({ driver_name: 'Renamed', driver_phone: '9876500001' });
    expect(edited.status).toBe(409);
    expect(supabaseMock.rows('users').find(u => u.id === uid('driver-a'))!.full_name).toBe('Ravi Alpha');
  });

  it('links the company\'s own driver by phone number, or by id', async () => {
    const byPhone = await request(app).post(api('/vehicles')).set(as('admin-b')).send(body({ driver_name: 'Sunil', driver_phone: '9876500002' }));
    expect(byPhone.status).toBe(201);
    expect(byPhone.body.driver_id).toBe(uid('driver-b'));
    const byId = await request(app).patch(api(`/vehicles/${VB}`)).set(as('admin-b')).send({ driver_id: uid('driver-b') });
    expect(byId.status).toBe(409); // already on the vehicle just made: one live vehicle per driver, not a company matter
  });

  it('puts a driver created from a vehicle form in the company that added them, not the default one', async () => {
    supabaseMock.authAdmin = true;
    const res = await request(app).post(api('/vehicles')).set(as('admin-b')).send(body({ driver_name: 'New Driver', driver_phone: '9811100077' }));
    expect(res.status).toBe(201);
    const id = res.body.driver_id as string;
    expect(id).toBeTruthy();
    expect(supabaseMock.rows('org_members').find(m => m.user_id === id && m.org_id === ORG.companyB)).toMatchObject({ status: 'active', role: 'driver' });
    expect(supabaseMock.rows('org_members').find(m => m.user_id === id && m.org_id === ORG.companyA)).toBeUndefined();
  });
});
