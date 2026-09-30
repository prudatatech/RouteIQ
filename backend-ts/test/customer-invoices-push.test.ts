/**
 * The customer app's invoice list (GET /customer/invoices) and push token (PUT/DELETE /customer/push-token),
 * and that a push reaches a customer through the token saved on their customers row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ID, NOW, auth, cargoWorld, shipmentRow } from './support/cargo-world';

const sent = vi.hoisted(() => ({ messages: [] as any[] }));
vi.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken = (t: unknown) => typeof t === 'string' && /^ExponentPushToken\[.+\]$/.test(t);
    chunkPushNotifications = (m: any[]) => [m];
    sendPushNotificationsAsync = async (chunk: any[]) => { sent.messages.push(...chunk); return []; };
  }
  return { Expo };
});

import { pushService } from '../src/services/push.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const DAY = 86_400_000;
const LOT = '51000000-0000-4000-8000-0000000000a1';
const TOKEN = 'ExponentPushToken[abc123]';

function invoice(id: string, shipmentId: string | null, over: Record<string, unknown> = {}) {
  return {
    id, invoice_number: `INV-${id}`, shipment_id: shipmentId, manifest_id: null, vendor_id: null, vendor_request_id: null,
    amount: 1000, gst_rate: 18, gst_amount: 180, total: 1180, status: 'issued',
    issued_at: new Date(Date.now() - 20 * DAY).toISOString(), due_date: new Date(Date.now() - 5 * DAY).toISOString(),
    paid_at: null, voided_at: null, payment_method: null, payment_reference: null, void_reason: null, price_source: 'freight',
    ...over,
  };
}

function world(invoices: Record<string, unknown>[]) {
  const base = cargoWorld();
  supabaseMock.reset({
    ...base,
    shipments: [...base.shipments, shipmentRow(LOT, { parent_shipment_id: ID.s1, tracking_id: 'RTX-TEST-B' })],
    customer_bookings: [
      ...base.customer_bookings,
      { id: 'bb000000-0000-4000-8000-000000000002', customer_id: ID.otherCustomer, shipment_id: ID.s2, tracking_id: 'RTX-OTHER', status: 'in_transit', pickup_name: 'A', drop_name: 'B', created_at: NOW, updated_at: NOW },
    ],
    invoices,
    system_settings: [{ key: 'company_profile', value: { value: { legal_name: 'Margix', payment_terms_days: 15 } } }],
  });
}

describe('GET /customer/invoices', () => {
  beforeEach(() => {
    world([
      invoice('i-over', ID.s1),
      invoice('i-lot', LOT, { due_date: new Date(Date.now() + 5 * DAY).toISOString(), issued_at: new Date().toISOString() }),
      invoice('i-paid', ID.s1, { status: 'paid', paid_at: NOW, issued_at: new Date(Date.now() - 40 * DAY).toISOString() }),
      invoice('i-void', ID.s1, { status: 'void' }),
      invoice('i-vendor', ID.s1, { vendor_id: ID.vendor }),
      invoice('i-other', ID.s2),
    ]);
  });

  it('lists their invoices, lots included, with due date, overdue and the booking to link to', async () => {
    const res = await request(app).get(api('/customer/invoices')).set(auth.customer());
    expect(res.status).toBe(200);
    expect(res.body.map((i: any) => i.id)).toEqual(['i-lot', 'i-over', 'i-paid']);
    const byId = (id: string) => res.body.find((i: any) => i.id === id);
    expect(byId('i-over')).toMatchObject({ overdue: true, days_overdue: 5, booking_id: ID.booking1, status: 'issued', total: 1180, pickup_name: 'Bhiwandi' });
    expect(byId('i-lot')).toMatchObject({ overdue: false, booking_id: ID.booking1, tracking_id: 'RTX-TEST-B' });
    expect(byId('i-paid')).toMatchObject({ overdue: false, status: 'paid' });
  });

  it('never shows another customer their invoices, or a void or vendor-billed one', async () => {
    const res = await request(app).get(api('/customer/invoices')).set(auth.customer(ID.otherCustomer));
    expect(res.body.map((i: any) => i.id)).toEqual(['i-other']);
  });

  it('is empty for a customer with no shipment yet, and for customers only', async () => {
    supabaseMock.reset({ ...cargoWorld({ customer_bookings: [] }), invoices: [invoice('x', ID.s1)] });
    expect((await request(app).get(api('/customer/invoices')).set(auth.customer())).body).toEqual([]);
    expect((await request(app).get(api('/customer/invoices')).set(auth.vendor())).status).toBe(403);
    expect((await request(app).get(api('/customer/invoices'))).status).toBe(401);
  });
});

describe('GET /customer/bookings', () => {
  it('says whether each delivery was rated, so the list can ask for a rating', async () => {
    world([]);
    supabaseMock.rows('shipments').find((s) => s.id === ID.s1)!.status = 'delivered';
    let res = await request(app).get(api('/customer/bookings')).set(auth.customer());
    expect(res.body[0]).toMatchObject({ id: ID.booking1, shipment_status: 'delivered', rated: false });
    supabaseMock.rows('shipments').find((s) => s.id === ID.s1)!.driver_rating = 5;
    res = await request(app).get(api('/customer/bookings')).set(auth.customer());
    expect(res.body[0].rated).toBe(true);
  });
});

describe('customer push token', () => {
  beforeEach(() => {
    sent.messages.length = 0;
    world([]);
  });
  const put = (token: unknown, headers = auth.customer()) => request(app).put(api('/customer/push-token')).set(headers).send({ token });

  it('saves the token on the customer and sends their notifications there', async () => {
    expect((await put(TOKEN)).status).toBe(200);
    expect(supabaseMock.rows('customers').find((c) => c.id === ID.customer)!.push_token).toBe(TOKEN);
    expect(await pushService.sendToUser(ID.customer, 'Hello', 'Body', { booking_id: 'b1', type: 'booking' })).toBe(true);
    expect(sent.messages).toEqual([expect.objectContaining({ to: TOKEN, title: 'Hello', channelId: 'default', data: { booking_id: 'b1', type: 'booking' } })]);
  });

  it('rejects anything that is not an Expo push token', async () => {
    expect((await put('not-a-token')).status).toBe(400);
    expect((await put(undefined)).status).toBe(400);
    expect((await put(`ExponentPushToken[${'x'.repeat(200)}]`)).status).toBe(400);
  });

  it('moves the token when the phone is used by another customer', async () => {
    await put(TOKEN);
    await put(TOKEN, auth.customer(ID.otherCustomer));
    const rows = supabaseMock.rows('customers');
    expect(rows.find((c) => c.id === ID.customer)!.push_token).toBeNull();
    expect(rows.find((c) => c.id === ID.otherCustomer)!.push_token).toBe(TOKEN);
  });

  it('clears the token on sign-out, so nothing is sent', async () => {
    await put(TOKEN);
    expect((await request(app).delete(api('/customer/push-token')).set(auth.customer())).status).toBe(200);
    expect(await pushService.sendToUser(ID.customer, 'Hello', 'Body')).toBe(false);
    expect(sent.messages).toHaveLength(0);
  });

  it('is for customers, signed in', async () => {
    expect((await put(TOKEN, auth.driver())).status).toBe(403);
    expect((await request(app).put(api('/customer/push-token')).send({ token: TOKEN })).status).toBe(401);
  });

  it('still sends drivers to the alarms channel from their users row', async () => {
    supabaseMock.rows('users').find((u) => u.id === ID.driver1)!.push_token = 'ExponentPushToken[driver]';
    expect(await pushService.sendToUser(ID.driver1, 'Route', 'Go')).toBe(true);
    expect(sent.messages[0]).toMatchObject({ to: 'ExponentPushToken[driver]', channelId: 'alarms' });
  });
});
