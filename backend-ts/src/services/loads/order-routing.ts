/**
 * margixindia — Order routing and quotes (docs/order-routing.md).
 *
 * A vendor's posted load (vendor_shipment_requests) reaches logistic companies either sent to chosen companies or open
 * to every company serving the lane. Companies quote or accept; the vendor picks one; the load then belongs to that
 * company (carrier_org_id). Who sees a load is the database function app.can_see_load; `loadVisibleToCompany` is the
 * same rule for the backend, which reads with the service role.
 *
 * The award (a vendor accepting a quote, or a company accepting at the budget) is one database function,
 * award_load, so it is atomic and only one award can ever happen.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { formatINR } from '../../core/format';
import { GST_STATES } from '../../core/gst';
import { notificationService, PLATFORM } from '../notification.service';
import { selectIn } from '../finance.service';
import { cityFromAddress } from '../demand.service';
import { placeMatchesSide } from '../../utils/corridor-match';
import type { Caller } from './loads.service';

/** Marks a load whose vendor organisation is not active yet: it reaches no company until it is. */
export const HOLD_UNVERIFIED = 'vendor_unverified';
/** A company can be chosen for a load up to this many at a time. */
export const MAX_CHOSEN_COMPANIES = 10;
/** How long companies get to quote when the vendor asked for quotes. */
export const QUOTE_WINDOW_MS = 2 * 60 * 60 * 1000;
/** How many people are told at the same time when a load goes out. */
const NOTIFY_CONCURRENCY = 20;
/** The market and the won list show at most this many loads at a time. */
const MARKET_LIMIT = 300;

export type Routing = 'open' | 'chosen';
export const MARKET_TABS = ['new', 'quoted', 'won', 'lost'] as const;
export type MarketTab = (typeof MARKET_TABS)[number];

/** The deadline companies quote by, or null when no quote was asked for. */
export function quoteDeadline(quoteRequested: boolean, from: Date = new Date()): string | null {
  return quoteRequested ? new Date(from.getTime() + QUOTE_WINDOW_MS).toISOString() : null;
}

const num = (v: unknown) => (v == null ? null : Number(v));
const one = <T>(embed: T | T[] | null | undefined): T | null => (Array.isArray(embed) ? embed[0] : embed) ?? null;
const lane = (l: Record<string, any>) => `${l.pickup_city ?? shortPlace(l.pickup_location)} → ${l.delivery_city ?? shortPlace(l.drop_location)}`;
const shortPlace = (p: string | null | undefined) => (p ?? '').split(',')[0].trim() || 'pickup';

// ── Choosing companies ──────────────────────────────────────

/** A 400 unless every id is an active logistic company (at most MAX_CHOSEN_COMPANIES of them). */
export async function assertChosenCompanies(ids: string[]): Promise<void> {
  if (ids.length === 0) throw new HttpError(400, 'Choose at least one company, or open the load to every company serving the pickup and delivery.');
  if (ids.length > MAX_CHOSEN_COMPANIES) throw new HttpError(400, `You can send a load to at most ${MAX_CHOSEN_COMPANIES} companies.`);
  const orgs = await selectIn<any>('organizations', 'id', ids, 'id, kind, status');
  const ok = new Set(orgs.filter(o => o.kind === 'logistic_company' && o.status === 'active').map(o => o.id));
  if (ids.some(id => !ok.has(id))) throw new HttpError(400, 'One of the chosen companies is not available. Choose active logistic companies.');
}

// ── Telling the companies ───────────────────────────────────

/** The owners and admins of these organisations, as active user ids. */
export async function ownersAndAdmins(orgIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (orgIds.length === 0) return out;
  const members = await selectIn<any>('org_members', 'org_id', orgIds, 'org_id, user_id', q => q.in('role', ['owner', 'admin']).eq('status', 'active'));
  const users = await selectIn<any>('users', 'id', members.map(m => m.user_id), 'id, is_active');
  const active = new Set(users.filter(u => u.is_active !== false).map(u => u.id));
  for (const m of members) {
    if (!active.has(m.user_id)) continue;
    out.set(m.org_id, [...(out.get(m.org_id) ?? []), m.user_id]);
  }
  return out;
}

/**
 * The companies an open load goes to: those whose home city or state, depots or vehicles serve the pickup or the delivery
 * (the state or the city). When none does, every active logistic company.
 */
export async function companiesServing(load: Record<string, any>): Promise<string[]> {
  const { data, error } = await supabase.from('organizations').select('id, city, state').eq('kind', 'logistic_company').eq('status', 'active').limit(500);
  if (error) throw new Error(`Failed to read companies: ${error.message}`);
  const companies = (data ?? []) as Array<{ id: string; city: string | null; state: string | null }>;
  if (companies.length === 0) return [];
  const ids = companies.map(c => c.id);

  const stateName = (code: unknown) => (typeof code === 'string' ? GST_STATES[code] ?? null : null);
  const sides = [
    { city: load.pickup_city ?? cityFromAddress(load.pickup_location), state: stateName(load.pickup_state_code) },
    { city: load.delivery_city ?? cityFromAddress(load.drop_location), state: stateName(load.delivery_state_code) },
  ];
  const serves = (place: unknown) => sides.some(s => (s.city && placeMatchesSide(place, s.city)) || (s.state && placeMatchesSide(place, s.state)));

  const [depots, vehicles] = await Promise.all([
    selectIn<any>('depots', 'carrier_org_id', ids, 'carrier_org_id, address'),
    selectIn<any>('vehicles', 'carrier_org_id', ids, 'carrier_org_id, current_location_name, status'),
  ]);
  const matched = new Set<string>();
  for (const c of companies) if (serves(c.city) || serves(c.state)) matched.add(c.id);
  for (const d of depots) if (serves(d.address)) matched.add(d.carrier_org_id);
  for (const v of vehicles) if (v.status !== 'archived' && serves(v.current_location_name)) matched.add(v.carrier_org_id);
  return matched.size > 0 ? [...matched] : ids;
}

/** The companies a pending load is for right now: its chosen companies, or those serving the lane. */
export async function companiesFor(load: Record<string, any>): Promise<string[]> {
  if (load.routing === 'chosen') {
    const chosen = Array.isArray(load.company_ids) ? (load.company_ids as string[]) : [];
    const orgs = await selectIn<any>('organizations', 'id', chosen, 'id, kind, status');
    return orgs.filter(o => o.kind === 'logistic_company' && o.status === 'active').map(o => o.id);
  }
  return companiesServing(load);
}

const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;

// ── Ranking the companies (internal order matching) ─────────

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
/** 0 is first. A load without a priority (an older row) counts as medium. */
export const priorityRank = (p: unknown): number => { const i = PRIORITIES.indexOf(p as Priority); return i < 0 ? 1 : i; };

/** A scorer gives each company a number; the higher the score, the earlier it is told. N2 (carrier scores) replaces it. */
export type CompanyScorer = (companyIds: string[]) => Promise<Map<string, number>>;

/** A vehicle that can take work: not archived and not waiting for approval. */
const activeVehicle = (v: { status?: string | null }) => v.status !== 'archived' && v.status !== 'pending_approval';

/**
 * Network size of each company: its own active vehicles plus the active vehicles of its active affiliated 3PL partners
 * (tpl_affiliations.status = 'active'; vehicles.carrier_org_id is the owner). A partner affiliated to two companies counts
 * for both.
 */
export const networkSizeScorer: CompanyScorer = async (companyIds) => {
  const out = new Map<string, number>(companyIds.map(id => [id, 0]));
  if (companyIds.length === 0) return out;
  const affiliations = await selectIn<any>('tpl_affiliations', 'company_id', companyIds, 'company_id, tpl_id', q => q.eq('status', 'active'));
  const owners = [...new Set([...companyIds, ...affiliations.map(a => a.tpl_id)])] as string[];
  const vehicles = await selectIn<any>('vehicles', 'carrier_org_id', owners, 'carrier_org_id, status');
  const perOwner = new Map<string, number>();
  for (const v of vehicles) if (activeVehicle(v)) perOwner.set(v.carrier_org_id, (perOwner.get(v.carrier_org_id) ?? 0) + 1);
  for (const id of companyIds) {
    const partners = new Set(affiliations.filter(a => a.company_id === id).map(a => a.tpl_id as string));
    partners.delete(id);
    let n = perOwner.get(id) ?? 0;
    for (const t of partners) n += perOwner.get(t) ?? 0;
    out.set(id, n);
  }
  return out;
};

/** The companies, biggest score first; equal scores keep a fixed order (by id), so the order is the same every time. */
export async function rankCompanies(companyIds: string[], scorer: CompanyScorer = networkSizeScorer): Promise<Array<{ id: string; score: number }>> {
  const scores = await scorer(companyIds);
  return [...new Set(companyIds)].map(id => ({ id, score: scores.get(id) ?? 0 })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Tells the matching companies about a load: the owners and admins of the companies it is for, never every staff member
 * platform-wide. Returns the organisations told. Callers must not announce a held load (see HOLD_UNVERIFIED).
 */
export async function notifyCompanies(load: Record<string, any>): Promise<string[]> {
  const priority: Priority = PRIORITIES.includes(load.priority) ? load.priority : 'medium';
  let orgIds = await companiesFor(load);
  // A high priority load goes first to the companies with the biggest network: told one company after another, in rank order
  if (priority === 'high' && orgIds.length > 1) orgIds = (await rankCompanies(orgIds)).map(r => r.id);
  const people = await ownersAndAdmins(orgIds);
  const when = shortDate(load.pickup_date);
  const kg = Math.round(Number(load.total_weight_kg ?? load.required_capacity_kg ?? 0)).toLocaleString('en-IN');
  const quote = load.quote_requested ? ' The vendor asked for quotes.' : '';
  const body = `Load ${load.load_number ?? ''}: ${kg} kg, ${lane(load)}${when ? `, pickup ${when}` : ''}.${quote}`.replace('Load : ', 'Load: ');
  const urgent = priority === 'high';
  const title = `${urgent ? 'Urgent: ' : ''}${load.routing === 'chosen' ? 'A vendor sent you a load' : 'New load for your lanes'}`;
  const data = { request_id: load.id, load_number: load.load_number ?? null, priority, ...(urgent ? { urgent: true } : {}) };
  const told: string[] = [];
  const send = async (userId: string) => {
    try {
      await notificationService.sendNotification(userId, title, body, 'vendor_request', data);
    } catch (e) {
      console.error('[routing] notification failed:', e);
    }
  };
  if (urgent) {
    // Rank order: each company's people are told together, the next company after them
    for (const orgId of orgIds) {
      const users = people.get(orgId) ?? [];
      await Promise.all(users.map(send));
      if (users.length) told.push(orgId);
    }
    return told;
  }
  // Medium and low: everyone, a few at a time (one after another, a vendor posting an open load waited on every company's people in turn).
  // The priority is on the notification; a low load may be batched later.
  const sends: Array<() => Promise<unknown>> = [];
  for (const [orgId, users] of people) {
    for (const userId of users) sends.push(() => send(userId));
    if (users.length) told.push(orgId);
  }
  for (let i = 0; i < sends.length; i += NOTIFY_CONCURRENCY) await Promise.all(sends.slice(i, i + NOTIFY_CONCURRENCY).map(f => f()));
  return told;
}

// ── Who sees a load (the backend's copy of app.can_see_load, for a company) ──

/** Whether the load is held for its vendor's business verification. */
export const isHeld = (load: Record<string, any>) => load.metadata?.hold === HOLD_UNVERIFIED;

/** The active vendor organisations among these loads' vendors, by id. */
async function activeVendorOrgs(loads: Array<Record<string, any>>): Promise<Set<string>> {
  const ids = [...new Set(loads.map(l => l.vendor_org_id).filter(Boolean))] as string[];
  const orgs = await selectIn<any>('organizations', 'id', ids, 'id, status');
  return new Set(orgs.filter(o => o.status === 'active').map(o => o.id));
}

/**
 * The awarded company, or (while pending, unawarded and not held, with an active vendor organisation) a company the load is
 * routed to: the chosen companies, or any company when it is open.
 */
export function loadVisibleToCompany(load: Record<string, any>, orgId: string, activeVendors: Set<string>): boolean {
  if (load.carrier_org_id) return load.carrier_org_id === orgId;
  if (load.status !== 'pending' || isHeld(load)) return false;
  if (load.vendor_org_id && !activeVendors.has(load.vendor_org_id)) return false;
  return load.routing !== 'chosen' || (Array.isArray(load.company_ids) && load.company_ids.includes(orgId));
}

/** Whether a caller who works for any of these logistic companies may see the load (the rule of app.can_see_load). */
export async function loadVisibleToAnyCompany(load: Record<string, any>, companyIds: string[]): Promise<boolean> {
  if (companyIds.length === 0) return false;
  const active = await activeVendorOrgs([load]);
  return companyIds.some(id => loadVisibleToCompany(load, id, active));
}

/** The loads (a list) this company may see. */
export async function filterVisibleToCompany<T extends Record<string, any>>(loads: T[], orgId: string): Promise<T[]> {
  const active = await activeVendorOrgs(loads);
  return loads.filter(l => loadVisibleToCompany(l, orgId, active));
}

/** One load as a company sees it, or a 404 (never a 403, so ids cannot be probed). */
async function readVisibleLoad(orgId: string, loadId: string): Promise<Record<string, any>> {
  const { data, error } = await supabase.from('vendor_shipment_requests').select('*').eq('id', loadId).maybeSingle();
  if (error) throw new Error(`Failed to read the load: ${error.message}`);
  if (!data) throw new HttpError(404, 'Load not found');
  const active = await activeVendorOrgs([data]);
  if (!loadVisibleToCompany(data, orgId, active)) throw new HttpError(404, 'Load not found');
  return data;
}

// ── The company's market ────────────────────────────────────

export interface QuoteView {
  id: string;
  amount_inr: number;
  valid_until: string | null;
  vehicle_class: string | null;
  pickup_eta: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const toQuoteView = (q: Record<string, any> | null | undefined): QuoteView | null => q ? ({
  id: q.id, amount_inr: Number(q.amount_inr), valid_until: q.valid_until ?? null, vehicle_class: q.vehicle_class ?? null,
  pickup_eta: q.pickup_eta ?? null, notes: q.notes ?? null, status: q.status, created_at: q.created_at, updated_at: q.updated_at,
}) : null;

/** What a company reads of a load. An explicit list, never a spread of the row. */
function toMarketLoad(l: Record<string, any>, items: any[], quote: Record<string, any> | null, vendorName: string | null, redact: boolean, networkVehicles?: number) {
  return {
    id: l.id,
    load_number: l.load_number ?? null,
    status: l.status,
    routing: l.routing ?? 'open',
    created_at: l.created_at,
    vendor: { name: vendorName },
    pickup_city: l.pickup_city ?? null,
    pickup_address: redact ? null : l.pickup_address ?? null,
    pickup_pincode: l.pickup_pincode ?? null,
    pickup_state_code: l.pickup_state_code ?? null,
    pickup_date: l.pickup_date ?? null,
    pickup_slot: l.pickup_slot ?? null,
    pickup_contact_name: redact ? null : l.pickup_contact_name ?? null,
    pickup_contact_phone: redact ? null : l.pickup_contact_phone ?? null,
    delivery_city: l.delivery_city ?? null,
    delivery_address: redact ? null : l.delivery_address ?? null,
    delivery_pincode: l.delivery_pincode ?? null,
    delivery_state_code: l.delivery_state_code ?? null,
    delivery_date: l.delivery_date ?? null,
    delivery_contact_name: redact ? null : l.delivery_contact_name ?? null,
    delivery_contact_phone: redact ? null : l.delivery_contact_phone ?? null,
    loading_dock: l.loading_dock ?? null,
    access_restrictions: redact ? null : l.access_restrictions ?? null,
    load_type: l.load_type ?? null,
    vehicle_class: l.vehicle_class ?? null,
    capacity_t: num(l.capacity_t),
    temp_min_c: num(l.temp_min_c),
    temp_max_c: num(l.temp_max_c),
    special_handling: l.special_handling ?? [],
    loading_help: !!l.loading_help,
    unloading_help: !!l.unloading_help,
    total_weight_kg: num(l.total_weight_kg ?? l.required_capacity_kg),
    total_declared_value: num(l.total_declared_value),
    // The same two numbers under the short names the market table uses
    weight_kg: num(l.total_weight_kg ?? l.required_capacity_kg),
    declared_value: num(l.total_declared_value),
    tax_basis: l.tax_basis ?? null,
    eway_required: !!l.eway_required,
    hazmat_mixed: !!l.hazmat_mixed,
    budget_inr: num(l.budget_inr),
    priority: PRIORITIES.includes(l.priority) ? l.priority : 'medium',
    price_min_inr: num(l.price_min_inr),
    price_max_inr: num(l.price_max_inr),
    ...(networkVehicles !== undefined ? { network_vehicles: networkVehicles } : {}),
    quote_requested: !!l.quote_requested,
    quote_deadline: l.quote_deadline ?? null,
    carrier_org_id: l.carrier_org_id ?? null,
    awarded_at: l.awarded_at ?? null,
    cost: num(l.cost),
    items: redact ? [] : items.map(i => ({
      line_no: i.line_no, product_name: i.product_name, hsn_code: i.hsn_code ?? null, gst_rate: num(i.gst_rate), quantity: num(i.quantity),
      unit: i.unit ?? null, weight_kg: num(i.weight_kg), declared_value: num(i.declared_value), handling: i.handling ?? [],
      is_hazmat: !!i.is_hazmat, is_perishable: !!i.is_perishable,
    })),
    my_quote: toQuoteView(quote),
  };
}

/** The quote to show for a load: the live one, else the latest. */
function pickQuote(quotes: Array<Record<string, any>>): Record<string, any> | null {
  const live = quotes.find(q => q.status === 'submitted' || q.status === 'accepted');
  if (live) return live;
  return [...quotes].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
}

async function vendorNames(loads: Array<Record<string, any>>): Promise<Map<string, string | null>> {
  const ids = [...new Set(loads.map(l => l.vendor_org_id).filter(Boolean))] as string[];
  const orgs = await selectIn<any>('organizations', 'id', ids, 'id, name');
  return new Map(orgs.map(o => [o.id, o.name ?? null]));
}

/** Board order: priority (high, medium, low), then pickup date (no date last), then newest first. */
export function boardOrder(a: Record<string, any>, b: Record<string, any>): number {
  return priorityRank(a.priority) - priorityRank(b.priority)
    || String(a.pickup_date ?? '9999-12-31').localeCompare(String(b.pickup_date ?? '9999-12-31'))
    || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
}

/**
 * The loads this company can see, by tab:
 *   new     open to it, no live quote from it yet;
 *   quoted  open to it, with a live quote from it;
 *   won     awarded to it (assigned, on the road, delivered: they all stay here);
 *   lost    it quoted and the vendor chose another company, or the quote expired and the load closed.
 * `counts` are the sizes of all four tabs.
 */
export async function listMarket(orgId: string, tab: MarketTab, opts: { isPlatformAdmin?: boolean } = {}) {
  const [open, mine, quotes] = await Promise.all([
    supabase.from('vendor_shipment_requests').select('*').eq('status', 'pending').is('carrier_org_id', null)
      .order('created_at', { ascending: false }).limit(MARKET_LIMIT),
    supabase.from('vendor_shipment_requests').select('*').eq('carrier_org_id', orgId)
      .order('created_at', { ascending: false }).limit(MARKET_LIMIT),
    supabase.from('load_quotes').select('*').eq('carrier_org_id', orgId).order('created_at', { ascending: false }).limit(1000),
  ]);
  for (const r of [open, mine, quotes]) if (r.error) throw new Error(`Failed to read the market: ${r.error.message}`);

  const myQuotes = new Map<string, Array<Record<string, any>>>();
  for (const q of quotes.data ?? []) myQuotes.set(q.load_id, [...(myQuotes.get(q.load_id) ?? []), q]);

  const visibleOpen = await filterVisibleToCompany(open.data ?? [], orgId);
  const liveQuote = (id: string) => (myQuotes.get(id) ?? []).some(q => q.status === 'submitted');
  const sets: Record<MarketTab, Array<Record<string, any>>> = {
    new: visibleOpen.filter(l => !liveQuote(l.id)),
    quoted: visibleOpen.filter(l => liveQuote(l.id)),
    won: mine.data ?? [],
    lost: [],
  };
  // Lost: a declined quote, or an expired one on a load that is no longer open to it, on a load it does not hold
  const known = new Set([...visibleOpen, ...(mine.data ?? [])].map(l => l.id));
  const lostIds = [...myQuotes.entries()]
    .filter(([id, qs]) => !known.has(id) && qs.some(q => q.status === 'declined' || q.status === 'expired'))
    .map(([id]) => id);
  sets.lost = (await selectIn<any>('vendor_shipment_requests', 'id', lostIds, '*'))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  // The board: high priority first, then the earliest pickup, then the newest post
  for (const t of ['new', 'quoted'] as const) sets[t].sort(boardOrder);

  const counts = { new: sets.new.length, quoted: sets.quoted.length, won: sets.won.length, lost: sets.lost.length };
  const loads = sets[tab];
  // The size of this company's network is for platform staff only: a company must not see how it is ranked
  const networkVehicles = opts.isPlatformAdmin ? (await networkSizeScorer([orgId])).get(orgId) ?? 0 : undefined;
  const [items, names] = await Promise.all([
    tab === 'lost' ? Promise.resolve([] as any[]) : selectIn<any>('load_items', 'load_id', loads.map(l => l.id), '*'),
    vendorNames(loads),
  ]);
  const itemsOf = new Map<string, any[]>();
  for (const i of items.sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0))) itemsOf.set(i.load_id, [...(itemsOf.get(i.load_id) ?? []), i]);

  return {
    tab,
    counts,
    items: loads.map(l => toMarketLoad(l, itemsOf.get(l.id) ?? [], pickQuote(myQuotes.get(l.id) ?? []), names.get(l.vendor_org_id) ?? null, tab === 'lost', networkVehicles)),
  };
}

/** One load as the company sees it (every posted field, its items and its own quote), or a 404. */
export async function companyLoadDetail(orgId: string, loadId: string) {
  const load = await readVisibleLoad(orgId, loadId);
  const [items, quotes, names] = await Promise.all([
    selectIn<any>('load_items', 'load_id', [loadId], '*'),
    selectIn<any>('load_quotes', 'load_id', [loadId], '*', q => q.eq('carrier_org_id', orgId)),
    vendorNames([load]),
  ]);
  items.sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0));
  return toMarketLoad(load, items, pickQuote(quotes), names.get(load.vendor_org_id) ?? null, false);
}

// ── Quoting ─────────────────────────────────────────────────

export interface QuoteInput {
  amount_inr: number;
  valid_until?: string | null;
  vehicle_class?: string | null;
  pickup_eta?: string | null;
  notes?: string | null;
}

const isUniqueViolation = (e: { code?: string } | null) => e?.code === '23505';

/** Creates or replaces the company's live quote. A 404 when the load is not visible; a 409 when it is no longer open. */
export async function submitQuote(orgId: string, userId: string, loadId: string, input: QuoteInput): Promise<{ quote: QuoteView; replaced: boolean }> {
  const load = await readVisibleLoad(orgId, loadId);
  if (load.carrier_org_id || load.status !== 'pending') throw new HttpError(409, 'This load is no longer open for quotes.');
  if (input.valid_until && Date.parse(input.valid_until) <= Date.now()) throw new HttpError(400, 'A quote must be valid until a time in the future.');

  const fields = {
    amount_inr: input.amount_inr,
    valid_until: input.valid_until ?? null,
    vehicle_class: input.vehicle_class ?? null,
    pickup_eta: input.pickup_eta ?? null,
    notes: input.notes ?? null,
  };
  const replace = async () => {
    const { data, error } = await supabase.from('load_quotes').update({ ...fields, updated_at: new Date().toISOString() })
      .eq('load_id', loadId).eq('carrier_org_id', orgId).eq('status', 'submitted').select().maybeSingle();
    if (error) throw new Error(`Failed to update the quote: ${error.message}`);
    return data;
  };

  let quote = await replace();
  let replaced = !!quote;
  if (!quote) {
    const { data, error } = await supabase.from('load_quotes')
      .insert({ load_id: loadId, carrier_org_id: orgId, ...fields, status: 'submitted', created_by: userId }).select().single();
    if (isUniqueViolation(error)) {
      // Two requests at once: the other one made the live quote, so this one replaces it
      quote = await replace();
      replaced = true;
    } else {
      if (error || !data) throw new Error(`Failed to save the quote: ${error?.message ?? 'no row'}`);
      quote = data;
    }
  }
  if (!quote) throw new HttpError(409, 'This load is no longer open for quotes.');

  try {
    const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
    await notificationService.sendNotification(
      load.vendor_id, replaced ? 'A quote was updated' : 'You have a new quote',
      `${org?.name ?? 'A logistic company'} quoted ${formatINR(input.amount_inr)} for load ${load.load_number ?? ''} (${lane(load)}).`,
      'quote_received', { request_id: loadId, quote_id: quote.id },
    );
  } catch (e) {
    console.error('[routing] quote notification failed:', e);
  }
  return { quote: toQuoteView(quote)!, replaced };
}

/** Withdraws the company's live quote. A 404 when it has none. */
export async function withdrawQuote(orgId: string, loadId: string): Promise<QuoteView> {
  const { data, error } = await supabase.from('load_quotes').update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('load_id', loadId).eq('carrier_org_id', orgId).eq('status', 'submitted').select().maybeSingle();
  if (error) throw new Error(`Failed to withdraw the quote: ${error.message}`);
  if (!data) throw new HttpError(404, 'You have no live quote on this load.');
  return toQuoteView(data)!;
}

// ── Awarding ────────────────────────────────────────────────

interface AwardResult {
  load: Record<string, any>;
  quote: Record<string, any>;
  declined: Array<{ id: string; carrier_org_id: string }>;
}

const AWARD_ERRORS: Record<string, [number, string]> = {
  load_not_found: [404, 'Load not found'],
  load_already_awarded: [409, 'This load has already been awarded.'],
  quote_required: [409, 'The vendor asked for quotes on this load. Send a quote instead of accepting.'],
  amount_required: [400, 'Enter the amount you will carry this load for.'],
  quote_not_found: [404, 'Quote not found'],
  quote_not_open: [409, 'This quote is no longer open.'],
  quote_expired: [409, 'This quote has expired. Ask the company for a new one.'],
};

async function award(args: Record<string, unknown>): Promise<AwardResult> {
  const { data, error } = await supabase.rpc('award_load', args);
  if (error) {
    const known = Object.keys(AWARD_ERRORS).find(code => error.message?.includes(code));
    if (known) throw new HttpError(AWARD_ERRORS[known][0], AWARD_ERRORS[known][1]);
    throw new Error(`Failed to award the load: ${error.message}`);
  }
  const out = data as AwardResult | null;
  if (!out?.load?.id || !out.quote?.id) throw new Error('Failed to award the load: no result came back');
  return out;
}

/** Tells the people the award concerns. None of it can fail the award: it is already made. */
async function afterAward(result: AwardResult, how: 'quote' | 'direct'): Promise<void> {
  const { load, quote, declined } = result;
  try {
    const orgIds = [quote.carrier_org_id, ...declined.map(d => d.carrier_org_id)];
    const [people, orgs] = await Promise.all([ownersAndAdmins(orgIds), selectIn<any>('organizations', 'id', [quote.carrier_org_id, load.vendor_org_id].filter(Boolean), 'id, name')]);
    const name = (id: string | null) => orgs.find(o => o.id === id)?.name ?? null;
    const price = formatINR(quote.amount_inr);
    const route = lane(load);
    const tasks: Array<Promise<unknown>> = [];
    if (how === 'quote') {
      for (const u of people.get(quote.carrier_org_id) ?? []) {
        tasks.push(notificationService.sendNotification(u, 'Your quote was accepted', `${name(load.vendor_org_id) ?? 'The vendor'} accepted your quote of ${price} for load ${load.load_number ?? ''} (${route}). Assign a vehicle next.`, 'quote_accepted', { request_id: load.id, quote_id: quote.id }));
      }
    } else {
      tasks.push(notificationService.sendNotification(load.vendor_id, 'Load accepted', `${name(quote.carrier_org_id) ?? 'A logistic company'} accepted your load at ${price}. A truck will be assigned next.`, 'request_approved', { request_id: load.id, cost: Number(quote.amount_inr) }));
    }
    for (const d of declined) {
      for (const u of people.get(d.carrier_org_id) ?? []) {
        tasks.push(notificationService.sendNotification(u, 'Quote not accepted', `The load ${load.load_number ?? ''} (${route}) went to another company.`, 'quote_declined', { request_id: load.id, quote_id: d.id }));
      }
    }
    for (const r of await Promise.allSettled(tasks)) if (r.status === 'rejected') console.error('[routing] award notification failed:', r.reason);
  } catch (e) {
    console.error('[routing] award notification failed:', e);
  }
}

/**
 * A company takes the load now. With a recommended range the amount is required and must be inside it; without one, the
 * amount given or the vendor's budget. Allowed only when the vendor did not ask for quotes. Creates an accepted quote and awards it at once.
 */
export async function acceptDirect(orgId: string, userId: string, loadId: string, opts: { amount?: number | null; costPerKm?: number | null } = {}) {
  const load = await readVisibleLoad(orgId, loadId);
  if (load.carrier_org_id || load.status !== 'pending') throw new HttpError(409, 'This load has already been awarded.');
  if (load.quote_requested) throw new HttpError(409, AWARD_ERRORS.quote_required[1]);
  // A load with a recommended range is booked at any price inside it, and the amount must be given
  const min = num(load.price_min_inr), max = num(load.price_max_inr);
  const ranged = min != null || max != null;
  const rangeText = min != null && max != null ? `${formatINR(min)} to ${formatINR(max)}` : min != null ? `at least ${formatINR(min)}` : `at most ${formatINR(max)}`;
  if (ranged && opts.amount == null) throw new HttpError(400, `Enter the amount you will carry this load for. It must be within the recommended range of ${rangeText}.`);
  const amount = opts.amount ?? num(load.budget_inr);
  if (!amount || amount <= 0) throw new HttpError(400, 'This load has no budget. Enter the amount you will carry it for.');
  if ((min != null && amount < min) || (max != null && amount > max)) throw new HttpError(400, `The amount must be within the recommended range for this load: ${rangeText}.`);
  const result = await award({ p_load: loadId, p_quote: null, p_carrier: orgId, p_amount: amount, p_actor: userId, p_direct: true, p_cost_per_km: opts.costPerKm ?? null });
  result.load = await freshLoad(loadId) ?? result.load;
  await afterAward(result, 'direct');
  return { load: result.load, quote: toQuoteView(result.quote)! };
}

// ── The vendor's side ───────────────────────────────────────

/** Whether this caller is the vendor of the load (their organisation, or they posted it), or a platform admin. */
function vendorSide(c: Caller, load: Record<string, any>): boolean {
  if (c.isPlatformAdmin) return true;
  if (load.vendor_id === c.userId) return true;
  return !!load.vendor_org_id && c.orgIds.includes(load.vendor_org_id);
}

async function readVendorLoad(c: Caller, loadId: string): Promise<Record<string, any>> {
  const { data, error } = await supabase.from('vendor_shipment_requests').select('*').eq('id', loadId).maybeSingle();
  if (error) throw new Error(`Failed to read the load: ${error.message}`);
  if (!data || !vendorSide(c, data)) throw new HttpError(404, 'Load not found');
  return data;
}

const loadSummary = (l: Record<string, any>) => ({
  id: l.id, load_number: l.load_number ?? null, status: l.status, routing: l.routing ?? 'open', quote_requested: !!l.quote_requested,
  quote_deadline: l.quote_deadline ?? null, budget_inr: num(l.budget_inr), priority: PRIORITIES.includes(l.priority) ? l.priority : 'medium',
  price_min_inr: num(l.price_min_inr), price_max_inr: num(l.price_max_inr), carrier_org_id: l.carrier_org_id ?? null,
  awarded_at: l.awarded_at ?? null, awarded_quote_id: l.awarded_quote_id ?? null,
});

/** The quotes on the vendor's load: the company's name and completed trips, the amount, validity, ETA and notes. */
export async function listVendorQuotes(c: Caller, loadId: string) {
  const load = await readVendorLoad(c, loadId);
  const quotes = (await selectIn<any>('load_quotes', 'load_id', [loadId], '*')).filter(q => q.status !== 'withdrawn');
  const orgIds = [...new Set(quotes.map(q => q.carrier_org_id))] as string[];
  const [orgs, delivered] = await Promise.all([
    selectIn<any>('organizations', 'id', orgIds, 'id, name'),
    selectIn<any>('shipments', 'carrier_org_id', orgIds, 'carrier_org_id', qb => qb.eq('status', 'delivered').neq('is_master', true).limit(5000)),
  ]);
  const names = new Map(orgs.map(o => [o.id, o.name ?? null]));
  const trips = new Map<string, number>();
  for (const s of delivered) trips.set(s.carrier_org_id, (trips.get(s.carrier_org_id) ?? 0) + 1);
  const winner = quotes.find(q => q.id === load.awarded_quote_id && q.status === 'accepted') ?? null;
  const rank = (s: string) => (s === 'accepted' ? 0 : s === 'submitted' ? 1 : 2);
  quotes.sort((a, b) => rank(a.status) - rank(b.status) || Number(a.amount_inr) - Number(b.amount_inr));
  return {
    load: loadSummary(load),
    quote_deadline: load.quote_deadline ?? null,
    quote_requested: !!load.quote_requested,
    awarded: winner ? { company_name: names.get(winner.carrier_org_id) ?? null, amount_inr: Number(winner.amount_inr) } : null,
    quotes: quotes.map(q => ({
      id: q.id, carrier_org_id: q.carrier_org_id, company_name: names.get(q.carrier_org_id) ?? null,
      trips_completed: trips.get(q.carrier_org_id) ?? 0, completed_trips: trips.get(q.carrier_org_id) ?? 0,
      amount_inr: Number(q.amount_inr), valid_until: q.valid_until ?? null, vehicle_class: q.vehicle_class ?? null, pickup_eta: q.pickup_eta ?? null,
      notes: q.notes ?? null, status: q.status, created_at: q.created_at, updated_at: q.updated_at,
    })),
  };
}

/** The vendor picks a quote: the load is awarded to that company, the other quotes are declined. Atomic. */

/** The load as it is stored right now (the award function returns its pre-update read). */
async function freshLoad(loadId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from('vendor_shipment_requests').select('*').eq('id', loadId).maybeSingle();
  return data ?? null;
}

export async function acceptQuote(c: Caller, loadId: string, quoteId: string) {
  await readVendorLoad(c, loadId);
  const result = await award({ p_load: loadId, p_quote: quoteId, p_carrier: null, p_amount: null, p_actor: c.userId, p_direct: false, p_cost_per_km: null });
  // The award function answers with the row it read before updating: hand back what is now stored
  result.load = await freshLoad(loadId) ?? result.load;
  await afterAward(result, 'quote');
  return { load: loadSummary(result.load), quote: toQuoteView(result.quote)! };
}

// ── The scheduler ───────────────────────────────────────────

/** Quotes whose validity has passed become expired, and their company is told. Returns how many. */
export async function expireQuotes(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from('load_quotes').update({ status: 'expired', updated_at: now.toISOString() })
    .eq('status', 'submitted').lt('valid_until', now.toISOString()).select('id, load_id, carrier_org_id');
  if (error) throw new Error(`Failed to expire quotes: ${error.message}`);
  const expired = data ?? [];
  if (expired.length === 0) return 0;
  try {
    const [people, loads] = await Promise.all([
      ownersAndAdmins([...new Set(expired.map((q: any) => q.carrier_org_id))] as string[]),
      selectIn<any>('vendor_shipment_requests', 'id', expired.map((q: any) => q.load_id), 'id, load_number'),
    ]);
    const numberOf = new Map(loads.map(l => [l.id, l.load_number]));
    for (const q of expired as any[]) {
      for (const u of people.get(q.carrier_org_id) ?? []) {
        await notificationService.sendNotification(u, 'Your quote expired', `Your quote on load ${numberOf.get(q.load_id) ?? ''} ran past its validity. Send a new one if the load is still open.`, 'quote_expired', { request_id: q.load_id, quote_id: q.id });
      }
    }
  } catch (e) {
    console.error('[routing] expiry notification failed:', e);
  }
  return expired.length;
}

/**
 * A load that asked for quotes, whose deadline has passed with no live quote, is escalated once: the platform admins are
 * told, and so is the vendor ("Companies need a little longer"). Returns how many loads were escalated.
 */
export async function escalateQuietLoads(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from('vendor_shipment_requests').select('*')
    .eq('status', 'pending').eq('quote_requested', true).is('carrier_org_id', null).is('quote_escalated_at', null)
    .lt('quote_deadline', now.toISOString()).limit(200);
  if (error) throw new Error(`Failed to read quiet loads: ${error.message}`);
  const candidates = (data ?? []).filter((l: any) => !isHeld(l));
  if (candidates.length === 0) return 0;
  const quotes = await selectIn<any>('load_quotes', 'load_id', candidates.map((l: any) => l.id), 'load_id, status');
  const quoted = new Set(quotes.filter(q => q.status === 'submitted').map(q => q.load_id));

  let escalated = 0;
  for (const load of candidates) {
    if (quoted.has(load.id)) continue;
    // Claim it first, so two servers ticking at once escalate it only once
    const { data: claimed, error: claimErr } = await supabase.from('vendor_shipment_requests')
      .update({ quote_escalated_at: now.toISOString() }).eq('id', load.id).is('quote_escalated_at', null).select('id').maybeSingle();
    if (claimErr) throw new Error(`Failed to escalate a load: ${claimErr.message}`);
    if (!claimed) continue;
    escalated++;
    try {
      await notificationService.notifyStaff('Load with no quotes', `Load ${load.load_number ?? ''} (${lane(load)}) had no quote by its deadline. It needs a nudge.`, 'vendor_request', { request_id: load.id, load_number: load.load_number ?? null }, PLATFORM);
      await notificationService.sendNotification(load.vendor_id, 'Companies need a little longer', `Load ${load.load_number ?? ''} has no quotes yet. We have asked companies to take a look.`, 'quote_delayed', { request_id: load.id });
    } catch (e) {
      console.error('[routing] escalation notification failed:', e);
    }
  }
  return escalated;
}
