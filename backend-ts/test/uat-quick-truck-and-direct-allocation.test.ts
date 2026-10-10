/**
 * UAT Test Suite: Quick Truck Onboarding, Multi-tenant 3PL Isolation & Direct Load Allocation
 * Verifies spec v1.0 and user acceptance criteria:
 * 1. Quick Onboarding: 2-field creation (type + plate), defaults profile_status = 'quick_added'
 * 2. Multi-tenancy: 3PL Partner A & B each see only their own fleet; Platform Admin sees all partner trucks
 * 3. Vehicles summary includes profile status counts
 * 4. Direct load allocation and compliance checks
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, ORGS, as, orgWorld, uid, PEOPLE, SEATS, memberRow } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

const TPL_A_ORG = '33333333-0000-4000-8000-000000000001';
const TPL_B_ORG = '33333333-0000-4000-8000-000000000002';

const tplAdminA = () => as('tpl-user-a', TPL_A_ORG);
const tplAdminB = () => as('tpl-user-b', TPL_B_ORG);
const platformAdmin = () => as('super-1', ORG.platform);
const companyAdmin = () => as('admin-a', ORG.companyA);

const LOAD_OPEN = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOAD_REEFER = 'aaaaaaaa-0000-4000-8000-000000000002';

function testWorld(extraVehicles: Row[] = []) {
  const orgA = { id: TPL_A_ORG, name: 'Speedy 3PL Logistics', kind: 'tpl_partner', status: 'active', profile: {}, created_at: '2026-01-01' };
  const orgB = { id: TPL_B_ORG, name: 'Express Freight 3PL', kind: 'tpl_partner', status: 'active', profile: {}, created_at: '2026-01-01' };

  return orgWorld({
    users: [
      ...PEOPLE.map(p => ({ id: uid(p.id), role: p.role, full_name: p.name, email: p.email, phone: p.phone ?? null, is_active: true })),
      { id: uid('tpl-user-a'), role: 'vendor', full_name: 'TPL User A', email: 'a@tpl.test', phone: null, is_active: true },
      { id: uid('tpl-user-b'), role: 'vendor', full_name: 'TPL User B', email: 'b@tpl.test', phone: null, is_active: true },
    ],
    organizations: [
      ...ORGS,
      orgA,
      orgB,
    ],
    org_members: [
      ...SEATS.map(memberRow),
      { org_id: TPL_A_ORG, user_id: uid('tpl-user-a'), role: 'owner', status: 'active', created_at: '2026-01-01', organizations: orgA },
      { org_id: TPL_B_ORG, user_id: uid('tpl-user-b'), role: 'owner', status: 'active', created_at: '2026-01-01', organizations: orgB },
    ],
    vehicles: extraVehicles,
    vendor_shipment_requests: [
      {
        id: LOAD_OPEN,
        vendor_id: uid('vendor-1'),
        carrier_org_id: ORG.companyA,
        status: 'approved',
        pickup_location: 'Mumbai',
        drop_location: 'Pune',
        required_vehicle_type: 'truck',
        cost: 15000,
        cargo_type: 'General',
      },
      {
        id: LOAD_REEFER,
        vendor_id: uid('vendor-1'),
        carrier_org_id: ORG.companyA,
        status: 'approved',
        pickup_location: 'Nashik',
        drop_location: 'Mumbai',
        required_vehicle_type: 'reefer',
        cost: 25000,
        cargo_type: 'Pharmaceuticals (Cold Chain)',
        temp_min_c: 2,
        temp_max_c: 8,
      },
    ],
    load_items: [
      { load_id: LOAD_REEFER, is_perishable: true, is_hazmat: false },
    ],
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  supabaseMock.reset(testWorld());
});

describe('UAT: Quick Truck Onboarding Flow (Spec v1.0)', () => {
  it('allows a 3PL owner to quick-add a truck with only vehicle_type and plate_number in seconds', async () => {
    const payload = {
      vehicle_type: 'truck',
      plate_number: 'MH04AB1234',
      vehicle_model: 'Container Truck',
      capacity_kg: 10000,
    };

    const res = await request(app)
      .post(api('/vehicles'))
      .set(tplAdminA())
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.plate_number).toBe('MH04AB1234');
    expect(res.body.vehicle_type).toBe('truck');
    expect(res.body.profile_status).toBe('quick_added');
    expect(res.body.status).toBe('available');

    // No documents or driver were provided, and it didn't fail
    expect(res.body.driver_id ?? null).toBeNull();
    expect(res.body.rc_number ?? null).toBeNull();
  });

  it('allows adding truck with minimal payload (only vehicle_type and plate_number)', async () => {
    const minimalPayload = {
      vehicle_type: 'truck',
      plate_number: 'DL01XY9999',
    };

    const res = await request(app)
      .post(api('/vehicles'))
      .set(tplAdminA())
      .send(minimalPayload);

    expect(res.status).toBe(201);
    expect(res.body.plate_number).toBe('DL01XY9999');
    expect(res.body.profile_status).toBe('quick_added');
    expect(res.body.capacity_kg).toBe(1000); // Defaults cleanly
  });
});

describe('UAT: Multi-Tenant Isolation for 3PL Owners & Platform Overview', () => {
  it('enforces that 3PL Partner A only sees their own trucks, and 3PL Partner B only sees theirs', async () => {
    // 3PL A adds a truck
    const resA = await request(app)
      .post(api('/vehicles'))
      .set(tplAdminA())
      .send({ vehicle_type: 'truck', plate_number: 'MH01AA1111' });
    expect(resA.status).toBe(201);

    // 3PL B adds a truck
    const resB = await request(app)
      .post(api('/vehicles'))
      .set(tplAdminB())
      .send({ vehicle_type: 'truck', plate_number: 'DL01BB2222' });
    expect(resB.status).toBe(201);

    // 3PL A lists trucks -> should ONLY see MH01AA1111
    const listA = await request(app).get(api('/vehicles')).set(tplAdminA());
    expect(listA.status).toBe(200);
    const platesA = listA.body.map((v: { plate_number: string }) => v.plate_number);
    expect(platesA).toContain('MH01AA1111');
    expect(platesA).not.toContain('DL01BB2222');

    // 3PL B lists trucks -> should ONLY see DL01BB2222
    const listB = await request(app).get(api('/vehicles')).set(tplAdminB());
    expect(listB.status).toBe(200);
    const platesB = listB.body.map((v: { plate_number: string }) => v.plate_number);
    expect(platesB).toContain('DL01BB2222');
    expect(platesB).not.toContain('MH01AA1111');
  });

  it('platform admin sees all trucks across all 3PL partners with partner org information', async () => {
    // Setup both trucks
    await request(app)
      .post(api('/vehicles'))
      .set(tplAdminA())
      .send({ vehicle_type: 'truck', plate_number: 'MH01AA1111' });

    await request(app)
      .post(api('/vehicles'))
      .set(tplAdminB())
      .send({ vehicle_type: 'truck', plate_number: 'DL01BB2222' });

    // Platform admin lists trucks -> sees both
    const platformList = await request(app).get(api('/vehicles')).set(platformAdmin());
    expect(platformList.status).toBe(200);

    const plates = platformList.body.map((v: { plate_number: string }) => v.plate_number);
    expect(plates).toContain('MH01AA1111');
    expect(plates).toContain('DL01BB2222');

    // Each vehicle has carrier_org information attached for Platform view
    const truckA = platformList.body.find((v: { plate_number: string }) => v.plate_number === 'MH01AA1111');
    expect(truckA.carrier_org).toBeDefined();
    expect(truckA.carrier_org.name).toBe('Speedy 3PL Logistics');

    const truckB = platformList.body.find((v: { plate_number: string }) => v.plate_number === 'DL01BB2222');
    expect(truckB.carrier_org).toBeDefined();
    expect(truckB.carrier_org.name).toBe('Express Freight 3PL');
  });
});

describe('UAT: Vehicle Summary & Operations Queue Counts', () => {
  it('returns profile_status counts in /vehicles/summary', async () => {
    // Add quick_added truck
    await request(app)
      .post(api('/vehicles'))
      .set(tplAdminA())
      .send({ vehicle_type: 'truck', plate_number: 'MH01AA1111' });

    const summaryRes = await request(app).get(api('/vehicles/summary')).set(tplAdminA());
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body).toHaveProperty('quick_added');
    expect(summaryRes.body).toHaveProperty('needs_completion');
    expect(summaryRes.body.quick_added).toBeGreaterThanOrEqual(1);
    expect(summaryRes.body.needs_completion).toBeGreaterThanOrEqual(1);
  });
});

describe('UAT: Compliance Gating on Direct Load Allocation', () => {
  it('blocks load allocation if vehicle has no driver assigned yet (per spec compliance gate)', async () => {
    // Quick added vehicle has no driver initially
    const createRes = await request(app)
      .post(api('/vehicles'))
      .set(companyAdmin())
      .send({ vehicle_type: 'truck', plate_number: 'MH04CC3333' });
    expect(createRes.status).toBe(201);
    const vehicleId = createRes.body.id;

    // Awarded load needing truck
    const assignRes = await request(app)
      .put(api(`/vendor/shipment-request/${LOAD_OPEN}/assign-vehicle`))
      .set(companyAdmin())
      .send({ vehicle_id: vehicleId, cost: 15000 });

    // Expect 409 because driver assignment is required before dispatch
    expect(assignRes.status).toBe(409);
    expect(assignRes.body.error || assignRes.body.detail).toMatch(/no driver/i);
  });

  it('blocks cold chain / reefer load allocation if truck lacks reefer certification', async () => {
    // Create vehicle with driver but standard dry freight (not reefer)
    const truckId = '77777777-0000-4000-8000-000000000001';
    const driverId = uid('driver-a');

    supabaseMock.reset(testWorld([
      {
        id: truckId,
        plate_number: 'MH01DRY100',
        vehicle_type: 'truck',
        status: 'available',
        driver_id: driverId,
        carrier_org_id: ORG.companyA,
        is_reefer: false,
        hazmat_certified: false,
        capacity_kg: 10000,
      },
    ]));

    const assignRes = await request(app)
      .put(api(`/vendor/shipment-request/${LOAD_REEFER}/assign-vehicle`))
      .set(companyAdmin())
      .send({ vehicle_id: truckId, cost: 25000 });

    // Blocked: cannot assign non-reefer truck to reefer / cold-chain load
    expect(assignRes.status).toBe(409);
    expect(assignRes.body.error || assignRes.body.detail).toMatch(/reefer|cold/i);
  });

  it('successfully allocates an open load to a compliant vehicle in one direct action', async () => {
    const truckId = '77777777-0000-4000-8000-000000000002';
    const driverId = uid('driver-a');

    supabaseMock.reset(testWorld([
      {
        id: truckId,
        plate_number: 'MH01OK200',
        vehicle_type: 'truck',
        status: 'available',
        driver_id: driverId,
        carrier_org_id: ORG.companyA,
        is_reefer: false,
        hazmat_certified: false,
        capacity_kg: 10000,
        available_capacity_kg: 10000,
      },
    ]));

    const assignRes = await request(app)
      .put(api(`/vendor/shipment-request/${LOAD_OPEN}/assign-vehicle`))
      .set(companyAdmin())
      .send({ vehicle_id: truckId, cost: 15000 });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.success).toBe(true);

    const updatedLoad = supabaseMock.rows('vendor_shipment_requests').find(r => r.id === LOAD_OPEN);
    expect(updatedLoad?.status).toBe('assigned');
    expect(updatedLoad?.assigned_vehicle_id).toBe(truckId);
  });
});
