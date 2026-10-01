/**
 * UAT-012: a name is kept without stray spaces. Trimmed when a person or user is created or
 * updated, and trimmed when shown in the "people missing documents" notice, for names saved
 * before this rule ("Vishal ").
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { getPeopleAttention } from '../src/services/people-docs.service';

const app = testApp();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(2), DRV = id(4);
const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const admin = as(ADMIN, 'admin');
const driver = as(DRV, 'driver');
const row = (uid: string) => supabaseMock.rows('users').find(u => u.id === uid)!;

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: ADMIN, role: 'admin', is_active: true, status: 'active', full_name: 'Adam Admin', email: 'adam@x.in' },
      { id: DRV, role: 'driver', is_active: true, status: 'active', full_name: 'Vishal ', phone: '+919876500001' },
    ],
    user_profiles: [], user_documents: [], user_activity: [], user_status_history: [], user_phone_history: [], user_bank_accounts: [],
    user_emergency_contacts: [], user_notes: [], notifications: [], vehicles: [], routes: [], system_settings: [],
    driver_vehicle_assignments: [], route_stops: [], shipments: [], depots: [], tpl_partners: [], ai_agent_logs: [],
  });
  supabaseMock.authAdmin = true;
});

describe('names are trimmed on write', () => {
  it('when a person is created', async () => {
    const res = await request(app).post('/api/v1/people').set(admin).send({ role: 'driver', full_name: '  New Driver  ', phone: '98765 00009' });
    expect(res.status).toBe(201);
    expect(res.body.user.full_name).toBe('New Driver');
    expect(supabaseMock.rows('users').find(u => u.phone === '+919876500009')!.full_name).toBe('New Driver');
  });

  it('when a person is updated', async () => {
    const res = await request(app).patch(`/api/v1/people/${DRV}`).set(admin).send({ full_name: ' Vishal Kumar ' });
    expect(res.status).toBe(200);
    expect(row(DRV).full_name).toBe('Vishal Kumar');
  });

  it('when a user is updated from the users list', async () => {
    const res = await request(app).patch(`/api/v1/users/${DRV}`).set(admin).send({ full_name: '  Vishal  ' });
    expect(res.status).toBe(200);
    expect(row(DRV).full_name).toBe('Vishal');
    expect((await request(app).patch(`/api/v1/users/${DRV}`).set(admin).send({ full_name: '   ' })).status).toBe(400);
  });

  it('when a driver edits their own profile', async () => {
    const res = await request(app).put('/api/v1/auth/driver/profile').set(driver).send({ full_name: ' Vishal Singh ' });
    expect(res.status).toBe(200);
    expect(row(DRV).full_name).toBe('Vishal Singh');
  });

  it('when a vehicle names its driver', async () => {
    const res = await request(app).post('/api/v1/vehicles').set(admin)
      .send({ plate_number: 'DL01AL0010', vehicle_type: 'truck', capacity_kg: 1000, driver_name: ' Munna  ' });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('vehicles').find(v => v.plate_number === 'DL01AL0010')!.driver_name).toBe('Munna');
  });
});

describe('the "people missing documents" notice', () => {
  it('shows names without the stray spaces already saved', async () => {
    const attention = await getPeopleAttention(10);
    const names = attention.missing_required.map(m => m.full_name);
    expect(names).toContain('Vishal');
    expect(names).not.toContain('Vishal ');
    const api = await request(app).get('/api/v1/dashboard/people-attention').set(admin);
    expect(api.body.missing_required.map((m: any) => m.full_name)).toContain('Vishal');
  });
});
