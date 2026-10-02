/**
 * The anchor network over HTTP (mocked Supabase), docs/network-design.md sections 1 and 2: offers that respect the
 * company-partner affiliation (and its rules), targeted offers, the availability score of one company, the partner's
 * own fleet and drivers, the fleet counts a company sees, the rules editor, and partner statements in paise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, ORGS, as, orgWorld, uid } from './support/org-world';
import { matchingService } from '../src/services/matching.service';
import { COMPANY_SETTING } from './support/cargo-world';
import { settle, toPaise, periodRange } from '../src/services/tpl-statement.service';
import { summarizeFleet, documentStatuses } from '../src/services/tpl-fleet.service';
import { ruleExclusion } from '../src/services/tpl-affiliation';
import { invalidateOrgContext } from '../src/core/org-context';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

const QORG = 'a0000000-0000-4000-8000-0000000000e5';
const P = 'cccccccc-0000-4000-8000-000000000001'; // partner row of Tiny Transport (ORG.tplT)
const Q = 'cccccccc-0000-4000-8000-000000000002'; // partner row of Quick Haul (QORG)
const REQ_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const REQ_B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const SHIP = 'bbbbbbbb-0000-4000-8000-000000000001';
const K_P = 'dddddddd-0000-4000-8000-000000000001';
const K_Q = 'dddddddd-0000-4000-8000-000000000002';

const adminA = () => as('admin-a', ORG.companyA);
const adminB = () => as('admin-b', ORG.companyB);
const managerA = () => as('manager-a', ORG.companyA);
const tpl = () => as('tpl-1', ORG.tplT);

const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const orgs = (): Row[] => [
  ...ORGS.map(o => (o.id === ORG.tplT ? { ...o, profile: { legacy_tpl_partner_id: P } } : { ...o })),
  { id: QORG, kind: 'tpl_partner', name: 'Quick Haul', status: 'active', profile: { legacy_tpl_partner_id: Q }, created_at: '2026-10-01T00:00:00Z' },
];

const request_ = (id: string, company: string, extra: Row = {}): Row => ({
  id, vendor_id: uid('vendor-1'), pickup_location: 'Okhla, New Delhi', pickup_lat: 28.5, pickup_lng: 77.3,
  drop_location: 'Andheri, Mumbai, Maharashtra', drop_lat: 19.1, drop_lng: 72.8, required_capacity_kg: 800,
  status: 'approved', metadata: null, carrier_org_id: company, vehicle_class: null, ...extra,
});

function world(extra: Record<string, Row[]> = {}) {
  return orgWorld({
    organizations: orgs(),
    tpl_affiliations: [
      { company_id: ORG.companyA, tpl_id: ORG.tplT, status: 'active', rules: {} },
      { company_id: ORG.companyB, tpl_id: QORG, status: 'active', rules: {} },
    ],
    tpl_partners: [
      { id: P, user_id: uid('tpl-1'), company_name: 'Tiny Transport', status: 'active', email: null, sla_commitment: '4 Hours' },
      { id: Q, user_id: null, company_name: 'Quick Haul', status: 'active', email: null, sla_commitment: '4 Hours' },
    ],
    tpl_corridors: [
      { id: K_P, partner_id: P, corridor_name: 'DEL-BOM', proposed_rate: '41200', priority: 1 },
      { id: K_Q, partner_id: Q, corridor_name: 'DEL-BOM', proposed_rate: '39000', priority: 1 },
    ],
    vendor_shipment_requests: [request_(REQ_A, ORG.companyA), request_(REQ_B, ORG.companyB)],
    tpl_offers: [], tpl_orders: [], tpl_partner_statements: [], vehicles: [], routes: [], shipments: [], shipment_logs: [],
    delivery_points: [], route_stops: [], capacity_windows: [],
    system_settings: [...orgWorld().system_settings, COMPANY_SETTING],
    ...extra,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  supabaseMock.reset(world());
});

const escalate = (who: Record<string, string>, body: Row) => request(app).post(api('/tpl-network/escalations')).set(who).send(body);
const rulesOf = (company: string, tpl: string) => supabaseMock.rows('tpl_affiliations').find(a => a.company_id === company && a.tpl_id === tpl)!;

describe('offers respect the affiliation', () => {
  it('offers company A\'s load to A\'s partner only, and company B\'s load to B\'s', async () => {
    const a = await escalate(adminA(), { request_id: REQ_A });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ created: 1, matched: 1, excluded: [] });
    expect(supabaseMock.rows('tpl_offers').map(o => [o.partner_id, o.carrier_org_id, o.targeted])).toEqual([[P, ORG.companyA, false]]);

    const b = await escalate(adminB(), { request_id: REQ_B });
    expect(b.status).toBe(201);
    expect(supabaseMock.rows('tpl_offers').filter(o => o.request_id === REQ_B).map(o => [o.partner_id, o.carrier_org_id])).toEqual([[Q, ORG.companyB]]);
  });

  it('never reaches A\'s partner from company B: a company with no partner gets a 409, and another company\'s load a 404', async () => {
    supabaseMock.rows('tpl_affiliations').splice(1, 1); // B has no partners at all
    const none = await escalate(adminB(), { request_id: REQ_B });
    expect(none.status).toBe(409);
    expect(none.body.error).toMatch(/No active 3PL partner of yours/);
    expect(supabaseMock.rows('tpl_offers')).toEqual([]);
    expect((await escalate(adminB(), { request_id: REQ_A })).status).toBe(404);
  });

  it('leaves out a partner whose affiliation is paused, pending or ended', async () => {
    for (const status of ['paused', 'pending', 'ended']) {
      rulesOf(ORG.companyA, ORG.tplT).status = status;
      expect((await escalate(adminA(), { request_id: REQ_A })).status).toBe(409);
    }
    expect(supabaseMock.rows('tpl_offers')).toEqual([]);
  });

  it('previews the partners and why others were excluded by the rules', async () => {
    rulesOf(ORG.companyA, ORG.tplT).rules = { vehicle_classes: ['32ft'] };
    supabaseMock.rows('vendor_shipment_requests')[0].vehicle_class = '20ft';
    const res = await request(app).get(api(`/tpl-network/escalations/preview?request_id=${REQ_A}`)).set(adminA());
    expect(res.status).toBe(200);
    expect(res.body.partners).toEqual([]);
    expect(res.body.excluded).toEqual([{ partner_id: P, name: 'Tiny Transport', reason: expect.stringMatching(/20ft vehicle class/) }]);
    const refused = await escalate(adminA(), { request_id: REQ_A });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/rules keep every matching partner out/);
    expect(refused.body.excluded).toHaveLength(1);
  });

  it('applies the minimum rate, GPS, insurance and lane rules, each with its reason', async () => {
    const preview = async () => (await request(app).get(api(`/tpl-network/escalations/preview?request_id=${REQ_A}`)).set(adminA())).body;
    rulesOf(ORG.companyA, ORG.tplT).rules = { min_rate_per_km: 500 };
    expect((await preview()).excluded[0].reason).toMatch(/below your minimum of ₹500 per km/);
    rulesOf(ORG.companyA, ORG.tplT).rules = { min_rate_per_km: 1 };
    expect((await preview()).partners).toHaveLength(1);

    rulesOf(ORG.companyA, ORG.tplT).rules = { gps_required: true };
    expect((await preview()).excluded[0].reason).toMatch(/GPS/);
    supabaseMock.rows('vehicles').push({ id: 'v1', carrier_org_id: ORG.tplT, status: 'available', spark_id: 'GPS-1', insurance_number: 'INS', insurance_expiry: inDays(-1) });
    expect((await preview()).partners).toHaveLength(1);
    rulesOf(ORG.companyA, ORG.tplT).rules = { insurance_required: true };
    expect((await preview()).excluded[0].reason).toMatch(/valid insurance/);
    supabaseMock.rows('vehicles')[0].insurance_expiry = inDays(90);
    expect((await preview()).partners).toHaveLength(1);

    rulesOf(ORG.companyA, ORG.tplT).rules = { corridor_ids: [K_Q] };
    expect((await preview()).excluded[0].reason).toMatch(/lane/);
  });
});

describe('targeted offers', () => {
  it('offers only to the chosen affiliated partners and marks the offers targeted', async () => {
    const res = await escalate(adminA(), { request_id: REQ_A, partner_ids: [P] });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('tpl_offers')).toHaveLength(1);
    expect(supabaseMock.rows('tpl_offers')[0]).toMatchObject({ partner_id: P, targeted: true, carrier_org_id: ORG.companyA });
  });

  it('lets the company pick a partner that has no lane for this route, and still applies the rules', async () => {
    supabaseMock.rows('tpl_corridors').splice(0, 1);
    const res = await escalate(adminA(), { request_id: REQ_A, partner_ids: [P] });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('tpl_offers')[0]).toMatchObject({ partner_id: P, corridor_id: null, targeted: true });
    supabaseMock.reset(world());
    rulesOf(ORG.companyA, ORG.tplT).rules = { gps_required: true };
    const refused = await escalate(adminA(), { request_id: REQ_A, partner_ids: [P] });
    expect(refused.status).toBe(409);
    expect(refused.body.excluded[0]).toMatchObject({ partner_id: P });
  });

  it('refuses a partner that is not the company\'s, and a list that is not 1 to 10 distinct partners', async () => {
    expect((await escalate(adminA(), { request_id: REQ_A, partner_ids: [Q] })).status).toBe(400);
    expect((await escalate(adminA(), { request_id: REQ_A, partner_ids: [] })).status).toBe(400);
    expect((await escalate(adminA(), { request_id: REQ_A, partner_ids: 'x' })).status).toBe(400);
    expect((await escalate(adminA(), { request_id: REQ_A, partner_ids: ['not-a-uuid'] })).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => `cccccccc-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`);
    expect((await escalate(adminA(), { request_id: REQ_A, partner_ids: eleven })).status).toBe(400);
    expect(supabaseMock.rows('tpl_offers')).toEqual([]);
  });
});

describe('the availability score', () => {
  const vehicle = (id: string, org: string, extra: Row = {}): Row => ({
    id, carrier_org_id: org, status: 'available', vehicle_type: 'truck', plate_number: `MH12AB${id}`, latitude: 28.6, longitude: 77.2, ...extra,
  });

  beforeEach(() => {
    supabaseMock.reset(world({
      shipments: [{ id: SHIP, origin_lat: 28.5, origin_lng: 77.3, required_vehicle_type: 'truck', metadata: {}, carrier_org_id: ORG.companyA }],
      vehicles: [
        vehicle('1001', ORG.companyA), vehicle('1002', ORG.companyA), vehicle('1003', ORG.companyA, { status: 'maintenance' }),
        vehicle('2001', ORG.companyB), vehicle('2002', ORG.companyB),
        vehicle('3001', ORG.tplT), vehicle('4001', QORG),
      ],
    }));
  });

  it('counts only the company\'s own dispatchable vehicles', async () => {
    expect(await matchingService.computeAvailabilityScore(SHIP)).toMatchObject({ count: 2, status: 'Computed' });
    expect(await matchingService.computeAvailabilityScore(SHIP, ORG.companyB)).toMatchObject({ count: 2 });
  });

  it('adds the vehicles of the company\'s active partners with include_network, and no one else\'s', async () => {
    expect(await matchingService.computeAvailabilityScore(SHIP, ORG.companyA, { include_network: true })).toMatchObject({ count: 3 });
    // B\'s partner is Quick Haul, not Tiny Transport
    expect(await matchingService.computeAvailabilityScore(SHIP, ORG.companyB, { include_network: true })).toMatchObject({ count: 3 });
    rulesOf(ORG.companyA, ORG.tplT).status = 'paused';
    expect(await matchingService.computeAvailabilityScore(SHIP, ORG.companyA, { include_network: true })).toMatchObject({ count: 2 });
  });
});

describe('the partner\'s own vehicles', () => {
  const vehicles = (who = tpl()) => request(app).get(api(`/tpl-portal/${ORG.tplT}/vehicles`)).set(who);
  const add = (body: Row, who = tpl()) => request(app).post(api(`/tpl-portal/${ORG.tplT}/vehicles`)).set(who).send(body);
  const truck = { plate_number: 'MH 12 AB 1234', vehicle_type: 'truck', capacity_kg: 9000 };

  it('stamps the partner organisation, whatever the body says, and waits for RC and insurance', async () => {
    const res = await add({ ...truck, carrier_org_id: ORG.companyA, status: 'available' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ plate_number: 'MH12AB1234', carrier_org_id: ORG.tplT, status: 'pending_approval', usable: false });
    expect(res.body.documents.find((d: any) => d.key === 'rc').status).toBe('missing');
    expect(supabaseMock.rows('vehicles')[0].carrier_org_id).toBe(ORG.tplT);
  });

  it('is usable once the RC and insurance numbers are present, at creation or by an edit', async () => {
    const ready = await add({ ...truck, plate_number: 'MH12AB0001', rc_number: 'RC1', insurance_number: 'INS1', insurance_expiry: inDays(200) });
    expect(ready.body).toMatchObject({ status: 'available', usable: true, review_decision: 'approved' });
    const waiting = await add(truck);
    expect(waiting.body.status).toBe('pending_approval');
    const forced = await request(app).patch(api(`/tpl-portal/${ORG.tplT}/vehicles/${waiting.body.id}`)).set(tpl()).send({ status: 'available' });
    expect(forced.status).toBe(409);
    const done = await request(app).patch(api(`/tpl-portal/${ORG.tplT}/vehicles/${waiting.body.id}`)).set(tpl()).send({ rc_number: 'RC2', insurance_number: 'INS2' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'available', usable: true });
  });

  it('lists only the partner\'s own vehicles and rejects another organisation\'s', async () => {
    supabaseMock.rows('vehicles').push({ id: 'va', plate_number: 'DL1AA0001', carrier_org_id: ORG.companyA, status: 'available', vehicle_type: 'truck' });
    await add(truck);
    const list = await vehicles();
    expect(list.status).toBe(200);
    expect(list.body.items.map((v: any) => v.plate_number)).toEqual(['MH12AB1234']);
    // Another company's vehicle cannot be edited through the partner portal, and the id does not give it away
    const other = await request(app).patch(api(`/tpl-portal/${ORG.tplT}/vehicles/${uid('va')}`)).set(tpl()).send({ capacity_kg: 1 });
    expect(other.status).toBe(404);
    expect(supabaseMock.rows('vehicles').find(v => v.id === 'va')!.capacity_kg).toBeUndefined();
  });

  it('is for members of the partner organisation only', async () => {
    expect((await vehicles(adminA())).status).toBe(403);
    expect((await add(truck, adminA())).status).toBe(403);
    expect((await request(app).get(api(`/tpl-portal/${ORG.tplT}/vehicles`))).status).toBe(401);
    expect((await request(app).get(api(`/tpl-portal/${QORG}/vehicles`)).set(tpl())).status).toBe(403);
    // The id of the older partner row opens the same organisation
    expect((await request(app).get(api(`/tpl-portal/${P}/vehicles`)).set(tpl())).status).toBe(200);
    supabaseMock.rows('organizations').find(o => o.id === ORG.tplT)!.status = 'pending';
    supabaseMock.rows('org_members').forEach(m => { if (m.org_id === ORG.tplT) m.organizations = { ...m.organizations, status: 'pending' }; });
    invalidateOrgContext();
    expect((await add(truck)).status).toBe(403);
  });

  it('validates the vehicle like the company form does', async () => {
    expect((await add({ plate_number: 'AB', vehicle_type: 'truck', capacity_kg: 9000 })).status).toBe(422);
    expect((await add({ ...truck, capacity_kg: -5 })).status).toBe(422);
    expect((await add({ ...truck, vehicle_type: 'spaceship' })).status).toBe(422);
  });

  it('assigns only the partner\'s own drivers to a vehicle', async () => {
    const v = (await add({ ...truck, rc_number: 'RC', insurance_number: 'INS' })).body;
    supabaseMock.rows('users').push({ id: uid('p-driver'), role: 'driver', full_name: 'Pat Driver', phone: '+919800000009', is_active: true });
    supabaseMock.rows('org_members').push({ org_id: ORG.tplT, user_id: uid('p-driver'), role: 'driver', status: 'active' });
    const mine = await request(app).patch(api(`/tpl-portal/${ORG.tplT}/vehicles/${v.id}`)).set(tpl()).send({ driver_id: uid('p-driver') });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ driver_id: uid('p-driver'), driver_name: 'Pat Driver' });
    const foreign = await request(app).patch(api(`/tpl-portal/${ORG.tplT}/vehicles/${v.id}`)).set(tpl()).send({ driver_id: uid('driver-a') });
    expect(foreign.status).toBe(422);
  });
});

describe('the partner\'s drivers', () => {
  beforeEach(() => {
    supabaseMock.reset(world({
      user_profiles: [], user_documents: [], user_activity: [], user_status_history: [], user_phone_history: [],
    }));
    supabaseMock.authAdmin = true;
  });

  it('invites a driver by phone into the partner organisation and keeps employer_partner_id in step', async () => {
    const res = await request(app).post(api(`/tpl-portal/${ORG.tplT}/drivers/invite`)).set(tpl()).send({ name: 'Nitin Driver', phone: '98765 00099' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: 'driver', full_name: 'Nitin Driver', phone: '+919876500099', partner_org_id: ORG.tplT });
    expect(supabaseMock.rows('org_members').find(m => m.user_id === res.body.id)).toMatchObject({ org_id: ORG.tplT, role: 'driver', status: 'active' });
    expect(supabaseMock.rows('user_profiles').find(p => p.user_id === res.body.id)).toMatchObject({ employer_type: 'partner', employer_partner_id: P });

    const list = await request(app).get(api(`/tpl-portal/${ORG.tplT}/drivers`)).set(tpl());
    expect(list.status).toBe(200);
    expect(list.body.items.map((d: any) => d.full_name)).toEqual(['Nitin Driver']);
  });

  it('needs a phone and a name, a partner member, and does not list another organisation\'s drivers', async () => {
    const invite = (who: Record<string, string>, body: Row) => request(app).post(api(`/tpl-portal/${ORG.tplT}/drivers/invite`)).set(who).send(body);
    expect((await invite(tpl(), { name: 'X' })).status).toBe(422);
    expect((await invite(tpl(), { phone: '9876500098' })).status).toBe(422);
    expect((await invite(adminA(), { name: 'Nope Nope', phone: '9876500097' })).status).toBe(403);
    const list = await request(app).get(api(`/tpl-portal/${ORG.tplT}/drivers`)).set(tpl());
    expect(list.body.items).toEqual([]);
  });
});

describe('what a company sees of a partner\'s fleet', () => {
  const v = (id: string, extra: Row = {}): Row => ({
    id, carrier_org_id: ORG.tplT, plate_number: `MH12AB${id}`, status: 'available', vehicle_type: 'truck',
    rc_number: 'RC', rc_expiry: inDays(300), insurance_number: 'INS', insurance_expiry: inDays(300), ...extra,
  });

  beforeEach(() => {
    supabaseMock.reset(world({
      vehicles: [
        v('1001'), v('1002', { status: 'on_route', puc_number: 'PUC', puc_expiry: inDays(10) }),
        v('1003', { status: 'maintenance', vehicle_type: 'van', insurance_expiry: inDays(-3) }),
        v('1004', { status: 'archived' }), v('1005', { rc_number: null }),
        { ...v('9001'), carrier_org_id: ORG.companyA },
      ],
    }));
  });

  it('answers counts only, by the partner organisation id or the older partner id', async () => {
    const expected = { vehicles_total: 4, available: 2, on_trip: 1, maintenance: 1, by_class: { truck: 3, van: 1 }, docs_ok: 1, docs_expiring: 1, docs_expired: 1, docs_missing: 1 };
    for (const id of [ORG.tplT, P]) {
      const res = await request(app).get(api(`/org/tpl-affiliations/${id}/fleet`)).set(adminA());
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expected);
    }
    expect(JSON.stringify((await request(app).get(api(`/org/tpl-affiliations/${ORG.tplT}/fleet`)).set(adminA())).body)).not.toMatch(/MH12|RC|INS/);
  });

  it('is only for the company the partner works with', async () => {
    expect((await request(app).get(api(`/org/tpl-affiliations/${ORG.tplT}/fleet`)).set(adminB())).status).toBe(404);
    expect((await request(app).get(api(`/org/tpl-affiliations/${ORG.tplT}/fleet`)).set(tpl())).status).toBe(403);
    rulesOf(ORG.companyA, ORG.tplT).status = 'pending';
    expect((await request(app).get(api(`/org/tpl-affiliations/${ORG.tplT}/fleet`)).set(adminA())).status).toBe(404);
  });

  it('counts documents the way the rules read them', () => {
    expect(summarizeFleet([]).vehicles_total).toBe(0);
    const statuses = documentStatuses({ rc_number: 'R', rc_expiry: inDays(5), insurance_number: null }, today).map(d => d.status);
    expect(statuses).toEqual(['expiring', 'missing', 'not_recorded', 'not_recorded', 'not_recorded']);
  });
});

describe('the rules editor', () => {
  const patch = (body: unknown, who = adminA(), id: string = ORG.tplT) => request(app).patch(api(`/org/tpl-affiliations/${id}/rules`)).set(who).send(body as object);

  it('saves the rules, and the affiliation reads them back', async () => {
    const res = await patch({ vehicle_classes: ['20ft', '32ft'], corridor_ids: [K_P], min_rate_per_km: 18.5, gps_required: true, insurance_required: false }, adminA(), P);
    expect(res.status).toBe(200);
    expect(res.body.rules).toEqual({ vehicle_classes: ['20ft', '32ft'], corridor_ids: [K_P], min_rate_per_km: 18.5, gps_required: true, insurance_required: false });
    const one = await request(app).get(api(`/org/tpl-affiliations/${P}`)).set(adminA());
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ tpl_id: ORG.tplT, status: 'active', rules: { min_rate_per_km: 18.5 }, organization: { name: 'Tiny Transport' } });
    expect((await request(app).get(api('/org/tpl-affiliations')).set(adminA())).body[0].rules).toMatchObject({ gps_required: true });
  });

  it('clears a rule sent as null, and accepts the rules wrapped in { rules }', async () => {
    await patch({ min_rate_per_km: 20, gps_required: true });
    const cleared = await patch({ min_rate_per_km: null, gps_required: true });
    expect(cleared.body.rules).toEqual({ gps_required: true });
    expect((await patch({ rules: { insurance_required: true } })).body.rules).toEqual({ insurance_required: true });
    expect((await patch({})).body.rules).toEqual({});
  });

  it('validates the shape and the lanes, and is for the company\'s owner or admin only', async () => {
    expect((await patch({ bogus: 1 })).status).toBe(422);
    expect((await patch({ min_rate_per_km: -1 })).status).toBe(422);
    expect((await patch({ vehicle_classes: [''] })).status).toBe(422);
    expect((await patch({ corridor_ids: ['nope'] })).status).toBe(422);
    expect((await patch({ corridor_ids: [K_Q] })).status).toBe(422); // another partner's lane
    expect((await patch({ gps_required: true }, managerA())).status).toBe(403);
    expect((await patch({ gps_required: true }, adminB())).status).toBe(404);
    expect((await patch({ gps_required: true }, tpl())).status).toBe(403);
  });

  it('keeps the pure rule check honest', () => {
    const ctx = { vehicleClass: '20ft', distanceKm: 100, rate: { amount: 30, unit: 'per_km' as const }, price: 3000, fleet: null };
    expect(ruleExclusion({}, ctx)).toBeNull();
    expect(ruleExclusion({ vehicle_classes: ['20FT'] }, ctx)).toBeNull();
    expect(ruleExclusion({ min_rate_per_km: 31 }, ctx)).toMatch(/₹30 per km is below/);
    expect(ruleExclusion({ min_rate_per_km: 30 }, ctx)).toBeNull();
    expect(ruleExclusion({ gps_required: true }, { ...ctx, fleet: { gps: false, insured: true } })).toMatch(/GPS/);
  });
});

describe('partner statements', () => {
  const order = (id: string, offerId: string, amount: number | string, extra: Row = {}): Row => ({
    id, offer_id: offerId, partner_id: P, status: 'delivered', agreed_amount: amount, delivered_at: '2026-10-10T10:00:00Z', paid_at: null, carrier_org_id: ORG.companyA,
    pickup_location: 'Okhla, New Delhi', drop_location: 'Andheri, Mumbai', accepted_at: '2026-10-09T10:00:00Z', ...extra,
  });
  const offer = (id: string, company: string): Row => ({ id, carrier_org_id: company, partner_id: P, status: 'accepted' });
  const base = '/org/tpl-affiliations';

  beforeEach(() => {
    supabaseMock.reset(world({
      tpl_offers: ['o1', 'o2', 'o3', 'o4', 'o5'].map(id => offer(id, id === 'o3' ? ORG.companyB : ORG.companyA)),
      tpl_orders: [
        order('t1', 'o1', '41200.50'),
        order('t2', 'o2', 19.99),
        order('t3', 'o3', 5000, { carrier_org_id: ORG.companyB }), // handed over by company B
        order('t4', 'o4', 3000, { delivered_at: '2026-09-30T10:00:00Z' }), // another month
        order('t5', 'o5', 700, { paid_at: '2026-10-12T00:00:00Z' }), // already paid on its own
        order('t6', 'o1', 900, { status: 'in_transit', delivered_at: null }),
      ],
    }));
  });

  const build = (period = '202610', who = adminA(), id: string = P) => request(app).post(api(`${base}/${id}/statements`)).set(who).send({ period });
  const get = async (id: string) => (await request(app).get(api(`${base}/${P}/statements/${id}`)).set(adminA())).body;

  it('builds a draft from the month\'s delivered, unpaid orders of this company, in whole paise', async () => {
    const res = await build();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      period: '202610', status: 'draft', partner_org_id: ORG.tplT, company_org_id: ORG.companyA, partner_name: 'Tiny Transport', company_name: 'Alpha Logistics',
      order_ids: ['t1', 't2'], orders_total_paise: 4_122_049, deductions: [], balance_paise: 4_122_049,
    });
    expect(res.body.orders.map((o: any) => [o.id, o.amount_paise])).toEqual([['t1', 4_120_050], ['t2', 1999]]);
    expect(supabaseMock.rows('tpl_partner_statements')[0]).toMatchObject({ orders_total_paise: 4_122_049, status: 'draft' });
  });

  it('refreshes the draft when asked again, and keeps its deductions', async () => {
    const first = (await build()).body;
    await request(app).patch(api(`${base}/${P}/statements/${first.id}`)).set(adminA()).send({ deductions: [{ label: 'Damage', amount_paise: 10_000, reason: 'Torn bag' }] });
    supabaseMock.rows('tpl_orders').push(order('t7', 'o1', 100));
    const again = await build();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.id, orders_total_paise: 4_132_049, balance_paise: 4_122_049 });
    expect(supabaseMock.rows('tpl_partner_statements')).toHaveLength(1);
  });

  it('takes deductions off in paise and refuses more than the orders come to', async () => {
    const { id } = (await build()).body;
    const patch = (deductions: unknown) => request(app).patch(api(`${base}/${P}/statements/${id}`)).set(adminA()).send({ deductions });
    const ok = await patch([{ label: 'Damage claim', amount_paise: 150_000, reason: 'Two bags torn' }, { label: 'Late fee', amount_paise: 12_049 }]);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      deductions: [{ label: 'Damage claim', amount_paise: 150_000, reason: 'Two bags torn' }, { label: 'Late fee', amount_paise: 12_049, reason: '' }],
      deductions_total_paise: 162_049, balance_paise: 3_960_000,
    });
    expect((await patch([{ label: 'Too much', amount_paise: 4_122_050 }])).status).toBe(422);
    expect((await patch([{ label: 'Rupees', amount_paise: 10.5 }])).status).toBe(422);
    expect((await patch([{ label: '', amount_paise: 10 }])).status).toBe(422);
    expect((await patch([{ label: 'Zero', amount_paise: 0 }])).status).toBe(422);
    expect((await get(id)).balance_paise).toBe(3_960_000);
  });

  it('issues, tells the partner, and makes the statement final', async () => {
    const { id } = (await build()).body;
    await request(app).patch(api(`${base}/${P}/statements/${id}`)).set(adminA()).send({ deductions: [{ label: 'Damage', amount_paise: 22_049, reason: '' }] });
    const issued = await request(app).post(api(`${base}/${P}/statements/${id}/issue`)).set(adminA());
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({ status: 'issued', balance_paise: 4_100_000 });
    expect(issued.body.issued_at).toBeTruthy();
    expect(supabaseMock.rows('notifications').some(n => n.user_id === uid('tpl-1') && n.type === 'tpl_statement_issued')).toBe(true);
    expect((await request(app).post(api(`${base}/${P}/statements/${id}/issue`)).set(adminA())).status).toBe(409);
    expect((await request(app).patch(api(`${base}/${P}/statements/${id}`)).set(adminA()).send({ deductions: [] })).status).toBe(409);
    expect((await build()).status).toBe(409);
  });

  it('recomputes the balance from the orders as they stand when issuing, and refuses orders that changed', async () => {
    const { id } = (await build()).body;
    supabaseMock.rows('tpl_orders').find(o => o.id === 't2')!.paid_at = '2026-10-20T00:00:00Z';
    const res = await request(app).post(api(`${base}/${P}/statements/${id}/issue`)).set(adminA());
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/Rebuild the statement/);
    const rebuilt = await request(app).patch(api(`${base}/${P}/statements/${id}`)).set(adminA()).send({ rebuild: true });
    expect(rebuilt.body).toMatchObject({ order_ids: ['t1'], orders_total_paise: 4_120_050 });
  });

  it('marks the statement paid, which marks its orders paid with the reference', async () => {
    const { id } = (await build()).body;
    const early = await request(app).post(api(`${base}/${P}/statements/${id}/mark-paid`)).set(adminA()).send({ reference: 'UTR1' });
    expect(early.status).toBe(409);
    await request(app).post(api(`${base}/${P}/statements/${id}/issue`)).set(adminA());
    const paid = await request(app).post(api(`${base}/${P}/statements/${id}/mark-paid`)).set(adminA()).send({ reference: 'UTR123' });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: 'paid', paid_reference: 'UTR123' });
    expect(paid.body.paid_at).toBeTruthy();
    expect(supabaseMock.rows('tpl_orders').filter(o => ['t1', 't2'].includes(o.id)).every(o => o.paid_at && o.paid_reference === 'UTR123')).toBe(true);
    expect(supabaseMock.rows('tpl_orders').find(o => o.id === 't3')!.paid_at).toBeNull();
    expect((await request(app).post(api(`${base}/${P}/statements/${id}/mark-paid`)).set(adminA()).send({})).status).toBe(409);
  });

  it('blocks marking an order paid on its own once it is inside an issued statement', async () => {
    const { id } = (await build()).body;
    const single = (orderId: string) => request(app).post(api(`/tpl-network/orders/${orderId}/paid`)).set(adminA()).send({ paid: true, reference: 'X' });
    expect((await request(app).post(api('/tpl-network/orders/t3/rate')).set(adminA()).send({ rating: 5 })).status).toBe(404);
    expect((await request(app).post(api('/tpl-network/orders/t5/rate')).set(adminA()).send({ rating: 4 })).status).toBe(200);
    // Another company's order is a 404 and stays unpaid
    expect((await single('t3')).status).toBe(404);
    expect(supabaseMock.rows('tpl_orders').find(o => o.id === 't3')!.paid_at).toBeNull();
    // Inside a draft it is still the order\'s own business; outside any statement too
    expect((await single('t5')).status).toBe(200);
    await request(app).post(api(`${base}/${P}/statements/${id}/issue`)).set(adminA());
    const blocked = await single('t1');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/part of the 202610 statement/);
    expect(supabaseMock.rows('tpl_orders').find(o => o.id === 't1')!.paid_at).toBeNull();
    expect((await single('t4')).status).toBe(200);
  });

  it('shows the partner what was issued to it (never a draft), and the PDF of it', async () => {
    const { id } = (await build()).body;
    const mine = () => request(app).get(api(`/tpl-portal/${ORG.tplT}/statements`)).set(tpl());
    expect((await mine()).body).toEqual({ items: [] });
    expect((await request(app).get(api(`/tpl-portal/${ORG.tplT}/statements/${id}`)).set(tpl())).status).toBe(404);
    await request(app).post(api(`${base}/${P}/statements/${id}/issue`)).set(adminA());
    const list = await mine();
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id, period: '202610', status: 'issued', company_name: 'Alpha Logistics', balance_paise: 4_122_049 });
    expect((await request(app).get(api(`/tpl-portal/${ORG.tplT}/statements/${id}`)).set(tpl())).body.orders).toHaveLength(2);

    const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    };
    for (const url of [`/tpl-portal/${ORG.tplT}/statements/${id}/pdf`, `${base}/${P}/statements/${id}/pdf`]) {
      const pdf = await request(app).get(api(url)).set(url.startsWith('/tpl-portal') ? tpl() : adminA()).buffer(true).parse(binary);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('keeps a company out of another company\'s statements, and managers out of the money', async () => {
    const { id } = (await build()).body;
    expect((await request(app).get(api(`${base}/${P}/statements/${id}`)).set(adminB())).status).toBe(404);
    expect((await request(app).get(api(`${base}/${P}/statements`)).set(adminB())).status).toBe(404);
    expect((await request(app).get(api(`${base}/${P}/statements`)).set(managerA())).status).toBe(403);
    expect((await build('202610', tpl())).status).toBe(403);
    expect((await request(app).get(api(`${base}/${P}/statements`)).set(adminA())).body.items).toHaveLength(1);
  });

  it('needs a valid month and some delivered orders', async () => {
    expect((await build('2026-10')).status).toBe(422);
    expect((await build('202613')).status).toBe(422);
    expect((await build('202611')).status).toBe(409);
    expect((await request(app).post(api(`${base}/${P}/statements`)).set(adminA()).send({})).status).toBe(422);
  });
});

describe('statement maths', () => {
  it('turns stored rupees into integer paise without float drift', () => {
    expect(toPaise('41200.50')).toBe(4_120_050);
    expect(toPaise(19.99)).toBe(1999);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise('1234567.89')).toBe(123_456_789);
  });

  it('subtracts deductions in paise and never goes below zero', () => {
    expect(settle(100_000, [{ amount_paise: 25_050 }, { amount_paise: 1 }])).toEqual({ deductions_total_paise: 25_051, balance_paise: 74_949 });
    expect(settle(100_000, [{ amount_paise: 100_000 }])).toEqual({ deductions_total_paise: 100_000, balance_paise: 0 });
    expect(() => settle(100_000, [{ amount_paise: 100_001 }])).toThrow(/more than the orders/);
  });

  it('works in Indian calendar months', () => {
    const { start, end } = periodRange('202610');
    expect(start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(periodRange('202612').end.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(() => periodRange('2026-1')).toThrow();
  });
});
