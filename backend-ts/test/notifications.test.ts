import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();

const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

/** notifyStaff fans out with un-awaited sendNotification calls in some callers
 * (the SOS route deliberately fires-and-forgets so a notification failure never
 * fails the emergency report); poll briefly instead of assuming it landed by
 * the time the HTTP response comes back. */
async function waitForNotifications(min = 1, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (supabaseMock.writes('notifications', 'POST').length < min) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise(r => setTimeout(r, 10));
  }
}

const STAFF_USERS = [
  { id: 'active-admin', role: 'admin', is_active: true, full_name: 'Active Admin' },
  { id: 'active-superadmin', role: 'superadmin', is_active: true, full_name: 'Active Superadmin' },
  { id: 'inactive-admin', role: 'admin', is_active: false, full_name: 'Inactive Admin' },
  { id: 'plain-driver', role: 'driver', is_active: true, full_name: 'Plain Driver' },
];

function notifiedUserIds(): string[] {
  return supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id);
}

describe('staff notifications (D2)', () => {
  describe('SOS', () => {
    const VEHICLE = '33333333-3333-3333-3333-333333333333';

    beforeEach(() => {
      supabaseMock.reset({
        users: STAFF_USERS,
        vehicles: [{ id: VEHICLE, driver_id: 'active-admin', plate_number: 'MH12AB1234', driver_name: 'Test Driver', status: 'idle' }],
        sos_alerts: [],
        notifications: [],
      });
    });

    it('notifies every active admin and superadmin, and no one else', async () => {
      const res = await request(app)
        .post(`/api/v1/vehicles/${VEHICLE}/sos`)
        .set(bearer('active-admin'))
        .send({ alert_type: 'breakdown', description: 'Engine failure', latitude: 1, longitude: 1 });
      expect(res.status).toBe(201);

      await waitForNotifications(2);
      const ids = notifiedUserIds();
      expect(ids.sort()).toEqual(['active-admin', 'active-superadmin'].sort());
      expect(ids).not.toContain('inactive-admin');
      expect(ids).not.toContain('plain-driver');

      const [write] = supabaseMock.writes('notifications', 'POST');
      expect(write.body.type).toBe('sos');
      expect(write.body.data).toMatchObject({ vehicle_id: VEHICLE });
    });
  });

  describe('KYC submitted', () => {
    const VENDOR = 'vendor-1';
    const APPROVED = {
      id: VENDOR,
      company_name: 'Acme Logistics',
      gst_number: '27ABCDE1234F1Z0',
      city: 'Pune',
      address: '1 MG Road, Pune',
      latitude: 18.5,
      longitude: 73.8,
      kyc_status: 'approved',
    };

    beforeEach(() => {
      supabaseMock.reset({
        users: [...STAFF_USERS, { id: VENDOR, role: 'vendor', is_active: true }],
        vendor_profiles: [APPROVED],
        tpl_partners: [],
        notifications: [],
      });
    });

    it('notifies superadmins, who own the KYC page, when an approved profile is resubmitted for review', async () => {
      const res = await request(app)
        .post('/api/v1/vendor/profile')
        .set(bearer(VENDOR))
        .send({
          companyName: 'Acme Freight Pvt Ltd',
          gstNumber: APPROVED.gst_number,
          city: APPROVED.city,
          address: APPROVED.address,
          lat: APPROVED.latitude,
          lng: APPROVED.longitude,
        });
      expect(res.status).toBe(200);

      const ids = notifiedUserIds();
      expect(ids).toEqual(['active-superadmin']);
      const [write] = supabaseMock.writes('notifications', 'POST');
      expect(write.body.type).toBe('kyc_submitted');
    });

    it('does not notify staff when nothing sent the profile to review', async () => {
      const res = await request(app)
        .post('/api/v1/vendor/profile')
        .set(bearer(VENDOR))
        .send({
          companyName: APPROVED.company_name,
          gstNumber: APPROVED.gst_number,
          city: 'Mumbai',
          address: APPROVED.address,
          lat: 19.07,
          lng: 72.87,
        });
      expect(res.status).toBe(200);
      expect(supabaseMock.writes('notifications', 'POST')).toEqual([]);
    });
  });

  describe('3PL application submitted', () => {
    beforeEach(() => {
      supabaseMock.reset({
        users: STAFF_USERS,
        tpl_partners: [],
        tpl_corridors: [],
        tpl_documents: [],
        notifications: [],
      });
    });

    it('notifies superadmin only, since admin cannot open the 3PL pages, when a new application is onboarded', async () => {
      const res = await request(app).post('/api/v1/tpl/onboard').send({
        companyName: 'Northline Logistics',
        email: 'ops@northline.example',
        pan: 'ABCDE1234F',
        gst: '27ABCDE1234F1Z0',
      });
      expect(res.status).toBe(200);

      const ids = notifiedUserIds();
      expect(ids).toEqual(['active-superadmin']);
      const [write] = supabaseMock.writes('notifications', 'POST');
      expect(write.body.type).toBe('tpl_application');
    });
  });

  describe('vendor shipment request and capacity bid still notify staff (widened from superadmin-only)', () => {
    it('notifies staff on a new vendor shipment request', async () => {
      supabaseMock.reset({
        users: [...STAFF_USERS, { id: 'vendor-1', role: 'vendor', is_active: true }],
        vendor_profiles: [{ id: 'vendor-1', kyc_status: 'approved', company_name: 'Acme', city: 'Pune' }],
        notifications: [],
      });
      const res = await request(app)
        .post('/api/v1/vendor/shipment-request')
        .set(bearer('vendor-1'))
        .send({
          pickup: { address: 'Pune Yard', lat: 18.5, lng: 73.8 },
          drop: { address: 'Mumbai Dock', lat: 19.0, lng: 72.8 },
          capacity: 500,
        });
      expect(res.status).toBe(200);
      const ids = notifiedUserIds();
      expect(ids.sort()).toEqual(['active-admin', 'active-superadmin'].sort());
    });

    it('notifies staff on a new capacity bid', async () => {
      const MINUTE = 60_000;
      supabaseMock.reset({
        users: [...STAFF_USERS, { id: 'vendor-1', role: 'vendor', is_active: true }],
        vendor_profiles: [{ id: 'vendor-1', kyc_status: 'approved', company_name: 'Acme', latitude: 18.52, longitude: 73.85, city: 'Pune' }],
        capacity_windows: [{
          id: 'w1',
          vehicle_id: 'vehicle-1',
          opens_at: new Date(Date.now() - MINUTE).toISOString(),
          closes_at: new Date(Date.now() + 5 * MINUTE).toISOString(),
          floor_price: 1000,
          status: 'open',
          winning_bid_id: null,
          fallback_shipment_id: null,
          vehicles: { plate_number: 'MH12AB1234', latitude: null, longitude: null, current_location_name: 'Pune', available_capacity_kg: 800 },
        }],
        capacity_bids: [],
        delivery_points: [],
        notifications: [],
      });

      const res = await request(app)
        .post('/api/v1/capacity/bids')
        .set(bearer('vendor-1'))
        .send({
          window_id: 'w1',
          bid_amount: 1500,
          weight_kg: 500,
          dropoff_name: 'Hinjewadi',
          dropoff_address: 'Hinjewadi, Pune',
          dropoff_lat: 18.59,
          dropoff_lng: 73.73,
          eway_bill_ref: '123456789012',
          load_configuration: 'Palletized',
        });
      expect(res.status).toBe(200);

      await waitForNotifications(2);
      const ids = notifiedUserIds();
      expect(ids.sort()).toEqual(['active-admin', 'active-superadmin'].sort());
    });
  });
});
