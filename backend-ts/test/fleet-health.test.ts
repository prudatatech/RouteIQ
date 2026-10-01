import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { clearThresholdCache } from '../src/services/alert-settings.service';
import { serviceStatus, type ServicePlan } from '../src/services/service-plans.service';
import { computeHealth, type HealthVehicleRow } from '../src/services/vehicle-health.service';

const app = testApp();
const VEHICLE = '66666666-6666-6666-6666-666666666666';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });
const NOW = new Date('2026-09-29T06:00:00Z');
const plan = (over: Partial<ServicePlan> = {}): ServicePlan => ({
  id: 'p1', vehicle_id: VEHICLE, item: 'Engine oil', interval_km: 10000, interval_days: null, last_done_km: 40000, last_done_at: null, ...over,
});
const vehicleRow = (over: Partial<HealthVehicleRow> = {}): HealthVehicleRow => ({
  id: VEHICLE, plate_number: 'MH12AB1234', status: 'idle', odometer_km: null,
  rc_expiry: null, insurance_expiry: null, fitness_expiry: null, permit_expiry: null, puc_expiry: null,
  fuel_level_pct: null, fuel_reported_at: null, last_heartbeat: null, last_sync: null, ...over,
});

describe('service status', () => {
  it('is overdue, due soon or ok by km', () => {
    expect(serviceStatus(plan(), 50500, NOW)).toMatchObject({ status: 'overdue', km_remaining: -500, summary: 'Overdue by 500 km' });
    expect(serviceStatus(plan(), 49200, NOW)).toMatchObject({ status: 'due_soon', km_remaining: 800 });
    expect(serviceStatus(plan(), 43000, NOW)).toMatchObject({ status: 'ok', km_remaining: 7000, next_due_km: 50000 });
  });

  it('works by date, and takes the worse of km and date', () => {
    const byDate = plan({ interval_km: null, interval_days: 180, last_done_km: null, last_done_at: '2026-03-01' });
    expect(serviceStatus(byDate, null, NOW)).toMatchObject({ status: 'overdue', next_due_at: '2026-08-28' });
    const both = plan({ interval_days: 365, last_done_at: '2026-09-01' });
    expect(serviceStatus(both, 51000, NOW).status).toBe('overdue'); // km overdue, date fine
  });

  it('is unknown when the baseline or odometer is missing', () => {
    expect(serviceStatus(plan({ last_done_km: null }), 50000, NOW).status).toBe('unknown');
    expect(serviceStatus(plan(), null, NOW)).toMatchObject({ status: 'unknown', summary: 'Odometer is not known yet' });
  });
});

describe('health score', () => {
  it('has no score when nothing is known', () => {
    const h = computeHealth(vehicleRow(), [], [], 15, NOW);
    expect(h.score).toBeNull();
    expect(h.band).toBe('unknown');
    expect(h.checks.every(c => c.state === 'unknown')).toBe(true);
  });

  it('has no score when only alarms and fuel are known: no odometer, service plan or document dates', () => {
    const v = vehicleRow({ last_heartbeat: '2026-09-29T05:59:00Z', fuel_level_pct: 60, fuel_reported_at: '2026-09-29T05:00:00Z' });
    const h = computeHealth(v, [], [], 15, NOW);
    expect(h.checks_known).toBe(2);
    expect(h.score).toBeNull();
    expect(h.band).toBe('unknown');
  });

  it('takes points off for overdue service, expired documents, alarms and low fuel', () => {
    const v = vehicleRow({
      odometer_km: 51000, insurance_expiry: '2026-09-01', puc_expiry: '2026-10-10', rc_expiry: '2030-01-01',
      last_heartbeat: '2026-09-29T05:59:00Z', fuel_level_pct: 5, fuel_reported_at: '2026-09-29T05:00:00Z',
    });
    const h = computeHealth(v, [serviceStatus(plan(), 51000, NOW)], [{ vehicle_id: VEHICLE, alert_type: 'overspeed', severity: 'high' }], 15, NOW);
    const by = Object.fromEntries(h.checks.map(c => [c.key, c]));
    expect(by.service).toMatchObject({ state: 'critical', penalty: 15 });
    expect(by.documents).toMatchObject({ state: 'critical', penalty: 25 }); // one expired (20) and one expiring (5)
    expect(by.alarms).toMatchObject({ state: 'warning', penalty: 5 });
    expect(by.fuel).toMatchObject({ state: 'critical', penalty: 20 });
    expect(h.score).toBe(100 - 15 - 25 - 5 - 20);
    expect(h.band).toBe('poor');
    expect(h.issues[0].severity).toBe('critical');
    expect(h.issues.map(i => i.text)).toContain('Insurance expired 28 days ago');
  });

  it('ignores fuel that is stale and does not count unknown checks against the vehicle', () => {
    const v = vehicleRow({ rc_expiry: '2030-01-01', fuel_level_pct: 3, fuel_reported_at: '2026-09-20T00:00:00Z' });
    const h = computeHealth(v, [], [], 15, NOW);
    expect(h.checks.find(c => c.key === 'fuel')?.state).toBe('unknown');
    expect(h.score).toBe(100);
    expect(h.checks_known).toBe(1);
  });
});

describe('fleet health endpoints', () => {
  beforeEach(() => {
    clearThresholdCache();
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'drv', role: 'driver', is_active: true }],
      vehicles: [
        { id: VEHICLE, plate_number: 'MH12AB1234', status: 'idle', odometer_km: 51000, insurance_expiry: '2020-01-01', last_heartbeat: new Date().toISOString() },
        { id: '77777777-7777-7777-7777-777777777777', plate_number: 'MH12ZZ0001', status: 'archived' },
        { id: '88888888-8888-8888-8888-888888888888', plate_number: 'MH12CC0002', status: 'idle' },
      ],
      vehicle_service_plans: [plan()],
      vehicle_service_log: [],
      maintenance_alerts: [
        { id: 't', vehicle_id: VEHICLE, alert_type: 'tamper', severity: 'critical', is_test: true, created_at: new Date().toISOString() },
      ],
      expenses: [],
      system_settings: [],
    });
  });

  it('lists vehicles worst first, leaves out archived ones, and ignores test alarms', async () => {
    const res = await request(app).get('/api/v1/fleet/health').set(bearer('admin-1'));
    expect(res.status).toBe(200);
    expect(res.body.map((h: { plate_number: string }) => h.plate_number)).toEqual(['MH12AB1234', 'MH12CC0002']);
    const [bad, unknown] = res.body;
    expect(bad.score).toBe(100 - 15 - 20); // overdue oil, expired insurance; the test alarm costs nothing
    expect(unknown.score).toBeNull();
    expect((await request(app).get('/api/v1/fleet/health').set(bearer('drv'))).status).toBe(403);
  });

  it('returns one vehicle with the breakdown', async () => {
    const res = await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/health`).set(bearer('admin-1'));
    expect(res.status).toBe(200);
    expect(res.body.checks).toHaveLength(4);
    expect(res.body.service[0]).toMatchObject({ item: 'Engine oil', status: 'overdue' });
    expect((await request(app).get('/api/v1/fleet/vehicles/99999999-9999-9999-9999-999999999999/health').set(bearer('admin-1'))).status).toBe(404);
  });

  it('lists overdue and due-soon service items across the fleet', async () => {
    const res = await request(app).get('/api/v1/fleet/service-due').set(bearer('admin-1'));
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ plate_number: 'MH12AB1234', item: 'Engine oil', status: 'overdue' });
  });
});

describe('service plans and log', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vehicles: [{ id: VEHICLE, plate_number: 'MH12AB1234', status: 'idle', odometer_km: 45000 }],
      vehicle_service_plans: [],
      vehicle_service_log: [],
      expenses: [],
    });
  });

  it('adds a plan, changes it for the same item, and removes it', async () => {
    const add = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/service-plans`).set(bearer('admin-1'))
      .send({ item: 'Brakes', interval_km: 30000, last_done_km: 30000 });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ item: 'Brakes', status: 'ok', km_remaining: 15000 });
    const change = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/service-plans`).set(bearer('admin-1'))
      .send({ item: 'Brakes', interval_km: 12000, last_done_km: 30000 });
    expect(change.body).toMatchObject({ status: 'overdue' });
    expect(supabaseMock.rows('vehicle_service_plans')).toHaveLength(1);

    const list = await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/service-plans`).set(bearer('admin-1'));
    expect(list.body).toHaveLength(1);
    const del = await request(app).delete(`/api/v1/fleet/service-plans/${add.body.id}`).set(bearer('admin-1'));
    expect(del.status).toBe(200);
    expect(supabaseMock.rows('vehicle_service_plans')).toHaveLength(0);
  });

  it('needs an interval and rejects bad numbers', async () => {
    const none = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/service-plans`).set(bearer('admin-1')).send({ item: 'Tyres' });
    expect(none.status).toBe(400);
    const neg = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/service-plans`).set(bearer('admin-1')).send({ item: 'Tyres', interval_km: -5 });
    expect(neg.status).toBe(400);
  });

  it('logs a service: moves the baseline, raises the odometer and records the cost as an expense', async () => {
    supabaseMock.rows('vehicle_service_plans').push(plan({ id: 'plan-oil', last_done_km: 30000 }));
    const res = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/service-log`).set(bearer('admin-1'))
      .send({ item: 'Engine oil', done_at: '2026-09-28', odometer_km: 45200, cost: 4200, note: 'Filter changed too' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ item: 'Engine oil', cost: 4200, expense_recorded: true, plan_updated: true });
    expect(res.body.vehicle_status).toBe(supabaseMock.rows('vehicles')[0].status); // so the UI can offer "Return to service"

    expect(supabaseMock.rows('vehicle_service_plans')[0]).toMatchObject({ last_done_km: 45200, last_done_at: '2026-09-28' });
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBe(45200);
    const [expense] = supabaseMock.rows('expenses');
    expect(expense).toMatchObject({ vehicle_id: VEHICLE, category: 'maintenance', amount: 4200, expense_date: '2026-09-28' });
    expect(supabaseMock.rows('vehicle_service_log')[0]).toMatchObject({ expense_id: expense.id, odometer_km: 45200 });

    const history = await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/service-log`).set(bearer('admin-1'));
    expect(history.body).toHaveLength(1);
  });

  it('stores the cost on the log alone when expenses cannot be written', async () => {
    supabaseMock.fail('expenses', 'relation "expenses" does not exist');
    const res = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/service-log`).set(bearer('admin-1')).send({ item: 'Tyres', cost: 900 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ cost: 900, expense_recorded: false, plan_updated: false });
    expect(supabaseMock.rows('vehicle_service_log')[0]).toMatchObject({ cost: 900, expense_id: null, odometer_km: 45000 });
  });

  it('rejects a future date and a missing item', async () => {
    const future = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/service-log`).set(bearer('admin-1')).send({ item: 'Tyres', done_at: '2999-01-01' });
    expect(future.status).toBe(400);
    const none = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/service-log`).set(bearer('admin-1')).send({});
    expect(none.status).toBe(400);
  });
});
