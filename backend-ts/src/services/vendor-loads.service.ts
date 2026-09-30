/**
 * margixindia — What a vendor sees of their loads
 *
 * The vendor portal's "My loads" board and a load's own page. A vendor's load is one of two things:
 *   - a load they posted (a vendor_shipment_requests row; once a truck is assigned it is carried by
 *     a cargo_manifest, code CM-…), or
 *   - return-trip space they won by bidding (a shipment with that bid, code RTX-…).
 * Both are read here in the vendor's words and stages, redacted like the customer's view: no driver
 * name, no seal, no staff notes, no internal freight split.
 *
 * Stages, in the order a load moves:
 *   waiting     posted, not yet accepted or priced by MargixIndia
 *   accepted    accepted at a price, truck still to be assigned (or with a partner carrier)
 *   assigned    a truck is assigned, goods not yet picked up
 *   on_the_way  picked up and moving (a hold or a problem on the way keeps it here)
 *   delivered   delivered, wholly or in part, until its invoice is paid
 *   closed      rejected, cancelled, returned, lost, or delivered and paid
 */
import { paymentTermsDays } from './company.service';
import { effectiveDueDate, overdueDays } from './invoice-detail.service';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { manifestParcelCode } from '../core/parcelCode';
import { getProofOfDelivery } from './pod.service';
import { selectIn } from './finance.service';
import { MANIFEST_CUSTODY_COLUMNS, SHIPMENT_CUSTODY_COLUMNS, piecesHeld, resolveRef, toConsignment, type Consignment } from './cargo/consignment';
import { openExceptionsFor, revisedEta, whereIs } from './cargo/custody.service';
import { ownerNotice } from './cargo/exception.service';
import { customerLots } from './cargo/lots.service';
import { vendorClaimWindow, type ClaimWindow } from './cargo/claim.service';

export const LOAD_STAGES = ['waiting', 'accepted', 'assigned', 'on_the_way', 'delivered', 'closed'] as const;
export type LoadStage = typeof LOAD_STAGES[number];

/** How a load ended or how far it got, from its custody record. */
export type LoadOutcome = 'delivered' | 'partly_delivered' | 'returned' | 'lost' | null;

const CLAIM_EVENT_KINDS = ['delivery', 'partial_delivery', 'return_delivery', 'lost'];
const OPEN_CASE = ['open', 'investigating', 'action_planned'];

export interface StageInput {
  /** vendor_shipment_requests.status, or null for return-trip space. */
  requestStatus: string | null;
  /** The carrying manifest (or shipment) status in the shipment vocabulary, or null before one exists. */
  status: string | null;
  outcome: LoadOutcome;
  /** Pieces still held; null when unknown. */
  held: number | null;
  invoiceStatus: string | null;
}

/** The stage of a load on the board. Pure, so the mapping is tested on its own. */
export function stageFor(i: StageInput): LoadStage {
  if (i.status == null) {
    switch (i.requestStatus) {
      case 'pending': return 'waiting';
      case 'approved': case 'escalated': case 'assigned_to_partner': return 'accepted';
      case 'assigned': return 'assigned';
      case 'completed': case 'fulfilled': return i.invoiceStatus === 'paid' ? 'closed' : 'delivered';
      default: return 'closed'; // rejected, cancelled
    }
  }
  if (i.outcome === 'lost' || i.status === 'lost') return 'closed';
  if (i.outcome === 'returned' || i.status === 'returned' || i.status === 'cancelled') return 'closed';
  const done = i.status === 'delivered' || i.status === 'completed' || i.status === 'partially_delivered'
    || (i.status === 'exception' && i.outcome === 'partly_delivered' && i.held === 0);
  if (done) return i.invoiceStatus === 'paid' ? 'closed' : 'delivered';
  if (i.status === 'created' || i.status === 'assigned' || i.status === 'scheduled') return 'assigned';
  return 'on_the_way';
}

export interface LoadProblem {
  id: string;
  type: string;
  title: string;
  message: string;
  opened_at: string | null;
  /** New arrival time, when the truck is moving and its position is known. */
  revised_eta: { eta_at: string; eta_text: string } | null;
}

export interface LoadInvoice {
  id: string;
  invoice_number: string;
  status: string;
  total: number | null;
  issued_at: string | null;
  due_date: string | null;
  overdue: boolean;
  days_overdue: number;
  paid_at: string | null;
  payment_method: string | null;
  payment_reference: string | null;
}

export interface VendorLoad {
  /** The id in the URL: the request id, or the shipment id for return-trip space. */
  id: string;
  kind: 'posted' | 'space';
  code: string;
  request_id: string | null;
  manifest_id: string | null;
  shipment_id: string | null;
  bid_id: string | null;
  stage: LoadStage;
  status: string;
  outcome: LoadOutcome;
  pickup: string | null;
  drop: string | null;
  weight_kg: number | null;
  pieces: number | null;
  price: number | null;
  price_source: 'agreed' | 'offered' | 'bid' | null;
  truck: { plate_number: string | null; vehicle_type: string | null } | null;
  /** The code for /track/:code, once a truck carries the goods. */
  tracking_id: string | null;
  with_partner: boolean;
  rejection_reason: string | null;
  created_at: string | null;
  delivered_at: string | null;
  invoice: LoadInvoice | null;
  problems: Pick<LoadProblem, 'id' | 'type' | 'title' | 'message' | 'opened_at'>[];
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function problemOf(e: any): Pick<LoadProblem, 'id' | 'type' | 'title' | 'message' | 'opened_at'> | null {
  const notice = ownerNotice(String(e.type));
  return notice ? { id: e.id, type: e.type, title: notice.title, message: notice.message, opened_at: e.created_at ?? null } : null;
}

const pieceCount = (metadata: any): number | null => num(metadata?.cargo?.noOfPackages) || null;

/** Every row the board needs for a set of the vendor's requests and won-bid shipments, in a fixed number of queries. */
async function assemble(requests: any[], shipments: any[], vendorId: string): Promise<VendorLoad[]> {
  const requestIds = requests.map(r => r.id as string);
  const manifests = await selectIn('cargo_manifest', 'vendor_request_id', requestIds, MANIFEST_CUSTODY_COLUMNS);
  const byRequest = new Map<string, any[]>();
  for (const m of manifests) {
    if (!m.vendor_request_id) continue;
    byRequest.set(m.vendor_request_id, [...(byRequest.get(m.vendor_request_id) ?? []), m]);
  }
  // The load itself, not a lot of it: a plain load or the master of a split one
  const mainOf = (requestId: string) => (byRequest.get(requestId) ?? []).filter(m => !m.parent_manifest_id && m.status !== 'cancelled')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
    ?? (byRequest.get(requestId) ?? []).filter(m => !m.parent_manifest_id)[0]
    ?? null;

  const mains = requests.map(r => mainOf(r.id)).filter(Boolean);
  const ownIds = [...mains.map(m => m.id), ...shipments.map(s => s.id)];
  // Lots count too: a problem or an event on a lot belongs to its master
  const lotRows = await selectIn('cargo_manifest', 'parent_manifest_id', mains.map(m => m.id), 'id, parent_manifest_id');
  const lotShipments = await selectIn('shipments', 'parent_shipment_id', shipments.map(s => s.id), 'id, parent_shipment_id');
  const parentOf = new Map<string, string>([...lotRows.map(l => [l.id, l.parent_manifest_id] as const), ...lotShipments.map(l => [l.id, l.parent_shipment_id] as const)]);
  const allIds = [...ownIds, ...parentOf.keys()];

  const terms = await paymentTermsDays();
  const [events, itemsByManifest, itemsByShipment, invoices, vehicles] = await Promise.all([
    selectIn('cargo_custody_events', 'manifest_id', allIds, 'manifest_id, shipment_id, kind, recorded_at', q => q.in('kind', CLAIM_EVENT_KINDS)),
    selectIn('cargo_exception_items', 'manifest_id', allIds, 'exception_id, manifest_id'),
    selectIn('cargo_exception_items', 'shipment_id', allIds, 'exception_id, shipment_id'),
    supabase.from('invoices').select('id, invoice_number, shipment_id, manifest_id, vendor_request_id, status, total, amount, gst_amount, issued_at, due_date, paid_at, payment_method, payment_reference')
      .eq('vendor_id', vendorId).neq('status', 'void').order('issued_at', { ascending: false }).then(r => {
        if (r.error) throw new Error(`Failed to read invoices: ${r.error.message}`);
        return (r.data ?? []) as any[];
      }),
    selectIn('vehicles', 'id', [...mains.map(m => m.current_vehicle_id ?? m.vehicle_id), ...shipments.map(s => s.current_vehicle_id)].filter(Boolean), 'id, plate_number, vehicle_type'),
  ]);
  const shipmentEvents = await selectIn('cargo_custody_events', 'shipment_id', allIds, 'manifest_id, shipment_id, kind, recorded_at', q => q.in('kind', CLAIM_EVENT_KINDS));

  const rootOf = (id: string) => parentOf.get(id) ?? id;
  const eventsOf = new Map<string, any[]>();
  for (const e of [...events, ...shipmentEvents]) {
    const key = rootOf(e.manifest_id ?? e.shipment_id);
    eventsOf.set(key, [...(eventsOf.get(key) ?? []), e]);
  }
  const outcomeOf = (id: string): { outcome: LoadOutcome; at: string | null } => {
    const list = eventsOf.get(id) ?? [];
    if (list.length === 0) return { outcome: null, at: null };
    const sorted = [...list].sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
    const kinds = new Set(list.map(e => e.kind));
    const outcome: LoadOutcome = kinds.has('lost') ? 'lost' : kinds.has('return_delivery') ? 'returned' : kinds.has('delivery') ? 'delivered' : 'partly_delivered';
    return { outcome, at: sorted[0].recorded_at };
  };

  const exceptionIds = [...new Set([...itemsByManifest, ...itemsByShipment].map(i => i.exception_id))];
  const cases = (await selectIn('cargo_exceptions', 'id', exceptionIds, 'id, code, type, status, created_at')).filter(c => OPEN_CASE.includes(c.status));
  const caseById = new Map(cases.map(c => [c.id, c]));
  const problemsOf = (id: string) => {
    const found = new Map<string, any>();
    for (const item of [...itemsByManifest, ...itemsByShipment]) {
      const owner = item.manifest_id ?? item.shipment_id;
      if (rootOf(owner) === id && caseById.has(item.exception_id)) found.set(item.exception_id, caseById.get(item.exception_id));
    }
    return [...found.values()].map(problemOf).filter((p): p is NonNullable<typeof p> => !!p);
  };

  const plate = new Map(vehicles.map(v => [v.id, v]));
  const invoiceFor = (keys: { request?: string; manifest?: string; shipment?: string }): LoadInvoice | null => {
    const row = invoices.find(i => (keys.manifest && i.manifest_id === keys.manifest) || (keys.request && i.vendor_request_id === keys.request) || (keys.shipment && i.shipment_id === keys.shipment));
    if (!row) return null;
    const due = effectiveDueDate(row, terms);
    const late = overdueDays(row, due);
    return {
      id: row.id, invoice_number: row.invoice_number, status: row.status, total: num(row.total) ?? num(row.amount),
      issued_at: row.issued_at ?? null, due_date: due, overdue: late > 0, days_overdue: late,
      paid_at: row.paid_at ?? null, payment_method: row.payment_method ?? null, payment_reference: row.payment_reference ?? null,
    };
  };

  const posted: VendorLoad[] = requests.map(r => {
    const m = mainOf(r.id);
    const c = m ? toConsignment('manifest', m) : null;
    const { outcome, at } = c ? outcomeOf(c.id) : { outcome: null as LoadOutcome, at: null };
    const invoice = invoiceFor({ request: r.id, manifest: c?.id });
    const stage = stageFor({ requestStatus: r.status, status: c?.status ?? null, outcome, held: c ? piecesHeld(c.pieces) : null, invoiceStatus: invoice?.status ?? null });
    const vehicle = c ? plate.get(c.vehicleId ?? '') : null;
    const agreed = num(r.cost);
    const offered = num(r.metadata?.offered_price_inr);
    return {
      id: r.id, kind: 'posted', code: c ? c.code : `REQ-${String(r.id).slice(0, 8).toUpperCase()}`,
      request_id: r.id, manifest_id: c?.id ?? null, shipment_id: null, bid_id: null,
      stage, status: c?.status ?? r.status, outcome,
      pickup: text(r.pickup_location), drop: text(r.drop_location),
      weight_kg: num(r.required_capacity_kg), pieces: (c?.pieces.total ?? null) ?? pieceCount(r.metadata),
      price: agreed && agreed > 0 ? agreed : offered, price_source: agreed && agreed > 0 ? 'agreed' : offered ? 'offered' : null,
      truck: vehicle ? { plate_number: vehicle.plate_number ?? null, vehicle_type: vehicle.vehicle_type ?? null } : null,
      tracking_id: c ? manifestParcelCode(c.id) : null,
      with_partner: r.status === 'assigned_to_partner' || r.status === 'escalated',
      rejection_reason: r.status === 'rejected' ? text(r.rejection_reason) : null,
      created_at: r.created_at ?? null, delivered_at: at,
      invoice, problems: c ? problemsOf(c.id) : [],
    };
  });

  const space: VendorLoad[] = shipments.map(s => {
    const c = toConsignment('shipment', s);
    const { outcome, at } = outcomeOf(c.id);
    const invoice = invoiceFor({ shipment: c.id });
    const stage = stageFor({ requestStatus: null, status: c.status, outcome, held: piecesHeld(c.pieces), invoiceStatus: invoice?.status ?? null });
    const vehicle = plate.get(c.vehicleId ?? '');
    return {
      id: c.id, kind: 'space', code: c.code, request_id: null, manifest_id: null, shipment_id: c.id, bid_id: s.bid_id ?? null,
      stage, status: c.status, outcome,
      pickup: text(s.origin_address) ?? text(s.origin_name), drop: s.__drop ?? null,
      weight_kg: num(s.total_weight_kg), pieces: c.pieces.total,
      price: num(s.__bid_amount), price_source: s.__bid_amount != null ? 'bid' : null,
      truck: vehicle ? { plate_number: vehicle.plate_number ?? null, vehicle_type: vehicle.vehicle_type ?? null } : null,
      tracking_id: c.code, with_partner: false, rejection_reason: null,
      created_at: s.created_at ?? null, delivered_at: at,
      invoice, problems: problemsOf(c.id),
    };
  });

  return [...posted, ...space].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

const SPACE_COLUMNS = `${SHIPMENT_CUSTODY_COLUMNS}, bid_id`;

/** The shipments the vendor won by bidding, each with its bid amount and drop address attached. */
async function wonSpace(vendorId: string, only?: string): Promise<any[]> {
  const { data: bids, error } = await supabase.from('capacity_bids').select('id, bid_amount').eq('vendor_id', vendorId).eq('status', 'won');
  if (error) throw new Error(`Failed to read bids: ${error.message}`);
  const amounts = new Map((bids ?? []).map((b: any) => [b.id, b.bid_amount]));
  if (amounts.size === 0) return [];
  const rows = await selectIn('shipments', 'bid_id', [...amounts.keys()], SPACE_COLUMNS, q => (only ? q.eq('id', only) : q));
  const points = await selectIn('delivery_points', 'shipment_id', rows.map(r => r.id), 'shipment_id, address, name, created_at');
  return rows.map(r => {
    const mine = points.filter(p => p.shipment_id === r.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    return { ...r, __bid_amount: amounts.get(r.bid_id) ?? null, __drop: text(mine?.address) ?? text(mine?.name) };
  });
}

/** All of a vendor's loads, newest first, with stage, price, truck, invoice and open problems. */
export async function listVendorLoads(vendorId: string): Promise<VendorLoad[]> {
  const { data, error } = await supabase
    .from('vendor_shipment_requests')
    .select('id, status, pickup_location, drop_location, required_capacity_kg, cost, rejection_reason, created_at, metadata')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to read your loads: ${error.message}`);
  return assemble((data ?? []) as any[], await wonSpace(vendorId), vendorId);
}

export interface VendorLoadDetail extends VendorLoad {
  where: {
    current_holder: string;
    depot: { name: string | null } | null;
    delivery_attempts: number;
    max_delivery_attempts: number;
    rto: boolean;
    pieces: unknown;
  } | null;
  lots: unknown[];
  pod: unknown | null;
  problems: LoadProblem[];
  claims: { id: string; code: string; claim_type: string; status: string; claimed_amount: number | null; approved_amount: number | null; settled_amount: number | null; created_at: string; lot_code: string | null }[];
  /** Whether a claim can be raised now; `until` is the last day. */
  claim_window: ClaimWindow;
}

/** One load, for its own page. 404 for a load that is not the vendor's. */
export async function vendorLoadDetail(vendorId: string, id: string): Promise<VendorLoadDetail> {
  const { data: request, error } = await supabase
    .from('vendor_shipment_requests')
    .select('id, vendor_id, status, pickup_location, drop_location, required_capacity_kg, cost, rejection_reason, created_at, metadata')
    .eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the load: ${error.message}`);

  let load: VendorLoad | undefined;
  if (request) {
    if (request.vendor_id !== vendorId) throw new HttpError(404, 'Load not found');
    load = (await assemble([request], [], vendorId))[0];
  } else {
    const space = await wonSpace(vendorId, id);
    if (space.length === 0) throw new HttpError(404, 'Load not found');
    load = (await assemble([], space, vendorId))[0];
  }

  let c: Consignment | null = null;
  if (load.manifest_id) c = await resolveRef({ manifest_id: load.manifest_id });
  else if (load.shipment_id) c = await resolveRef({ shipment_id: load.shipment_id });

  if (!c) {
    return { ...load, where: null, lots: [], pod: null, problems: [], claims: [], claim_window: { allowed: false, reason: 'A claim can be raised once your load is delivered, partly delivered or lost.', until: null } };
  }

  const open = await openExceptionsFor(c);
  const eta = open.length > 0 ? await revisedEta(c) : null;
  const where = await whereIs(c, { redacted: true });
  const finished = ['delivered', 'completed', 'partially_delivered', 'returned'].includes(c.rawStatus) || load.stage === 'delivered' || load.stage === 'closed';
  const lots = c.isMaster ? await customerLots(c) : [];
  const claimIds = [c.id, ...lots.map(l => ('manifest_id' in l.ref ? l.ref.manifest_id : l.ref.shipment_id))];
  const column = c.kind === 'manifest' ? 'manifest_id' : 'shipment_id';
  const { data: claimRows, error: claimErr } = await supabase
    .from('cargo_claims').select(`id, code, ${column}, claim_type, status, claimed_amount, approved_amount, settled_amount, created_at`)
    .in(column, claimIds).order('created_at', { ascending: false });
  if (claimErr) throw new Error(`Failed to read the claims: ${claimErr.message}`);
  const lotCode = new Map(lots.map(l => [('manifest_id' in l.ref ? l.ref.manifest_id : l.ref.shipment_id) as string, l.code]));

  return {
    ...load,
    where: {
      current_holder: where.current_holder,
      depot: where.depot ? { name: where.depot.name } : null,
      delivery_attempts: where.delivery_attempts,
      max_delivery_attempts: where.max_delivery_attempts,
      rto: where.rto,
      pieces: where.pieces,
    },
    lots: lots.map(l => ({ ref: l.ref, code: l.code, label: l.label, status: l.status, pieces: l.pieces, consignee: l.consignee ? { name: l.consignee.name } : null, drop: l.drop, vehicle: l.vehicle, depot: l.depot, text: l.text, pod: l.pod })),
    // A master holds no goods of its own once split; its lots carry the proof
    pod: finished && !c.isMaster ? await getProofOfDelivery(c.id) : null,
    problems: open.map(e => {
      const p = problemOf(e);
      return p ? { ...p, revised_eta: eta } : null;
    }).filter((p): p is LoadProblem => !!p),
    claims: ((claimRows ?? []) as any[]).map(r => ({
      id: r.id, code: r.code, claim_type: r.claim_type, status: r.status, claimed_amount: num(r.claimed_amount), approved_amount: num(r.approved_amount),
      settled_amount: num(r.settled_amount), created_at: r.created_at, lot_code: lotCode.get(r[column]) ?? null,
    })),
    claim_window: c.kind === 'manifest'
      ? await vendorClaimWindow(c)
      : { allowed: false, reason: 'For a claim on return-trip space, please contact dispatch.', until: null },
  };
}
