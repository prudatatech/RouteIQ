/**
 * Workflow handoff notifications (docs/notifications.md): who is told, and the ids in each
 * notification that let their app open the exact item. A trigger that can fire twice tells
 * the person once.
 */
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { InvoiceService } from '../src/services/invoice.service';
import { runPeopleDailyJob } from '../src/services/people-jobs.service';
import { rateDelivery } from '../src/services/driver-performance.service';
import { ID, auth, cargoWorld, manifestRow, notesFor, one } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const of = (type: string, userId?: string) =>
  supabaseMock.rows('notifications').filter(n => n.type === type && (!userId || n.user_id === userId));
const settle = () => new Promise(r => setTimeout(r, 60));

const STAFF = [
  { id: 'admin-1', role: 'admin', is_active: true, full_name: 'Asha Admin' },
  { id: 'super-1', role: 'superadmin', is_active: true, full_name: 'Sue Super' },
  { id: 'mgr-1', role: 'manager', is_active: true, full_name: 'Mona Manager' },
  { id: 'off-admin', role: 'admin', is_active: false, full_name: 'Gone Admin' },
];

describe('a new driver signs up', () => {
  let warn: MockInstance<typeof console.warn>;
  const code = () => warn.mock.calls.map(a => String(a[0])).filter(m => m.includes('OTP is:')).at(-1)?.match(/OTP is: (\d+)/)?.[1] ?? '';
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    supabaseMock.reset({ users: [...STAFF], notifications: [] });
    supabaseMock.authAdmin = true;
  });

  async function signIn(phone: string, ip: string) {
    await request(app).post('/api/v1/auth/driver/send-otp').set('X-Forwarded-For', ip).send({ phone });
    return request(app).post('/api/v1/auth/driver/verify-otp').set('X-Forwarded-For', ip).send({ phone, otp: code() });
  }

  it('tells active staff once, with the driver id, and not again on the next sign-in', async () => {
    const first = await signIn('9876511111', '10.9.0.1');
    // (the mock does not apply the database default is_active = true, so the sign-in itself may answer 403)
    expect(first.status).not.toBe(500);
    // The staff are told in the background, one by one: wait for all of them (a fixed pause was too short on a busy CI runner)
    await vi.waitFor(() => expect(of('driver_signed_up').map(n => n.user_id).sort()).toEqual(['admin-1', 'mgr-1', 'super-1']), { timeout: 3000 });
    const notes = of('driver_signed_up');
    const driverId = supabaseMock.rows('users').find(u => u.role === 'driver')!.id;
    expect(notes[0].data).toEqual({ user_id: driverId });

    expect((await signIn('9876511111', '10.9.0.2')).status).not.toBe(500);
    await settle();
    expect(of('driver_signed_up')).toHaveLength(3);
  });
});

describe('a driver has no vehicle after a day', () => {
  const day = 86_400_000;
  const driver = (id: string, hoursOld: number) => ({ id, role: 'driver', is_active: true, full_name: `Driver ${id}`, created_at: new Date(Date.now() - hoursOld * 3_600_000).toISOString() });
  beforeEach(() => {
    supabaseMock.reset({
      users: [...STAFF, driver('d-new', 2), driver('d-old', 30), driver('d-placeholder', 30), driver('d-real', 30), driver('d-ancient', 24 * 90)],
      vehicles: [
        { id: 'v-temp', driver_id: 'd-placeholder', plate_number: 'TEMP-ABC123', status: 'idle' },
        { id: 'v-real', driver_id: 'd-real', plate_number: 'MH12AB1234', status: 'available' },
      ],
      notifications: [], user_documents: [], user_profiles: [], user_status_history: [], user_activity: [], system_settings: [], capacity_windows: [], capacity_bids: [],
    });
    void day;
  });

  it('asks staff once per driver without a real vehicle, and never repeats the notice', async () => {
    await runPeopleDailyJob();
    const first = of('driver_needs_vehicle');
    expect([...new Set(first.map(n => n.data.user_id))].sort()).toEqual(['d-old', 'd-placeholder']);
    expect(first.filter(n => n.user_id === 'admin-1')).toHaveLength(2);
    expect(first.some(n => n.user_id === 'off-admin')).toBe(false);

    await runPeopleDailyJob();
    expect(of('driver_needs_vehicle')).toHaveLength(first.length);
  });
});

describe('documents', () => {
  const DRV = '00000000-0000-4000-8000-000000000004';
  const ADM = '00000000-0000-4000-8000-000000000002';
  const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
  beforeEach(() => {
    supabaseMock.reset({
      users: [
        { id: ADM, role: 'admin', is_active: true, status: 'active', full_name: 'Adam Admin' },
        { id: DRV, role: 'driver', is_active: true, status: 'active', full_name: 'Ravi Kumar', phone: '+919876500001' },
      ],
      user_profiles: [{ user_id: DRV, consent_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }],
      user_documents: [], user_activity: [], notifications: [], system_settings: [],
    });
    supabaseMock.authAdmin = true;
  });
  const add = (who: object) => request(app).post(`/api/v1/people/${DRV}/documents`).set(who)
    .send({ doc_type: 'pan', doc_number: 'ABCDE1234F', file_path: `people/${DRV}/pan/x.jpg` });

  it('tells staff when the driver uploads one, linked to the person, but not when staff add it', async () => {
    const staffAdded = await add(as(ADM, 'admin'));
    expect(staffAdded.status).toBe(201);
    expect(of('document_uploaded')).toHaveLength(0);

    const res = await add(as(DRV, 'driver'));
    expect(res.status).toBe(201);
    const notes = of('document_uploaded');
    expect(notes.map(n => n.user_id)).toEqual([ADM]);
    expect(notes[0].data).toEqual({ user_id: DRV, doc_id: res.body.id, doc_type: 'pan' });
    expect(notes[0].title).toBe('Document uploaded');
  });

  it('tells the driver when staff verify it, once', async () => {
    const doc = (await add(as(DRV, 'driver'))).body;
    const verify = () => request(app).patch(`/api/v1/people/${DRV}/documents/${doc.id}`).set(as(ADM, 'admin')).send({ status: 'verified' });
    expect((await verify()).status).toBe(200);
    expect(of('document_verified', DRV)).toHaveLength(1);
    expect(of('document_verified', DRV)[0].data).toEqual({ user_id: DRV, doc_id: doc.id, doc_type: 'pan' });
    await verify();
    expect(of('document_verified', DRV)).toHaveLength(1);
  });
});

describe('a return trip window opens', () => {
  const vendor = (id: string, over: Record<string, unknown> = {}) => ({ id, company_name: id, kyc_status: 'approved', city: 'Pune', latitude: 18.55, longitude: 73.85, ...over });
  const openWindow = () => request(app).post(api('/capacity/windows')).set(auth.admin()).send({ vehicle_id: 'v1', floor_price: 1000, duration_minutes: 30 });
  beforeEach(() => {
    supabaseMock.reset({
      users: [...STAFF, { id: 'vendor-near', role: 'vendor', is_active: true }, { id: 'vendor-far', role: 'vendor', is_active: true }, { id: 'vendor-noloc', role: 'vendor', is_active: true }, { id: 'vendor-pending', role: 'vendor', is_active: true }],
      vendor_profiles: [
        vendor('vendor-near'),
        vendor('vendor-far', { city: 'Delhi', latitude: 28.6, longitude: 77.2 }),
        vendor('vendor-noloc', { latitude: null, longitude: null, city: null }),
        vendor('vendor-pending', { kyc_status: 'pending' }),
      ],
      vehicles: [{ id: 'v1', plate_number: 'MH12AB1234', vehicle_type: 'truck', status: 'available', available_capacity_kg: 800, latitude: 18.5, longitude: 73.8, current_location_name: 'Pune', bidding_window_open: false }],
      capacity_windows: [], capacity_bids: [], notifications: [], routes: [], route_stops: [],
    });
  });

  it('tells approved vendors near the truck, once, and never the plate', async () => {
    const res = await openWindow();
    expect(res.status).toBe(201);
    await settle();
    const notes = of('return_trip_opened');
    expect(notes.map(n => n.user_id)).toEqual(['vendor-near']);
    expect(notes[0].data).toMatchObject({ window_id: res.body.id, trigger_type: 'superadmin_dispatch' });
    expect(notes[0].data.closes_at).toBeTruthy();
    expect(JSON.stringify(notes[0])).not.toContain('MH12AB1234');
  });

  it('is not repeated for the same window', async () => {
    const res = await openWindow();
    await settle();
    const { capacityService } = await import('../src/services/capacity.service');
    void capacityService;
    const { notificationService } = await import('../src/services/notification.service');
    const again = await notificationService.sendNotificationOnce('vendor-near', 't', 'b', 'return_trip_opened', { window_id: res.body.id }, 'window_id');
    expect(again).toBeNull();
    expect(of('return_trip_opened')).toHaveLength(1);
  });

  it('asks a vendor with no location to fix their profile when their bid cannot be awarded', async () => {
    const window = (await openWindow()).body;
    supabaseMock.rows('capacity_bids').push({ id: 'bid-1', window_id: window.id, vendor_id: 'vendor-noloc', status: 'pending', bid_amount: 900, weight_kg: 100 });
    const approve = () => request(app).post(api('/capacity/bids/bid-1/approve')).set(auth.admin());
    expect((await approve()).status).toBe(400);
    await settle();
    const notes = of('vendor_profile_incomplete');
    expect(notes.map(n => n.user_id)).toEqual(['vendor-noloc']);
    expect(notes[0].data).toEqual({ bid_id: 'bid-1', window_id: window.id, missing: 'location' });

    expect((await approve()).status).toBe(400);
    await settle();
    expect(of('vendor_profile_incomplete')).toHaveLength(1);
  });
});

describe('invoices', () => {
  beforeEach(() => supabaseMock.reset(cargoWorld({ users: [...cargoWorld().users, { id: 'mgr-1', role: 'manager', is_active: true }] })));

  it('tells the customer when the invoice for their booking is issued, and when it is paid', async () => {
    Object.assign(one('shipments', ID.s1), { status: 'delivered' });
    expect((await InvoiceService.createForShipment(ID.s1)).status).toBe('created');
    const invoice = supabaseMock.rows('invoices')[0];
    const issued = of('invoice_issued');
    expect(issued.map(n => n.user_id)).toEqual([ID.customer]);
    expect(issued[0].data).toMatchObject({ invoice_id: invoice.id, shipment_id: ID.s1, booking_id: ID.booking1, invoice_number: invoice.invoice_number });

    expect((await InvoiceService.createForShipment(ID.s1)).status).toBe('exists');
    expect(of('invoice_issued')).toHaveLength(1);

    const pay = () => request(app).put(api(`/finance/invoices/${invoice.id}/pay`)).set(auth.admin()).send({ method: 'upi', reference: 'UTR1' });
    expect((await pay()).status).toBe(200);
    expect(of('invoice_paid').map(n => n.user_id)).toEqual([ID.customer]);
    expect(of('invoice_paid')[0].data).toMatchObject({ invoice_id: invoice.id, shipment_id: ID.s1, booking_id: ID.booking1 });
    expect((await pay()).status).toBe(409);
    expect(of('invoice_paid')).toHaveLength(1);
  });

  it('tells the vendor for their load, with the request id', async () => {
    Object.assign(one('cargo_manifest', ID.m1), { status: 'delivered' });
    expect((await InvoiceService.createForManifest(ID.m1)).status).toBe('created');
    const invoice = supabaseMock.rows('invoices')[0];
    const issued = of('invoice_issued');
    expect(issued.map(n => n.user_id)).toEqual([ID.vendor]);
    expect(issued[0].data).toMatchObject({ invoice_id: invoice.id, manifest_id: ID.m1, request_id: ID.request1 });
    await request(app).put(api(`/finance/invoices/${invoice.id}/pay`)).set(auth.admin()).send({ method: 'upi', reference: 'UTR1' });
    expect(of('invoice_paid', ID.vendor)[0].data).toMatchObject({ invoice_id: invoice.id, request_id: ID.request1 });
  });

  it('tells the vendor whose load a 3PL partner delivered', async () => {
    expect((await InvoiceService.createForRequest(ID.request1)).status).toBe('created');
    expect(of('invoice_issued', ID.vendor)[0].data).toMatchObject({ request_id: ID.request1 });
  });

  it('tells the vendor who won a bid, with the bid id, and the customer too', async () => {
    Object.assign(one('shipments', ID.s1), { status: 'delivered', bid_id: 'bid-9' });
    supabaseMock.rows('capacity_bids').push({ id: 'bid-9', vendor_id: ID.vendor, bid_amount: 4000, status: 'won' });
    await InvoiceService.createForShipment(ID.s1);
    expect(of('invoice_issued').map(n => n.user_id).sort()).toEqual([ID.customer, ID.vendor].sort());
    expect(of('invoice_issued', ID.vendor)[0].data).toMatchObject({ shipment_id: ID.s1, bid_id: 'bid-9' });
  });
});

describe('cargo claim updates carry the ids the app opens', () => {
  beforeEach(() => {
    supabaseMock.reset(cargoWorld({ cargo_manifest: [manifestRow(ID.m1, { status: 'delivered' })] }));
    Object.assign(one('shipments', ID.s1), { status: 'delivered', current_holder: 'consignee', pieces_delivered: 10 });
    supabaseMock.rows('cargo_custody_events').push({ id: 'ev', shipment_id: ID.s1, kind: 'delivery', pieces: 10, photo_paths: [], recorded_role: 'driver', recorded_at: new Date().toISOString() });
  });
  const file = (body: object, who: object) => request(app).post(api('/cargo/claims')).set(who).send(body);
  const patch = (id: string, body: object) => request(app).patch(api(`/cargo/claims/${id}`)).set(auth.admin()).send(body);

  it('gives the customer the booking id and the shipment code', async () => {
    const { body: claim } = await file({ ref: { shipment_id: ID.s1 }, claim_type: 'damage', claimed_amount: 100 }, auth.customer());
    expect((await patch(claim.id, { status: 'rejected' })).status).toBe(200);
    const [note] = of('cargo_claim_update', ID.customer);
    expect(note.data).toMatchObject({ booking_id: ID.booking1, shipment_id: ID.s1, claim_id: claim.id, consignment_code: one('shipments', ID.s1).tracking_id, status: 'rejected' });
    expect(note.data.request_id).toBeUndefined();
  });

  it('gives the vendor the request id and the load code', async () => {
    const { body: claim } = await file({ ref: { manifest_id: ID.m1 }, claim_type: 'shortage', claimed_amount: 100 }, auth.vendor());
    expect((await patch(claim.id, { status: 'rejected' })).status).toBe(200);
    const [note] = of('cargo_claim_update', ID.vendor);
    expect(note.data).toMatchObject({ request_id: ID.request1, manifest_id: ID.m1, claim_id: claim.id, status: 'rejected' });
    expect(note.data.consignment_code).toMatch(/^CM-/);
  });

  it('gives the vendor the request id on every cargo notification for their load', async () => {
    const res = await request(app).post(api('/cargo/exceptions')).set(auth.admin())
      .send({ type: 'damage', severity: 'low', description: 'Dented', items: [{ ref: { manifest_id: ID.m1 }, pieces_affected: 1 }] });
    expect(res.status).toBe(201);
    const notes = notesFor(ID.vendor).filter(n => n.type.startsWith('cargo_'));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.data).toMatchObject({ request_id: ID.request1, manifest_id: ID.m1 });
  });
});

describe('a delivery is rated', () => {
  beforeEach(() => {
    supabaseMock.reset(cargoWorld());
    Object.assign(one('shipments', ID.s1), { status: 'delivered', current_holder: 'consignee', pieces_delivered: 10, current_vehicle_id: null });
    supabaseMock.rows('cargo_custody_events').push({ id: 'ev', shipment_id: ID.s1, kind: 'delivery', from_vehicle_id: ID.v1, pieces: 10, photo_paths: [], recorded_role: 'driver', recorded_at: new Date().toISOString() });
  });

  it('tells staff and the driver when the customer rates, and links the shipment', async () => {
    const res = await request(app).post(api(`/customer/bookings/${ID.booking1}/confirm-receipt`)).set(auth.customer()).send({ rating: 2, comment: 'Late' });
    expect(res.status).toBe(200);
    const staff = of('delivery_rated', ID.admin);
    expect(staff).toHaveLength(1);
    expect(staff[0].data).toMatchObject({ shipment_id: ID.s1, rating: 2, comment: 'Late' });
    expect(of('delivery_rated', ID.driver1)).toHaveLength(1);
    expect(of('delivery_rated', ID.driver1)[0].data).toMatchObject({ shipment_id: ID.s1, rating: 2 });
    expect((await request(app).post(api(`/customer/bookings/${ID.booking1}/confirm-receipt`)).set(auth.customer()).send({ rating: 5 })).status).toBe(409);
    expect(of('delivery_rated')).toHaveLength(2);
  });

  it('tells only the driver when staff rate it', async () => {
    await rateDelivery(ID.s1, 5, null, ID.admin);
    expect(of('delivery_rated').map(n => n.user_id)).toEqual([ID.driver1]);
  });
});
