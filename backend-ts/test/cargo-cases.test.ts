/**
 * Cargo cases: listing and filters, the case page, owner and status actions, SLA escalation
 * from the scheduler, and delay cases from a slipping live ETA.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one, notesFor } from './support/cargo-world';
import { ESCALATE_EVERY_MIN, MAX_ESCALATIONS, detectDelays, escalateOverdueExceptions } from '../src/services/cargo/exception.service';
import { runSchedulerTick } from '../src/services/scheduler.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const MIN = 60_000;

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld());
});

async function openCase(body: object = {}) {
  const res = await request(app).post(api('/cargo/exceptions')).set(auth.admin())
    .send({ type: 'damage', severity: 'critical', description: 'Forklift pierced two cartons', items: [{ ref: { shipment_id: ID.s1 }, pieces_affected: 2, condition: 'damaged_goods' }], ...body });
  expect(res.status).toBe(201);
  return res.body;
}

describe('the case file', () => {
  it('opens a case by hand with its SLA, and shows it with items and a merged timeline', async () => {
    const exc = await openCase();
    expect(exc).toMatchObject({ type: 'damage', severity: 'critical', status: 'open', source: 'manual', vehicle_id: ID.v1 });
    expect(Date.parse(exc.sla_due_at) - Date.parse(exc.created_at)).toBe(60 * MIN);
    expect(exc.items).toEqual([expect.objectContaining({ ref: { shipment_id: ID.s1 }, pieces_affected: 2, weight_affected_kg: 200, condition: 'damaged_goods', status: 'in_transit' })]);

    const act = (body: object) => request(app).post(api(`/cargo/exceptions/${exc.id}/actions`)).set(auth.admin()).send(body);
    expect((await act({ action: 'assign_owner', owner_id: ID.driver1 })).status).toBe(400);
    const owned = await act({ action: 'assign_owner', owner_id: ID.admin });
    expect(owned.body).toMatchObject({ owner_id: ID.admin, status: 'investigating' });
    expect((await act({ action: 'set_status', status: 'resolved' })).status).toBe(400);
    expect((await act({ action: 'add_note', note: 'Surveyor called' })).status).toBe(200);
    expect((await act({ action: 'teleport' })).status).toBe(400);

    const page = await request(app).get(api(`/cargo/exceptions/${exc.id}`)).set(auth.admin());
    expect(page.status).toBe(200);
    expect(page.body.timeline.map((t: any) => t.text)).toEqual(expect.arrayContaining(['Forklift pierced two cartons', 'Owner set to Asha Admin', 'Surveyor called']));
    expect(page.body.sla).toMatchObject({ overdue: false });
    expect(page.body).not.toHaveProperty('notes');

    const closed = await act({ action: 'set_status', status: 'closed' });
    expect(closed.body.status).toBe('closed');
    expect((await act({ action: 'set_status', status: 'open' })).status).toBe(409);
  });

  it('lists cases by status, type, severity, vehicle, consignment and overdue', async () => {
    const a = await openCase();
    await openCase({ type: 'delay', severity: 'low', items: [{ ref: { manifest_id: ID.m1 } }] });
    one('cargo_exceptions', a.id).sla_due_at = new Date(Date.now() - 5 * MIN).toISOString();
    const list = (q: string) => request(app).get(api(`/cargo/exceptions${q}`)).set(auth.admin());
    expect((await list('')).body).toHaveLength(2);
    expect((await list('?type=delay')).body).toHaveLength(1);
    expect((await list('?severity=critical')).body.map((e: any) => e.id)).toEqual([a.id]);
    expect((await list(`?ref=${ID.m1}`)).body.map((e: any) => e.type)).toEqual(['delay']);
    expect((await list('?overdue=true')).body.map((e: any) => e.id)).toEqual([a.id]);
    expect((await list('?status=open,investigating')).body).toHaveLength(2);
    expect((await list(`?vehicle_id=${ID.v2}`)).body).toHaveLength(0);
    expect((await list('?status=nope')).status).toBe(400);
    const [first] = (await list('?overdue=true')).body;
    expect(first).toMatchObject({ plate_number: 'MH12AB0001', sla: { overdue: true } });
  });
});

describe('SLA escalation', () => {
  it('reminds staff about overdue cases, then every hour, up to a limit', async () => {
    const exc = await openCase();
    const row = one('cargo_exceptions', exc.id);
    const now = Date.now();
    row.sla_due_at = new Date(now - 10 * MIN).toISOString();
    const escalations = () => notesFor(ID.admin).filter(n => n.type === 'cargo_exception_escalated');

    expect(await escalateOverdueExceptions(now)).toBe(1);
    expect(row).toMatchObject({ escalation_count: 1 });
    expect(escalations()[0].body).toMatch(/past its SLA/);
    expect(await escalateOverdueExceptions(now + 5 * MIN)).toBe(0);
    expect(await escalateOverdueExceptions(now + (ESCALATE_EVERY_MIN + 1) * MIN)).toBe(1);
    expect(row.escalation_count).toBe(2);

    row.escalation_count = MAX_ESCALATIONS;
    expect(await escalateOverdueExceptions(now + 10 * ESCALATE_EVERY_MIN * MIN)).toBe(0);
    row.escalation_count = 0;
    row.status = 'resolved';
    expect(await escalateOverdueExceptions(now + 10 * ESCALATE_EVERY_MIN * MIN)).toBe(0);
  });

  it('runs from the scheduler tick', async () => {
    const exc = await openCase();
    one('cargo_exceptions', exc.id).sla_due_at = new Date(Date.now() - MIN).toISOString();
    await runSchedulerTick();
    expect(one('cargo_exceptions', exc.id).escalation_count).toBe(1);
  });
});

describe('delay cases from the live ETA', () => {
  it('opens one delay case when the ETA slips past the threshold', async () => {
    // The truck is ~95 km from its drop, which was planned for 30 minutes ago
    Object.assign(one('vehicles', ID.v1), { latitude: 19.3, longitude: 73.0 });
    one('route_stops', ID.stop1).planned_arrival_at = new Date(Date.now() - 30 * MIN).toISOString();
    expect(await detectDelays()).toBe(1);
    const [exc] = supabaseMock.rows('cargo_exceptions');
    expect(exc).toMatchObject({ type: 'delay', source: 'eta', route_id: ID.route1, vehicle_id: ID.v1 });
    expect(await detectDelays()).toBe(0);
    expect(notesFor(ID.customer).some(n => /running late/.test(n.body))).toBe(true);
  });

  it('leaves a delivery on time alone', async () => {
    one('route_stops', ID.stop1).planned_arrival_at = new Date(Date.now() + 60 * MIN).toISOString();
    expect(await detectDelays()).toBe(0);
    expect(supabaseMock.rows('cargo_exceptions')).toHaveLength(0);
  });
});
