import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const adminToken = () => supabaseMock.signUserToken('admin-1');

describe('vehicle document numbers round-trip', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vehicles: [],
    });
  });

  it('stores every document number, including fitness_certificate_number', async () => {
    const docs = {
      rc_number: 'MH01AB1234',
      insurance_number: 'INS-1',
      fitness_certificate_number: 'FIT-77',
      permit_number: 'PER-9',
      puc_number: 'PUC-3',
      fitness_expiry: '2030-01-01',
    };
    const res = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ plate_number: 'MH01AB1234', vehicle_type: 'truck', capacity_kg: 5000, ...docs });
    expect(res.status).toBeLessThan(300);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject(docs);
    expect(res.body).toMatchObject(docs);
  });
});
