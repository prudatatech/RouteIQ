/**
 * Fixes found by an end-to-end run on a local stack:
 *  - a multi-drop booking shows the customer the open problems of its lots
 *  - a partial delivery closes the booking once it is settled, and is invoiced (never twice)
 *  - the first driver is paid for their leg when a customer shipment is transferred, once
 * (Assigning without dispatch is covered in shipment-workflow.test.ts and vendor-requests.test.ts.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { InvoiceService } from '../src/services/invoice.service';
import { onShipmentStatus } from '../src/services/customer-bookings.service';
import { openExceptionsFor } from '../src/services/cargo/custody.service';
import { resolveRef } from '../src/services/cargo/consignment';
import { getUnpricedDeliveries } from '../src/services/finance.service';
import { setPriceAndInvoice } from '../src/services/invoice-pricing.service';
import { recordShipmentLegAfterTransfer, recordTripPay } from '../src/services/driver-pay.service';
import { ID, NOW, auth, cargoWorld, one, shipmentRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const MASTER = '51000000-0000-4000-8000-0000000000a0';
const LOT_A = '51000000-0000-4000-8000-0000000000a1';
const LOT_B = '51000000-0000-4000-8000-0000000000a2';
const CASE = 'ca000000-0000-4000-8000-000000000001';
const BOOKING = ID.booking1;

function world(over: Record<string, any[]> = {}) {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld({ driver_pay_rates: [], driver_pay_entries: [], gps_points: [], ...over }));
}

const lotRow = (id: string, label: string, seq: number, over: Record<string, unknown> = {}) => shipmentRow(id, {
  tracking_id: `RTX-MULTI-${label}`, parent_shipment_id: MASTER, lot_label: label, lot_seq: seq, freight_share: 2500, freight_charge: null,
  total_items: 5, pieces_total: 5, ...over,
});
const masterRow = (over: Record<string, unknown> = {}) => shipmentRow(MASTER, {
  tracking_id: 'RTX-MULTI', is_master: true, freight_share: 0, freight_charge: 5000, pieces_total: 10, current_vehicle_id: null, ...over,
});
const multiDrop = (lotA: Record<string, unknown> = {}, lotB: Record<string, unknown> = {}, master: Record<string, unknown> = {}) => world({
  shipments: [masterRow(master), lotRow(LOT_A, 'A', 1, lotA), lotRow(LOT_B, 'B', 2, lotB)],
  customer_bookings: [{ id: BOOKING, customer_id: ID.customer, shipment_id: MASTER, tracking_id: 'RTX-MULTI', status: 'in_transit', pickup_name: 'Bhiwandi', drop_name: 'Patna', created_at: NOW, updated_at: NOW }],
});

describe('a multi-drop booking shows the problems of its lots', () => {
  beforeEach(() => {
    multiDrop();
    supabaseMock.rows('cargo_exceptions').push({ id: CASE, code: 'EXC-AAAAAA', type: 'damage', severity: 'medium', status: 'open', description: 'Crushed', created_at: NOW });
    supabaseMock.rows('cargo_exception_items').push({ id: 'ci-1', exception_id: CASE, shipment_id: LOT_B, pieces_affected: 1 });
  });

  it('openExceptionsFor a master includes the open cases of its lots, tagged with the lot code', async () => {
    const master = await resolveRef({ shipment_id: MASTER });
    const open = await openExceptionsFor(master);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: CASE, lot_code: 'RTX-MULTI-B' });
    // A lot on its own only sees its own case, with no lot tag
    expect(await openExceptionsFor(await resolveRef({ shipment_id: LOT_A }))).toEqual([]);
    expect((await openExceptionsFor(await resolveRef({ shipment_id: LOT_B })))[0].lot_code).toBeUndefined();
  });

  it('lists a case once even when it touches the master and two lots', async () => {
    supabaseMock.rows('cargo_exception_items').push({ id: 'ci-2', exception_id: CASE, shipment_id: LOT_A, pieces_affected: 1 });
    supabaseMock.rows('cargo_exception_items').push({ id: 'ci-3', exception_id: CASE, shipment_id: MASTER, pieces_affected: 2 });
    const open = await openExceptionsFor(await resolveRef({ shipment_id: MASTER }));
    expect(open.map(e => e.id)).toEqual([CASE]);
  });

  it('gives the customer a notice on the booking, with its lot code', async () => {
    const res = await request(app).get(api(`/customer/bookings/${BOOKING}/cargo`)).set(auth.customer());
    expect(res.status).toBe(200);
    expect(res.body.exceptions).toHaveLength(1);
    expect(res.body.exceptions[0]).toMatchObject({ id: CASE, type: 'damage', lot_code: 'RTX-MULTI-B' });
  });
});

describe('a partial delivery and the booking', () => {
  const bookingStatus = () => one('customer_bookings', BOOKING).status;

  beforeEach(() => world({
    shipments: [shipmentRow(ID.s1, { status: 'partially_delivered', pieces_delivered: 7, pieces_short: 1, pieces_returned: 0 })],
  }));

  it('closes the booking as delivered once nothing is left on a vehicle', async () => {
    // 10 pieces: 7 delivered, 1 short, 2 refused and still on the vehicle
    await onShipmentStatus(ID.s1, 'partially_delivered');
    expect(bookingStatus()).toBe('in_transit');

    // The refused pieces are back with the sender: settled
    Object.assign(one('shipments', ID.s1), { pieces_short: 1, pieces_returned: 2, current_holder: 'consignor', current_vehicle_id: null });
    await onShipmentStatus(ID.s1, 'partially_delivered');
    expect(bookingStatus()).toBe('delivered');
    expect(supabaseMock.rows('notifications').some(n => n.title === 'Your shipment was delivered')).toBe(true);
  });

  it('closes it at once when the missing pieces were all short (nothing is left to hold)', async () => {
    Object.assign(one('shipments', ID.s1), { pieces_short: 3, current_holder: 'consignee', current_vehicle_id: null });
    await onShipmentStatus(ID.s1, 'partially_delivered');
    expect(bookingStatus()).toBe('delivered');
  });

  it('keeps a master booking in transit while a lot is still on a vehicle, and closes it when all are settled', async () => {
    multiDrop(
      { status: 'delivered', current_holder: 'consignee', current_vehicle_id: null, pieces_delivered: 5 },
      { status: 'in_transit' },
      { status: 'partially_delivered' },
    );
    await onShipmentStatus(MASTER, 'partially_delivered');
    expect(one('customer_bookings', BOOKING).status).toBe('in_transit');

    Object.assign(one('shipments', LOT_B), { status: 'returned', current_holder: 'consignor', current_vehicle_id: null, pieces_returned: 5 });
    await onShipmentStatus(MASTER, 'partially_delivered');
    expect(one('customer_bookings', BOOKING).status).toBe('delivered');
  });
});

describe('a partial delivery is invoiced', () => {
  const invoices = () => supabaseMock.rows('invoices');
  const range = () => ({ start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000) }) as any;

  it('invoices a settled partial delivery for its price, with the short pieces in the notes, and never twice', async () => {
    world({ shipments: [shipmentRow(ID.s1, { status: 'partially_delivered', freight_charge: 5000, pieces_delivered: 7, pieces_short: 1, pieces_returned: 2, current_holder: 'consignor', current_vehicle_id: null })] });
    const first = await InvoiceService.createForShipment(ID.s1);
    expect(first.status).toBe('created');
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0]).toMatchObject({ shipment_id: ID.s1, amount: 5000, price_source: 'freight_charge' });
    expect(invoices()[0].notes).toMatch(/7 of 10 pieces delivered, 1 short, 2 refused or returned/);
    expect((await InvoiceService.createForShipment(ID.s1)).status).toBe('exists');
    await InvoiceService.onShipmentDelivered(ID.s1);
    expect(invoices()).toHaveLength(1);
  });

  it('waits while pieces are still on the vehicle', async () => {
    world({ shipments: [shipmentRow(ID.s1, { status: 'partially_delivered', pieces_delivered: 7, pieces_short: 1 })] });
    expect((await InvoiceService.createForShipment(ID.s1)).status).toBe('skipped');
    expect(invoices()).toHaveLength(0);
  });

  it('invoices a lot for its freight share when it settles as partially delivered', async () => {
    multiDrop({ status: 'partially_delivered', pieces_delivered: 4, pieces_short: 1, current_holder: 'consignee', current_vehicle_id: null }, {}, { status: 'in_transit' });
    await InvoiceService.onShipmentDelivered(LOT_A);
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0]).toMatchObject({ shipment_id: LOT_A, amount: 2500, price_source: 'lot_freight_share' });
    expect(invoices()[0].notes).toMatch(/4 of 5 pieces delivered, 1 short/);
  });

  it('a delivered shipment has no partial note', async () => {
    world({ shipments: [shipmentRow(ID.s1, { status: 'delivered', freight_charge: 5000, pieces_delivered: 10, current_holder: 'consignee', current_vehicle_id: null })] });
    await InvoiceService.createForShipment(ID.s1);
    expect(invoices()[0].notes).toBeUndefined();
  });

  it('lists an unpriced settled partial delivery in Finance and prices it', async () => {
    world({ shipments: [shipmentRow(ID.s1, { status: 'partially_delivered', freight_charge: null, pieces_delivered: 8, pieces_short: 2, current_holder: 'consignee', current_vehicle_id: null })] });
    expect((await getUnpricedDeliveries(range())).map(d => d.id)).toContain(ID.s1);
    const done = await setPriceAndInvoice({ kind: 'shipment', id: ID.s1 }, 3000);
    expect(done.amount).toBe(3000);
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].notes).toMatch(/8 of 10 pieces delivered, 2 short/);
    await expect(setPriceAndInvoice({ kind: 'shipment', id: ID.s1 }, 3000)).rejects.toThrow(/already has invoice/);
  });

  it('does not list a partial delivery that still holds pieces', async () => {
    world({ shipments: [shipmentRow(ID.s1, { status: 'partially_delivered', freight_charge: null, pieces_delivered: 7, pieces_short: 1 })] });
    expect((await getUnpricedDeliveries(range())).map(d => d.id)).not.toContain(ID.s1);
  });

  it('invoices when a partial delivery is recorded through the driver API and nothing is left to hold', async () => {
    world();
    Object.assign(one('shipments', ID.s1), { freight_charge: 5000 });
    const res = await request(app).post(api('/cargo/custody')).set(auth.driver()).send({
      ref: { shipment_id: ID.s1 }, kind: 'partial_delivery', pieces: 8, pieces_short: 2, receiver_name: 'Store manager', photo_paths: [`cargo/${ID.s1}/photo_a.jpg`],
    });
    expect(res.status).toBe(201);
    expect(one('shipments', ID.s1).status).toBe('partially_delivered');
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0]).toMatchObject({ shipment_id: ID.s1, amount: 5000 });
    expect(one('customer_bookings', BOOKING).status).toBe('delivered');
  });
});

describe('the first driver is paid for their leg before a transfer', () => {
  const V = ID.v1;
  const entries = () => supabaseMock.rows('driver_pay_entries');
  const transfer = { id: 'ee100000-0000-4000-8000-000000000001', from_vehicle_id: V, to_vehicle_id: ID.v2, status: 'completed', meet_lat: 18.7, meet_lng: 73.9, completed_at: NOW };
  const rate = { id: 'rate-1', vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10, effective_from: '2026-01-01', active: true };

  beforeEach(() => {
    world({ cargo_manifest: [], cargo_transfers: [transfer], driver_pay_rates: [{ ...rate }] });
    // s1 was handed to the relief truck: it is no longer aboard v1
    Object.assign(one('shipments', ID.s1), { current_vehicle_id: ID.v2 });
    Object.assign(one('shipments', ID.s2), { current_vehicle_id: null });
  });

  it('records the leg: the per-trip amount and the km up to the handover, on the from-route', async () => {
    const out = await recordShipmentLegAfterTransfer([ID.s1], transfer.id, V);
    expect(out?.created).toBe(true);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ driver_id: ID.driver1, vehicle_id: V, route_id: ID.route1, per_trip_amount: 500, km_source: 'estimated' });
    expect(entries()[0].km).toBeGreaterThan(0);
  });

  it('is idempotent, and the route completing later pays nothing more', async () => {
    await recordShipmentLegAfterTransfer([ID.s1], transfer.id, V);
    const again = await recordShipmentLegAfterTransfer([ID.s1], transfer.id, V);
    expect(again?.created).toBe(false);
    expect(entries()).toHaveLength(1);

    Object.assign(one('routes', ID.route1), { status: 'completed', completed_at: NOW });
    const later = await recordTripPay({ route_id: ID.route1 });
    expect(later?.created).toBe(false);
    expect(entries()).toHaveLength(1);
  });

  it('waits while goods of the trip are still aboard the from-vehicle', async () => {
    Object.assign(one('shipments', ID.s2), { current_vehicle_id: V, current_holder: 'vehicle', status: 'in_transit' });
    expect(await recordShipmentLegAfterTransfer([ID.s1], transfer.id, V)).toBeNull();
    expect(entries()).toHaveLength(0);
  });

  it('is recorded by the transfer itself when it completes', async () => {
    world({ cargo_manifest: [], driver_pay_rates: [{ ...rate }] });
    const items = [{ ref: { shipment_id: ID.s1 }, pieces_out: 10, condition: 'good' }];
    const planned = await request(app).post(api('/cargo/transfers')).set(auth.admin())
      .send({ from_vehicle_id: V, to_vehicle_id: ID.v2, items: [{ ref: { shipment_id: ID.s1 }, pieces: 10 }], meet_lat: 18.61, meet_lng: 73.81 });
    expect(planned.status).toBeLessThan(300);
    const id = planned.body.id ?? planned.body.transfer?.id;
    expect((await request(app).post(api(`/cargo/transfers/${id}/handover-out`)).set(auth.driver()).send({ items })).status).toBe(200);
    const done = await request(app).post(api(`/cargo/transfers/${id}/handover-in`)).set(auth.driver(ID.driver2))
      .send({ items: [{ ref: { shipment_id: ID.s1 }, pieces_in: 10, condition: 'good' }] });
    expect(done.status).toBe(200);
    expect(entries().filter(e => e.route_id === ID.route1)).toHaveLength(1);
    expect(entries()[0].driver_id).toBe(ID.driver1);
  });
});
