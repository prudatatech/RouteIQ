/**
 * Listing claims: a customer or vendor gets exactly their own, chosen in the database query (not
 * by trimming the newest few hundred of everyone's), in pages with a (created_at, id) cursor; and
 * the customer's booking cargo view carries the claims of the master and of every lot.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Agent, setGlobalDispatcher } from 'undici';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, manifestRow, shipmentRow, type Row } from './support/cargo-world';

// The suite's own dispatcher (test/support/setup.ts) opens a connection per request, and the whole
// suite already sits close to the local ephemeral-port limit. This file runs many short bursts of
// requests against one live mock server, so it lets a burst share connections (idle for at most
// 2s, under the server's own 5s keep-alive, so a pooled socket is never a closed one).
setGlobalDispatcher(new Agent({ keepAliveTimeout: 2000, keepAliveMaxTimeout: 2000 }));

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const uuid = (n: number) => `c1a10000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ISO = (minutesAgo: number) => new Date(Date.UTC(2026, 5, 1, 12, 0, 0) - minutesAgo * 60_000).toISOString();

const OTHER_SHIPMENT = '51000000-0000-4000-8000-0000000000aa';
const LOT_SHIPMENT = '51000000-0000-4000-8000-0000000000bb';
const OTHER_REQUEST = 'ab000000-0000-4000-8000-0000000000aa';
const OTHER_MANIFEST = 'aa110000-0000-4000-8000-0000000000aa';
const LOT_MANIFEST = 'aa110000-0000-4000-8000-0000000000bb';

let n = 0;
function claim(over: Row): Row {
  n += 1;
  return {
    id: uuid(n), code: `CLM-${n}`, exception_id: null, shipment_id: null, manifest_id: null, claim_type: 'damage', declared_value: null, claimed_amount: 100,
    approved_amount: null, settled_amount: null, status: 'filed', raised_by_role: 'customer', raised_by: 'someone-else', document_paths: [], notes: null,
    created_at: ISO(n), updated_at: ISO(n), settled_at: null, ...over,
  };
}

function world(claims: Row[]) {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld({
    shipments: [
      shipmentRow(ID.s1, { is_master: true }),
      shipmentRow(LOT_SHIPMENT, { tracking_id: `${shipmentRow(ID.s1).tracking_id}-A`, parent_shipment_id: ID.s1, lot_label: 'A', lot_seq: 1, is_master: false }),
      shipmentRow(OTHER_SHIPMENT),
    ],
    customer_bookings: [
      { id: ID.booking1, customer_id: ID.customer, shipment_id: ID.s1, status: 'in_transit', created_at: ISO(0), updated_at: ISO(0) },
      { id: 'bb000000-0000-4000-8000-0000000000aa', customer_id: ID.otherCustomer, shipment_id: OTHER_SHIPMENT, status: 'in_transit', created_at: ISO(0), updated_at: ISO(0) },
    ],
    cargo_manifest: [
      manifestRow(ID.m1),
      manifestRow(LOT_MANIFEST, { vendor_request_id: null, parent_manifest_id: ID.m1, lot_label: 'A' }),
      manifestRow(OTHER_MANIFEST, { vendor_request_id: OTHER_REQUEST }),
    ],
    vendor_shipment_requests: [
      { id: ID.request1, vendor_id: ID.vendor, status: 'assigned', metadata: {} },
      { id: OTHER_REQUEST, vendor_id: ID.otherVendor, status: 'assigned', metadata: {} },
    ],
    cargo_claims: claims,
  }));
}

const list = (query: string, who: Record<string, string>) => request(app).get(api(`/cargo/claims${query}`)).set(who);

/** Follows next_cursor to the end and returns every id, in order. */
async function pageThrough(who: Record<string, string>, limit: number, extra = ''): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res: any = await list(`?limit=${limit}${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, who);
    expect(res.status).toBe(200);
    ids.push(...res.body.items.map((c: any) => c.id));
    cursor = res.body.next_cursor;
    pages += 1;
  } while (cursor && pages < 100);
  return { ids, pages };
}

beforeEach(() => {
  n = 0;
});

describe('claims list scoped in the query', () => {
  it('shows a customer all their claims although 300+ newer claims belong to other customers', async () => {
    // Others' claims are the newest; the customer's are older than all of them
    const others = Array.from({ length: 320 }, (_, i) => claim({ shipment_id: OTHER_SHIPMENT, created_at: ISO(1000 - i) }));
    const mine = [
      claim({ shipment_id: ID.s1, created_at: ISO(5000) }),
      claim({ shipment_id: LOT_SHIPMENT, created_at: ISO(5001) }),
      claim({ shipment_id: OTHER_SHIPMENT, raised_by: ID.customer, created_at: ISO(5002) }),
    ];
    world([...others, ...mine]);
    const res = await list('', auth.customer());
    expect(res.status).toBe(200);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.items.map((c: any) => c.id)).toEqual(mine.map(c => c.id));
    // The scope is in the request the database gets, not applied afterwards
    expect(supabaseMock.requests.some(u => u.pathname.endsWith('/cargo_claims') && (u.searchParams.get('or') ?? '').includes('shipment_id.in.('))).toBe(true);
  });

  it('shows a vendor only their own loads and the lots of them', async () => {
    const others = Array.from({ length: 320 }, (_, i) => claim({ manifest_id: OTHER_MANIFEST, raised_by_role: 'vendor', created_at: ISO(1000 - i) }));
    const mine = [
      claim({ manifest_id: ID.m1, raised_by_role: 'vendor', created_at: ISO(5000) }),
      claim({ manifest_id: LOT_MANIFEST, raised_by_role: 'vendor', created_at: ISO(5001) }),
    ];
    world([...others, claim({ shipment_id: ID.s1, created_at: ISO(4000) }), ...mine]);
    const res = await list('?limit=200', auth.vendor());
    expect(res.body.items.map((c: any) => c.id)).toEqual(mine.map(c => c.id));
  });

  it('pages with a (created_at, id) cursor, returning every item exactly once, ties included', async () => {
    // 60 claims in groups of 10 sharing one timestamp, so the id breaks the ties
    const mine = Array.from({ length: 60 }, (_, i) => claim({ shipment_id: i % 2 ? ID.s1 : LOT_SHIPMENT, created_at: ISO(Math.floor(i / 10)) }));
    world([...mine, ...Array.from({ length: 20 }, () => claim({ shipment_id: OTHER_SHIPMENT }))]);
    const { ids, pages } = await pageThrough(auth.customer(), 25);
    expect(pages).toBe(3);
    expect(ids).toHaveLength(60);
    expect(new Set(ids)).toEqual(new Set(mine.map(c => c.id)));
    // Newest first, the id breaking a tie
    expect(ids.slice(0, 10)).toEqual(mine.slice(0, 10).map(c => c.id).sort().reverse());
  });

  it('pages a customer whose bookings span several chunks of ids of shipments', async () => {
    const extra = Array.from({ length: 120 }, (_, i) => ({ id: `bb000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`, customer_id: ID.customer, shipment_id: `52000000-0000-4000-8000-${String(i).padStart(12, '0')}`, status: 'delivered', created_at: ISO(0), updated_at: ISO(0) }));
    const mine = extra.map((b, i) => claim({ shipment_id: b.shipment_id, created_at: ISO(i) }));
    world(mine);
    supabaseMock.rows('customer_bookings').push(...extra);
    const { ids } = await pageThrough(auth.customer(), 100);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
  });

  it('keeps staff seeing everything, with the status and ref filters', async () => {
    const all = [
      claim({ shipment_id: ID.s1, status: 'filed' }),
      claim({ shipment_id: OTHER_SHIPMENT, status: 'approved' }),
      claim({ manifest_id: OTHER_MANIFEST, status: 'filed', raised_by_role: 'vendor' }),
      ...Array.from({ length: 300 }, () => claim({ shipment_id: OTHER_SHIPMENT, status: 'filed' })),
    ];
    world(all);
    expect((await pageThrough(auth.admin(), 200)).ids).toHaveLength(303);
    expect((await list('?status=approved', auth.admin())).body.items).toHaveLength(1);
    expect((await list('?status=nope', auth.admin())).status).toBe(400);
    const ref = shipmentRow(ID.s1).tracking_id;
    expect((await list(`?ref=${ref}`, auth.admin())).body.items.map((c: any) => c.id)).toEqual([all[0].id]);
    // A customer's ref filter stays inside their own claims
    expect((await list(`?ref=${shipmentRow(OTHER_SHIPMENT).tracking_id}`, auth.customer())).body.items).toHaveLength(0);
  });

  it('caps the page size and rejects a bad limit or cursor', async () => {
    world(Array.from({ length: 205 }, () => claim({ shipment_id: ID.s1 })));
    const big = await list('?limit=999', auth.admin());
    expect(big.body.items).toHaveLength(200);
    expect(big.body.next_cursor).toEqual(expect.any(String));
    expect((await list('', auth.admin())).body.items).toHaveLength(50);
    expect((await list('?limit=0', auth.admin())).status).toBe(400);
    expect((await list('?limit=abc', auth.admin())).status).toBe(400);
    expect((await list('?cursor=garbage', auth.admin())).status).toBe(400);
  });
});

describe('the booking cargo view', () => {
  it('includes the claims of the master and of every lot, tagged with the lot code', async () => {
    const own = claim({ shipment_id: ID.s1, claim_type: 'delay' });
    const onLot = claim({ shipment_id: LOT_SHIPMENT, claim_type: 'damage' });
    world([own, onLot, claim({ shipment_id: OTHER_SHIPMENT })]);
    const res = await request(app).get(api(`/customer/bookings/${ID.booking1}/cargo`)).set(auth.customer());
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.claims.map((c: any) => [c.id, c]));
    expect(Object.keys(byId).sort()).toEqual([own.id, onLot.id].sort());
    expect(byId[own.id].lot_code).toBeNull();
    expect(byId[onLot.id]).toMatchObject({ lot_code: `${shipmentRow(ID.s1).tracking_id}-A`, shipment_id: LOT_SHIPMENT });
  });
});
