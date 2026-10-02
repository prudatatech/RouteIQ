/**
 * Findings of the fleet and people audit on the hosted test stage (docs/uat/findings/FLEET.md):
 *  - a capacity edit moves the free space (the lookup of the carried load used the wrong route parameter);
 *  - a stoppage carries its own id (the Azure table has no default for it);
 *  - another company's person is never named when a phone, email or code is already taken.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

const truck = (over: Record<string, unknown> = {}) => ({
  id: 'veh-1', plate_number: 'MH01AB1234', vehicle_type: 'truck', capacity_kg: 5000, available_capacity_kg: 4000, current_load_kg: 1000,
  fuel_type: 'diesel', status: 'idle', carrier_org_id: ORG.companyA, ...over,
});

beforeEach(() => supabaseMock.reset(orgWorld({ vehicles: [truck()], vehicle_stoppages: [], user_profiles: [], user_phone_history: [], user_status_history: [] })));

describe('capacity edit', () => {
  it('moves the free space with the capacity and leaves the load it carries alone', async () => {
    const bigger = await request(app).patch(api('/vehicles/veh-1')).set(as('admin-a')).send({ capacity_kg: 9000 });
    expect(bigger.status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ capacity_kg: 9000, available_capacity_kg: 8000, current_load_kg: 1000 });

    const smaller = await request(app).patch(api('/vehicles/veh-1')).set(as('admin-a')).send({ capacity_kg: 1500 });
    expect(smaller.status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ capacity_kg: 1500, available_capacity_kg: 500 });
  });
});

describe('stoppages', () => {
  it('are saved with an id of their own', async () => {
    const res = await request(app).post(api('/telemetry/stoppages')).set(as('admin-a')).send({ vehicle_id: 'veh-1', lat: 19.1, lng: 72.9, reason: 'traffic' });
    expect(res.status).toBe(201);
    const row = supabaseMock.rows('vehicle_stoppages')[0];
    expect(row.id).toEqual(expect.any(String));
    expect(row.vehicle_id).toBe('veh-1');
  });
});

describe('a phone number somebody already uses', () => {
  const newDriver = (who: string, phone: string) => request(app).post(api('/people')).set(as(who)).send({ role: 'driver', full_name: 'New Driver', phone });

  it("names the person to their own company's admin", async () => {
    const res = await newDriver('admin-a', '+919876500001');
    expect(res.status).toBe(409);
    expect(res.body.existing_person).toMatchObject({ id: uid('driver-a'), full_name: 'Ravi Alpha' });
  });

  it("does not name, identify or describe another company's person", async () => {
    const res = await newDriver('admin-b', '+919876500001');
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/Ravi|existing_person/);
    expect(JSON.stringify(res.body)).not.toContain(uid('driver-a'));
  });
});
