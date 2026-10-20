import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';

const app = testApp();
const staff = (id = 'admin-1') => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

const USERS = [
  { id: 'admin-1', role: 'admin', is_active: true },
  { id: 'super-1', role: 'superadmin', is_active: true },
  { id: 'manager-1', role: 'manager', is_active: true },
];

const veh = (over: Record<string, unknown> = {}) => ({
  id: 'veh-1', plate_number: 'MH01AB1234', vehicle_type: 'truck', capacity_kg: 5000, fuel_type: 'diesel', status: 'idle',
  rc_number: 'MH01AB1234', ...over,
});

function reset(vehicles: Record<string, unknown>[] = [veh()]) {
  supabaseMock.reset({
    users: USERS, vehicles, routes: [], sos_alerts: [], notifications: [], cargo_manifest: [], invoices: [], vehicle_rc_verifications: [],
  });
}

function configureCashfree(on: boolean) {
  Object.assign(settings, {
    CASHFREE_CLIENT_ID: on ? 'cf-client' : '',
    CASHFREE_CLIENT_SECRET: on ? 'cf-secret' : '',
    CASHFREE_VERIFICATION_BASE_URL: on ? 'https://sandbox.cashfree.com/verification' : '',
  });
}

beforeEach(() => {
  configureCashfree(false);
  reset();
});
afterEach(() => {
  configureCashfree(false);
  vi.restoreAllMocks();
});

describe('creating or updating a vehicle checks its RC', () => {
  it('records "not configured" and never blocks the save when Cashfree has no credentials', async () => {
    reset([]);
    const res = await request(app).post('/api/v1/vehicles').set(staff()).send({ plate_number: 'KA06AZ6020', vehicle_type: 'truck', rc_number: 'KA06AZ6020' });
    expect(res.status).toBe(201);
    expect(res.body.rc_verification_status).toBe('not_configured');
    expect(supabaseMock.rows('vehicle_rc_verifications')).toHaveLength(1);
    expect(supabaseMock.rows('vehicle_rc_verifications')[0]).toMatchObject({ status: 'not_configured', rc_number: 'KA06AZ6020' });
    expect(supabaseMock.rows('vehicles')[0].rc_verification_status).toBe('not_configured');
  });

  it('creates a vehicle with no RC number with nothing to verify', async () => {
    reset([]);
    const res = await request(app).post('/api/v1/vehicles').set(staff()).send({ plate_number: 'KA06AZ6020', vehicle_type: 'truck' });
    expect(res.status).toBe(201);
    expect(res.body.rc_verification_status).toBeUndefined();
    expect(supabaseMock.rows('vehicle_rc_verifications')).toHaveLength(0);
  });

  it('stores the full response and marks it valid when Cashfree confirms the RC', async () => {
    configureCashfree(true);
    reset([]);
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: {} });
    const get = vi.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: {
        verification_id: 'margix_abc', reference_id: 12345, status: 'VALID',
        reg_no: 'KA06AZ6020', chassis: 'CHASSIS123', engine: 'ENGINE456', class: 'LMV', owner: 'Ravi Kumar',
        rc_status: 'ACTIVE', rc_expiry_date: '15/08/2035', vehicle_insurance_upto: '01/01/2027', pucc_upto: '01/06/2026',
        vehicle_manufacturer_name: 'Ashok Leyland', model: 'Bada Dost',
      },
    });
    const res = await request(app).post('/api/v1/vehicles').set(staff()).send({ plate_number: 'KA06AZ6020', vehicle_type: 'truck', rc_number: 'KA06AZ6020' });
    expect(res.status).toBe(201);
    expect(res.body.rc_verification_status).toBe('valid');
    const row = supabaseMock.rows('vehicle_rc_verifications')[0];
    expect(row).toMatchObject({
      status: 'valid', chassis_number: 'CHASSIS123', engine_number: 'ENGINE456', vehicle_class: 'LMV',
      owner_name: 'Ravi Kumar', rc_status: 'ACTIVE', rc_expiry_date: '15/08/2035', insurance_upto: '01/01/2027',
      pucc_upto: '01/06/2026', manufacturer_name: 'Ashok Leyland', model_name: 'Bada Dost', reference_id: '12345',
    });
    expect(row.raw_response).toMatchObject({ status: 'VALID', owner: 'Ravi Kumar' });
    // Pre-fills the vehicle's own document fields from a confirmed check
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ rc_expiry: '2035-08-15', insurance_expiry: '2027-01-01', puc_expiry: '2026-06-01' });
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/verification/vehicle-rc'),
      expect.objectContaining({ vehicle_number: 'KA06AZ6020' }),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-client-id': 'cf-client', 'x-client-secret': 'cf-secret' }) }),
    );
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/verification/vehicle-rc'), expect.objectContaining({ params: { verification_id: expect.any(String) } }));
  });

  it('marks invalid when Cashfree says INVALID, and unavailable when it cannot be reached', async () => {
    configureCashfree(true);
    reset([]);
    vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: {} });
    vi.spyOn(axios, 'get').mockResolvedValueOnce({ status: 200, data: { status: 'INVALID' } });
    const invalid = await request(app).post('/api/v1/vehicles').set(staff()).send({ plate_number: 'MH12XY9999', vehicle_type: 'truck', rc_number: 'MH12XY9999' });
    expect(invalid.body.rc_verification_status).toBe('invalid');

    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('network down'));
    const unavailable = await request(app).post('/api/v1/vehicles').set(staff()).send({ plate_number: 'MH12XY8888', vehicle_type: 'truck', rc_number: 'MH12XY8888' });
    expect(unavailable.status).toBe(201); // still saves
    expect(unavailable.body.rc_verification_status).toBe('unavailable');
    expect(supabaseMock.rows('vehicle_rc_verifications').find(r => r.rc_number === 'MH12XY8888')?.error_message).toMatch(/network down/);
    // Neither an invalid nor an unreachable check pre-fills anything - only a confirmed one does
    expect(supabaseMock.rows('vehicles').find(v => v.plate_number === 'MH12XY9999')?.rc_expiry).toBeUndefined();
    expect(supabaseMock.rows('vehicles').find(v => v.plate_number === 'MH12XY8888')?.rc_expiry).toBeUndefined();
  });

  it('skips a date Cashfree sends in a shape that cannot be parsed, instead of writing something wrong', async () => {
    configureCashfree(true);
    reset([]);
    vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: {} });
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { status: 'VALID', rc_expiry_date: 'not-a-date', vehicle_insurance_upto: '31/13/2027' } });
    const res = await request(app).post('/api/v1/vehicles').set(staff()).send({ plate_number: 'MH12XY7777', vehicle_type: 'truck', rc_number: 'MH12XY7777' });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('vehicles')[0].rc_expiry).toBeUndefined();
    expect(supabaseMock.rows('vehicles')[0].insurance_expiry).toBeUndefined();
  });

  it('re-verifies on PATCH only when the RC number itself changes', async () => {
    const patch = (body: Record<string, unknown>) => request(app).patch('/api/v1/vehicles/veh-1').set(staff()).send(body);
    const unrelated = await patch({ driver_name: 'New Driver' });
    expect(unrelated.status).toBe(200);
    expect(supabaseMock.rows('vehicle_rc_verifications')).toHaveLength(0);

    const changed = await patch({ rc_number: 'MH01ZZ9999' });
    expect(changed.status).toBe(200);
    expect(changed.body.rc_verification_status).toBe('not_configured');
    expect(supabaseMock.rows('vehicle_rc_verifications')).toHaveLength(1);
    expect(supabaseMock.rows('vehicle_rc_verifications')[0].rc_number).toBe('MH01ZZ9999');
  });
});

describe('POST /vehicles/:id/verify-rc', () => {
  const verify = (id = 'veh-1', who = staff('super-1')) => request(app).post(`/api/v1/vehicles/${id}/verify-rc`).set(who);

  it('re-checks an existing vehicle\'s RC on demand', async () => {
    const res = await verify();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_configured');
    expect(supabaseMock.rows('vehicle_rc_verifications')).toHaveLength(1);
  });

  it('is for staff only', async () => {
    expect((await request(app).post('/api/v1/vehicles/veh-1/verify-rc')).status).toBe(401);
    expect((await verify('veh-1', staff('manager-1'))).status).toBe(200);
  });

  it('needs an RC number on file', async () => {
    reset([veh({ rc_number: null })]);
    expect((await verify()).status).toBe(400);
  });

  it('reports an unknown vehicle as not found', async () => {
    expect((await verify('nope')).status).toBe(404);
  });
});
