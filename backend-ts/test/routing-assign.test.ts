/**
 * Assigning a vehicle to a load awarded to a company (docs/order-routing.md): only the carrier company, only its own
 * vehicles, and only vehicles that fit the goods (hazmat certified, reefer for a temperature range, open body for ODC);
 * and the scheduler: quotes expire, quiet loads are escalated once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, uid } from './support/org-world';
import { L, loadRow, notesFor, quoteRow, routingWorld } from './support/routing-world';
import { assertVehicleFits, vehicleFitProblem } from '../src/services/loads/vehicle-fit';
import { escalateQuietLoads, expireQuotes } from '../src/services/loads/order-routing';
import { runSchedulerTick } from '../src/services/scheduler.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const adminA = () => as('admin-a', ORG.companyA);
const adminB = () => as('admin-b', ORG.companyB);
const platform = () => as('super-1', ORG.platform);

describe('vehicleFitProblem / assertVehicleFits', () => {
  const closed = { plate_number: 'MH12AB1234', body_type: 'closed', hazmat_certified: false, is_reefer: false };

  it('fits a plain load on any vehicle', () => {
    expect(vehicleFitProblem({}, closed)).toBeNull();
    expect(vehicleFitProblem({ special_handling: ['fragile'], items: [{ is_hazmat: false, is_perishable: false }] }, {})).toBeNull();
  });

  it('needs a hazmat certified vehicle for hazardous goods, however the load says so', () => {
    for (const load of [{ hazmat_mixed: true }, { special_handling: ['hazmat'] }, { items: [{ is_hazmat: true }] }]) {
      expect(vehicleFitProblem(load, closed)).toMatch(/not hazmat certified/);
      expect(vehicleFitProblem(load, { ...closed, hazmat_certified: true })).toBeNull();
    }
  });

  it('needs a reefer for a perishable load with a temperature range, and not for ambient or a plain range', () => {
    const cold = { items: [{ is_perishable: true }], temp_min_c: 2, temp_max_c: 8 };
    expect(vehicleFitProblem(cold, closed)).toMatch(/not a reefer/);
    expect(vehicleFitProblem(cold, { ...closed, is_reefer: true })).toBeNull();
    expect(vehicleFitProblem(cold, { ...closed, body_type: 'reefer' })).toBeNull();
    expect(vehicleFitProblem({ items: [{ is_perishable: true }] }, closed)).toBeNull();
    expect(vehicleFitProblem({ items: [{ is_perishable: false }], temp_min_c: 2, temp_max_c: 8 }, closed)).toBeNull();
    expect(vehicleFitProblem({ items: [{ is_perishable: true }], temp_min_c: '-18', temp_max_c: null }, closed)).toMatch(/not a reefer/);
  });

  it('needs an open or trailer body for ODC, and says to set the body when it is unknown', () => {
    const odc = { special_handling: ['odc'] };
    expect(vehicleFitProblem(odc, closed)).toMatch(/closed body.*open or trailer/);
    expect(vehicleFitProblem(odc, { ...closed, body_type: 'container' })).toMatch(/container body/);
    expect(vehicleFitProblem(odc, { plate_number: 'MH12AB1234' })).toMatch(/no body type set/);
    expect(vehicleFitProblem(odc, { ...closed, body_type: 'open' })).toBeNull();
    expect(vehicleFitProblem(odc, { ...closed, body_type: 'trailer' })).toBeNull();
  });

  it('throws a 409 with the reason', () => {
    expect(() => assertVehicleFits({ hazmat_mixed: true }, closed)).toThrowError(/hazmat/);
    try { assertVehicleFits({ hazmat_mixed: true }, closed); } catch (e: any) { expect(e.status).toBe(409); }
  });
});

describe('PUT /vendor/shipment-request/:id/assign-vehicle', () => {
  const VA = 'e1000000-0000-4000-8000-0000000000a1';
  const VB = 'e1000000-0000-4000-8000-0000000000b1';
  const VA_HAZ = 'e1000000-0000-4000-8000-0000000000a2';
  const VA_REEFER = 'e1000000-0000-4000-8000-0000000000a3';
  const VA_OPEN = 'e1000000-0000-4000-8000-0000000000a4';
  const HAZ = 'e2000000-0000-4000-8000-000000000001';
  const COLD = 'e2000000-0000-4000-8000-000000000002';
  const ODC = 'e2000000-0000-4000-8000-000000000003';

  const vehicle = (id: string, org: string, plate: string, over: Row = {}): Row => ({
    id, plate_number: plate, status: 'available', capacity_kg: 10000, current_load_kg: 0, available_capacity_kg: 10000, driver_id: uid('driver-a'),
    carrier_org_id: org, hazmat_certified: false, is_reefer: false, body_type: 'closed', ...over,
  });
  const awarded = (id: string, over: Row = {}) => loadRow(id, { status: 'approved', carrier_org_id: ORG.companyA, cost: 18000, awarded_at: new Date().toISOString(), ...over });
  const assign = (who: Record<string, string>, id: string, vehicle_id: string) =>
    request(app).put(api(`/vendor/shipment-request/${id}/assign-vehicle`)).set(who).send({ vehicle_id });
  const manifests = () => supabaseMock.rows('cargo_manifest');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    routingWorld({
      vendor_shipment_requests: [
        awarded(L.awardedA),
        awarded(HAZ, { hazmat_mixed: true, special_handling: ['hazmat'] }),
        awarded(COLD, { temp_min_c: 2, temp_max_c: 8 }),
        awarded(ODC, { special_handling: ['odc'] }),
        loadRow(L.open),
      ],
      load_items: [
        { id: 'i-cold', load_id: COLD, line_no: 1, product_name: 'Milk', is_hazmat: false, is_perishable: true },
        { id: 'i-haz', load_id: HAZ, line_no: 1, product_name: 'Paint thinner', is_hazmat: true, is_perishable: false },
      ],
      vehicles: [
        vehicle(VA, ORG.companyA, 'MH01AA0001'),
        vehicle(VB, ORG.companyB, 'MH01BB0001'),
        vehicle(VA_HAZ, ORG.companyA, 'MH01AA0002', { hazmat_certified: true }),
        vehicle(VA_REEFER, ORG.companyA, 'MH01AA0003', { is_reefer: true, body_type: 'reefer' }),
        vehicle(VA_OPEN, ORG.companyA, 'MH01AA0004', { body_type: 'open' }),
      ],
      cargo_manifest: [], shipments: [], routes: [],
    });
  });

  it('assigns the awarded company\'s own vehicle, and the manifest carries the carrier and the vendor', async () => {
    const res = await assign(adminA(), L.awardedA, VA);
    expect(res.status).toBe(200);
    expect(manifests()[0]).toMatchObject({ carrier_org_id: ORG.companyA, vendor_org_id: ORG.vendorV, vehicle_id: VA });
    expect(supabaseMock.rows('vendor_shipment_requests').find(r => r.id === L.awardedA)).toMatchObject({ status: 'assigned', assigned_vehicle_id: VA, carrier_org_id: ORG.companyA });
  });

  it('refuses another company\'s vehicle', async () => {
    const res = await assign(adminA(), L.awardedA, VB);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Vehicle not found/);
    expect(manifests()).toHaveLength(0);
    expect(supabaseMock.rows('vendor_shipment_requests').find(r => r.id === L.awardedA)!.status).toBe('approved');
  });

  it('refuses a company that was not awarded the load, with its own vehicle, and a load nobody has won yet', async () => {
    const other = await assign(adminB(), L.awardedA, VB);
    expect(other.status).toBe(404);
    expect(other.body.error).toMatch(/Request not found/);
    expect((await assign(adminA(), L.open, VA)).status).toBe(409);
    expect(manifests()).toHaveLength(0);
  });

  it('lets a platform admin assign, but still only a vehicle of the carrier company', async () => {
    expect((await assign(platform(), L.awardedA, VB)).status).toBe(404);
    expect((await assign(platform(), L.awardedA, VA)).status).toBe(200);
  });

  it('refuses a hazmat load on a vehicle that is not hazmat certified, and takes a certified one', async () => {
    const res = await assign(adminA(), HAZ, VA);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/hazmat certified/);
    expect(manifests()).toHaveLength(0);
    expect((await assign(adminA(), HAZ, VA_HAZ)).status).toBe(200);
  });

  it('refuses a perishable load with a temperature range on a non-reefer, and takes a reefer', async () => {
    const res = await assign(adminA(), COLD, VA);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not a reefer/);
    expect((await assign(adminA(), COLD, VA_REEFER)).status).toBe(200);
  });

  it('refuses ODC on a closed body, and takes an open one', async () => {
    const res = await assign(adminA(), ODC, VA);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/open or trailer/);
    expect((await assign(adminA(), ODC, VA_OPEN)).status).toBe(200);
  });

  it('leaves the vehicle free when the fit check refuses it', async () => {
    await assign(adminA(), HAZ, VA);
    expect(supabaseMock.rows('vehicles').find(v => v.id === VA)).toMatchObject({ status: 'available', current_load_kg: 0 });
  });
});

describe('the scheduler', () => {
  const past = (ms = 3_600_000) => new Date(Date.now() - ms).toISOString();
  const future = (ms = 3_600_000) => new Date(Date.now() + ms).toISOString();
  const rowOf = (table: string, id: string) => supabaseMock.rows(table).find(r => r.id === id)!;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('expiring quotes', () => {
    it('turns a submitted quote past its validity into expired, tells its company, and leaves the rest', async () => {
      routingWorld();
      const stale = quoteRow(L.open, ORG.companyA, 1000, { valid_until: past() });
      const fresh = quoteRow(L.open, ORG.companyB, 1000, { valid_until: future() });
      const open = quoteRow(L.quoteReq, ORG.companyA, 1000, { valid_until: null });
      const accepted = quoteRow(L.awardedA, ORG.companyA, 1000, { valid_until: past(), status: 'accepted' });
      const withdrawn = quoteRow(L.quoteReq, ORG.companyB, 1000, { valid_until: past(), status: 'withdrawn' });
      supabaseMock.rows('load_quotes').push(stale, fresh, open, accepted, withdrawn);
      expect(await expireQuotes()).toBe(1);
      expect(rowOf('load_quotes', stale.id).status).toBe('expired');
      expect([fresh, open, accepted, withdrawn].map(q => rowOf('load_quotes', q.id).status)).toEqual(['submitted', 'submitted', 'accepted', 'withdrawn']);
      expect(notesFor('admin-a', 'quote_expired')).toHaveLength(1);
      expect(notesFor('admin-b', 'quote_expired')).toHaveLength(0);
      // A second pass finds nothing
      expect(await expireQuotes()).toBe(0);
      expect(notesFor('admin-a', 'quote_expired')).toHaveLength(1);
    });

    it('frees the company to quote again once its old quote has expired', async () => {
      routingWorld();
      supabaseMock.rows('load_quotes').push(quoteRow(L.open, ORG.companyA, 1000, { valid_until: past() }));
      await expireQuotes();
      const res = await request(app).post(api(`/company/loads/${L.open}/quotes`)).set(adminA()).send({ amount_inr: 900 });
      expect(res.status).toBe(201);
      expect(supabaseMock.rows('load_quotes').map(q => q.status).sort()).toEqual(['expired', 'submitted']);
    });
  });

  describe('escalating quiet loads', () => {
    const quiet = (id: string, over: Row = {}) => loadRow(id, { quote_requested: true, quote_deadline: past(), ...over });
    const Q1 = 'f1000000-0000-4000-8000-000000000001';
    const Q2 = 'f1000000-0000-4000-8000-000000000002';
    const Q3 = 'f1000000-0000-4000-8000-000000000003';
    const Q4 = 'f1000000-0000-4000-8000-000000000004';
    const Q5 = 'f1000000-0000-4000-8000-000000000005';
    const Q6 = 'f1000000-0000-4000-8000-000000000006';

    it('tells the platform admins and the vendor, once, only for loads that asked for quotes and got none by the deadline', async () => {
      routingWorld({
        vendor_shipment_requests: [
          quiet(Q1),
          quiet(Q2),                                       // has a live quote
          quiet(Q3, { quote_deadline: future() }),          // deadline not passed
          loadRow(Q4, { quote_requested: false }),          // no quote asked for
          quiet(Q5, { metadata: { hold: 'vendor_unverified' } }), // held
          quiet(Q6, { status: 'approved', carrier_org_id: ORG.companyA }), // already awarded
        ],
      });
      supabaseMock.rows('load_quotes').push(quoteRow(Q2, ORG.companyA, 5000));
      expect(await escalateQuietLoads()).toBe(1);
      expect(rowOf('vendor_shipment_requests', Q1).quote_escalated_at).toBeTruthy();
      for (const id of [Q2, Q3, Q4, Q5, Q6]) expect(rowOf('vendor_shipment_requests', id).quote_escalated_at, id).toBeNull();
      // The platform's owners and admins are told: not a company's staff
      expect(notesFor('super-1', 'vendor_request')).toHaveLength(1);
      expect(notesFor('admin-a', 'vendor_request')).toHaveLength(0);
      expect(notesFor('admin-b', 'vendor_request')).toHaveLength(0);
      expect(notesFor('manager-a', 'vendor_request')).toHaveLength(0);
      expect(notesFor('vendor-1', 'quote_delayed')).toHaveLength(1);
      expect(notesFor('vendor-1', 'quote_delayed')[0].body).toMatch(/Companies need a little longer|asked companies/);
      expect(notesFor('vendor-1', 'quote_delayed')[0].title).toBe('Companies need a little longer');
      // Once only
      expect(await escalateQuietLoads()).toBe(0);
      expect(notesFor('super-1', 'vendor_request')).toHaveLength(1);
      expect(notesFor('vendor-1', 'quote_delayed')).toHaveLength(1);
    });

    it('counts an expired or withdrawn quote as no quote', async () => {
      routingWorld({ vendor_shipment_requests: [quiet(Q1)] });
      supabaseMock.rows('load_quotes').push(quoteRow(Q1, ORG.companyA, 5000, { status: 'expired' }), quoteRow(Q1, ORG.companyB, 5000, { status: 'withdrawn' }));
      expect(await escalateQuietLoads()).toBe(1);
    });

    it('is run by the scheduler tick every 15 minutes, expiry first', async () => {
      routingWorld({ vendor_shipment_requests: [quiet(Q1)] });
      supabaseMock.rows('load_quotes').push(quoteRow(Q1, ORG.companyA, 5000, { valid_until: past() }));
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(Date.now() + 16 * 60_000 + 1_000_000_000);
        await runSchedulerTick();
      } finally {
        vi.useRealTimers();
      }
      expect(supabaseMock.rows('load_quotes')[0].status).toBe('expired');
      expect(rowOf('vendor_shipment_requests', Q1).quote_escalated_at).toBeTruthy();
    });
  });
});
