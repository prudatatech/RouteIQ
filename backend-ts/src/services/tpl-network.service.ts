/**
 * 3PL network: escalating loads to partners, their answers, the orders that
 * follow, earnings and partner statistics.
 *
 * Flow: staff escalate a vendor request or an unassigned shipment -> one offer per
 * active partner whose corridor runs from the pickup to the drop -> the first
 * partner to accept gets an order (the rest see "taken") -> the partner moves the
 * order to picked up, in transit and delivered -> staff rate it and mark it paid.
 */
import { carrierOf } from '../core/org-guards';
import { supabase } from '../core/supabase';
import { HttpError, parseRejectionReason } from '../core/errors';
import { indianDateKey } from '../core/istDate';
import { formatINR, formatKg } from '../core/format';
import { corridorMatches, corridorRate, priceAtRate, type CorridorRate } from '../utils/corridor-match';
import { roadKm, toPoint } from '../utils/eta';
import { notificationService } from './notification.service';
import { emailService, escapeHtml } from './email.service';
import { ShipmentService } from './shipment.service';
import { vendorService, type LoadEvent } from './vendor.service';
import { InvoiceService } from './invoice.service';
import { carrierStamp, currentOrgContext, loadMemberships } from '../core/org-context';
import { isDispatchable } from '../core/vehicles';
import { assertVehicleFits } from './loads/vehicle-fit';
import { assertCapacity, insertManifest, putLoadOnVehicle } from './loads/create-manifest';
import { memberOrgId } from '../core/org-scope';
import { statementCoveringOrder } from './tpl-statement.service';
import { activePartnersOf, fleetFlagsOf, ruleExclusion, type AffiliatedPartner } from './tpl-affiliation';

export type SourceType = 'request' | 'shipment';

/** Request states from which a request can be escalated (again). */
const ESCALATABLE_REQUEST_STATUSES = ['pending', 'approved', 'escalated'];
/** Where a request goes back to when every offer has been withdrawn or declined. */
const DEFAULT_RETURN_STATUS = 'approved';

const MAX_AMOUNT = 10_000_000;

export const ORDER_STATUS_FLOW = ['accepted', 'picked_up', 'in_transit', 'delivered'] as const;
type OrderStatus = (typeof ORDER_STATUS_FLOW)[number];

export interface Load {
  sourceType: SourceType;
  id: string;
  label: string;
  pickup: string;
  drop: string;
  weightKg: number | null;
  /** Vendor who posted it, for request loads. */
  vendorId: string | null;
  /** Status before escalation, for request loads. */
  requestStatus: string | null;
  metadata: Record<string, unknown> | null;
  /** Road distance between pickup and drop when both have coordinates; needed to price a per-km rate. */
  distanceKm: number | null;
  /** The company that runs the load (the awarded company, or the shipment's carrier); null when unrouted. */
  carrierOrgId: string | null;
  /** The vehicle class the load needs, when it says. */
  vehicleClass: string | null;
}

export interface PartnerMatch {
  partner: { id: string; company_name: string; user_id: string | null; email: string | null };
  /** The partner's organisation (null only when organisations are not set up). */
  orgId: string | null;
  /** The corridor that matched; null for a partner the company chose by hand that has none from this pickup to this drop. */
  corridor: { id: string; corridor_name: string } | null;
  /** The corridor's numeric rate, if it has one. */
  rate: CorridorRate | null;
  /** The price for this load at that rate: per trip as is, per km x the distance. Null when the rate is missing or the distance is unknown. */
  price: number | null;
}

export interface PartnerSession {
  id: string;
  company_name: string;
  status: string;
  sla_commitment: string | null;
  email: string | null;
  /** The partner's organisation (kind tpl_partner); null before organisations are set up. */
  org_id: string | null;
}

/** Of the 3PL organisations a user belongs to, the one that is partner `partnerId`'s. */
async function partnerOrgIdOf(partnerId: string, orgIds: string[]): Promise<string | null> {
  const { data } = await supabase.from('organizations').select('id, profile').in('id', orgIds);
  const hit = (data ?? []).find(o => (o.profile as { legacy_tpl_partner_id?: string } | null)?.legacy_tpl_partner_id === partnerId);
  return hit?.id ?? null;
}

/** Display names of organisations, by id. */
async function orgNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data } = await supabase.from('organizations').select('id, name').in('id', unique);
  for (const o of data ?? []) names.set(o.id, o.name);
  return names;
}

/** Rows grouped by the company that handed the work over (`carrier_org_id`), in the order they arrive. */
function groupByCompany<T extends { carrier_org_id?: string | null }>(rows: T[], names: Map<string, string>, key: 'offers' | 'orders') {
  const groups = new Map<string, { org_id: string | null; name: string | null } & Record<string, unknown>>();
  for (const row of rows) {
    const id = row.carrier_org_id ?? null;
    const k = id ?? '';
    if (!groups.has(k)) groups.set(k, { org_id: id, name: id ? names.get(id) ?? null : null, [key]: [] });
    (groups.get(k)![key] as T[]).push(row);
  }
  return [...groups.values()];
}
/** A partner left out of an offer, and why (the company's rules, or the partner itself). */
export interface ExcludedPartner { partner_id: string; name: string; reason: string }

export interface PartnerMatchResult { matches: PartnerMatch[]; excluded: ExcludedPartner[] }

const sourceColumn = (type: SourceType) => (type === 'request' ? 'request_id' : 'shipment_id');
const inr = formatINR;
const shortPlace = (p: string | null | undefined) => (p ?? '').split(',')[0].trim() || 'pickup';

function dbError(action: string, error: { message: string } | null): never {
  throw new Error(`${action}: ${error?.message}`);
}

/** Hours in an SLA commitment such as "4 Hours"; null when there is no number. */
/** A stop that was cancelled (the shipment was taken off its vehicle) or sits on a cancelled trip no longer puts the shipment on a trip. */
export function hasLiveStop(stops: { status?: string | null; routes?: { status?: string | null } | { status?: string | null }[] | null }[]): boolean {
  return stops.some(st => {
    const trip = Array.isArray(st.routes) ? st.routes[0] : st.routes;
    return st.status !== 'cancelled' && trip?.status !== 'cancelled';
  });
}

export function slaHours(sla: unknown): number | null {
  if (typeof sla !== 'string') return null;
  const m = sla.match(/(\d+(?:\.\d+)?)/);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

function parseDate(value: unknown, label: string): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} is not a valid date and time`);
  return d;
}

// ── Loads ────────────────────────────────────────────────────────────

async function loadSource(sourceType: SourceType, id: string): Promise<Load> {
  if (sourceType === 'request') {
    const { data: r, error } = await supabase
      .from('vendor_shipment_requests')
      .select('id, vendor_id, pickup_location, drop_location, pickup_lat, pickup_lng, drop_lat, drop_lng, required_capacity_kg, status, metadata, carrier_org_id, vehicle_class')
      .eq('id', id)
      .maybeSingle();
    if (error) dbError('Failed to load request', error);
    if (!r) throw new HttpError(404, 'Request not found');
    if (!ESCALATABLE_REQUEST_STATUSES.includes(r.status)) {
      throw new HttpError(409, `This request is already ${String(r.status).replace(/_/g, ' ')}, so it cannot be escalated`);
    }
    return {
      sourceType, id: r.id, label: `${shortPlace(r.pickup_location)} to ${shortPlace(r.drop_location)}`,
      pickup: r.pickup_location ?? '', drop: r.drop_location ?? '',
      weightKg: r.required_capacity_kg != null ? Number(r.required_capacity_kg) : null,
      vendorId: r.vendor_id ?? null, requestStatus: r.status, metadata: r.metadata ?? null,
      distanceKm: roadKm(toPoint(r.pickup_lat, r.pickup_lng), toPoint(r.drop_lat, r.drop_lng)),
      carrierOrgId: r.carrier_org_id ?? null, vehicleClass: r.vehicle_class ?? null,
    };
  }

  const { data: s, error } = await supabase
    .from('shipments')
    .select('id, tracking_id, status, origin_name, origin_address, origin_lat, origin_lng, total_weight_kg, bid_id, carrier_org_id, required_vehicle_type')
    .eq('id', id)
    .maybeSingle();
  if (error) dbError('Failed to load shipment', error);
  if (!s) throw new HttpError(404, 'Shipment not found');
  if (s.status !== 'created') throw new HttpError(409, `This shipment is already ${String(s.status).replace(/_/g, ' ')}, so it cannot be escalated`);
  if (s.bid_id) throw new HttpError(409, 'This shipment is open to vendor bids');

  const { data: points, error: pErr } = await supabase
    .from('delivery_points')
    .select('id, name, address, latitude, longitude')
    .eq('shipment_id', id);
  if (pErr) dbError('Failed to load delivery points', pErr);
  const stops = points ?? [];
  if (stops.length > 0) {
    const { data: onRoute, error: rErr } = await supabase
      .from('route_stops')
      .select('id, status, routes(status)')
      .in('delivery_point_id', stops.map(p => p.id));
    if (rErr) dbError('Failed to check routes', rErr);
    if (hasLiveStop(onRoute ?? [])) throw new HttpError(409, 'This shipment is already on a trip');
  }
  const { data: live, error: lErr } = await supabase
    .from('tpl_orders').select('id').eq('shipment_id', id).neq('status', 'cancelled');
  if (lErr) dbError('Failed to check partner orders', lErr);
  if ((live ?? []).length > 0) throw new HttpError(409, 'A 3PL partner already has this shipment');
  const { data: bidding, error: bErr } = await supabase
    .from('capacity_windows').select('id').eq('fallback_shipment_id', id).eq('status', 'open').is('winning_bid_id', null);
  if (bErr) dbError('Failed to check bidding windows', bErr);
  if ((bidding ?? []).length > 0) throw new HttpError(409, 'A bidding window is open for this shipment. Close it first');

  // The server stores extra stops first and the destination last
  const last = stops[stops.length - 1];
  const place = (name?: string | null, address?: string | null) => [name, address].filter(Boolean).join(', ');
  const pickup = place(s.origin_name, s.origin_address);
  const drop = place(last?.name, last?.address);
  return {
    sourceType, id: s.id, label: s.tracking_id, pickup, drop,
    weightKg: s.total_weight_kg != null ? Number(s.total_weight_kg) : null,
    vendorId: null, requestStatus: null, metadata: null,
    distanceKm: roadKm(toPoint(s.origin_lat, s.origin_lng), toPoint(last?.latitude, last?.longitude)),
    carrierOrgId: s.carrier_org_id ?? null, vehicleClass: s.required_vehicle_type ?? null,
  };
}

// ── Matching ─────────────────────────────────────────────────────────

/**
 * The company whose partners a load may go to: the one the caller acts for, else the company that runs the load.
 * null means "not scoped" (organisations are not set up yet). A caller of another company gets a 404, as for any
 * record that is not theirs; a platform admin acting as the platform needs the load to have a company.
 */
function companyFor(load: Load, explicit?: string | null): string | null {
  const mine = memberOrgId();
  if (mine && load.carrierOrgId && mine !== load.carrierOrgId) {
    throw new HttpError(404, load.sourceType === 'request' ? 'Request not found' : 'Shipment not found');
  }
  const company = mine ?? explicit ?? load.carrierOrgId ?? null;
  if (!company && currentOrgContext()?.configured) throw new HttpError(409, 'This load has no company yet, so there are no partners to offer it to');
  return company;
}

const priorityOf = (c: { priority: unknown }) => {
  const m = String(c.priority ?? '').match(/\d+/);
  return m ? Number(m[0]) : 99;
};

/**
 * The active partners of `companyOrgId` (its active affiliations only, never another company's), each with the best
 * matching corridor, minus the ones the company's affiliation rules keep out (with the reason). A null company means
 * organisations are not set up: every active partner and no rules (how it worked before).
 * `opts.partnerIds` offers only to those partners, chosen by hand: they need no matching corridor, the rules still apply.
 */
export async function findMatchingPartners(
  companyOrgId: string | null,
  pickup: string,
  drop: string,
  distanceKm: number | null = null,
  opts: { vehicleClass?: string | null; partnerIds?: string[] | null } = {},
): Promise<PartnerMatchResult> {
  const result: PartnerMatchResult = { matches: [], excluded: [] };
  const chosen = opts.partnerIds && opts.partnerIds.length > 0 ? new Set(opts.partnerIds) : null;
  if (!chosen && (!pickup.trim() || !drop.trim())) return result;

  // Who may be offered the load: the company's active partners, by partner row id
  let affiliated: Map<string, AffiliatedPartner> | null = null;
  if (companyOrgId) {
    affiliated = new Map();
    for (const a of await activePartnersOf(companyOrgId)) if (a.partnerId) affiliated.set(a.partnerId, a);
    if (chosen) {
      for (const id of chosen) {
        if (!affiliated.has(id)) throw new HttpError(400, 'One of the chosen partners is not an active partner of your company');
      }
    }
  }

  let query = supabase.from('tpl_partners').select('id, company_name, user_id, email').eq('status', 'active');
  if (affiliated) {
    const ids = [...(chosen ?? affiliated.keys())];
    if (ids.length === 0) return result;
    query = query.in('id', ids);
  } else if (chosen) {
    query = query.in('id', [...chosen]);
  }
  const { data: partners, error } = await query;
  if (error) dbError('Failed to load partners', error);
  if (!partners || partners.length === 0) return result;

  const { data: corridors, error: cErr } = await supabase
    .from('tpl_corridors')
    .select('id, partner_id, corridor_name, proposed_rate, rate_amount, rate_unit, priority')
    .in('partner_id', partners.map(p => p.id));
  if (cErr) dbError('Failed to load corridors', cErr);

  const links = [...(affiliated?.values() ?? [])];
  const needsFleet = links.some(a => a.rules.gps_required || a.rules.insurance_required);
  const fleets = needsFleet ? await fleetFlagsOf(links.map(a => a.orgId)) : new Map();

  for (const partner of partners) {
    const link = affiliated?.get(partner.id);
    const rules = link?.rules ?? {};
    const mine = (corridors ?? []).filter(c => c.partner_id === partner.id && corridorMatches(c.corridor_name, pickup, drop));
    const allowedLanes = rules.corridor_ids && rules.corridor_ids.length > 0 ? new Set(rules.corridor_ids) : null;
    const usable = allowedLanes ? mine.filter(c => allowedLanes.has(c.id)) : mine;
    const best = [...usable].sort((a, b) => priorityOf(a) - priorityOf(b))[0];

    if (!best) {
      if (mine.length > 0) {
        result.excluded.push({ partner_id: partner.id, name: partner.company_name, reason: 'Its lane from this pickup to this drop is not one your rules allow' });
        continue;
      }
      if (!chosen) continue; // no corridor: not a candidate, nothing to explain
    }
    // A rate the partner did not enter as a number and a unit is never turned into a price
    const rate = best ? corridorRate(best) : null;
    const price = priceAtRate(rate, distanceKm);
    const why = ruleExclusion(rules, {
      vehicleClass: opts.vehicleClass ?? null, distanceKm, rate, price,
      fleet: link ? fleets.get(link.orgId) ?? null : null,
    });
    if (why) {
      result.excluded.push({ partner_id: partner.id, name: partner.company_name, reason: why });
      continue;
    }
    result.matches.push({
      partner, orgId: link?.orgId ?? null,
      corridor: best ? { id: best.id, corridor_name: best.corridor_name } : null,
      rate, price,
    });
  }
  return result;
}

// ── Escalation ───────────────────────────────────────────────────────

async function notifyPartner(match: PartnerMatch, load: Load, price: number | null, offerId: string): Promise<void> {
  const body = `${shortPlace(load.pickup)} to ${shortPlace(load.drop)}${load.weightKg ? `, ${formatKg(load.weightKg)}` : ''}${price ? ` at ${inr(price)}` : ''}. Open your dashboard to accept or decline.`;
  try {
    if (match.partner.user_id) {
      await notificationService.sendNotification(match.partner.user_id, 'New load offer', body, 'tpl_offer', { offer_id: offerId, partner_id: match.partner.id });
    }
    if (match.partner.email) {
      await emailService.send(
        match.partner.email,
        'New load offer on MargixIndia',
        `<p>Hello ${escapeHtml(match.partner.company_name ?? '')},</p><p>A load ${match.corridor ? `matches your corridor ${escapeHtml(match.corridor.corridor_name)}` : 'was offered to you'}: ${escapeHtml(body)}</p><p>The first partner to accept gets the load.</p>`,
      );
    }
  } catch (e) {
    console.error('[tpl-network] Partner notification failed:', e);
  }
}

async function returnRequestIfIdle(sourceType: SourceType, sourceId: string): Promise<void> {
  if (sourceType !== 'request') return;
  const { data: open, error } = await supabase
    .from('tpl_offers').select('id').eq('request_id', sourceId).eq('status', 'offered');
  if (error) dbError('Failed to check offers', error);
  if ((open ?? []).length > 0) return;
  const { data: r } = await supabase
    .from('vendor_shipment_requests').select('metadata').eq('id', sourceId).maybeSingle();
  const back = (r?.metadata as { escalated_from?: string } | null)?.escalated_from ?? DEFAULT_RETURN_STATUS;
  await supabase
    .from('vendor_shipment_requests')
    .update({ status: back, updated_at: new Date().toISOString() })
    .eq('id', sourceId)
    .eq('status', 'escalated');
}

export interface EscalationResult {
  created: number;
  already_offered: number;
  matched: number;
  offers: unknown[];
  /** Partners the company's rules kept out, with the reason. */
  excluded: ExcludedPartner[];
}

/** `partner_ids` of an escalation: absent for "every matching partner", else 1 to 10 distinct partner ids. */
export function parsePartnerIds(input: unknown): string[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) throw new HttpError(400, 'partner_ids must be a list of partner ids');
  const ids = [...new Set(input.map(v => String(v)))];
  if (ids.length < 1 || ids.length > 10) throw new HttpError(400, 'Choose between 1 and 10 partners');
  if (!ids.every(id => /^[0-9a-fA-F-]{36}$/.test(id))) throw new HttpError(400, 'A partner id is not valid');
  return ids;
}

interface Execution {
  vehicle: Record<string, any>;
  driverId: string;
  /** The vendor request being carried (its manifest is made on accept); null for a shipment, which has no manifest. */
  load: Record<string, any> | null;
  capacity: { required: number; free: number | null };
}

/**
 * The vehicle and driver a partner runs an accepted load with. Null for the older flow with no vehicle (a
 * partner that has none registered). Both must belong to the partner's organisation, the driver must be the
 * one the vehicle is given to (the driver app finds a trip by the driver's vehicle), the vehicle must be
 * ready and fit the goods, and have the room for them.
 */
async function resolveExecution(
  partner: { id: string; org_id?: string | null },
  offer: Record<string, any>,
  sourceType: SourceType,
  sourceId: string,
  input: { vehicle_id?: unknown; driver_id?: unknown },
): Promise<Execution | null> {
  const vehicleId = typeof input.vehicle_id === 'string' && input.vehicle_id ? input.vehicle_id : null;
  const driverId = typeof input.driver_id === 'string' && input.driver_id ? input.driver_id : null;
  const orgId = partner.org_id ?? null;

  if (!vehicleId) {
    if (driverId) throw new HttpError(400, 'Choose the vehicle that will carry this load');
    if (orgId) {
      const { data: owned, error } = await supabase
        .from('vehicles').select('id').eq('carrier_org_id', orgId).neq('status', 'archived').limit(1);
      if (error) dbError('Failed to check your vehicles', error);
      if ((owned ?? []).length > 0) throw new HttpError(400, 'Choose the vehicle and driver that will carry this load. Update the app if you do not see them.');
    }
    return null;
  }
  if (!driverId) throw new HttpError(400, 'Choose the driver for this load');
  if (!orgId) throw new HttpError(409, 'Your partner organisation is not set up yet, so vehicles cannot be assigned');

  const { data: vehicle, error: vErr } = await supabase
    .from('vehicles')
    .select('id, status, plate_number, capacity_kg, current_load_kg, available_capacity_kg, driver_id, carrier_org_id, hazmat_certified, is_reefer, body_type')
    .eq('id', vehicleId).maybeSingle();
  if (vErr) dbError('Failed to load the vehicle', vErr);
  // A vehicle of another organisation is never confirmed to exist
  if (!vehicle || vehicle.carrier_org_id !== orgId) throw new HttpError(404, 'Vehicle not found');
  const { data: member, error: mErr } = await supabase
    .from('org_members').select('user_id').eq('org_id', orgId).eq('user_id', driverId).eq('status', 'active').maybeSingle();
  if (mErr) dbError('Failed to load the driver', mErr);
  if (!member) throw new HttpError(404, 'Driver not found');
  if (vehicle.driver_id !== driverId) {
    throw new HttpError(409, `${vehicle.plate_number ?? 'This vehicle'} is not assigned to that driver. Choose the vehicle's own driver, or give the vehicle this driver in Fleet.`);
  }
  if (!isDispatchable(vehicle)) {
    throw new HttpError(409, `This vehicle is ${vehicle.status === 'maintenance' || vehicle.status === 'archived' ? `in ${vehicle.status}` : 'not ready for dispatch'} and can't take a load`);
  }

  if (sourceType === 'request') {
    const { data: load, error: lErr } = await supabase.from('vendor_shipment_requests').select('*').eq('id', sourceId).maybeSingle();
    if (lErr) dbError('Failed to load the request', lErr);
    if (!load) throw new HttpError(404, 'Request not found');
    const { data: goods, error: gErr } = await supabase.from('load_items').select('is_hazmat, is_perishable').eq('load_id', sourceId);
    if (gErr) dbError('Failed to load the goods', gErr);
    assertVehicleFits({ ...load, items: goods ?? [] }, vehicle);
    return { vehicle, driverId, load, capacity: assertCapacity(vehicle, load.required_capacity_kg) };
  }
  // A shipment keeps its own custody trail: the partner's vehicle is recorded on the order only
  return { vehicle, driverId, load: null, capacity: assertCapacity(vehicle, offer.weight_kg) };
}

/** Where a manifest's status puts a 3PL order; null leaves the order as it is (held, in an exception, not yet moving). */
function orderStatusForManifest(manifestStatus: string): OrderStatus | 'cancelled' | null {
  switch (manifestStatus) {
    case 'picked_up': return 'picked_up';
    case 'in_transit': return 'in_transit';
    case 'delivered':
    case 'completed': return 'delivered';
    case 'cancelled': return 'cancelled';
    default: return null;
  }
}

/** The proof of delivery a manifest holds; a master load takes its lots' when it has none of its own. */
async function manifestPod(manifest: Record<string, any>): Promise<{ photo: string | null; signature: string | null; receivedBy: string | null }> {
  let { photo_url: photo, signature_url: signature, received_by: receivedBy } = manifest;
  if (!photo && !signature && manifest.is_master) {
    const { data: lots } = await supabase.from('cargo_manifest')
      .select('photo_url, signature_url, received_by').eq('parent_manifest_id', manifest.id).order('lot_seq', { ascending: true });
    const lot = (lots ?? []).find(l => l.photo_url || l.signature_url);
    if (lot) ({ photo_url: photo, signature_url: signature, received_by: receivedBy } = { ...lot, received_by: receivedBy ?? lot.received_by });
  }
  return { photo: photo ?? null, signature: signature ?? null, receivedBy: receivedBy ?? null };
}

/**
 * Keeps a 3PL order in step with the trip that carries it: when the manifest is picked up, in transit,
 * delivered or cancelled, the order follows with its timestamps (and, at delivery, the proof of delivery the
 * driver captured). Moves forward only. Returns the updated order, or null when the manifest backs no order
 * or nothing changed. Called from the custody transition hook; failures are the caller's to log.
 */
export async function syncTplOrderFromManifest(manifestId: string): Promise<Record<string, any> | null> {
  const { data: order, error } = await supabase
    .from('tpl_orders').select('*').eq('manifest_id', manifestId).neq('status', 'cancelled').maybeSingle();
  if (error) dbError('Failed to load the order of a trip', error);
  if (!order) return null;
  const { data: manifest, error: mErr } = await supabase
    .from('cargo_manifest').select('id, status, is_master, photo_url, signature_url, received_by').eq('id', manifestId).maybeSingle();
  if (mErr) dbError('Failed to load the trip', mErr);
  if (!manifest) return null;

  const target = orderStatusForManifest(String(manifest.status));
  if (!target) return null;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (target === 'cancelled') {
    if (order.status === 'delivered') return null;
    patch.status = 'cancelled';
  } else {
    const from = ORDER_STATUS_FLOW.indexOf(order.status as OrderStatus);
    const to = ORDER_STATUS_FLOW.indexOf(target);
    if (from < 0 || to <= from) return null;
    patch.status = target;
    if (!order.picked_up_at) patch.picked_up_at = now;
    if (target === 'delivered') {
      patch.delivered_at = now;
      const pod = await manifestPod(manifest);
      if (pod.photo) patch.pod_photo_url = pod.photo;
      if (pod.signature) patch.pod_signature_url = pod.signature;
      if (pod.receivedBy) patch.pod_received_by = pod.receivedBy;
    }
  }
  const { data: updated, error: uErr } = await supabase
    .from('tpl_orders').update(patch).eq('id', order.id).eq('status', order.status).select().maybeSingle();
  if (uErr) dbError('Failed to update the order of a trip', uErr);
  if (!updated) return null;
  try {
    const label = target === 'delivered' ? 'delivered' : target === 'in_transit' || target === 'picked_up' ? 'picked up and on its way' : 'cancelled';
    await notificationService.notifyStaff(`3PL order ${target === 'cancelled' ? 'cancelled' : label}`,
      `${shortPlace(order.pickup_location)} to ${shortPlace(order.drop_location)} is ${label}.`,
      'tpl_order_status', { order_id: order.id, partner_id: order.partner_id }, await carrierOf('cargo_manifest', manifestId));
  } catch (e) {
    console.error('[tpl-network] Trip sync notification failed:', e);
  }
  return updated;
}

export const tplNetworkService = {
  /** Partners that would receive an offer, without sending anything. */
  async preview(sourceType: SourceType, id: string, options: { partnerIds?: string[] | null } = {}) {
    const load = await loadSource(sourceType, id);
    const company = companyFor(load);
    const { matches, excluded } = await findMatchingPartners(company, load.pickup, load.drop, load.distanceKm, { vehicleClass: load.vehicleClass, partnerIds: options.partnerIds });
    return {
      pickup: load.pickup, drop: load.drop,
      distance_km: load.distanceKm,
      partners: matches.map(m => ({ partner_id: m.partner.id, company_name: m.partner.company_name, corridor_name: m.corridor?.corridor_name ?? null, price: m.price, rate: m.rate })),
      excluded,
    };
  },

  /**
   * Sends the load to every active partner whose corridor matches. Partners with an open or accepted
   * offer for it are skipped, so escalating twice is safe.
   */
  async escalate(
    sourceType: SourceType,
    id: string,
    createdBy: string | null,
    options: { vendorPrice?: unknown; partnerIds?: unknown; companyOrgId?: string | null } = {},
  ): Promise<EscalationResult> {
    const partnerIds = parsePartnerIds(options.partnerIds);
    const load = await loadSource(sourceType, id);
    const company = companyFor(load, options.companyOrgId);
    // The price the vendor pays is staff's to set, here or later; it is what the vendor's invoice is made from
    if (sourceType === 'request' && options.vendorPrice !== undefined && options.vendorPrice !== null && options.vendorPrice !== '') {
      await this.setVendorPrice(id, options.vendorPrice);
    }
    const { matches, excluded } = await findMatchingPartners(company, load.pickup, load.drop, load.distanceKm, { vehicleClass: load.vehicleClass, partnerIds });
    if (matches.length === 0) {
      if (excluded.length > 0) {
        throw new HttpError(409, `Your partner rules keep every matching partner out: ${excluded.map(e => `${e.name}: ${e.reason}`).join('; ')}`, { excluded });
      }
      throw new HttpError(409, partnerIds
        ? 'None of the chosen partners can take this load'
        : 'No active 3PL partner of yours has a corridor from this pickup to this drop-off');
    }

    const col = sourceColumn(sourceType);
    const { data: existing, error: exErr } = await supabase
      .from('tpl_offers').select('partner_id, status').eq(col, id).in('status', ['offered', 'accepted']);
    if (exErr) dbError('Failed to check existing offers', exErr);
    const skip = new Set((existing ?? []).map(o => o.partner_id));
    const fresh = matches.filter(m => !skip.has(m.partner.id));
    if (fresh.length === 0) {
      throw new HttpError(409, 'Every matching partner already has this load');
    }

    // Request goes to "escalated" first: the conditional update refuses a request someone just rejected.
    if (sourceType === 'request' && load.requestStatus !== 'escalated') {
      const { data: moved, error: mvErr } = await supabase
        .from('vendor_shipment_requests')
        .update({
          status: 'escalated',
          metadata: { ...(load.metadata ?? {}), escalated_from: load.requestStatus },
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', load.requestStatus as string)
        .select('id')
        .maybeSingle();
      if (mvErr) dbError('Failed to update request', mvErr);
      if (!moved) throw new HttpError(409, 'This request changed while you were escalating it. Refresh and try again');
    }

    const now = new Date().toISOString();
    const rows = fresh.map(m => ({
      ...carrierStamp(),
      // The company that makes the offer, also when the scheduler does (no request, so no stamp)
      ...(company ? { carrier_org_id: company } : {}),
      targeted: !!partnerIds,
      partner_id: m.partner.id,
      source_type: sourceType,
      [col]: id,
      corridor_id: m.corridor?.id ?? null,
      corridor_name: m.corridor?.corridor_name ?? null,
      pickup_location: load.pickup,
      drop_location: load.drop,
      weight_kg: load.weightKg,
      proposed_price: m.price,
      status: 'offered',
      offered_at: now,
      created_by: createdBy,
    }));
    const { data: offers, error: insErr } = await supabase.from('tpl_offers').insert(rows).select();
    if (insErr) {
      if (sourceType === 'request' && load.requestStatus !== 'escalated') {
        await supabase.from('vendor_shipment_requests')
          .update({ status: load.requestStatus as string, updated_at: now }).eq('id', id).eq('status', 'escalated');
      }
      dbError('Failed to create offers', insErr);
    }

    for (const offer of offers ?? []) {
      const match = fresh.find(m => m.partner.id === offer.partner_id)!;
      await notifyPartner(match, load, offer.proposed_price != null ? Number(offer.proposed_price) : null, offer.id);
    }

    // The cascade matcher writes its own log entry; staff escalations write theirs here.
    if (sourceType === 'shipment' && createdBy) {
      try {
        await ShipmentService.recordShipmentLog(id, 'escalated', null, null, {
          engine: 'staff', tier: 'Tier 2', broadcast_count: fresh.length,
        }, { id: createdBy, role: 'staff' });
      } catch (e) {
        console.error('[tpl-network] Shipment log failed:', e);
      }
    }
    if (sourceType === 'request' && load.vendorId) {
      try {
        await notificationService.sendNotification(load.vendorId, 'Your load is with 3PL partners',
          `Your request from ${shortPlace(load.pickup)} to ${shortPlace(load.drop)} was sent to ${fresh.length} 3PL ${fresh.length === 1 ? 'partner' : 'partners'}. We will tell you when one accepts.`,
          'request_escalated', { request_id: id });
      } catch (e) {
        console.error('[tpl-network] Vendor notification failed:', e);
      }
    }

    return { created: (offers ?? []).length, already_offered: matches.length - fresh.length, matched: matches.length, offers: offers ?? [], excluded };
  },

  /**
   * Staff set what the vendor pays for a load a 3PL partner carries (not what the partner charges).
   * When the partner has already delivered it, the vendor's invoice is made right away.
   */
  async setVendorPrice(requestId: string, costInput: unknown) {
    const cost = Number(costInput);
    if (!Number.isFinite(cost) || cost <= 0 || cost > MAX_AMOUNT) {
      throw new HttpError(400, `The price must be more than 0 and at most ₹${MAX_AMOUNT.toLocaleString('en-IN')}`);
    }
    const { data: request, error } = await supabase
      .from('vendor_shipment_requests').select('id, status').eq('id', requestId).maybeSingle();
    if (error) dbError('Failed to load request', error);
    if (!request) throw new HttpError(404, 'Request not found');
    if (['rejected', 'cancelled'].includes(request.status)) {
      throw new HttpError(409, `This request is ${request.status}, so it has no price to set`);
    }
    const { error: uErr } = await supabase
      .from('vendor_shipment_requests').update({ cost, updated_at: new Date().toISOString() }).eq('id', requestId);
    if (uErr) dbError('Failed to save the price', uErr);
    let invoice: string | null = null;
    if (request.status === 'completed') {
      const { data: delivered } = await supabase
        .from('tpl_orders').select('id').eq('request_id', requestId).eq('status', 'delivered');
      if ((delivered ?? []).length > 0) {
        try {
          invoice = (await InvoiceService.createForRequest(requestId)).status;
        } catch (e) {
          // The price is saved; the invoice waits until the company profile is complete
          if (!(e instanceof HttpError) || e.status !== 409) throw e;
          invoice = 'blocked';
        }
      }
    }
    return { request_id: requestId, cost, invoice };
  },

  /** Offers for one load (with partner names) and the order, if a partner accepted. */
  async listForSource(sourceType: SourceType, id: string) {
    const col = sourceColumn(sourceType);
    const { data: offers, error } = await supabase.from('tpl_offers').select('*').eq(col, id).order('offered_at', { ascending: false });
    if (error) dbError('Failed to load offers', error);
    const partnerIds = [...new Set((offers ?? []).map(o => o.partner_id))];
    const names = new Map<string, string>();
    if (partnerIds.length > 0) {
      const { data: partners, error: pErr } = await supabase.from('tpl_partners').select('id, company_name').in('id', partnerIds);
      if (pErr) dbError('Failed to load partners', pErr);
      for (const p of partners ?? []) names.set(p.id, p.company_name);
    }
    const { data: orders, error: oErr } = await supabase.from('tpl_orders').select('*').eq(col, id).neq('status', 'cancelled');
    if (oErr) dbError('Failed to load order', oErr);
    return {
      offers: (offers ?? []).map(o => ({ ...o, partner_name: names.get(o.partner_id) ?? null })),
      order: orders?.[0] ? { ...orders[0], partner_name: names.get(orders[0].partner_id) ?? null } : null,
    };
  },

  /** Withdraws every open offer for a load (or one offer, with `offerId`). */
  async withdraw(sourceType: SourceType, id: string, offerId?: string): Promise<number> {
    const col = sourceColumn(sourceType);
    let query = supabase
      .from('tpl_offers')
      .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
      .eq(col, id)
      .eq('status', 'offered');
    if (offerId) query = query.eq('id', offerId);
    const { data, error } = await query.select();
    if (error) dbError('Failed to withdraw offers', error);
    const withdrawn = data ?? [];
    if (withdrawn.length === 0) throw new HttpError(409, 'There is no open offer to withdraw. A partner may have just answered it');

    await returnRequestIfIdle(sourceType, id);

    const { data: partners } = await supabase
      .from('tpl_partners').select('id, user_id').in('id', withdrawn.map(o => o.partner_id));
    for (const p of partners ?? []) {
      if (!p.user_id) continue;
      try {
        await notificationService.sendNotification(p.user_id, 'Load offer withdrawn', 'A load offered to you is no longer available.', 'tpl_offer_withdrawn', { partner_id: p.id });
      } catch (e) {
        console.error('[tpl-network] Withdraw notification failed:', e);
      }
    }
    return withdrawn.length;
  },

  async getOfferSource(offerId: string): Promise<{ sourceType: SourceType; id: string }> {
    const { data, error } = await supabase.from('tpl_offers').select('id, source_type, request_id, shipment_id').eq('id', offerId).maybeSingle();
    if (error) dbError('Failed to load offer', error);
    if (!data) throw new HttpError(404, 'Offer not found');
    return { sourceType: data.source_type, id: (data.source_type === 'request' ? data.request_id : data.shipment_id) as string };
  },

  // ── Partner side ─────────────────────────────────────────────────

  /**
   * The partner a signed-in user works for: the row linked to them (`tpl_partners.user_id`), or the partner of
   * a 3PL organisation they are an active member of (a manager the partner invited). `org_id` is the partner's
   * organisation, null before organisations are set up.
   */
  async partnerForUser(userId: string): Promise<PartnerSession> {
    const memberships = (await loadMemberships(userId)).filter(m => m.org.kind === 'tpl_partner');
    const { data, error } = await supabase
      .from('tpl_partners').select('id, company_name, status, sla_commitment, email').eq('user_id', userId).maybeSingle();
    if (error) dbError('Failed to load partner', error);
    if (data) {
      let orgId: string | null = null;
      if (memberships.length === 1) orgId = memberships[0].org.id;
      else if (memberships.length > 1) orgId = (await partnerOrgIdOf(data.id, memberships.map(m => m.org.id))) ?? memberships[0].org.id;
      return { ...(data as Omit<PartnerSession, 'org_id'>), org_id: orgId };
    }
    for (const m of memberships) {
      const { data: org } = await supabase.from('organizations').select('profile').eq('id', m.org.id).maybeSingle();
      const legacy = (org?.profile as { legacy_tpl_partner_id?: string } | null)?.legacy_tpl_partner_id;
      if (!legacy) continue;
      const { data: p } = await supabase
        .from('tpl_partners').select('id, company_name, status, sla_commitment, email').eq('id', legacy).maybeSingle();
      if (p) return { ...(p as Omit<PartnerSession, 'org_id'>), org_id: m.org.id };
    }
    throw new HttpError(403, 'This account is not linked to a 3PL partner');
  },

  async offersForPartner(partnerId: string) {
    const { data, error } = await supabase
      .from('tpl_offers').select('*').eq('partner_id', partnerId).order('offered_at', { ascending: false }).limit(200);
    if (error) dbError('Failed to load offers', error);
    const items = data ?? [];
    const names = await orgNames(items.map(o => o.carrier_org_id));
    return { companies: groupByCompany(items, names, 'offers'), items };
  },

  async accept(partner: Omit<PartnerSession, 'email' | 'org_id'> & { org_id?: string | null }, offerId: string, input: { pickup_eta?: unknown; delivery_eta?: unknown; agreed_amount?: unknown; vehicle_id?: unknown; driver_id?: unknown }) {
    if (partner.status !== 'active') throw new HttpError(403, 'Your partner account is not active, so you cannot accept loads');
    const { data: offer, error } = await supabase
      .from('tpl_offers').select('*').eq('id', offerId).eq('partner_id', partner.id).maybeSingle();
    if (error) dbError('Failed to load offer', error);
    if (!offer) throw new HttpError(404, 'Offer not found');
    if (offer.status !== 'offered') {
      const why: Record<string, string> = {
        taken: 'Another partner already took this load',
        withdrawn: 'This offer was withdrawn',
        declined: 'You already declined this offer',
        accepted: 'You already accepted this offer',
      };
      throw new HttpError(409, why[offer.status] ?? 'This offer is no longer open');
    }

    const pickupEta = parseDate(input.pickup_eta, 'Pickup time');
    const deliveryEta = parseDate(input.delivery_eta, 'Delivery time');
    if (pickupEta && deliveryEta && deliveryEta <= pickupEta) throw new HttpError(400, 'Delivery time must be after the pickup time');
    // The amount the partner types is what they will charge and wins over the price worked out from
    // their corridor rate; without one, the offer's price is used, and with neither there is no deal.
    const entered = input.agreed_amount === undefined || input.agreed_amount === null || input.agreed_amount === '' ? null : Number(input.agreed_amount);
    if (entered !== null && (!Number.isFinite(entered) || entered <= 0 || entered > MAX_AMOUNT)) {
      throw new HttpError(400, `The amount must be more than 0 and at most ₹${MAX_AMOUNT.toLocaleString('en-IN')}`);
    }
    let amount: number | null = entered ?? (offer.proposed_price != null ? Number(offer.proposed_price) : null);
    if (amount == null) throw new HttpError(400, 'Enter the amount you will charge for this load');

    const sourceType: SourceType = offer.source_type;
    const sourceId: string = sourceType === 'request' ? offer.request_id : offer.shipment_id;
    const col = sourceColumn(sourceType);
    const now = new Date();
    const nowIso = now.toISOString();

    // The partner's own vehicle and driver run the load: checked before anything is claimed
    const execution = await resolveExecution(partner, offer, sourceType, sourceId, input);

    // 1. This offer: only one accept can flip it from "offered".
    const { data: claimedOffer, error: cErr } = await supabase
      .from('tpl_offers')
      .update({ status: 'accepted', responded_at: nowIso, pickup_eta: pickupEta?.toISOString() ?? null, updated_at: nowIso })
      .eq('id', offerId).eq('status', 'offered').select('id').maybeSingle();
    if (cErr) dbError('Failed to accept offer', cErr);
    if (!claimedOffer) throw new HttpError(409, 'This offer is no longer open');

    const giveUp = async (message: string): Promise<never> => {
      await supabase.from('tpl_offers').update({ status: 'taken', responded_at: nowIso, updated_at: nowIso }).eq('id', offerId);
      throw new HttpError(409, message);
    };

    // 2. The load: a request moves from "escalated" to "assigned to partner" for one caller only;
    //    a shipment is guarded by the unique index on live orders.
    if (sourceType === 'request') {
      const { data: claimed, error: rErr } = await supabase
        .from('vendor_shipment_requests')
        .update({ status: 'assigned_to_partner', updated_at: nowIso })
        .eq('id', sourceId).eq('status', 'escalated').select('id').maybeSingle();
      if (rErr) dbError('Failed to claim request', rErr);
      if (!claimed) await giveUp('Another partner already took this load');
    } else {
      const { data: live } = await supabase.from('tpl_orders').select('id').eq('shipment_id', sourceId).neq('status', 'cancelled');
      if ((live ?? []).length > 0) await giveUp('Another partner already took this load');
    }

    const hours = slaHours(partner.sla_commitment);
    const dueBy = deliveryEta ?? (hours ? new Date(now.getTime() + hours * 3600_000) : null);
    const { data: order, error: oErr } = await supabase
      .from('tpl_orders')
      .insert({
        ...carrierStamp(),
        offer_id: offerId,
        partner_id: partner.id,
        source_type: sourceType,
        [col]: sourceId,
        pickup_location: offer.pickup_location,
        drop_location: offer.drop_location,
        weight_kg: offer.weight_kg,
        agreed_amount: amount,
        status: 'accepted',
        ...(execution ? { vehicle_id: execution.vehicle.id, driver_id: execution.driverId } : {}),
        pickup_eta: pickupEta?.toISOString() ?? null,
        due_by: dueBy?.toISOString() ?? null,
        accepted_at: nowIso,
      })
      .select()
      .single();
    if (oErr) {
      if (sourceType === 'request') {
        await supabase.from('vendor_shipment_requests').update({ status: 'escalated', updated_at: nowIso }).eq('id', sourceId).eq('status', 'assigned_to_partner');
      }
      if ((oErr as { code?: string }).code === '23505') await giveUp('Another partner already took this load');
      await supabase.from('tpl_offers').update({ status: 'offered', responded_at: null, updated_at: nowIso }).eq('id', offerId);
      dbError('Failed to create order', oErr);
    }

    // 2b. The trip: a manifest for the load on the partner's vehicle, kept with the company that owns the load
    let manifestId: string | null = null;
    if (execution?.load) {
      try {
        const company: string | null = execution.load.carrier_org_id ?? offer.carrier_org_id ?? null;
        const manifest = await insertManifest(execution.load, execution.vehicle.id, { executedByOrg: partner.org_id ?? null, carrierOrgId: company });
        manifestId = manifest.id;
        const { error: lErr } = await supabase.from('tpl_orders').update({ manifest_id: manifestId }).eq('id', order.id);
        if (lErr) dbError('Failed to link the trip to the order', lErr);
        order.manifest_id = manifestId;
      } catch (e) {
        // Undo the claim so another try (or partner) can take the load
        await supabase.from('tpl_orders').delete().eq('id', order.id);
        if (manifestId) await supabase.from('cargo_manifest').delete().eq('id', manifestId);
        await supabase.from('vendor_shipment_requests').update({ status: 'escalated', updated_at: nowIso }).eq('id', sourceId).eq('status', 'assigned_to_partner');
        await supabase.from('tpl_offers').update({ status: 'offered', responded_at: null, updated_at: nowIso }).eq('id', offerId);
        throw e;
      }
    }
    if (execution) {
      try {
        await putLoadOnVehicle(execution.vehicle, execution.vehicle.id, execution.load ?? { id: sourceId, pickup_location: offer.pickup_location }, execution.capacity);
      } catch (e) {
        console.error('[tpl-network] Putting the load on the vehicle failed:', e);
      }
    }

    // 3. Everyone else who was offered it now sees "taken".
    const { data: taken } = await supabase
      .from('tpl_offers')
      .update({ status: 'taken', responded_at: nowIso, updated_at: nowIso })
      .eq(col, sourceId).eq('status', 'offered').neq('id', offerId).select('partner_id');
    if ((taken ?? []).length > 0) {
      const { data: others } = await supabase.from('tpl_partners').select('id, user_id').in('id', taken!.map(o => o.partner_id));
      for (const p of others ?? []) {
        if (!p.user_id) continue;
        try {
          await notificationService.sendNotification(p.user_id, 'Load taken', 'Another partner accepted a load that was offered to you.', 'tpl_offer_taken', { partner_id: p.id });
        } catch (e) {
          console.error('[tpl-network] Taken notification failed:', e);
        }
      }
    }

    try {
      await notificationService.notifyStaff('3PL partner accepted a load',
        `${partner.company_name} accepted ${shortPlace(offer.pickup_location)} to ${shortPlace(offer.drop_location)} at ${inr(amount)}.`,
        'tpl_order_accepted', { order_id: order.id, partner_id: partner.id, [col]: sourceId }, await carrierOf('tpl_orders', order.id));
      if (sourceType === 'request') {
        const { data: r } = await supabase.from('vendor_shipment_requests').select('vendor_id').eq('id', sourceId).maybeSingle();
        if (r?.vendor_id) {
          await notificationService.sendNotification(r.vendor_id, 'A 3PL partner accepted your load',
            `${partner.company_name} will carry your load from ${shortPlace(offer.pickup_location)} to ${shortPlace(offer.drop_location)}.`,
            'request_assigned_partner', { request_id: sourceId });
        }
      }
    } catch (e) {
      console.error('[tpl-network] Accept notification failed:', e);
    }
    return order;
  },

  async decline(partner: { id: string; company_name: string }, offerId: string, reasonInput: unknown) {
    const reason = parseRejectionReason(reasonInput);
    const now = new Date().toISOString();
    const { data: declined, error } = await supabase
      .from('tpl_offers')
      .update({ status: 'declined', decline_reason: reason, responded_at: now, updated_at: now })
      .eq('id', offerId).eq('partner_id', partner.id).eq('status', 'offered')
      .select().maybeSingle();
    if (error) dbError('Failed to decline offer', error);
    if (!declined) {
      const { data: existing } = await supabase.from('tpl_offers').select('status').eq('id', offerId).eq('partner_id', partner.id).maybeSingle();
      if (!existing) throw new HttpError(404, 'Offer not found');
      throw new HttpError(409, `This offer is already ${existing.status}`);
    }
    const sourceType: SourceType = declined.source_type;
    const sourceId: string = sourceType === 'request' ? declined.request_id : declined.shipment_id;
    await returnRequestIfIdle(sourceType, sourceId);
    try {
      await notificationService.notifyStaff('3PL partner declined a load',
        `${partner.company_name} declined ${shortPlace(declined.pickup_location)} to ${shortPlace(declined.drop_location)}: ${reason}`,
        'tpl_offer_declined', { offer_id: offerId, partner_id: partner.id }, await carrierOf('tpl_offers', offerId));
    } catch (e) {
      console.error('[tpl-network] Decline notification failed:', e);
    }
    return declined;
  },

  async ordersForPartner(partnerId: string) {
    const { data, error } = await supabase
      .from('tpl_orders').select('*').eq('partner_id', partnerId).order('accepted_at', { ascending: false }).limit(500);
    if (error) dbError('Failed to load orders', error);
    const items = data ?? [];
    const names = await orgNames(items.map(o => o.carrier_org_id));
    return { companies: groupByCompany(items, names, 'orders'), items };
  },

  /** Moves an order forward: picked up, in transit, then delivered (which needs a proof-of-delivery note). */
  async updateOrderStatus(partner: { id: string; company_name: string }, orderId: string, next: unknown, noteInput: unknown) {
    if (typeof next !== 'string' || !(ORDER_STATUS_FLOW as readonly string[]).includes(next) || next === 'accepted') {
      throw new HttpError(400, 'Status must be picked_up, in_transit or delivered');
    }
    const note = typeof noteInput === 'string' ? noteInput.trim() : '';
    if (note.length > 500) throw new HttpError(400, 'The note can be at most 500 characters');

    const { data: order, error } = await supabase
      .from('tpl_orders').select('*').eq('id', orderId).eq('partner_id', partner.id).maybeSingle();
    if (error) dbError('Failed to load order', error);
    if (!order) throw new HttpError(404, 'Order not found');
    // A trip the partner's driver runs in the driver app moves by the driver's steps, and is delivered with their proof
    const backed = !!order.manifest_id;
    let pod: { photo: string | null; signature: string | null; receivedBy: string | null } | null = null;
    if (backed) {
      if (next !== 'delivered') throw new HttpError(409, 'The driver moves this trip in the driver app: pickup and departure update this order by themselves');
      const { data: manifest, error: mErr } = await supabase
        .from('cargo_manifest').select('id, is_master, photo_url, signature_url, received_by').eq('id', order.manifest_id).maybeSingle();
      if (mErr) dbError('Failed to load the trip', mErr);
      pod = manifest ? await manifestPod(manifest) : null;
      if (!pod || (!pod.photo && !pod.signature)) {
        throw new HttpError(409, 'The driver has not captured the proof of delivery yet. Delivery needs a photo or a signature taken in the driver app');
      }
    } else if (next === 'delivered' && note.length < 3) {
      throw new HttpError(400, 'Add a proof of delivery note, such as who received the load');
    }
    const from = ORDER_STATUS_FLOW.indexOf(order.status as OrderStatus);
    if (from < 0) throw new HttpError(409, `This order is ${order.status} and cannot be updated`);
    if (from >= ORDER_STATUS_FLOW.indexOf(next as OrderStatus)) throw new HttpError(409, `This order is already ${String(order.status).replace(/_/g, ' ')}`);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: next, updated_at: now };
    if (!order.picked_up_at) patch.picked_up_at = now;
    if (next === 'delivered') {
      patch.delivered_at = now;
      if (pod) {
        if (pod.photo) patch.pod_photo_url = pod.photo;
        if (pod.signature) patch.pod_signature_url = pod.signature;
        if (pod.receivedBy) patch.pod_received_by = pod.receivedBy;
        if (note) patch.pod_note = note;
      } else patch.pod_note = note;
    }
    const { data: updated, error: uErr } = await supabase
      .from('tpl_orders').update(patch).eq('id', orderId).eq('status', order.status).select().maybeSingle();
    if (uErr) dbError('Failed to update order', uErr);
    if (!updated) throw new HttpError(409, 'This order was just updated. Refresh and try again');

    // Keep the load in step
    try {
      if (backed) {
        // The manifest is the source of truth: the vendor was told, the load closed and billed when it was delivered
      } else if (order.source_type === 'shipment' && order.shipment_id) {
        // The partner's truck is not one of ours: the steps go through custody with the partner named
        const { recordCustody } = await import('./cargo/custody.service');
        const by = `3PL partner ${partner.company_name}`;
        const log = { tpl_order_id: orderId, tpl_partner: partner.company_name };
        const { data: goods } = await supabase.from('shipments').select('status, current_holder').eq('id', order.shipment_id).maybeSingle();
        const pickedUp = !!goods && (goods.current_holder ? goods.current_holder !== 'consignor' : !['created', 'assigned'].includes(String(goods.status)));
        if (!pickedUp) {
          await recordCustody({ shipment_id: order.shipment_id }, { kind: 'pickup', notes: by }, null, { via: 'tpl', logMetadata: log });
        }
        if (next === 'in_transit') {
          await recordCustody({ shipment_id: order.shipment_id }, { kind: 'departed', notes: by }, null, { via: 'tpl', logMetadata: log });
        }
        if (next === 'delivered') {
          await recordCustody({ shipment_id: order.shipment_id }, { kind: 'delivery', receiver_name: note, notes: `${by}: ${note}` }, null, { via: 'tpl', legacyEvidence: true, logMetadata: log });
        }
      }
      if (!backed && order.source_type === 'request' && order.request_id) {
        if (next === 'delivered') {
          await supabase.from('vendor_shipment_requests')
            .update({ status: 'completed', updated_at: now }).eq('id', order.request_id).eq('status', 'assigned_to_partner');
        }
        // The vendor hears about every step, like a load on our own trucks
        await vendorService.notifyVendorRequestEvent(order.request_id, next as LoadEvent, order.pickup_location, order.drop_location, partner.company_name);
        if (next === 'delivered') await InvoiceService.onRequestDelivered(order.request_id);
      }
      const label = next === 'picked_up' ? 'picked up' : next === 'in_transit' ? 'in transit' : 'delivered';
      await notificationService.notifyStaff(`3PL order ${label}`,
        `${partner.company_name}: ${shortPlace(order.pickup_location)} to ${shortPlace(order.drop_location)} is ${label}.`,
        'tpl_order_status', { order_id: orderId, partner_id: partner.id }, await carrierOf('tpl_orders', orderId));
    } catch (e) {
      console.error('[tpl-network] Order follow-up failed:', e);
    }
    return updated;
  },

  /** Accepted orders grouped by month (Indian calendar), with paid and unpaid totals. */
  async earnings(partnerId: string) {
    const orders = (await this.ordersForPartner(partnerId)).items.filter(o => o.status !== 'cancelled');
    return groupEarnings(orders);
  },

  // ── Staff side ───────────────────────────────────────────────────

  async ordersForStaff(partnerId?: string) {
    let query = supabase.from('tpl_orders').select('*').order('accepted_at', { ascending: false }).limit(500);
    if (partnerId) query = query.eq('partner_id', partnerId);
    const { data, error } = await query;
    if (error) dbError('Failed to load orders', error);
    const ids = [...new Set((data ?? []).map(o => o.partner_id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: partners } = await supabase.from('tpl_partners').select('id, company_name').in('id', ids);
      for (const p of partners ?? []) names.set(p.id, p.company_name);
    }
    return (data ?? []).map(o => ({ ...o, partner_name: names.get(o.partner_id) ?? null }));
  },

  async rateOrder(orderId: string, ratingInput: unknown, noteInput: unknown, staffId: string) {
    const rating = Number(ratingInput);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Rating must be a whole number from 1 to 5');
    const note = typeof noteInput === 'string' ? noteInput.trim() : '';
    if (note.length > 500) throw new HttpError(400, 'The note can be at most 500 characters');
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('tpl_orders')
      .update({ rating, rating_note: note || null, rated_at: now, rated_by: staffId, updated_at: now })
      .eq('id', orderId).eq('status', 'delivered').select().maybeSingle();
    if (error) dbError('Failed to save rating', error);
    if (!data) {
      const { data: existing } = await supabase.from('tpl_orders').select('status').eq('id', orderId).maybeSingle();
      if (!existing) throw new HttpError(404, 'Order not found');
      throw new HttpError(409, 'You can rate an order after it is delivered');
    }
    return data;
  },

  async markPaid(orderId: string, paid: boolean, referenceInput: unknown) {
    // An order inside an issued statement is settled by that statement, not one order at a time
    const statement = await statementCoveringOrder(orderId);
    if (statement) {
      throw new HttpError(409, `This order is part of the ${statement.period} statement (${statement.status}). Mark the statement paid instead`);
    }
    const reference = typeof referenceInput === 'string' ? referenceInput.trim().slice(0, 100) : '';
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('tpl_orders')
      .update({ paid_at: paid ? now : null, paid_reference: paid && reference ? reference : null, updated_at: now })
      .eq('id', orderId).eq('status', 'delivered').select().maybeSingle();
    if (error) dbError('Failed to update payment', error);
    if (!data) {
      const { data: existing } = await supabase.from('tpl_orders').select('status').eq('id', orderId).maybeSingle();
      if (!existing) throw new HttpError(404, 'Order not found');
      throw new HttpError(409, 'Mark an order paid after it is delivered');
    }
    if (paid) {
      try {
        const { data: partner } = await supabase.from('tpl_partners').select('user_id').eq('id', data.partner_id).maybeSingle();
        if (partner?.user_id) {
          await notificationService.sendNotification(partner.user_id, 'Payment marked as paid',
            `${inr(Number(data.agreed_amount))} for ${shortPlace(data.pickup_location)} to ${shortPlace(data.drop_location)} was marked paid.`,
            'tpl_order_paid', { order_id: orderId, partner_id: data.partner_id });
        }
      } catch (e) {
        console.error('[tpl-network] Paid notification failed:', e);
      }
    }
    return data;
  },

  /** Statistics for every partner, keyed by partner id. Partners with no offers or orders are left out. */
  async statsForAll() {
    const [{ data: offers, error: oErr }, { data: orders, error: rErr }] = await Promise.all([
      supabase.from('tpl_offers').select('partner_id, status, offered_at, responded_at'),
      supabase.from('tpl_orders').select('partner_id, status, due_by, delivered_at, rating, agreed_amount, paid_at'),
    ]);
    if (oErr) dbError('Failed to load offers', oErr);
    if (rErr) dbError('Failed to load orders', rErr);
    const ids = new Set([...(offers ?? []).map(o => o.partner_id), ...(orders ?? []).map(o => o.partner_id)]);
    const now = new Date();
    const out: Record<string, PartnerStats> = {};
    for (const id of ids) {
      out[id] = computeStats((offers ?? []).filter(o => o.partner_id === id), (orders ?? []).filter(o => o.partner_id === id), now);
    }
    return out;
  },

  async statsForPartner(partnerId: string) {
    const [{ data: offers, error: oErr }, { data: orders, error: rErr }] = await Promise.all([
      supabase.from('tpl_offers').select('partner_id, status, offered_at, responded_at').eq('partner_id', partnerId),
      supabase.from('tpl_orders').select('partner_id, status, due_by, delivered_at, rating, agreed_amount, paid_at').eq('partner_id', partnerId),
    ]);
    if (oErr) dbError('Failed to load offers', oErr);
    if (rErr) dbError('Failed to load orders', rErr);
    return computeStats(offers ?? [], orders ?? [], new Date());
  },
};

// ── Pure calculations (unit tested) ──────────────────────────────────

export interface PartnerStats {
  offers_received: number;
  offers_accepted: number;
  offers_declined: number;
  /** Offers another partner took first. Not held against the partner. */
  offers_taken: number;
  /** Accepted out of answered (accepted + declined); null until the partner has answered one. */
  acceptance_rate: number | null;
  /** Average minutes from offer to answer; null until the partner has answered one. */
  avg_response_minutes: number | null;
  orders_completed: number;
  orders_active: number;
  /** Delivered after the due time, or still open past it. */
  sla_breaches: number;
  /** Orders with a due time, i.e. the ones a breach can be judged on. */
  sla_measured: number;
  rating_avg: number | null;
  rating_count: number;
}

interface OfferLike { status: string; offered_at?: string | null; responded_at?: string | null }
interface OrderLike { status: string; due_by?: string | null; delivered_at?: string | null; rating?: number | null }

export function computeStats(offers: OfferLike[], orders: OrderLike[], now: Date): PartnerStats {
  const count = (s: string) => offers.filter(o => o.status === s).length;
  const accepted = count('accepted');
  const declined = count('declined');
  const answered = offers.filter(o => (o.status === 'accepted' || o.status === 'declined') && o.offered_at && o.responded_at);
  const minutes = answered
    .map(o => (new Date(o.responded_at!).getTime() - new Date(o.offered_at!).getTime()) / 60000)
    .filter(m => Number.isFinite(m) && m >= 0);
  const live = orders.filter(o => o.status !== 'cancelled');
  const measured = live.filter(o => o.due_by);
  const breaches = measured.filter(o => {
    const done = o.status === 'delivered' && o.delivered_at ? new Date(o.delivered_at) : now;
    return done.getTime() > new Date(o.due_by!).getTime();
  });
  const ratings = live.map(o => o.rating).filter((r): r is number => typeof r === 'number');
  return {
    offers_received: offers.filter(o => o.status !== 'withdrawn').length,
    offers_accepted: accepted,
    offers_declined: declined,
    offers_taken: count('taken'),
    acceptance_rate: accepted + declined > 0 ? accepted / (accepted + declined) : null,
    avg_response_minutes: minutes.length > 0 ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null,
    orders_completed: live.filter(o => o.status === 'delivered').length,
    orders_active: live.filter(o => o.status !== 'delivered').length,
    sla_breaches: breaches.length,
    sla_measured: measured.length,
    rating_avg: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    rating_count: ratings.length,
  };
}

interface EarningsOrder {
  id: string; agreed_amount: number | string; paid_at?: string | null; accepted_at: string; delivered_at?: string | null;
  status?: string;
  [key: string]: unknown;
}

/**
 * Earnings by Indian calendar month. An amount is:
 *   - paid: delivered and marked paid by dispatch
 *   - payable: delivered, not yet paid (only a delivered order can be paid)
 *   - in progress: accepted, picked up or in transit: not payable yet
 * `unpaid` is payable plus in progress.
 */
export interface EarningsMonth { month: string; total: number; paid: number; payable: number; in_progress: number; unpaid: number; orders: EarningsOrder[] }

export function groupEarnings(orders: EarningsOrder[]) {
  const months = new Map<string, EarningsMonth>();
  for (const o of orders) {
    const month = indianDateKey(new Date(o.delivered_at ?? o.accepted_at)).slice(0, 7);
    const m: EarningsMonth = months.get(month) ?? { month, total: 0, paid: 0, payable: 0, in_progress: 0, unpaid: 0, orders: [] };
    const amount = Number(o.agreed_amount) || 0;
    const delivered = o.status ? o.status === 'delivered' : !!o.delivered_at;
    m.total += amount;
    if (o.paid_at) m.paid += amount;
    else if (delivered) m.payable += amount;
    else m.in_progress += amount;
    m.orders.push(o);
    months.set(month, m);
  }
  const list = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const m of list) {
    m.total = round(m.total); m.paid = round(m.paid); m.payable = round(m.payable); m.in_progress = round(m.in_progress);
    m.unpaid = round(m.payable + m.in_progress);
  }
  const sum = (key: 'total' | 'paid' | 'payable' | 'in_progress' | 'unpaid') => round(list.reduce((acc, m) => acc + m[key], 0));
  return { totals: { total: sum('total'), paid: sum('paid'), payable: sum('payable'), in_progress: sum('in_progress'), unpaid: sum('unpaid') }, months: list };
}
