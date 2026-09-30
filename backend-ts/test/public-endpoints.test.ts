import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();

beforeEach(() => {
  supabaseMock.reset({
    users: [{ id: 'vendor-1', role: 'vendor', is_active: true }],
    vendor_profiles: [],
    shipments: [],
    tpl_partners: [],
  });
});

describe('public endpoints are rate limited', () => {
  it('slows down tracking-id lookups from one address', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await request(app).get('/api/v1/shipments/track/RTX-NOPE0000')).status;
    }
    expect(last).toBe(429);
  });

  it('slows down 3PL application lookups from one address', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await request(app).get('/api/v1/tpl/acme_3pl')).status;
    }
    expect(last).toBe(429);
  });
});

describe('endpoints that spend money or reveal data need a signed-in caller', () => {
  it('takes no coordinates on the public tracking route, so it is not an open directions proxy', async () => {
    // Coordinates in the query are ignored; an unknown tracking id gets a 404 and nothing is routed
    const res = await request(app).get('/api/v1/shipments/track/RTX-NOPE0000/route?lat=1&lng=1&dLat=2&dLng=2');
    expect(res.status).toBe(404);
  });

  it('does not let vendors read fleet analytics or the driver ETA model', async () => {
    const vendor = { Authorization: `Bearer ${supabaseMock.signUserToken('vendor-1')}` };
    expect((await request(app).get('/api/v1/analytics/metrics').set(vendor)).status).toBe(403);
    expect((await request(app).get('/api/v1/analytics/audit-logs').set(vendor)).status).toBe(403);
    expect((await request(app).post('/api/v1/optimize/eta').set(vendor).send({ distance_km: 10 })).status).toBe(403);
    expect((await request(app).post('/api/v1/optimize/eta').send({ distance_km: 10 })).status).toBe(401);
  });
});
