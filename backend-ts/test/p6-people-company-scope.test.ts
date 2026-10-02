/**
 * Tenancy audit (area 6): checks on a person's profile are made inside the company. An employee code another company
 * already uses is not a clash (and never names that company's person); a base depot or reporting manager of another
 * company is refused.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { clearAllMemos } from '../src/core/memo';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const DEPOT_A = 'd0000000-0000-4000-8000-0000000000a1';
const DEPOT_B = 'd0000000-0000-4000-8000-0000000000b1';

beforeEach(() => {
  clearAllMemos();
  supabaseMock.reset({
    ...orgWorld(),
    user_profiles: [
      { user_id: uid('driver-a'), employee_code: 'E001' },
      { user_id: uid('admin-b'), employee_code: 'E002' },
    ],
    depots: [
      { id: DEPOT_A, name: 'Alpha yard', address: 'A', latitude: 19.1, longitude: 72.9, carrier_org_id: ORG.companyA },
      { id: DEPOT_B, name: 'Beta yard', address: 'B', latitude: 28.6, longitude: 77.2, carrier_org_id: ORG.companyB },
    ],
    user_activity: [], user_status_history: [], user_phone_history: [], vehicles: [], routes: [],
  });
});

const patch = (who: string, id: string, body: Record<string, unknown>) => request(app).patch(api(`/people/${id}`)).set(as(who)).send(body);

describe('employee codes are unique within a company', () => {
  it('lets company B use a code company A already uses, without naming A\'s person', async () => {
    const res = await patch('admin-b', uid('driver-b'), { employee_code: 'E001' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Ravi');
    expect(supabaseMock.rows('user_profiles').find(p => p.user_id === uid('driver-b'))!.employee_code).toBe('E001');
  });

  it('still refuses a code a colleague in the same company has', async () => {
    const res = await patch('admin-b', uid('driver-b'), { employee_code: 'E002' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/already used/i);
  });
});

describe('a base depot and a reporting manager come from the company', () => {
  it('refuses another company\'s depot, accepts its own', async () => {
    expect((await patch('admin-b', uid('driver-b'), { base_depot_id: DEPOT_A })).status).toBe(400);
    expect((await patch('admin-b', uid('driver-b'), { base_depot_id: DEPOT_B })).status).toBe(200);
  });

  it('refuses a reporting manager from another company', async () => {
    expect((await patch('admin-b', uid('driver-b'), { reporting_manager_id: uid('admin-a') })).status).toBe(400);
    expect((await patch('admin-b', uid('driver-b'), { reporting_manager_id: uid('admin-b') })).status).toBe(200);
  });
});

describe('a phone number another company\'s person holds', () => {
  it('is refused without naming them, and a former employee\'s number is never taken from their record', async () => {
    const res = await request(app).post(api('/people')).set(as('admin-b')).send({ role: 'driver', full_name: 'New Driver', phone: '9876500001' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/already registered to another account/i);
    expect(JSON.stringify(res.body)).not.toMatch(/Ravi|existing_person/);
    expect(supabaseMock.rows('users').find(u => u.id === uid('driver-a'))!.phone).toBe('+919876500001');
  });
  it('is still named to the company that holds it', async () => {
    const res = await request(app).post(api('/people')).set(as('admin-b')).send({ role: 'driver', full_name: 'New Driver', phone: '9876500002' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/Sunil Beta/);
  });
});
