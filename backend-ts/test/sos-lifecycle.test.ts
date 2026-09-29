import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import {
  escalateStaleSos, reminderDue, summariseSos, SOS_MAX_REMINDERS, SOS_REMIND_AFTER_MIN, SOS_REMIND_EVERY_MIN,
} from '../src/services/sos.service';

const app = testApp();
const ALERT = '44444444-4444-4444-4444-444444444444';
const VEHICLE = '33333333-3333-3333-3333-333333333333';
const driver = createAccessToken({ sub: 'driver-1', role: 'driver' });
const otherDriver = createAccessToken({ sub: 'driver-2', role: 'driver' });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const staff = () => bearer(supabaseMock.signUserToken('admin-1'));
const MIN = 60_000;

const USERS = [
  { id: 'admin-1', role: 'admin', is_active: true },
  { id: 'super-1', role: 'superadmin', is_active: true },
  { id: 'driver-1', role: 'driver', is_active: true },
];

function seed(status: string | null, extra: Record<string, unknown> = {}) {
  supabaseMock.reset({
    users: USERS,
    vehicles: [{ id: VEHICLE, driver_id: 'driver-1', plate_number: 'MH12AB1234', driver_name: 'Ravi', status: 'idle' }],
    sos_alerts: [{ id: ALERT, driver_id: 'driver-1', vehicle_id: VEHICLE, alert_type: 'panic_button', status, ...extra }],
    notifications: [],
  });
}
const statusNow = () => supabaseMock.rows('sos_alerts').find(a => a.id === ALERT)?.status;
const cancel = (headers: Record<string, string>) => request(app).post(`/api/v1/telemetry/sos/${ALERT}/cancel`).set(headers);
const step = (what: 'acknowledge' | 'resolve') => request(app).put(`/api/v1/telemetry/sos/${ALERT}/${what}`).set(staff());

async function waitForNotifications(min: number, timeoutMs = 800) {
  const start = Date.now();
  while (supabaseMock.writes('notifications', 'POST').length < min && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('SOS status transitions', () => {
  beforeEach(() => seed('active'));

  it('goes active, acknowledged, resolved', async () => {
    expect((await step('acknowledge')).body).toMatchObject({ success: true, status: 'acknowledged', changed: true });
    expect(statusNow()).toBe('acknowledged');
    expect((await step('resolve')).body).toMatchObject({ success: true, status: 'resolved', changed: true });
    expect(statusNow()).toBe('resolved');
  });

  it('can be resolved straight from active', async () => {
    expect((await step('resolve')).status).toBe(200);
    expect(statusNow()).toBe('resolved');
  });

  it('repeating the step the alert is already in succeeds and changes nothing', async () => {
    await step('resolve');
    const writesBefore = supabaseMock.writes('sos_alerts').length;
    const again = await step('resolve');
    expect(again.status).toBe(200);
    expect(again.body.changed).toBe(false);
    expect(supabaseMock.writes('sos_alerts').length).toBe(writesBefore);
  });

  it('refuses to acknowledge or resolve a resolved alert back to an earlier state', async () => {
    seed('resolved');
    const res = await step('acknowledge');
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain('already resolved');
    expect(statusNow()).toBe('resolved');
  });

  it('refuses to resolve a cancelled alert', async () => {
    seed('cancelled');
    expect((await step('resolve')).status).toBe(409);
    expect(statusNow()).toBe('cancelled');
  });

  it('404s for an alert that does not exist', async () => {
    const res = await request(app).put('/api/v1/telemetry/sos/00000000-0000-0000-0000-000000000000/resolve').set(staff());
    expect(res.status).toBe(404);
  });

  it('writes only valid statuses', async () => {
    await step('acknowledge');
    await step('resolve');
    seed('active');
    await cancel(staff());
    const written = supabaseMock.writes('sos_alerts').map(w => w.body.status).filter(Boolean);
    expect(written.length).toBeGreaterThan(0);
    for (const s of written) expect(['active', 'acknowledged', 'resolved', 'cancelled']).toContain(s);
  });
});

describe('cancelling an SOS', () => {
  beforeEach(() => seed('active'));

  it('lets the driver cancel their own alert, and tells staff', async () => {
    const res = await cancel(bearer(driver));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'cancelled', changed: true });
    expect(statusNow()).toBe('cancelled');

    await waitForNotifications(2);
    const sent = supabaseMock.writes('notifications', 'POST').map(w => w.body);
    expect(sent.map(n => n.user_id).sort()).toEqual(['admin-1', 'super-1']);
    expect(sent[0]).toMatchObject({ type: 'sos', title: 'SOS cancelled' });
    expect(sent[0].data).toMatchObject({ alert_id: ALERT, cancelled: true });
  });

  it('lets the driver cancel an alert staff already acknowledged', async () => {
    seed('acknowledged');
    expect((await cancel(bearer(driver))).status).toBe(200);
    expect(statusNow()).toBe('cancelled');
  });

  it("does not let a driver cancel another driver's alert", async () => {
    const res = await cancel(bearer(otherDriver));
    expect(res.status).toBe(404);
    expect(statusNow()).toBe('active');
  });

  it('cannot cancel an alert that is already resolved', async () => {
    seed('resolved');
    const res = await cancel(bearer(driver));
    expect(res.status).toBe(409);
    expect(statusNow()).toBe('resolved');
  });

  it('cancelling twice is not an error and does not notify twice', async () => {
    await cancel(bearer(driver));
    await waitForNotifications(2);
    const before = supabaseMock.writes('notifications', 'POST').length;
    const again = await cancel(bearer(driver));
    expect(again.status).toBe(200);
    expect(again.body.changed).toBe(false);
    await new Promise(r => setTimeout(r, 50));
    expect(supabaseMock.writes('notifications', 'POST').length).toBe(before);
  });

  it('lets staff close an alert as a false alarm without notifying anyone', async () => {
    const res = await cancel(staff());
    expect(res.status).toBe(200);
    expect(statusNow()).toBe('cancelled');
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(0);
  });

  it('is for drivers and staff only', async () => {
    const vendor = createAccessToken({ sub: 'vendor-1', role: 'vendor' });
    expect((await cancel(bearer(vendor))).status).toBe(403);
  });
});

describe('SOS counts', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();

  it('counts total, the last 30 days, open and cancelled per vehicle', () => {
    const counts = summariseSos([
      { vehicle_id: 'a', status: 'active', created_at: ago(1) },
      { vehicle_id: 'a', status: 'acknowledged', created_at: ago(10) },
      { vehicle_id: 'a', status: 'resolved', created_at: ago(29) },
      { vehicle_id: 'a', status: 'resolved', created_at: ago(45) },
      { vehicle_id: 'a', status: 'cancelled', created_at: ago(2) },
      { vehicle_id: 'b', status: null, created_at: ago(90) },
      { vehicle_id: null, status: 'active', created_at: ago(1) },
    ], now);
    expect(counts.a).toEqual({ total: 5, last_30_days: 4, open: 2, cancelled: 1 });
    // No status means nobody has touched it: it is still open
    expect(counts.b).toEqual({ total: 1, last_30_days: 0, open: 1, cancelled: 0 });
    expect(Object.keys(counts)).toEqual(['a', 'b']);
  });

  it('GET /vehicles/sos-counts returns the counts for staff only', async () => {
    supabaseMock.reset({
      users: USERS,
      sos_alerts: [
        { id: 's1', vehicle_id: VEHICLE, status: 'active', created_at: new Date().toISOString() },
        { id: 's2', vehicle_id: VEHICLE, status: 'resolved', created_at: new Date(Date.now() - 60 * 86_400_000).toISOString() },
      ],
    });
    const res = await request(app).get('/api/v1/vehicles/sos-counts').set(staff());
    expect(res.status).toBe(200);
    expect(res.body[VEHICLE]).toEqual({ total: 2, last_30_days: 1, open: 1, cancelled: 0 });
    expect((await request(app).get('/api/v1/vehicles/sos-counts').set(bearer(driver))).status).toBe(403);
  });

  it("GET /vehicles/:id/sos returns that vehicle's history with its counts", async () => {
    supabaseMock.reset({
      users: USERS,
      sos_alerts: [
        { id: 's1', vehicle_id: VEHICLE, status: 'resolved', alert_type: 'breakdown', created_at: '2026-09-01T10:00:00Z' },
        { id: 's2', vehicle_id: VEHICLE, status: 'active', alert_type: 'panic_button', created_at: '2026-09-20T10:00:00Z' },
        { id: 's3', vehicle_id: 'other-vehicle', status: 'active', alert_type: 'theft', created_at: '2026-09-25T10:00:00Z' },
      ],
    });
    const res = await request(app).get(`/api/v1/vehicles/${VEHICLE}/sos`).set(staff());
    expect(res.status).toBe(200);
    // (ordering is done by the database; the mock does not sort)
    expect(res.body.alerts.map((a: { id: string }) => a.id).sort()).toEqual(['s1', 's2']);
    expect(res.body.counts.total).toBe(2);
    expect(res.body.counts.open).toBe(1);
  });
});

describe('stale SOS reminders', () => {
  const created = '2026-09-29T10:00:00Z';
  const t0 = Date.parse(created);

  it('waits before reminding, then reminds, then spaces the reminders out', () => {
    const alert = { status: 'active', created_at: created, updated_at: created };
    const none = { reminders: 0, lastReminderAt: null };
    expect(reminderDue(alert, none, t0 + (SOS_REMIND_AFTER_MIN.active - 1) * MIN)).toBeNull();
    expect(reminderDue(alert, none, t0 + SOS_REMIND_AFTER_MIN.active * MIN)).toBe(1);
    const sent = { reminders: 1, lastReminderAt: t0 + 5 * MIN };
    expect(reminderDue(alert, sent, t0 + (5 + SOS_REMIND_EVERY_MIN - 1) * MIN)).toBeNull();
    expect(reminderDue(alert, sent, t0 + (5 + SOS_REMIND_EVERY_MIN) * MIN)).toBe(2);
  });

  it('gives an acknowledged alert its longer wait, counted from when it was acknowledged', () => {
    const alert = { status: 'acknowledged', created_at: created, updated_at: new Date(t0 + 20 * MIN).toISOString() };
    const none = { reminders: 0, lastReminderAt: null };
    expect(reminderDue(alert, none, t0 + 20 * MIN + (SOS_REMIND_AFTER_MIN.acknowledged - 1) * MIN)).toBeNull();
    expect(reminderDue(alert, none, t0 + 20 * MIN + SOS_REMIND_AFTER_MIN.acknowledged * MIN)).toBe(1);
  });

  it('never reminds about closed alerts, and stops after the last reminder', () => {
    const none = { reminders: 0, lastReminderAt: null };
    for (const status of ['resolved', 'cancelled']) {
      expect(reminderDue({ status, created_at: created, updated_at: created }, none, t0 + 999 * MIN)).toBeNull();
    }
    const maxed = { reminders: SOS_MAX_REMINDERS, lastReminderAt: t0 };
    expect(reminderDue({ status: 'active', created_at: created, updated_at: created }, maxed, t0 + 999 * MIN)).toBeNull();
  });

  it('notifies staff about an alert nobody has picked up, once per interval, and marks it escalated', async () => {
    seed('active', { created_at: created, updated_at: created });

    expect(await escalateStaleSos(t0 + 2 * MIN)).toBe(0);
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(0);

    expect(await escalateStaleSos(t0 + 6 * MIN)).toBe(1);
    const first = supabaseMock.writes('notifications', 'POST').map(w => w.body);
    expect(first.map(n => n.user_id).sort()).toEqual(['admin-1', 'super-1']);
    expect(first[0]).toMatchObject({ type: 'sos', title: 'SOS still open' });
    expect(first[0].data).toMatchObject({ alert_id: ALERT, reminder: 1 });
    expect(first[0].body).toContain('MH12AB1234');

    // The first reminders were just sent; another tick does not send them again
    const sentAt = t0 + 6 * MIN;
    for (const n of supabaseMock.rows('notifications')) n.created_at = new Date(sentAt).toISOString();
    expect(await escalateStaleSos(sentAt + 3 * MIN)).toBe(0);

    expect(await escalateStaleSos(sentAt + SOS_REMIND_EVERY_MIN * MIN)).toBe(1);
    const second = supabaseMock.writes('notifications', 'POST').map(w => w.body).filter(n => n.data.reminder === 2);
    expect(second).toHaveLength(2);
    expect(second[0].title).toBe('SOS still open: escalated');
  });

  it('leaves resolved and cancelled alerts alone', async () => {
    for (const status of ['resolved', 'cancelled']) {
      seed(status, { created_at: created, updated_at: created });
      expect(await escalateStaleSos(t0 + 120 * MIN)).toBe(0);
    }
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(0);
  });
});
