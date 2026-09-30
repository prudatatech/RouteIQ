/**
 * A master's status, holder and pieces are rolled up from its lots (docs/cargo-plan.md, Lots),
 * and each lot is invoiced for its freight share when it is delivered, never the master again.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { rollupHolder, rollupMaster, rollupStatus, type RollupLot } from '../src/services/cargo/lots.service';
import { InvoiceService } from '../src/services/invoice.service';
import { ID, auth, cargoWorld, one, shipmentRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const S1 = shipmentRow(ID.s1).tracking_id as string;

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld({
    shipments: [
      shipmentRow(ID.s1, { total_items: 100, pieces_total: 100, total_weight_kg: 1000, freight_charge: 5000 }),
      shipmentRow(ID.s2, { status: 'assigned', current_holder: 'consignor', total_items: 5, pieces_total: 5, total_weight_kg: 500, seal_number: null }),
    ],
  }));
});

const lot = (status: string, over: Partial<RollupLot> & { delivered?: number; short?: number; returned?: number; total?: number } = {}): RollupLot => ({
  status,
  holder: over.holder ?? (status === 'delivered' ? 'consignee' : status === 'at_hub' ? 'hub' : ['created', 'assigned', 'returned'].includes(status) ? 'consignor' : 'vehicle'),
  pieces: { total: over.total ?? 10, delivered: over.delivered ?? (status === 'delivered' ? over.total ?? 10 : 0), damaged: 0, short: over.short ?? 0, returned: over.returned ?? (status === 'returned' ? 10 : 0) },
  openCase: over.openCase ?? false,
});
const none = { delivered: 0, short: 0, returned: 0 };

describe('rollup rules', () => {
  it('is delivered when every lot is, and partially delivered when some were returned, lost or short', () => {
    expect(rollupStatus([lot('delivered'), lot('delivered')], none)).toBe('delivered');
    expect(rollupStatus([lot('delivered'), lot('returned')], none)).toBe('partially_delivered');
    expect(rollupStatus([lot('delivered'), lot('lost', { short: 10 })], none)).toBe('partially_delivered');
    expect(rollupStatus([lot('delivered', { delivered: 8, short: 2 })], none)).toBe('partially_delivered');
    expect(rollupStatus([lot('returned'), lot('returned')], none)).toBe('returned');
    // A cancelled (merged or emptied) lot is left out
    expect(rollupStatus([lot('delivered'), lot('cancelled', { total: 0 })], none)).toBe('delivered');
    // What the master delivered itself before the split counts
    expect(rollupStatus([lot('returned')], { delivered: 7, short: 0, returned: 0 })).toBe('partially_delivered');
  });

  it('is on hold or exception when a lot is held or has an open case, then in transit when one moves', () => {
    expect(rollupStatus([lot('in_transit'), lot('on_hold')], none)).toBe('on_hold');
    expect(rollupStatus([lot('in_transit'), lot('in_transit', { openCase: true })], none)).toBe('exception');
    expect(rollupStatus([lot('in_transit'), lot('at_hub')], none)).toBe('in_transit');
    expect(rollupStatus([lot('at_hub'), lot('created')], none)).toBe('at_hub');
    expect(rollupStatus([lot('delivered'), lot('assigned')], none)).toBe('partially_delivered');
    expect(rollupStatus([lot('returning'), lot('returning')], none)).toBe('returning');
    expect(rollupStatus([lot('assigned'), lot('created')], none)).toBe('assigned');
  });

  it('rolls the holder up: the common one, else vehicle, else hub', () => {
    expect(rollupHolder([lot('in_transit'), lot('in_transit')], none)).toBe('vehicle');
    expect(rollupHolder([lot('at_hub'), lot('at_hub')], none)).toBe('hub');
    expect(rollupHolder([lot('at_hub'), lot('in_transit')], none)).toBe('vehicle');
    expect(rollupHolder([lot('at_hub'), lot('created')], none)).toBe('hub');
    expect(rollupHolder([lot('delivered'), lot('delivered')], none)).toBe('consignee');
  });
});

describe('rollup of a split shipment', () => {
  const split = (body: object) => request(app).post(api('/cargo/lots/split')).set(auth.admin()).send({ ref: S1, ...body });
  const deliver = (ref: string) => request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref, kind: 'delivery', receiver_name: 'Store manager', reason: 'Signed paper POD' });

  it('delivers the master once every lot is delivered, moves the booking, and bills each lot once', async () => {
    expect((await split({ lots: [{ pieces: 50 }, { pieces: 25 }] })).status).toBe(201);
    expect((await deliver(`${S1}-A`)).status).toBe(201);
    // One lot delivered while the others are on the move: still in transit
    expect(one('shipments', ID.s1).status).toBe('in_transit');
    expect(one('customer_bookings', ID.booking1).status).toBe('in_transit');
    expect((await deliver(`${S1}-B`)).status).toBe(201);
    expect((await deliver(`${S1}-C`)).status).toBe(201);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'delivered', current_holder: 'consignee', current_vehicle_id: null });
    expect(one('customer_bookings', ID.booking1).status).toBe('delivered');

    const where = await request(app).get(api(`/cargo/where/${S1}`)).set(auth.admin());
    expect(where.body).toMatchObject({ status: 'delivered', current_holder: 'consignee', pieces: { total: 100, delivered: 100, on_board: 0 } });
    expect(where.body.totals.progress_text).toBe('100 of 100 delivered');

    // One invoice per lot for its share of the ₹5,000; none for the master, which kept nothing
    const invoices = supabaseMock.rows('invoices');
    expect(invoices.map(i => i.amount).sort((a, b) => a - b)).toEqual([1250, 1250, 2500]);
    expect(invoices.every(i => i.price_source === 'lot_freight_share')).toBe(true);
    expect(invoices.some(i => i.shipment_id === ID.s1)).toBe(false);
    // Asking again never bills twice
    expect(await InvoiceService.createForShipment(ID.s1)).toEqual({ status: 'skipped' });
    const lotA = supabaseMock.rows('shipments').find(s => s.tracking_id === `${S1}-A`)!;
    expect((await InvoiceService.createForShipment(lotA.id)).status).toBe('exists');
    await rollupMaster('shipment', ID.s1, null);
    expect(supabaseMock.rows('invoices')).toHaveLength(3);
  });

  it('is partially delivered when one lot is delivered and the other lost', async () => {
    await split({ lots: [{ pieces: 60 }] });
    await deliver(`${S1}-A`);
    const lost = await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: `${S1}-B`, kind: 'lost', notes: 'Not found after the night halt' });
    expect(lost.status).toBe(201);
    expect(one('shipments', ID.s1).status).toBe('partially_delivered');
    const where = await request(app).get(api(`/cargo/where/${S1}`)).set(auth.admin());
    expect(where.body.pieces).toMatchObject({ total: 100, delivered: 60, short: 40, on_board: 0 });
    expect(where.body.totals.progress_text).toBe('60 of 100 delivered · 40 short or lost');
    // Only the delivered lot is billed
    expect(supabaseMock.rows('invoices').map(i => i.amount)).toEqual([3000]);
  });

  it('is on hold while a lot is held, and moves again when it is released', async () => {
    await split({ lots: [{ pieces: 60 }] });
    const held = await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: `${S1}-B`, kind: 'hold', reason: 'Paperwork check' });
    expect(held.status).toBe(201);
    expect(one('shipments', ID.s1).status).toBe('on_hold');
    const where = await request(app).get(api(`/cargo/where/${S1}`)).set(auth.admin());
    expect(where.body).toMatchObject({ status: 'on_hold', on_hold_reason: 'Paperwork check' });
    await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: `${S1}-B`, kind: 'release_hold' });
    expect(one('shipments', ID.s1).status).toBe('in_transit');
    // Each change of the master is in its hash chain
    const rollups = supabaseMock.rows('shipment_logs').filter(l => l.shipment_id === ID.s1 && l.metadata_json?.rollup);
    expect(rollups.map(l => l.status)).toEqual(['on_hold', 'in_transit']);
  });
});
