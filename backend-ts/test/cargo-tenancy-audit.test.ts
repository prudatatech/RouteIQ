/**
 * Found by the cargo workflow audit on the test stage: another company's staff could confirm delivery of a
 * shipment by tracking id (verify-pod) and drop goods at another company's hub. Both are a 404 now, and a
 * vendor load put in a hub comes off the truck's load until a truck collects it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, cargoWorld, one } from './support/cargo-world';
import { ORG, ORG_SETTINGS, as, orgWorld } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

beforeEach(() => {
  invalidateDriverVehicles();
  const base = cargoWorld();
  const org = orgWorld();
  supabaseMock.reset(cargoWorld({
    ...org,
    users: [...base.users, ...org.users],
    shipments: base.shipments.map(s => ({ ...s, carrier_org_id: ORG.companyA })),
    depots: base.depots.map(d => ({ ...d, carrier_org_id: ORG.companyA })),
    vehicles: base.vehicles.map(v => ({ ...v, carrier_org_id: ORG.companyA })),
    system_settings: [...ORG_SETTINGS],
  }));
});

describe('another company', () => {
  it('cannot confirm delivery of our shipment by its tracking id', async () => {
    const tracking = one('shipments', ID.s1).tracking_id;
    const res = await request(app).post(api('/cargo/verify-pod')).set(as('admin-b', ORG.companyB))
      .send({ tracking_id: tracking, recipient_name: 'Intruder', reason: 'I am another company' });
    expect(res.status).toBe(404);
    expect(one('shipments', ID.s1).status).not.toBe('delivered');
  });

  it('cannot drop goods at our hub', async () => {
    const res = await request(app).post(api('/cargo/custody')).set(as('admin-b', ORG.companyB))
      .send({ ref: { shipment_id: ID.s1 }, kind: 'hub_in', depot_id: ID.depot, pieces: 10 });
    expect(res.status).toBe(404);
  });

  it('cannot claim on our shipment, nor add documents to our claim', async () => {
    const bad = await request(app).post(api('/cargo/claims')).set(as('admin-b', ORG.companyB))
      .send({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 10 });
    expect(bad.status).toBe(404);
    const mine = await request(app).post(api('/cargo/claims')).set(as('admin-a', ORG.companyA))
      .send({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 100 });
    expect(mine.status).toBe(201);
    const docs = await request(app).post(api(`/cargo/claims/${mine.body.id}/documents-upload-url`)).set(as('admin-b', ORG.companyB))
      .send({ content_type: 'image/png', size: 100 });
    expect(docs.status).toBe(404);
  });
});

describe('claim amounts', () => {
  it('never approve more than was claimed, nor settle more than was approved', async () => {
    const made = await request(app).post(api('/cargo/claims')).set(as('admin-a', ORG.companyA))
      .send({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 1000 });
    const patch = (body: object) => request(app).patch(api(`/cargo/claims/${made.body.id}`)).set(as('admin-a', ORG.companyA)).send(body);
    expect((await patch({ status: 'filed' })).status).toBe(200);
    expect((await patch({ status: 'approved', approved_amount: 5000 })).status).toBe(422);
    expect((await patch({ status: 'approved', approved_amount: 800 })).status).toBe(200);
    expect((await patch({ status: 'settled', settled_amount: 900 })).status).toBe(422);
    expect((await patch({ status: 'settled', settled_amount: 800 })).status).toBe(200);
  });
});
