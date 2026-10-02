/**
 * Azure parity sweep (docs/uat/findings/PARITY.md): database refusals that are the caller's doing answer 4xx, never 500,
 * an empty vehicle edit is a 400 (PostgREST refuses an empty UPDATE), and the delivery-points query names the one foreign
 * key to shipments (the table has two, so an unnamed embed answers PGRST201 on a real database).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientDatabaseError, sendError } from '../src/core/errors';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';

const app = testApp();

describe('database refusals caused by the request', () => {
  const fakeRes = () => {
    const res: any = { headersSent: false, statusCode: 0, body: undefined, getHeader: () => 'rid' };
    res.status = (s: number) => { res.statusCode = s; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
  };

  it('maps a malformed uuid, a duplicate and a dangling reference to 400 / 409 / 409', () => {
    expect(clientDatabaseError({ code: '22P02', message: 'invalid input syntax for type uuid: "x"' })).toMatchObject({ status: 400 });
    expect(clientDatabaseError({ code: '23505' })).toMatchObject({ status: 409 });
    expect(clientDatabaseError({ code: '23503' })).toMatchObject({ status: 409 });
    expect(clientDatabaseError({ code: 'XX000' })).toBeNull();
    expect(clientDatabaseError(new Error('boom'))).toBeNull();
  });

  it('sendError answers those with the code, without the database text, and everything else with 500', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = fakeRes();
    sendError({ method: 'GET', originalUrl: '/x' } as any, bad, { code: '22P02', message: 'invalid input syntax for type uuid: "x"' });
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/uuid|syntax/);
    const dup = fakeRes();
    sendError({ method: 'POST', originalUrl: '/x' } as any, dup, { code: '23505', message: 'duplicate key value violates unique constraint' }, 'error');
    expect(dup.statusCode).toBe(409);
    expect(dup.body).toEqual({ error: 'That already exists' });
    const other = fakeRes();
    sendError({ method: 'GET', originalUrl: '/x' } as any, other, new Error('boom'));
    expect(other.statusCode).toBe(500);
  });
});

describe('PATCH /vehicles/:id', () => {
  beforeEach(() => {
    supabaseMock.reset(orgWorld({ vehicles: [{ id: uid('veh-1'), plate_number: 'MH12AB1234', status: 'available', capacity_kg: 9000, carrier_org_id: ORG.companyA }] }));
  });

  it('an edit that changes nothing is a 400, not a database error', async () => {
    const res = await request(app).patch(`/api/v1/vehicles/${uid('veh-1')}`).set(as('admin-a')).send({});
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Nothing to update');
  });
});

describe('delivery points query', () => {
  it('names the foreign key to the shipment it belongs to', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'routes.routes.ts'), 'utf8');
    expect(src).toContain('shipments!delivery_points_shipment_id_fkey(carrier_org_id)');
    expect(src).not.toMatch(/'\*, shipments\(carrier_org_id\)/);
  });
});

describe('GET /vendor/shipment-request/pending', () => {
  it('lists a load that has no vendor user instead of failing on a null id', async () => {
    supabaseMock.reset(orgWorld({
      vendor_profiles: [],
      vendor_shipment_requests: [{ id: uid('load-1'), vendor_id: null, vendor_org_id: ORG.vendorV, status: 'pending', routing: 'open', created_at: new Date().toISOString(), metadata: {} }],
    }));
    const res = await request(app).get('/api/v1/vendor/shipment-request/pending').set(as('super-1', ORG.platform));
    expect(res.status).toBe(200);
    expect(res.body.every((r: any) => r.vendor_profiles === null)).toBe(true);
  });
});
