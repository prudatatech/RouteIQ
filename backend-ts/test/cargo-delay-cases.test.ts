/**
 * Delay cases (UAT-001, UAT-016): never opened for goods already delivered, cancelled, returned or
 * lost; one open case per shipment; closed by themselves when the goods are delivered or cancelled,
 * with a note on the case, an entry in the shipment log and a line in the audit log.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one, shipmentRow, manifestRow } from './support/cargo-world';
import { delayIsMoot, detectDelays, resolveDelayCasesFor } from '../src/services/cargo/exception.service';
import { ShipmentService } from '../src/services/shipment.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const MIN = 60_000;

/** The truck is ~95 km from the drop, which was planned for 30 minutes ago: late. */
function lateWorld(over: Record<string, any[]> = {}) {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld({ ai_agent_logs: [], ...over }));
  Object.assign(one('vehicles', ID.v1), { latitude: 19.3, longitude: 73.0 });
  one('route_stops', ID.stop1).planned_arrival_at = new Date(Date.now() - 30 * MIN).toISOString();
}

const cases = () => supabaseMock.rows('cargo_exceptions');
const audit = () => supabaseMock.rows('ai_agent_logs');
const stamp = () => new Date().toISOString();
const delayCase = (id: string, code: string, over: Record<string, unknown> = {}) => ({
  id, code, type: 'delay', severity: 'medium', status: 'open', source: 'eta', notes: [], escalation_count: 0,
  created_at: stamp(), updated_at: stamp(), ...over,
});

beforeEach(() => lateWorld());

describe('never open a delay case for settled goods', () => {
  it.each([
    ['delivered', { status: 'delivered', current_holder: 'consignee', pieces_delivered: 10 }],
    ['cancelled', { status: 'cancelled', current_holder: 'consignor' }],
    ['returned', { status: 'returned', current_holder: 'consignor' }],
    ['lost', { status: 'lost', current_holder: 'vehicle' }],
    ['partially delivered and settled', { status: 'partially_delivered', pieces_delivered: 8, pieces_returned: 2 }],
  ])('%s', async (_name, patch) => {
    Object.assign(one('shipments', ID.s1), patch);
    expect(await detectDelays()).toBe(0);
    expect(cases()).toHaveLength(0);
  });

  it('knows a partial delivery is settled only when no pieces are left to deliver', () => {
    const pieces = (delivered: number) => ({ total: 10, delivered, damaged: 0, short: 0, returned: 0 });
    expect(delayIsMoot({ status: 'partially_delivered', pieces: pieces(7) })).toBe(false);
    expect(delayIsMoot({ status: 'partially_delivered', pieces: pieces(10) })).toBe(true);
    expect(delayIsMoot({ status: 'in_transit', pieces: pieces(0) })).toBe(false);
  });
});

describe('one open delay case per shipment', () => {
  it('opens one case, keyed so the database refuses a second, and records it in the audit log', async () => {
    expect(await detectDelays()).toBe(1);
    expect(await detectDelays()).toBe(0);
    expect(cases()).toHaveLength(1);
    expect(cases()[0]).toMatchObject({ type: 'delay', source: 'eta', dedupe_key: `delay:shipment:${ID.s1}` });
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ agent_name: 'system', action: 'cargo_case.opened', status: 'success' });
    expect(audit()[0].input_data).toMatchObject({ code: cases()[0].code, type: 'delay', source: 'eta', actor_role: 'system' });
  });

  it('does not open another while the case is investigating', async () => {
    await detectDelays();
    cases()[0].status = 'investigating';
    expect(await detectDelays()).toBe(0);
    expect(cases()).toHaveLength(1);
  });

  it('closes the newer of two open delay cases for the same shipment (the UAT duplicates)', async () => {
    lateWorld({
      cargo_exceptions: [
        delayCase('x1', 'EXC-AAAAAA', { severity: 'high', created_at: '2026-09-30T13:00:00.000Z' }),
        delayCase('x2', 'EXC-BBBBBB', { severity: 'high', created_at: '2026-09-30T13:00:01.000Z' }),
      ],
      cargo_exception_items: [{ id: 'i1', exception_id: 'x1', shipment_id: ID.s1 }, { id: 'i2', exception_id: 'x2', shipment_id: ID.s1 }],
    });
    await detectDelays();
    expect(one('cargo_exceptions', 'x1').status).toBe('open');
    expect(one('cargo_exceptions', 'x2')).toMatchObject({ status: 'resolved', resolution: 'no_action' });
    expect(one('cargo_exceptions', 'x2').resolution_note).toMatch(/Duplicate of EXC-AAAAAA/);
  });
});

describe('a delay case closes itself when the goods are delivered or cancelled', () => {
  it('on delivery: resolved with a note, logged on the shipment, hidden from public tracking, and audited', async () => {
    await detectDelays();
    const [exc] = cases();
    expect(exc.status).toBe('open');

    const res = await request(app).post(api('/cargo/custody')).set(auth.driver())
      .send({ ref: { shipment_id: ID.s1 }, kind: 'delivery', pieces: 10, receiver_name: 'Store manager', photo_paths: [`cargo/${ID.s1}/photo_a.jpg`] });
    expect(res.status).toBe(201);

    expect(one('cargo_exceptions', exc.id)).toMatchObject({ status: 'resolved', resolution: 'no_action', resolved_by: null });
    expect(one('cargo_exceptions', exc.id).resolution_note).toMatch(/was delivered, so the delay no longer applies/);
    expect(one('cargo_exceptions', exc.id).notes.at(-1)).toMatchObject({ role: 'system', kind: 'action' });
    expect(one('cargo_exceptions', exc.id).notes.at(-1).text).toMatch(/^Resolved automatically/);

    const log = supabaseMock.rows('shipment_logs').filter(l => l.metadata_json?.automatic);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ shipment_id: ID.s1, status: 'delivered' });
    expect(log[0].metadata_json.case_note).toMatch(new RegExp(`Case ${exc.code} \\(delay\\) closed automatically`));

    const history = await ShipmentService.getShipmentHistory(ID.s1);
    expect(history!.some(e => e.internal && /closed automatically/.test(e.note ?? ''))).toBe(true);
    const tracking = await ShipmentService.getPublicTracking(one('shipments', ID.s1).tracking_id);
    expect(JSON.stringify(tracking)).not.toMatch(/closed automatically|internal/);

    expect(audit().map(a => a.action)).toEqual(['cargo_case.opened', 'cargo_case.auto_resolved']);
    expect(audit()[1].input_data).toMatchObject({ code: exc.code, type: 'delay', resolution: 'no_action' });
  });

  it('on cancellation of a load', async () => {
    lateWorld({
      cargo_exceptions: [delayCase('x1', 'EXC-LOAD01')],
      cargo_exception_items: [{ id: 'i1', exception_id: 'x1', manifest_id: ID.m1 }],
      cargo_manifest: [manifestRow(ID.m1, { status: 'cancelled', current_holder: 'consignor' })],
    });
    expect(await resolveDelayCasesFor({ manifest_id: ID.m1 }, 'cancelled')).toBe(1);
    expect(one('cargo_exceptions', 'x1').resolution_note).toMatch(/was cancelled/);
    expect(audit().at(-1)).toMatchObject({ action: 'cargo_case.auto_resolved' });
  });

  it('leaves a case alone while another of its goods is still on the road', async () => {
    lateWorld({
      shipments: [shipmentRow(ID.s1, { status: 'delivered', current_holder: 'consignee', pieces_delivered: 10 }), shipmentRow(ID.s2)],
      cargo_exceptions: [delayCase('x1', 'EXC-TWO001', { source: 'manual' })],
      cargo_exception_items: [{ id: 'i1', exception_id: 'x1', shipment_id: ID.s1 }, { id: 'i2', exception_id: 'x1', shipment_id: ID.s2 }],
    });
    expect(await resolveDelayCasesFor({ shipment_id: ID.s1 }, 'delivered')).toBe(0);
    expect(one('cargo_exceptions', 'x1').status).toBe('open');
  });

  it('only touches delay cases', async () => {
    lateWorld({
      shipments: [shipmentRow(ID.s1, { status: 'delivered', current_holder: 'consignee', pieces_delivered: 10 })],
      cargo_exceptions: [delayCase('x1', 'EXC-DMG001', { type: 'damage', source: 'manual' })],
      cargo_exception_items: [{ id: 'i1', exception_id: 'x1', shipment_id: ID.s1 }],
    });
    expect(await resolveDelayCasesFor({ shipment_id: ID.s1 }, 'delivered')).toBe(0);
    expect(one('cargo_exceptions', 'x1').status).toBe('open');
  });

  it('the scheduler sweep closes delay cases left open on goods delivered earlier', async () => {
    lateWorld({
      shipments: [shipmentRow(ID.s1, { status: 'delivered', current_holder: 'consignee', pieces_delivered: 10 })],
      cargo_exceptions: [delayCase('x1', 'EXC-OLD001', { severity: 'high' })],
      cargo_exception_items: [{ id: 'i1', exception_id: 'x1', shipment_id: ID.s1 }],
    });
    await detectDelays();
    expect(one('cargo_exceptions', 'x1').status).toBe('resolved');
  });
});
