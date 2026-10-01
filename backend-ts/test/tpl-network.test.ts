import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { COMPANY_SETTING } from './support/cargo-world';
import { testApp } from './support/test-app';
import { computeStats, groupEarnings, slaHours } from '../src/services/tpl-network.service';
import { matchingService } from '../src/services/matching.service';
import { InvoiceService } from '../src/services/invoice.service';

const app = testApp();

const REQ = 'aaaaaaaa-0000-4000-8000-000000000001';
const SHIP = 'bbbbbbbb-0000-4000-8000-000000000001';
const P1 = 'cccccccc-0000-4000-8000-000000000001';
const P2 = 'cccccccc-0000-4000-8000-000000000002';
const P3 = 'cccccccc-0000-4000-8000-000000000003';
const P4 = 'cccccccc-0000-4000-8000-000000000004';

const staff = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const asPartner = (userId: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(userId)}` });

function fixtures(overrides: Record<string, Record<string, unknown>[]> = {}) {
  return {
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
      { id: 'u1', role: 'vendor', is_active: true },
      { id: 'u2', role: 'vendor', is_active: true },
      { id: 'u3', role: 'vendor', is_active: true },
    ],
    vendor_shipment_requests: [{
      id: REQ, vendor_id: 'vendor-1', pickup_location: 'Okhla, New Delhi', pickup_lat: 28.5, pickup_lng: 77.3,
      drop_location: 'Andheri, Mumbai, Maharashtra', drop_lat: 19.1, drop_lng: 72.8,
      required_capacity_kg: 800, status: 'approved', metadata: null,
    }],
    tpl_partners: [
      { id: P1, user_id: 'u1', company_name: 'North Freight', status: 'active', email: null, sla_commitment: '4 Hours' },
      { id: P2, user_id: 'u2', company_name: 'West Carriers', status: 'active', email: null, sla_commitment: '2 Hours' },
      { id: P3, user_id: 'u3', company_name: 'South Lines', status: 'active', email: null, sla_commitment: '2 Hours' },
      { id: P4, user_id: null, company_name: 'Paused Co', status: 'paused', email: null, sla_commitment: '2 Hours' },
    ],
    tpl_corridors: [
      { id: 'k1', partner_id: P1, corridor_name: 'DEL-BOM', proposed_rate: '₹41,200', priority: 1 },
      { id: 'k2', partner_id: P2, corridor_name: 'Delhi to Maharashtra', proposed_rate: 'on request', priority: 1 },
      { id: 'k3', partner_id: P3, corridor_name: 'BLR-MAA', proposed_rate: '18000', priority: 1 },
      { id: 'k4', partner_id: P4, corridor_name: 'DEL-BOM', proposed_rate: '39000', priority: 1 },
    ],
    tpl_offers: [],
    tpl_orders: [],
    notifications: [],
    shipments: [],
    shipment_logs: [],
    delivery_points: [],
    route_stops: [],
    system_settings: [COMPANY_SETTING],
    ...overrides,
  };
}

const escalate = (body: Record<string, unknown> = { request_id: REQ }) =>
  request(app).post('/api/v1/tpl-network/escalations').set(staff()).send(body);

describe('escalating a vendor request', () => {
  beforeEach(() => supabaseMock.reset(fixtures()));

  it('creates an offer for every active partner on a matching corridor, at their corridor rate', async () => {
    const res = await escalate();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 2, matched: 2, already_offered: 0 });

    const offers = supabaseMock.rows('tpl_offers');
    expect(offers.map(o => o.partner_id).sort()).toEqual([P1, P2]);
    expect(offers.find(o => o.partner_id === P1)).toMatchObject({
      status: 'offered', source_type: 'request', request_id: REQ, proposed_price: 41200, corridor_name: 'DEL-BOM', weight_kg: 800,
    });
    // A rate that is not a number is left empty, not guessed
    expect(offers.find(o => o.partner_id === P2)!.proposed_price).toBeNull();
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'escalated', metadata: { escalated_from: 'approved' } });
  });

  it('notifies the partners and the vendor', async () => {
    await escalate();
    const notified = supabaseMock.rows('notifications').map(n => `${n.user_id}:${n.type}`).sort();
    expect(notified).toEqual(['u1:tpl_offer', 'u2:tpl_offer', 'vendor-1:request_escalated']);
  });

  it('refuses when no partner covers the route and leaves the request alone', async () => {
    supabaseMock.reset(fixtures({ tpl_corridors: [{ id: 'k3', partner_id: P3, corridor_name: 'BLR-MAA', proposed_rate: '18000', priority: 1 }] }));
    const res = await escalate();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/No active 3PL partner/);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('approved');
    expect(supabaseMock.rows('tpl_offers')).toEqual([]);
  });

  it('does not offer twice to the same partner', async () => {
    await escalate();
    const again = await escalate();
    expect(again.status).toBe(409);
    expect(supabaseMock.rows('tpl_offers')).toHaveLength(2);
  });

  it('refuses a request that was rejected or already assigned', async () => {
    supabaseMock.rows('vendor_shipment_requests')[0].status = 'rejected';
    expect((await escalate()).status).toBe(409);
  });

  it('needs staff, and exactly one load', async () => {
    expect((await request(app).post('/api/v1/tpl-network/escalations').send({ request_id: REQ })).status).toBe(401);
    expect((await request(app).post('/api/v1/tpl-network/escalations').set(asPartner('u1')).send({ request_id: REQ })).status).toBe(403);
    expect((await escalate({})).status).toBe(400);
    expect((await escalate({ request_id: REQ, shipment_id: SHIP })).status).toBe(400);
  });

  it('previews the partners without sending anything', async () => {
    const res = await request(app).get(`/api/v1/tpl-network/escalations/preview?request_id=${REQ}`).set(staff());
    expect(res.status).toBe(200);
    expect(res.body.partners.map((p: { company_name: string }) => p.company_name).sort()).toEqual(['North Freight', 'West Carriers']);
    expect(supabaseMock.rows('tpl_offers')).toEqual([]);
  });

  it('lists offers with partner names', async () => {
    await escalate();
    const res = await request(app).get(`/api/v1/tpl-network/escalations?request_id=${REQ}`).set(staff());
    expect(res.status).toBe(200);
    expect(res.body.offers.map((o: { partner_name: string }) => o.partner_name).sort()).toEqual(['North Freight', 'West Carriers']);
    expect(res.body.order).toBeNull();
  });

  it('withdraws offers and puts the request back where it was', async () => {
    await escalate();
    const res = await request(app).post('/api/v1/tpl-network/escalations/withdraw').set(staff()).send({ request_id: REQ });
    expect(res.status).toBe(200);
    expect(res.body.withdrawn).toBe(2);
    expect(supabaseMock.rows('tpl_offers').every(o => o.status === 'withdrawn')).toBe(true);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('approved');
    expect((await request(app).post('/api/v1/tpl-network/escalations/withdraw').set(staff()).send({ request_id: REQ })).status).toBe(409);
  });

  it('withdraws a single offer and keeps the request escalated while others are open', async () => {
    await escalate();
    const [first] = supabaseMock.rows('tpl_offers');
    const res = await request(app).post(`/api/v1/tpl-network/offers/${first.id}/withdraw`).set(staff());
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_offers').filter(o => o.status === 'offered')).toHaveLength(1);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('escalated');
  });
});

describe('escalating a shipment', () => {
  const shipmentFixtures = (extra: Record<string, Record<string, unknown>[]> = {}) => fixtures({
    shipments: [{ id: SHIP, tracking_id: 'MGX-1', status: 'created', origin_name: 'Okhla', origin_address: 'New Delhi', total_weight_kg: 300, bid_id: null }],
    delivery_points: [{ id: 'dp-1', shipment_id: SHIP, name: 'Andheri warehouse', address: 'Mumbai, Maharashtra' }],
    vendor_shipment_requests: [],
    ...extra,
  });

  it('offers an unassigned shipment to matching partners', async () => {
    supabaseMock.reset(shipmentFixtures());
    const res = await escalate({ shipment_id: SHIP });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(supabaseMock.rows('tpl_offers')[0]).toMatchObject({ source_type: 'shipment', shipment_id: SHIP });
  });

  it('refuses a shipment that is already on a trip', async () => {
    supabaseMock.reset(shipmentFixtures({ route_stops: [{ id: 'rs-1', delivery_point_id: 'dp-1' }] }));
    const res = await escalate({ shipment_id: SHIP });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already on a trip/);
  });

  it('refuses a shipment that has moved on', async () => {
    supabaseMock.reset(shipmentFixtures());
    supabaseMock.rows('shipments')[0].status = 'in_transit';
    expect((await escalate({ shipment_id: SHIP })).status).toBe(409);
  });
});

describe('the cascade matcher (tier 2)', () => {
  const tier2Shipment = {
    shipments: [{ id: SHIP, tracking_id: 'MGX-2', status: 'created', origin_name: 'Okhla', origin_address: 'New Delhi', origin_lat: null, origin_lng: null, total_weight_kg: 300, bid_id: null, metadata: {} }],
    delivery_points: [{ id: 'dp-1', shipment_id: SHIP, name: 'Andheri warehouse', address: 'Mumbai, Maharashtra' }],
    vendor_shipment_requests: [],
  };

  it('does not offer loads to partners unless automatic escalation is switched on', async () => {
    supabaseMock.reset(fixtures(tier2Shipment));
    const result = await matchingService.cascadeEscalation(SHIP);
    expect(result).toMatchObject({ tier: 'Tier 2', broadcastedTo: 0 });
    expect(supabaseMock.rows('tpl_offers')).toEqual([]);
    // Nobody was offered the load, so the history never says "With 3PL partners"
    expect(supabaseMock.rows('shipment_logs').filter(l => l.status === 'escalated')).toEqual([]);
  });

  it('creates offers on the same corridor match when automatic escalation is on', async () => {
    supabaseMock.reset(fixtures({ ...tier2Shipment, system_settings: [{ key: 'auto_escalate_3pl', value: true }] }));
    const result = await matchingService.cascadeEscalation(SHIP);
    expect(result).toMatchObject({ tier: 'Tier 2', broadcastedTo: 2 });
    expect(supabaseMock.rows('tpl_offers')).toHaveLength(2);
    expect(supabaseMock.rows('shipment_logs').filter(l => l.status === 'escalated')).toHaveLength(1);
  });

  it('broadcasts to nobody when no partner covers the route', async () => {
    supabaseMock.reset(fixtures({
      shipments: [{ id: SHIP, tracking_id: 'MGX-3', status: 'created', origin_name: 'Chennai', origin_address: '', origin_lat: null, origin_lng: null, total_weight_kg: 300, bid_id: null, metadata: {} }],
      delivery_points: [{ id: 'dp-1', shipment_id: SHIP, name: 'Jaipur', address: 'Rajasthan' }],
      vendor_shipment_requests: [],
      system_settings: [{ key: 'auto_escalate_3pl', value: true }],
    }));
    const result = await matchingService.cascadeEscalation(SHIP);
    expect(result.broadcastedTo).toBe(0);
    expect(supabaseMock.rows('tpl_offers')).toEqual([]);
  });
});

describe('partner responses', () => {
  beforeEach(async () => {
    supabaseMock.reset(fixtures());
    await escalate();
  });

  const offerOf = (partnerId: string) => supabaseMock.rows('tpl_offers').find(o => o.partner_id === partnerId)!;
  const accept = (user: string, offerId: string, body: Record<string, unknown> = {}) =>
    request(app).post(`/api/v1/tpl-network/my/offers/${offerId}/accept`).set(asPartner(user)).send(body);

  it('shows a partner only their own offers', async () => {
    const res = await request(app).get('/api/v1/tpl-network/my/offers').set(asPartner('u1'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].partner_id).toBe(P1);
  });

  it('keeps other accounts out', async () => {
    expect((await request(app).get('/api/v1/tpl-network/my/offers').set(staff())).status).toBe(403);
    supabaseMock.rows('users').push({ id: 'stray', role: 'vendor', is_active: true });
    expect((await request(app).get('/api/v1/tpl-network/my/offers').set(asPartner('stray'))).status).toBe(403);
  });

  it('first accept wins: order created, request assigned, other offer taken', async () => {
    const res = await accept('u1', offerOf(P1).id, { pickup_eta: '2026-10-01T08:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ partner_id: P1, agreed_amount: 41200, status: 'accepted', request_id: REQ });
    expect(res.body.due_by).toBeTruthy();
    expect(offerOf(P1)).toMatchObject({ status: 'accepted', pickup_eta: '2026-10-01T08:00:00.000Z' });
    expect(offerOf(P2).status).toBe('taken');
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('assigned_to_partner');
    expect(supabaseMock.rows('notifications').some(n => n.user_id === 'u2' && n.type === 'tpl_offer_taken')).toBe(true);

    const second = await accept('u2', offerOf(P2).id, { agreed_amount: 39000 });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/Another partner already took/);
    expect(supabaseMock.rows('tpl_orders')).toHaveLength(1);
  });

  it('cannot accept an offer addressed to someone else', async () => {
    const res = await accept('u1', offerOf(P2).id, { agreed_amount: 39000 });
    expect(res.status).toBe(404);
    expect(supabaseMock.rows('tpl_orders')).toEqual([]);
  });

  it('asks for an amount when the corridor rate was not a number', async () => {
    expect((await accept('u2', offerOf(P2).id)).status).toBe(400);
    const ok = await accept('u2', offerOf(P2).id, { agreed_amount: 39500 });
    expect(ok.status).toBe(201);
    expect(ok.body.agreed_amount).toBe(39500);
  });

  it('rejects a delivery time before the pickup time', async () => {
    const res = await accept('u1', offerOf(P1).id, { pickup_eta: '2026-10-01T08:00:00Z', delivery_eta: '2026-10-01T07:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('uses the promised delivery time, else the SLA commitment, as the due time', async () => {
    const promised = await accept('u1', offerOf(P1).id, { delivery_eta: '2030-01-02T10:00:00Z' });
    expect(promised.body.due_by).toBe('2030-01-02T10:00:00.000Z');
    const order = supabaseMock.rows('tpl_orders')[0];
    expect(order.due_by).toBe('2030-01-02T10:00:00.000Z');
    expect(slaHours('4 Hours')).toBe(4);
    expect(slaHours('soon')).toBeNull();
  });

  it('a paused partner cannot accept', async () => {
    supabaseMock.rows('tpl_partners').find(p => p.id === P1)!.status = 'paused';
    expect((await accept('u1', offerOf(P1).id)).status).toBe(403);
  });

  it('declining needs a reason and puts the request back once nobody is left', async () => {
    const decline = (user: string, id: string, body: Record<string, unknown>) =>
      request(app).post(`/api/v1/tpl-network/my/offers/${id}/decline`).set(asPartner(user)).send(body);
    expect((await decline('u1', offerOf(P1).id, {})).status).toBe(400);
    expect((await decline('u1', offerOf(P1).id, { reason: 'No trucks free this week' })).status).toBe(200);
    expect(offerOf(P1)).toMatchObject({ status: 'declined', decline_reason: 'No trucks free this week' });
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('escalated');
    expect((await decline('u2', offerOf(P2).id, { reason: 'Route not served now' })).status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('approved');
    expect((await decline('u2', offerOf(P2).id, { reason: 'Route not served now' })).status).toBe(409);
  });
});

describe('orders, earnings and ratings', () => {
  let orderId: string;
  const setStatus = (status: string, note?: string) =>
    request(app).post(`/api/v1/tpl-network/my/orders/${orderId}/status`).set(asPartner('u1')).send({ status, note });

  beforeEach(async () => {
    supabaseMock.reset(fixtures());
    await escalate();
    const offer = supabaseMock.rows('tpl_offers').find(o => o.partner_id === P1)!;
    const res = await request(app).post(`/api/v1/tpl-network/my/offers/${offer.id}/accept`).set(asPartner('u1')).send({});
    orderId = res.body.id;
  });

  it('moves forward through picked up, in transit and delivered', async () => {
    expect((await setStatus('picked_up')).status).toBe(200);
    expect(supabaseMock.rows('tpl_orders')[0].picked_up_at).toBeTruthy();
    expect((await setStatus('picked_up')).status).toBe(409);
    expect((await setStatus('in_transit')).status).toBe(200);
    expect((await setStatus('accepted')).status).toBe(400);
  });

  it('delivered needs a proof of delivery note, and completes the request', async () => {
    expect((await setStatus('delivered')).status).toBe(400);
    const res = await setStatus('delivered', 'Received by A. Kumar at the gate');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'delivered', pod_note: 'Received by A. Kumar at the gate' });
    expect(res.body.delivered_at).toBeTruthy();
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('completed');
    expect(supabaseMock.rows('notifications').some(n => n.user_id === 'vendor-1' && n.type === 'request_completed')).toBe(true);
  });

  it('another partner cannot update the order', async () => {
    const res = await request(app).post(`/api/v1/tpl-network/my/orders/${orderId}/status`).set(asPartner('u2')).send({ status: 'picked_up' });
    expect(res.status).toBe(404);
  });

  it('groups earnings by month and shows paid, payable and in progress', async () => {
    await setStatus('delivered', 'Received at gate');
    const before = await request(app).get('/api/v1/tpl-network/my/earnings').set(asPartner('u1'));
    expect(before.status).toBe(200);
    expect(before.body.totals).toEqual({ total: 41200, paid: 0, payable: 41200, in_progress: 0, unpaid: 41200 });
    expect(before.body.months).toHaveLength(1);

    const paid = await request(app).post(`/api/v1/tpl-network/orders/${orderId}/paid`).set(staff()).send({ paid: true, reference: 'UTR123' });
    expect(paid.status).toBe(200);
    const after = await request(app).get('/api/v1/tpl-network/my/earnings').set(asPartner('u1'));
    expect(after.body.totals).toEqual({ total: 41200, paid: 41200, payable: 0, in_progress: 0, unpaid: 0 });
  });

  it('marks paid and rates only after delivery', async () => {
    expect((await request(app).post(`/api/v1/tpl-network/orders/${orderId}/paid`).set(staff()).send({ paid: true })).status).toBe(409);
    expect((await request(app).post(`/api/v1/tpl-network/orders/${orderId}/rate`).set(staff()).send({ rating: 5 })).status).toBe(409);
  });

  it('staff rate a delivered order from 1 to 5', async () => {
    await setStatus('delivered', 'Received at gate');
    const rate = (rating: unknown) => request(app).post(`/api/v1/tpl-network/orders/${orderId}/rate`).set(staff()).send({ rating, note: 'On time' });
    expect((await rate(6)).status).toBe(400);
    expect((await rate(0)).status).toBe(400);
    expect((await rate(2.5)).status).toBe(400);
    expect((await rate(4)).status).toBe(200);
    expect(supabaseMock.rows('tpl_orders')[0]).toMatchObject({ rating: 4, rating_note: 'On time' });
    expect((await request(app).post(`/api/v1/tpl-network/orders/${orderId}/rate`).set(asPartner('u1')).send({ rating: 5 })).status).toBe(403);
  });

  it('serves partner statistics to staff and to the partner', async () => {
    await setStatus('delivered', 'Received at gate');
    await request(app).post(`/api/v1/tpl-network/orders/${orderId}/rate`).set(staff()).send({ rating: 4 });
    const all = await request(app).get('/api/v1/tpl-network/partners/stats').set(staff());
    expect(all.status).toBe(200);
    expect(all.body[P1]).toMatchObject({ offers_accepted: 1, acceptance_rate: 1, orders_completed: 1, rating_avg: 4, rating_count: 1 });
    const mine = await request(app).get('/api/v1/tpl-network/my/stats').set(asPartner('u1'));
    expect(mine.body.orders_completed).toBe(1);
    expect((await request(app).get('/api/v1/tpl-network/partners/stats').set(asPartner('u1'))).status).toBe(403);
  });
});

describe('statistics', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const offer = (status: string, minutes?: number) => ({
    status,
    offered_at: '2026-10-01T10:00:00Z',
    responded_at: minutes == null ? null : new Date(new Date('2026-10-01T10:00:00Z').getTime() + minutes * 60000).toISOString(),
  });

  it('counts acceptance out of answered offers only', () => {
    const s = computeStats([offer('accepted', 10), offer('accepted', 30), offer('declined', 20), offer('taken', 5), offer('withdrawn'), offer('offered')], [], now);
    expect(s).toMatchObject({ offers_received: 5, offers_accepted: 2, offers_declined: 1, offers_taken: 1 });
    expect(s.acceptance_rate).toBeCloseTo(2 / 3);
    expect(s.avg_response_minutes).toBe(20);
  });

  it('has no rate or response time before anything is answered', () => {
    const s = computeStats([offer('offered'), offer('taken', 5)], [], now);
    expect(s.acceptance_rate).toBeNull();
    expect(s.avg_response_minutes).toBeNull();
    expect(s.rating_avg).toBeNull();
  });

  it('counts late deliveries and open orders past their due time as breaches', () => {
    const s = computeStats([], [
      { status: 'delivered', due_by: '2026-10-02T10:00:00Z', delivered_at: '2026-10-02T09:00:00Z', rating: 5 },
      { status: 'delivered', due_by: '2026-10-02T10:00:00Z', delivered_at: '2026-10-02T11:00:00Z', rating: 3 },
      { status: 'in_transit', due_by: '2026-10-09T10:00:00Z' },
      { status: 'in_transit', due_by: '2026-10-11T10:00:00Z' },
      { status: 'accepted', due_by: null },
      { status: 'cancelled', due_by: '2026-10-01T10:00:00Z' },
    ], now);
    expect(s).toMatchObject({ orders_completed: 2, orders_active: 3, sla_breaches: 2, sla_measured: 4, rating_count: 2, rating_avg: 4 });
  });

  it('groups earnings by Indian calendar month', () => {
    const g = groupEarnings([
      { id: 'a', agreed_amount: 1000.5, accepted_at: '2026-09-30T20:00:00Z', delivered_at: '2026-09-30T20:00:00Z', paid_at: null },
      { id: 'b', agreed_amount: '2000', accepted_at: '2026-09-10T00:00:00Z', delivered_at: '2026-09-12T00:00:00Z', paid_at: '2026-09-20T00:00:00Z' },
      { id: 'c', agreed_amount: 500, accepted_at: '2026-10-02T00:00:00Z', delivered_at: null, paid_at: null },
    ]);
    // 20:00 UTC on 30 Sept is already 1 October in India
    expect(g.months.map(m => m.month)).toEqual(['2026-10', '2026-09']);
    // Delivered and unpaid is payable; not yet delivered is still in progress
    expect(g.months[0]).toMatchObject({ total: 1500.5, payable: 1000.5, in_progress: 500, unpaid: 1500.5, paid: 0 });
    expect(g.months[1]).toMatchObject({ total: 2000, paid: 2000, payable: 0, in_progress: 0, unpaid: 0 });
    expect(g.totals).toEqual({ total: 3500.5, paid: 2000, payable: 1000.5, in_progress: 500, unpaid: 1500.5 });
  });
});

describe('corridor rates', () => {
  const rate = (over: Record<string, unknown>) => ({ id: 'k1', partner_id: P1, corridor_name: 'DEL-BOM', priority: 1, ...over });

  it('prices a per-trip rate as it is and a per-km rate from the road distance', async () => {
    supabaseMock.reset(fixtures({
      tpl_corridors: [
        rate({ rate_amount: 45000, rate_unit: 'per_trip', proposed_rate: '₹45,000 per trip' }),
        rate({ id: 'k2', partner_id: P2, corridor_name: 'Delhi to Maharashtra', rate_amount: 20, rate_unit: 'per_km', proposed_rate: '₹20 per km' }),
      ],
    }));
    const res = await escalate();
    expect(res.status).toBe(201);
    const offers = supabaseMock.rows('tpl_offers');
    expect(offers.find(o => o.partner_id === P1)!.proposed_price).toBe(45000);
    // Delhi to Mumbai is well over 1,000 km by road: the price is the rate times that distance
    const perKm = offers.find(o => o.partner_id === P2)!.proposed_price;
    expect(perKm).toBeGreaterThan(20 * 1000);
    expect(perKm).toBeLessThan(20 * 2000);
  });

  it('does not price a per-km rate when the distance is unknown', async () => {
    supabaseMock.reset(fixtures({
      tpl_corridors: [rate({ rate_amount: 20, rate_unit: 'per_km', proposed_rate: '₹20 per km' })],
    }));
    supabaseMock.rows('vendor_shipment_requests')[0].drop_lat = null;
    await escalate();
    expect(supabaseMock.rows('tpl_offers')[0].proposed_price).toBeNull();
  });

  it('never prices a load from text that is not just an amount', async () => {
    supabaseMock.reset(fixtures({
      tpl_corridors: [rate({ proposed_rate: 'Base + 12%' }), rate({ id: 'k2', partner_id: P2, corridor_name: 'Delhi to Maharashtra', proposed_rate: '12% over base' })],
    }));
    await escalate();
    expect(supabaseMock.rows('tpl_offers').map(o => o.proposed_price)).toEqual([null, null]);
  });

  it('still reads an older rate that is only an amount, per trip or per km', async () => {
    supabaseMock.reset(fixtures({
      tpl_corridors: [rate({ proposed_rate: '₹41,200' }), rate({ id: 'k2', partner_id: P2, corridor_name: 'Delhi to Maharashtra', proposed_rate: '₹20 per km' })],
    }));
    await escalate();
    const offers = supabaseMock.rows('tpl_offers');
    expect(offers.find(o => o.partner_id === P1)!.proposed_price).toBe(41200);
    expect(offers.find(o => o.partner_id === P2)!.proposed_price).toBeGreaterThan(20000);
  });

  it('the amount a partner enters on accepting wins over the corridor price', async () => {
    supabaseMock.reset(fixtures());
    await escalate();
    const offer = supabaseMock.rows('tpl_offers').find(o => o.partner_id === P1)!;
    expect(offer.proposed_price).toBe(41200);
    const res = await request(app).post(`/api/v1/tpl-network/my/offers/${offer.id}/accept`).set(asPartner('u1')).send({ agreed_amount: 43500 });
    expect(res.status).toBe(201);
    expect(res.body.agreed_amount).toBe(43500);
    expect(supabaseMock.rows('tpl_orders')[0].agreed_amount).toBe(43500);
  });

  it('refuses an amount that is not a positive number', async () => {
    supabaseMock.reset(fixtures());
    await escalate();
    const offer = supabaseMock.rows('tpl_offers').find(o => o.partner_id === P1)!;
    for (const bad of [-5, 0, 'lots', 999_999_999]) {
      const res = await request(app).post(`/api/v1/tpl-network/my/offers/${offer.id}/accept`).set(asPartner('u1')).send({ agreed_amount: bad });
      expect(res.status).toBe(400);
    }
    expect(supabaseMock.rows('tpl_orders')).toEqual([]);
  });
});

describe('a shipment another route already holds', () => {
  beforeEach(() => {
    supabaseMock.reset(fixtures({
      shipments: [{ id: SHIP, tracking_id: 'RTX-1', status: 'created', origin_name: 'Okhla Hub', origin_address: 'Okhla, New Delhi', total_weight_kg: 500, bid_id: null }],
      delivery_points: [{ id: 'dp-1', shipment_id: SHIP, name: 'Andheri', address: 'Andheri, Mumbai', latitude: 19.1, longitude: 72.8 }],
    }));
  });

  it('cannot be escalated while a bidding window is open for it', async () => {
    supabaseMock.rows('capacity_windows').push({ id: 'w1', fallback_shipment_id: SHIP, status: 'open', winning_bid_id: null });
    const res = await escalate({ shipment_id: SHIP });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/bidding window/);
    expect(supabaseMock.rows('tpl_offers')).toEqual([]);
  });

  it('can be escalated once the window is closed', async () => {
    supabaseMock.rows('capacity_windows').push({ id: 'w1', fallback_shipment_id: SHIP, status: 'closed', winning_bid_id: null });
    expect((await escalate({ shipment_id: SHIP })).status).toBe(201);
  });
});

describe('when a partner delivers a vendor load', () => {
  let orderId: string;
  const setStatus = (status: string, note?: string) =>
    request(app).post(`/api/v1/tpl-network/my/orders/${orderId}/status`).set(asPartner('u1')).send({ status, note });

  beforeEach(async () => {
    supabaseMock.reset(fixtures({ invoices: [], vendor_profiles: [{ id: 'vendor-1', company_name: 'Acme' }] }));
    await escalate();
    const offer = supabaseMock.rows('tpl_offers').find(o => o.partner_id === P1)!;
    const res = await request(app).post(`/api/v1/tpl-network/my/offers/${offer.id}/accept`).set(asPartner('u1')).send({});
    orderId = res.body.id;
    supabaseMock.rows('notifications').length = 0;
  });

  it('tells the vendor at pickup, on the way and on delivery', async () => {
    await setStatus('picked_up');
    await setStatus('in_transit');
    await setStatus('delivered', 'Received at gate');
    const types = supabaseMock.rows('notifications').filter(n => n.user_id === 'vendor-1').map(n => n.type);
    expect(types).toEqual(['load_picked_up', 'load_in_transit', 'request_completed']);
  });

  it('invoices the vendor at the price staff set, not at what the partner charges', async () => {
    supabaseMock.rows('vendor_shipment_requests')[0].cost = 52000;
    await setStatus('delivered', 'Received at gate');
    const invoices = supabaseMock.rows('invoices');
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ vendor_request_id: REQ, vendor_id: 'vendor-1', amount: 52000, price_source: 'vendor_request', status: 'issued' });
    // Delivering again does not invoice again
    expect((await InvoiceService.createForRequest(REQ)).status).toBe('exists');
  });

  it('writes no invoice without a price, and staff can set it afterwards', async () => {
    await setStatus('delivered', 'Received at gate');
    expect(supabaseMock.rows('invoices')).toEqual([]);

    const bad = await request(app).put(`/api/v1/tpl-network/requests/${REQ}/price`).set(staff()).send({ cost: -1 });
    expect(bad.status).toBe(400);
    const res = await request(app).put(`/api/v1/tpl-network/requests/${REQ}/price`).set(staff()).send({ cost: 48000 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cost: 48000, invoice: 'created' });
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ vendor_request_id: REQ, amount: 48000 });
  });

  it('lets staff set the vendor price when they escalate', async () => {
    supabaseMock.reset(fixtures());
    const res = await escalate({ request_id: REQ, vendor_price: 50000 });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].cost).toBe(50000);
  });
});

describe('the automatic escalation switch', () => {
  const read = () => request(app).get('/api/v1/tpl-network/settings').set(staff());

  it.each([
    [true, true],
    [{ enabled: true }, true],
    ['true', true],
    [false, false],
    [{ enabled: false }, false],
    [{}, false],
  ])('reads %j as %j', async (value, expected) => {
    supabaseMock.reset({ users: [{ id: 'admin-1', role: 'admin', is_active: true }], system_settings: [{ key: 'auto_escalate_3pl', value }] });
    expect((await read()).body).toEqual({ auto_escalate: expected });
  });
});
