import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { itemTotal, recordTotal } from '../src/services/service-records.service';
import { decorateJob } from '../src/services/maintenance.service';

const app = testApp();
const VEHICLE = '88888888-8888-8888-8888-888888888888';
const ROUTE = '99999999-9999-9999-9999-999999999999';
const SOS = 'abababab-abab-abab-abab-abababababab';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });
const api = (path: string) => `/api/v1/fleet${path}`;
const FUTURE = '2999-01-01';

function seed(extra: Record<string, object[]> = {}) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true }],
    vehicles: [{
      id: VEHICLE, plate_number: 'JH10AL0303', status: 'available', driver_id: 'driver-1', odometer_km: 45000,
      odometer_updated_at: '2026-09-28T00:00:00.000Z', capacity_kg: 5000,
    }],
    ...extra,
  });
}

describe('service record totals', () => {
  it('rounds each line and adds labour', () => {
    expect(itemTotal({ quantity: 2, unit_cost: 1250.5 })).toBe(2501);
    expect(itemTotal({ quantity: 0.5, unit_cost: 333.33 })).toBe(166.67);
    expect(recordTotal([{ quantity: 2, unit_cost: 100 }, { quantity: 1, unit_cost: 50.25 }], 300, 9999)).toBe(550.25);
  });

  it('uses the entered total only when there are no items and no labour', () => {
    expect(recordTotal([], null, 4200)).toBe(4200);
    expect(recordTotal([], null, null)).toBeNull();
    expect(recordTotal([], 500, 4200)).toBe(500);
  });
});

describe('service records with items', () => {
  beforeEach(() => seed());
  const log = (body: object) => request(app).post(api(`/vehicles/${VEHICLE}/service-log`)).set(bearer('admin-1')).send(body);

  it('keeps the simple form simple: what was done, total, workshop', async () => {
    const res = await log({ item: 'Engine oil', done_at: '2026-09-28', odometer_km: 45100, cost: 4200, workshop: 'Sharma Motors' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ item: 'Engine oil', cost: 4200, workshop: 'Sharma Motors', items: [], attachments: [], expense_recorded: true });
  });

  it('makes the total the sum of the items plus labour and stores each item', async () => {
    const res = await log({
      item: 'Brake job', done_at: '2026-09-28', cost: 1, labour_cost: 600,
      items: [
        { description: 'Brake pads (front)', quantity: 2, unit_cost: 1800 },
        { description: 'Brake fluid', kind: 'part', quantity: 1, unit_cost: 250.5 },
        { description: 'Caliper repair', kind: 'repair', quantity: 1, unit_cost: 900 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.cost).toBe(5350.5); // 3600 + 250.5 + 900 + 600, the typed total is ignored
    expect(res.body.labour_cost).toBe(600);
    expect(res.body.items.map((i: any) => [i.description, i.total_cost])).toEqual([
      ['Brake pads (front)', 3600], ['Brake fluid', 250.5], ['Caliper repair', 900],
    ]);
    expect(supabaseMock.rows('expenses')[0]).toMatchObject({ amount: 5350.5, category: 'maintenance' });

    const history = await request(app).get(api(`/vehicles/${VEHICLE}/service-log`)).set(bearer('admin-1'));
    expect(history.body[0].items).toHaveLength(3);
  });

  it('rejects a bad item', async () => {
    expect((await log({ item: 'Oil', items: [{ description: '', quantity: 1, unit_cost: 5 }] })).status).toBe(400);
    expect((await log({ item: 'Oil', items: [{ description: 'Filter', quantity: 0, unit_cost: 5 }] })).status).toBe(400);
    expect((await log({ item: 'Oil', items: [{ description: 'Filter', quantity: 1, unit_cost: -5 }] })).status).toBe(400);
  });

  it('updates the cost and the expense when items are added or removed later', async () => {
    const created = await log({ item: 'Service', labour_cost: 500 });
    const id = created.body.id;
    expect(created.body.cost).toBe(500);

    const added = await request(app).post(api(`/service-log/${id}/items`)).set(bearer('admin-1'))
      .send({ items: [{ description: 'Oil filter', quantity: 1, unit_cost: 350 }, { description: 'Engine oil 15W40 (L)', quantity: 8, unit_cost: 420 }] });
    expect(added.status).toBe(201);
    expect(added.body.cost).toBe(4210);
    expect(supabaseMock.rows('vehicle_service_log')[0].cost).toBe(4210);
    expect(supabaseMock.rows('expenses')[0].amount).toBe(4210);

    const oil = added.body.items.find((i: any) => i.description.startsWith('Engine oil'));
    const removed = await request(app).delete(api(`/service-items/${oil.id}`)).set(bearer('admin-1'));
    expect(removed.status).toBe(200);
    expect(removed.body.cost).toBe(850);
    expect(supabaseMock.rows('vehicle_service_log')[0].cost).toBe(850);
    expect(supabaseMock.rows('expenses')[0].amount).toBe(850);
  });

  it('moves the baseline of every schedule item the service covers', async () => {
    supabaseMock.rows('vehicle_service_plans').push(
      { id: 'p1', vehicle_id: VEHICLE, item: 'Engine oil', interval_km: 10000, last_done_km: 30000, last_done_at: '2026-01-01' },
      { id: 'p2', vehicle_id: VEHICLE, item: 'Air filter', interval_km: 20000, last_done_km: 20000, last_done_at: '2026-01-01' },
      { id: 'p3', vehicle_id: VEHICLE, item: 'Coolant', interval_km: 40000, last_done_km: 10000, last_done_at: '2026-01-01' },
    );
    const res = await log({ item: 'Full service', done_at: '2026-09-28', odometer_km: 45200, plan_items: ['Engine oil', 'Air filter'] });
    expect(res.body.plan_updated).toBe(true);
    const plans = supabaseMock.rows('vehicle_service_plans');
    expect(plans.find(p => p.item === 'Engine oil')).toMatchObject({ last_done_km: 45200, last_done_at: '2026-09-28' });
    expect(plans.find(p => p.item === 'Air filter')).toMatchObject({ last_done_km: 45200, last_done_at: '2026-09-28' });
    expect(plans.find(p => p.item === 'Coolant')).toMatchObject({ last_done_km: 10000, last_done_at: '2026-01-01' });
  });
});

describe('service attachments', () => {
  beforeEach(() => seed());
  const auth = () => bearer('admin-1');

  it('issues a signed upload URL under this vehicle for a PDF, JPG or PNG', async () => {
    const res = await request(app).post(api(`/vehicles/${VEHICLE}/service-attachments/upload-url`)).set(auth())
      .send({ content_type: 'application/pdf', size: 200_000 });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(new RegExp(`^vehicle-service/${VEHICLE}/[0-9a-f-]+\\.pdf$`));
    expect(supabaseMock.signedUploads.some(p => p.includes(`vehicle-service/${VEHICLE}/`))).toBe(true);
  });

  it('refuses other types, missing sizes and files that are too big', async () => {
    const post = (body: object) => request(app).post(api(`/vehicles/${VEHICLE}/service-attachments/upload-url`)).set(auth()).send(body);
    expect((await post({ content_type: 'application/zip', size: 100 })).status).toBe(415);
    expect((await post({ content_type: 'image/png' })).status).toBe(400);
    expect((await post({ content_type: 'image/png', size: 50 * 1024 * 1024 })).status).toBe(413);
  });

  it('stores attachments with a record and lists them; refuses another vehicle\'s file', async () => {
    const path = `vehicle-service/${VEHICLE}/inv-1.pdf`;
    const ok = await request(app).post(api(`/vehicles/${VEHICLE}/service-log`)).set(auth()).send({
      item: 'Tyres', cost: 24000,
      attachments: [{ path, kind: 'invoice', file_name: 'invoice.pdf', content_type: 'application/pdf', size_bytes: 1234 },
        { path: `vehicle-service/${VEHICLE}/tyre.jpg`, kind: 'photo', file_name: 'tyre.jpg' }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.attachments).toHaveLength(2);
    expect(supabaseMock.rows('vehicle_service_attachments')[0]).toMatchObject({ file_path: path, kind: 'invoice', service_log_id: ok.body.id, vehicle_id: VEHICLE });
    // The private storage path is never selected for the browser
    expect(supabaseMock.requests.filter(r => r.pathname.endsWith('/vehicle_service_attachments') && r.searchParams.get('select')).every(r => !r.searchParams.get('select')!.includes('file_path'))).toBe(true);

    const history = await request(app).get(api(`/vehicles/${VEHICLE}/service-log`)).set(auth());
    expect(history.body[0].attachments.map((a: any) => a.file_name).sort()).toEqual(['invoice.pdf', 'tyre.jpg']);

    const foreign = await request(app).post(api(`/vehicles/${VEHICLE}/service-log`)).set(auth())
      .send({ item: 'Tyres', attachments: [{ path: 'vehicle-service/someone-else/inv.pdf', kind: 'invoice' }] });
    expect(foreign.status).toBe(400);
    const traversal = await request(app).post(api(`/vehicles/${VEHICLE}/service-log`)).set(auth())
      .send({ item: 'Tyres', attachments: [{ path: `vehicle-service/${VEHICLE}/../x/inv.pdf`, kind: 'invoice' }] });
    expect(traversal.status).toBe(400);
    expect(supabaseMock.rows('vehicle_service_log')).toHaveLength(1);
  });

  it('adds files to an existing record, gives a signed link to view or download, and deletes', async () => {
    const created = await request(app).post(api(`/vehicles/${VEHICLE}/service-log`)).set(auth()).send({ item: 'Oil' });
    const add = await request(app).post(api(`/service-log/${created.body.id}/attachments`)).set(auth())
      .send({ attachments: [{ path: `vehicle-service/${VEHICLE}/card.png`, kind: 'job_card', file_name: 'card.png' }] });
    expect(add.status).toBe(201);
    const id = add.body[0].id;

    const view = await request(app).get(api(`/service-attachments/${id}/url`)).set(auth());
    expect(view.status).toBe(200);
    expect(view.body.url).toContain('token=');
    expect(supabaseMock.signedReads).toContain(`kyc_documents/vehicle-service/${VEHICLE}/card.png`);
    const dl = await request(app).get(api(`/service-attachments/${id}/url?download=1`)).set(auth());
    expect(dl.status).toBe(200);

    const del = await request(app).delete(api(`/service-attachments/${id}`)).set(auth());
    expect(del.status).toBe(200);
    expect(supabaseMock.rows('vehicle_service_attachments')).toHaveLength(0);
    expect((await request(app).get(api(`/service-attachments/${id}/url`)).set(auth())).status).toBe(404);
  });

  it('is staff only', async () => {
    expect((await request(app).post(api(`/vehicles/${VEHICLE}/service-attachments/upload-url`)).set(bearer('driver-1')).send({})).status).toBe(403);
  });
});

describe('moving a vehicle to maintenance', () => {
  beforeEach(() => seed());
  const open = (body: object = {}) => request(app).post(api(`/vehicles/${VEHICLE}/maintenance`)).set(bearer('admin-1'))
    .send({ reason_type: 'scheduled_service', expected_return_date: FUTURE, workshop: 'Sharma Motors, Jamshedpur', note: 'Due for 45,000 km service', ...body });

  it('opens a job, sets the vehicle to maintenance and tells the driver', async () => {
    const res = await open();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'open', reason_type: 'scheduled_service', workshop: 'Sharma Motors, Jamshedpur', expected_return_date: FUTURE,
      plate_number: 'JH10AL0303', is_overdue: false, opened_odometer_km: 45000,
    });
    expect(supabaseMock.rows('vehicles')[0].status).toBe('maintenance');
    expect(supabaseMock.rows('vehicle_maintenance_jobs')).toHaveLength(1);
    const [note] = supabaseMock.rows('notifications');
    expect(note).toMatchObject({ user_id: 'driver-1', type: 'maintenance' });
    expect(note.body).toContain('JH10AL0303');
  });

  it('needs a reason type, and a return date that is not in the past', async () => {
    expect((await open({ reason_type: undefined })).status).toBe(400);
    expect((await open({ reason_type: 'wear_and_tear' })).status).toBe(400);
    expect((await open({ expected_return_date: '2020-01-01' })).status).toBe(400);
    expect(supabaseMock.rows('vehicle_maintenance_jobs')).toHaveLength(0);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('available');
  });

  it('does not open a second job for the same vehicle, or one for an archived vehicle', async () => {
    await open();
    const again = await open();
    expect(again.status).toBe(409);
    expect(again.body.job_id).toBeTruthy();
    expect(supabaseMock.rows('vehicle_maintenance_jobs')).toHaveLength(1);

    supabaseMock.rows('vehicle_maintenance_jobs').length = 0;
    supabaseMock.rows('vehicles')[0].status = 'archived';
    expect((await open()).status).toBe(409);
  });

  describe('a vehicle with work', () => {
    beforeEach(() => {
      seed({
        routes: [{ id: ROUTE, vehicle_id: VEHICLE, status: 'active', started_at: '2026-09-29T02:00:00.000Z' }],
        cargo_manifest: [{ id: 'cccccccc-0000-0000-0000-000000000001', vehicle_id: VEHICLE, status: 'in_transit', pickup_location: 'Ranchi', drop_location: 'Patna', capacity_kg: 800 }],
        route_stops: [], delivery_points: [], shipments: [],
      });
      supabaseMock.rows('vehicles')[0].status = 'on_route';
    });

    it('previews what would be interrupted', async () => {
      const res = await request(app).get(api(`/vehicles/${VEHICLE}/maintenance/preview`)).set(bearer('admin-1'));
      expect(res.status).toBe(200);
      expect(res.body.open_work).toMatchObject({ blocking: true });
      expect(res.body.open_work.routes).toHaveLength(1);
      expect(res.body.open_work.manifests).toHaveLength(1);
      expect(res.body.open_work.summary).toContain('1 active route');
      expect(res.body.open_job).toBeNull();
    });

    it('is blocked unless staff choose to release the routes and loads', async () => {
      const res = await open();
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ requires_release: true });
      expect(res.body.open_work.blocking).toBe(true);
      expect(res.body.detail).toContain('JH10AL0303');
      expect(supabaseMock.rows('vehicle_maintenance_jobs')).toHaveLength(0);
      expect(supabaseMock.rows('vehicles')[0].status).toBe('on_route');
      expect(supabaseMock.rows('routes')[0].status).toBe('active');
    });

    it('releases the route and load, records what was released and notifies the driver', async () => {
      const res = await open({ release_work: true });
      expect(res.status).toBe(201);
      expect(res.body.released_work).toEqual({ routes: [ROUTE], manifests: ['cccccccc-0000-0000-0000-000000000001'] });
      expect(supabaseMock.rows('routes')[0].status).toBe('cancelled');
      expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('cancelled');
      expect(supabaseMock.rows('vehicles')[0].status).toBe('maintenance');
      const titles = supabaseMock.rows('notifications').filter(n => n.user_id === 'driver-1').map(n => n.title);
      expect(titles).toContain('Route cancelled');
      expect(titles).toContain('Load cancelled');
      expect(titles).toContain('Vehicle moved to maintenance');
    });

    it('puts its unpicked shipments back in the queue when the route is released', async () => {
      const SHIPMENT = 'dddddddd-0000-0000-0000-000000000001';
      supabaseMock.rows('route_stops').push({ id: 'st1', route_id: ROUTE, delivery_point_id: 'dp1', status: 'pending' });
      supabaseMock.rows('delivery_points').push({ id: 'dp1', shipment_id: SHIPMENT });
      supabaseMock.rows('shipments').push({ id: SHIPMENT, status: 'assigned', origin_lat: 1, origin_lng: 2 });
      const res = await open({ release_work: true });
      expect(res.status).toBe(201);
      expect(supabaseMock.rows('shipments')[0].status).toBe('created');
    });

    it('counts shipments already on board so staff know what release does not undo', async () => {
      supabaseMock.rows('route_stops').push({ id: 'st1', route_id: ROUTE, delivery_point_id: 'dp1', status: 'pending' });
      supabaseMock.rows('delivery_points').push({ id: 'dp1', shipment_id: 'eeeeeeee-0000-0000-0000-000000000001' });
      supabaseMock.rows('shipments').push({ id: 'eeeeeeee-0000-0000-0000-000000000001', status: 'in_transit' });
      const res = await request(app).get(api(`/vehicles/${VEHICLE}/maintenance/preview`)).set(bearer('admin-1'));
      expect(res.body.open_work.shipments_on_board).toBe(1);
      expect(res.body.open_work.summary).toContain('already on board');
    });
  });

  it('converts a driver-raised breakdown into a job, and acknowledges the SOS', async () => {
    seed({ sos_alerts: [{ id: SOS, vehicle_id: VEHICLE, alert_type: 'breakdown', status: 'active', severity: 'serious' }] });
    // A serious breakdown already holds the vehicle in maintenance
    supabaseMock.rows('vehicles')[0].status = 'maintenance';
    const res = await open({ reason_type: 'breakdown', sos_alert_id: SOS });
    expect(res.status).toBe(201);
    expect(res.body.sos_alert_id).toBe(SOS);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('maintenance');
    expect(supabaseMock.rows('sos_alerts')[0].status).toBe('acknowledged');
  });

  it('refuses an SOS from another vehicle', async () => {
    seed({ sos_alerts: [{ id: SOS, vehicle_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', alert_type: 'breakdown', status: 'active' }] });
    expect((await open({ sos_alert_id: SOS })).status).toBe(400);
    expect(supabaseMock.rows('vehicle_maintenance_jobs')).toHaveLength(0);
  });

  it('lists jobs with days in maintenance and marks a late one overdue', async () => {
    seed();
    supabaseMock.rows('vehicles')[0].status = 'maintenance';
    supabaseMock.rows('vehicle_maintenance_jobs').push({
      id: 'job-late', vehicle_id: VEHICLE, status: 'open', reason_type: 'breakdown', expected_return_date: '2026-01-10',
      opened_at: '2026-01-05T00:00:00.000Z', closed_at: null,
    });
    const res = await request(app).get(api('/maintenance/jobs?status=open')).set(bearer('admin-1'));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 'job-late', plate_number: 'JH10AL0303', is_overdue: true });
    expect(res.body[0].days_overdue).toBeGreaterThan(0);
    expect(res.body[0].days_in_maintenance).toBeGreaterThan(200);
  });

  it('decorates a job as on time until the day after the expected return', () => {
    const job = { status: 'open', opened_at: '2026-09-20T05:00:00.000Z', expected_return_date: '2026-09-29', closed_at: null };
    expect(decorateJob(job, new Date('2026-09-29T10:00:00Z'))).toMatchObject({ is_overdue: false, days_in_maintenance: 9 });
    expect(decorateJob(job, new Date('2026-09-30T10:00:00Z'))).toMatchObject({ is_overdue: true, days_overdue: 1 });
    expect(decorateJob({ ...job, status: 'closed', closed_at: '2026-10-05T00:00:00.000Z' }, new Date('2026-10-30T00:00:00Z')).is_overdue).toBe(false);
  });

  it('changes the expected return date of an open job', async () => {
    const opened = await open();
    const res = await request(app).patch(api(`/maintenance/jobs/${opened.body.id}`)).set(bearer('admin-1')).send({ expected_return_date: '2999-02-02' });
    expect(res.status).toBe(200);
    expect(res.body.expected_return_date).toBe('2999-02-02');
    expect((await request(app).patch(api(`/maintenance/jobs/${opened.body.id}`)).set(bearer('admin-1')).send({})).status).toBe(400);
  });
});

describe('returning a vehicle to service', () => {
  let jobId: string;
  beforeEach(async () => {
    seed();
    supabaseMock.rows('vehicle_service_plans').push(
      { id: 'p1', vehicle_id: VEHICLE, item: 'Engine oil', interval_km: 10000, last_done_km: 30000, last_done_at: '2026-01-01' },
      { id: 'p2', vehicle_id: VEHICLE, item: 'Brake pads', interval_km: 40000, last_done_km: 5000, last_done_at: '2026-01-01' },
      { id: 'p3', vehicle_id: VEHICLE, item: 'Coolant', interval_km: 40000, last_done_km: 5000, last_done_at: '2026-01-01' },
    );
    const opened = await request(app).post(api(`/vehicles/${VEHICLE}/maintenance`)).set(bearer('admin-1'))
      .send({ reason_type: 'scheduled_service', expected_return_date: FUTURE, workshop: 'Sharma Motors' });
    jobId = opened.body.id;
  });
  const close = (body: object = {}, id?: string) => request(app).post(api(`/maintenance/jobs/${id ?? jobId}/close`)).set(bearer('admin-1'))
    .send({ final_odometer_km: 45120, ...body });

  it('writes the service record, moves the serviced plans, closes the job and frees the vehicle', async () => {
    const res = await close({
      done_at: '2026-09-28', labour_cost: 1500, invoice_number: 'INV-77', note: 'All good',
      items: [{ description: 'Engine oil 15W40 (L)', quantity: 8, unit_cost: 420 }, { description: 'Brake pads', quantity: 1, unit_cost: 3200 }],
      serviced_items: ['Engine oil', 'Brake pads'],
      attachments: [{ path: `vehicle-service/${VEHICLE}/inv.pdf`, kind: 'invoice', file_name: 'inv.pdf' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.vehicle_status).toBe('available');
    expect(res.body.job).toMatchObject({ status: 'closed', final_odometer_km: 45120, total_cost: 8060, service_log_id: res.body.service_record.id });
    expect(res.body.service_record).toMatchObject({
      item: 'Scheduled service', cost: 8060, labour_cost: 1500, workshop: 'Sharma Motors', invoice_number: 'INV-77', job_id: jobId, odometer_km: 45120,
    });
    expect(res.body.service_record.items).toHaveLength(2);

    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ status: 'available', odometer_km: 45120 });
    const plans = supabaseMock.rows('vehicle_service_plans');
    expect(plans.find(p => p.item === 'Engine oil')).toMatchObject({ last_done_km: 45120, last_done_at: '2026-09-28' });
    expect(plans.find(p => p.item === 'Brake pads')).toMatchObject({ last_done_km: 45120, last_done_at: '2026-09-28' });
    expect(plans.find(p => p.item === 'Coolant')).toMatchObject({ last_done_km: 5000, last_done_at: '2026-01-01' });
    expect(supabaseMock.rows('expenses')[0]).toMatchObject({ amount: 8060, category: 'maintenance', vehicle_id: VEHICLE });
    expect(supabaseMock.rows('vehicle_service_attachments')[0]).toMatchObject({ service_log_id: res.body.service_record.id, job_id: jobId, kind: 'invoice' });
  });

  it('closes with just the odometer when nothing else is known', async () => {
    const res = await close();
    expect(res.status).toBe(200);
    expect(res.body.job.total_cost).toBeNull();
    expect(supabaseMock.rows('vehicle_service_log')).toHaveLength(1);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('available');
  });

  it('can return the vehicle as idle', async () => {
    const res = await close({ return_status: 'idle' });
    expect(res.body.vehicle_status).toBe('idle');
  });

  it('will not take the odometer backwards without a reason', async () => {
    const res = await close({ final_odometer_km: 40000 });
    expect(res.status).toBe(400);
    expect(res.body.requires_reason).toBe(true);
    // Nothing was written and the job is still open
    expect(supabaseMock.rows('vehicle_maintenance_jobs')[0].status).toBe('open');
    expect(supabaseMock.rows('vehicle_service_log')).toHaveLength(0);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ status: 'maintenance', odometer_km: 45000 });

    const ok = await close({ final_odometer_km: 40000, correction_reason: 'Cluster replaced during the repair' });
    expect(ok.status).toBe(200);
    expect(supabaseMock.rows('vehicle_odometer_events').find(e => e.kind === 'correction')).toMatchObject({ before_km: 45000, after_km: 40000 });
  });

  it('needs a final odometer and rejects files that are not this vehicle\'s', async () => {
    const none = await request(app).post(api(`/maintenance/jobs/${jobId}/close`)).set(bearer('admin-1')).send({});
    expect(none.status).toBe(400);
    const foreign = await close({ attachments: [{ path: 'vehicle-service/other/x.pdf', kind: 'invoice' }] });
    expect(foreign.status).toBe(400);
    // The failed return reopens the job so it can be tried again
    expect(supabaseMock.rows('vehicle_maintenance_jobs')[0].status).toBe('open');
    expect(supabaseMock.rows('vehicle_service_log')).toHaveLength(0);
    expect((await close()).status).toBe(200);
  });

  it('cannot be closed twice', async () => {
    expect((await close()).status).toBe(200);
    const again = await close();
    expect(again.status).toBe(409);
    expect(supabaseMock.rows('vehicle_service_log')).toHaveLength(1);
    expect((await close({}, 'no-such-job')).status).toBe(404);
  });

  it('closes the job when the plain status change takes the vehicle out of maintenance', async () => {
    const res = await request(app).post(`/api/v1/vehicles/${VEHICLE}/status`).set(bearer('admin-1')).send({ status: 'available' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vehicle_maintenance_jobs')[0]).toMatchObject({ status: 'closed', close_note: 'Returned to service without a service record' });
    expect(supabaseMock.rows('vehicle_service_log')).toHaveLength(0);
  });

  it('leaves a vehicle alone that is no longer in maintenance', async () => {
    supabaseMock.rows('vehicles')[0].status = 'on_route';
    const res = await close();
    expect(res.status).toBe(200);
    expect(res.body.vehicle_status).toBe('on_route');
    expect(supabaseMock.rows('vehicles')[0].status).toBe('on_route');
  });
});

describe('default service plans', () => {
  beforeEach(() => {
    seed({
      service_plan_templates: [
        { id: 't1', item: 'Engine oil', interval_km: 10000, interval_days: 180, sort_order: 10, is_active: true },
        { id: 't2', item: 'Battery', interval_km: null, interval_days: 1095, sort_order: 60, is_active: true },
        { id: 't3', item: 'Retired item', interval_km: 1000, interval_days: null, sort_order: 5, is_active: false },
      ],
    });
  });

  it('lists the active defaults in order', async () => {
    const res = await request(app).get(api('/service-plan-templates')).set(bearer('admin-1'));
    expect(res.body.map((t: any) => t.item)).toEqual(['Engine oil', 'Battery']);
  });

  it('adds the defaults a vehicle lacks, starting from its last logged service or today', async () => {
    supabaseMock.rows('vehicle_service_log').push({ id: 'l1', vehicle_id: VEHICLE, item: 'Engine oil', done_at: '2026-08-01', odometer_km: 42000 });
    const res = await request(app).post(api(`/vehicles/${VEHICLE}/service-plans/defaults`)).set(bearer('admin-1'));
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    const plans = supabaseMock.rows('vehicle_service_plans');
    expect(plans.find(p => p.item === 'Engine oil')).toMatchObject({ interval_km: 10000, interval_days: 180, last_done_at: '2026-08-01', last_done_km: 42000 });
    expect(plans.find(p => p.item === 'Battery')).toMatchObject({ interval_km: null, interval_days: 1095, last_done_km: 45000 });
    expect(plans.find(p => p.item === 'Battery')!.last_done_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const again = await request(app).post(api(`/vehicles/${VEHICLE}/service-plans/defaults`)).set(bearer('admin-1'));
    expect(again.status).toBe(409);
    expect(supabaseMock.rows('vehicle_service_plans')).toHaveLength(2);
  });

  it('keeps a plan the vehicle already adjusted', async () => {
    supabaseMock.rows('vehicle_service_plans').push({ id: 'mine', vehicle_id: VEHICLE, item: 'engine oil', interval_km: 7500, interval_days: null, last_done_km: 40000, last_done_at: '2026-06-01' });
    const res = await request(app).post(api(`/vehicles/${VEHICLE}/service-plans/defaults`)).set(bearer('admin-1'));
    expect(res.status).toBe(201);
    expect(res.body.map((p: any) => p.item)).toEqual(['Battery']);
    expect(supabaseMock.rows('vehicle_service_plans').find(p => p.id === 'mine')!.interval_km).toBe(7500);
  });
});
