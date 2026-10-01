/**
 * The hot endpoints read in batches, not row by row: the number of database calls does not grow
 * with the number of rows. Server-Timing's query count is what the page's latency is made of.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { memoize } from '../src/core/memo';

const app = testApp();
const admin = { Authorization: `Bearer ${createAccessToken({ sub: 'admin-1', role: 'admin' })}` };
const queriesOf = (res: request.Response): number => Number(/desc="(\d+) queries"/.exec(res.headers['server-timing'])![1]);

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('memoize', () => {
  it('shares a load that is running, keeps the value until it expires, and never keeps a failure', async () => {
    let calls = 0;
    let fail = true;
    const m = memoize(60_000, async () => {
      calls++;
      if (fail) throw new Error('down');
      return calls;
    });
    await expect(m()).rejects.toThrow('down');
    fail = false;
    const [a, b] = await Promise.all([m(), m()]);
    expect(a).toBe(b);
    expect(calls).toBe(2);
    await m();
    expect(calls).toBe(2);
    m.clear();
    await m();
    expect(calls).toBe(3);
  });

  it('does not keep a value whose load was overtaken by a clear', async () => {
    let release!: () => void;
    let calls = 0;
    const m = memoize(60_000, async () => {
      calls++;
      if (calls === 1) await new Promise<void>(r => { release = r; });
      return calls;
    });
    const first = m();
    m.clear();
    release();
    await first;
    expect(await m()).toBe(2);
  });
});

describe('cargo transfers list', () => {
  const world = (n: number) => supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    vehicles: [{ id: U(1), plate_number: 'MH12AB0001', status: 'available' }, { id: U(2), plate_number: 'MH12AB0002', status: 'available' }],
    shipments: Array.from({ length: n }, (_, i) => ({ id: U(300 + i), tracking_id: `RTX-T${i}`, status: 'in_transit' })),
    cargo_manifest: [],
    cargo_transfers: Array.from({ length: n }, (_, i) => ({ id: U(400 + i), code: `TR-${i}`, status: 'planned', from_vehicle_id: U(1), to_vehicle_id: U(2), planned_at: new Date(2026, 0, 1 + i).toISOString() })),
    cargo_transfer_items: Array.from({ length: n }, (_, i) => ({ id: U(500 + i), transfer_id: U(400 + i), shipment_id: U(300 + i), pieces_planned: 1 })),
    depots: [], cargo_exceptions: [],
  });

  it('makes the same number of database calls for 2 transfers as for 8, and still names every shipment', async () => {
    world(2);
    await request(app).get('/api/v1/cargo/transfers').set(admin); // the first call also resolves the caller's role
    const few = await request(app).get('/api/v1/cargo/transfers').set(admin);
    world(8);
    await request(app).get('/api/v1/cargo/transfers').set(admin);
    const many = await request(app).get('/api/v1/cargo/transfers').set(admin);
    expect(few.status).toBe(200);
    expect(many.body).toHaveLength(8);
    expect(many.body.every((t: any) => t.items[0].code && t.from_vehicle?.plate_number === 'MH12AB0001')).toBe(true);
    expect(queriesOf(many)).toBe(queriesOf(few));
  });
});
