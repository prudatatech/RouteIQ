/**
 * Fixtures for the order routing tests: loads in every routing state, quotes, and a stand-in for the database function
 * award_load (the same steps as the SQL in migration 20261004010000_order_routing.sql, in the same order).
 */
import { randomUUID } from 'node:crypto';
import { supabaseMock, type Row } from './mock-supabase';
import { ORG, ORGS, SEATS, memberRow, orgWorld, uid } from './org-world';

export const L = {
  open: 'b1000000-0000-4000-8000-000000000001',
  chosenB: 'b1000000-0000-4000-8000-000000000002',
  awardedA: 'b1000000-0000-4000-8000-000000000003',
  held: 'b1000000-0000-4000-8000-000000000004',
  quoteReq: 'b1000000-0000-4000-8000-000000000005',
  cancelled: 'b1000000-0000-4000-8000-000000000006',
} as const;

const NOW = new Date().toISOString();

export const loadRow = (id: string, over: Row = {}): Row => ({
  id, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, status: 'pending', routing: 'open', company_ids: [], carrier_org_id: null,
  quote_requested: false, quote_deadline: null, quote_escalated_at: null, budget_inr: 20000, cost: null, load_number: `MRX-2026-${id.slice(-5)}`,
  pickup_city: 'Pune', delivery_city: 'Mumbai', pickup_location: 'Plot 4, Pune', drop_location: 'Dock 2, Mumbai',
  pickup_lat: 18.52, pickup_lng: 73.85, drop_lat: 19.07, drop_lng: 72.87,
  pickup_date: '2026-12-01', delivery_date: '2026-12-02', pickup_slot: 'morning', pickup_contact_name: 'Ravi', pickup_contact_phone: '+919800000000',
  pickup_address: 'Plot 4 MIDC', delivery_address: 'Dock 2 Bhiwandi', delivery_contact_name: 'Asha', delivery_contact_phone: '+919800000001',
  total_weight_kg: 5000, required_capacity_kg: 5000, total_declared_value: 100000, eway_required: true, hazmat_mixed: false, special_handling: [],
  temp_min_c: null, temp_max_c: null, metadata: {}, created_at: NOW, updated_at: NOW, ...over,
});

export const quoteRow = (loadId: string, org: string, amount: number, over: Row = {}): Row => ({
  id: randomUUID(), load_id: loadId, carrier_org_id: org, amount_inr: amount, valid_until: null, vehicle_class: null, pickup_eta: null, notes: null,
  status: 'submitted', created_by: uid('admin-a'), created_at: NOW, updated_at: NOW, ...over,
});

/** The world: two companies (Alpha serves Pune and Mumbai by a depot, Beta serves Delhi), a vendor, a platform, and loads. */
export function routingWorld(over: Record<string, Row[]> = {}, orgs: Row[] = ORGS.map(o => ({ ...o }))): void {
  supabaseMock.reset(orgWorld({
    organizations: orgs,
    // The memberships embed their organisation, so a changed organisation status reaches them too
    org_members: SEATS.map(memberRow).map(m => ({ ...m, organizations: orgs.find(o => o.id === m.org_id) })),
    vendor_shipment_requests: [
      loadRow(L.open),
      loadRow(L.chosenB, { routing: 'chosen', company_ids: [ORG.companyB] }),
      loadRow(L.awardedA, { status: 'approved', carrier_org_id: ORG.companyA, cost: 18000, awarded_at: NOW }),
      loadRow(L.held, { metadata: { hold: 'vendor_unverified' } }),
      loadRow(L.quoteReq, { quote_requested: true, quote_deadline: new Date(Date.now() + 7_200_000).toISOString() }),
      loadRow(L.cancelled, { status: 'cancelled' }),
    ],
    load_items: [
      { id: 'i1', load_id: L.open, line_no: 1, product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 100, unit: 'bags', weight_kg: 5000, declared_value: 100000, handling: [], is_hazmat: false, is_perishable: false },
    ],
    load_quotes: [],
    depots: [{ id: 'd1', name: 'Mumbai hub', address: 'MIDC, Andheri, Mumbai, Maharashtra', carrier_org_id: ORG.companyA }, { id: 'd2', name: 'Kolkata hub', address: 'Salt Lake, Kolkata', carrier_org_id: ORG.companyB }],
    vehicles: [], shipments: [], cargo_manifest: [], vendor_profiles: [], load_documents: [], load_document_events: [], trip_settlements: [],
    ...over,
  }));
  installAwardRpc();
}

/** award_load, step for step as the SQL does it. Errors are the SQL exception messages. */
export function installAwardRpc(): void {
  supabaseMock.onRpc('award_load', (a: any) => {
    const loads = supabaseMock.rows('vendor_shipment_requests');
    const quotes = supabaseMock.rows('load_quotes');
    const l = loads.find(x => x.id === a.p_load);
    if (!l) return { __rpcError: 'load_not_found' };
    if (l.status !== 'pending' || l.carrier_org_id) return { __rpcError: 'load_already_awarded' };
    let q: Row | undefined;
    if (a.p_direct) {
      if (l.quote_requested) return { __rpcError: 'quote_required' };
      if (!a.p_carrier || !(a.p_amount > 0)) return { __rpcError: 'amount_required' };
      q = quotes.find(x => x.load_id === a.p_load && x.carrier_org_id === a.p_carrier && x.status === 'submitted');
      if (q) Object.assign(q, { status: 'accepted', amount_inr: a.p_amount });
      else {
        q = quoteRow(a.p_load, a.p_carrier, a.p_amount, { status: 'accepted', created_by: a.p_actor });
        quotes.push(q);
      }
    } else {
      q = quotes.find(x => x.id === a.p_quote && x.load_id === a.p_load);
      if (!q) return { __rpcError: 'quote_not_found' };
      if (q.status !== 'submitted') return { __rpcError: 'quote_not_open' };
      if (q.valid_until && Date.parse(q.valid_until) < Date.now()) return { __rpcError: 'quote_expired' };
      q.status = 'accepted';
    }
    const declined = quotes.filter(x => x.load_id === a.p_load && x.status === 'submitted' && x.id !== q!.id);
    for (const d of declined) d.status = 'declined';
    Object.assign(l, { carrier_org_id: q.carrier_org_id, awarded_at: new Date().toISOString(), awarded_quote_id: q.id, status: 'approved', cost: q.amount_inr, ...(a.p_cost_per_km ? { cost_per_km: a.p_cost_per_km } : {}) });
    return { load: { ...l }, quote: { ...q }, declined: declined.map(d => ({ id: d.id, carrier_org_id: d.carrier_org_id })) };
  });
}

/** The notifications a user got, newest first. */
export const notesFor = (user: string, type?: string): Row[] =>
  supabaseMock.rows('notifications').filter(n => n.user_id === uid(user) && (!type || n.type === type));
