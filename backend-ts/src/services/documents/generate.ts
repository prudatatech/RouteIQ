/**
 * margixindia — Documents the logistic company generates from the load's own data.
 *
 *   lr               LR / GR consignment note: load, transporter, route, goods, assigned vehicle (needs an accepted transporter)
 *   freight_sheet    freight, advance, amount to pay, delivery acknowledgement (needs the agreed freight)
 *   pod              the proof of delivery as a document, from the custody delivery data (see pod.service)
 *   loading_report / unloading_report   from the custody events
 *   damage_report    from the exception cases and their items
 *   trip_closure     from the settlement
 *
 * What the system does not know is left out; nothing is filled in. The values are stored in the document's
 * `fields` (so a document is a frozen record, versioned on every change) and the PDF is rendered from them.
 * Generating again updates the same document (a new version) and keeps its number.
 */
import { HttpError } from '../../core/errors';
import { indianDateKey } from '../../core/istDate';
import { requireCarrier, transporterAccepted, loadCode, loadFacts, type LoadAccess, type LoadFacts } from './context';
import { INVOICE_KINDS, isGeneratedKind } from './kinds';
import { generateBody, parseBody, parseFields } from './schemas';
import { auditDocument, listDocuments, toView, type DocumentRow, type DocumentView } from './documents.service';
import { activeDoc, upsertGenerated } from './upsert';
import { FREIGHT_SHEET_PREFIX, lrPrefixOf, nextDocumentNumber } from './numbering';
import { custodyEventsOf, exceptionsOf, manifestIds, userNames, type CustodyEvent } from './data';
import { findSettlement, toRupees, type SettlementRow } from './settlement';
import { buildPodFields } from './pod';

const LOADING_KINDS = ['pickup', 'hub_out', 'handover_in', 'return_pickup'];
const UNLOADING_KINDS = ['delivery', 'partial_delivery', 'hub_in', 'handover_out', 'return_delivery'];

/** Drops what is not known so the schemas (which treat a missing value as absent, null as wrong) accept the rest. */
export function clean<T extends Record<string, any>>(o: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0 && k !== 'items')) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

const joinParts = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(', ');

interface Gen {
  access: LoadAccess;
  facts: LoadFacts;
  today: string;
  docs: DocumentRow[];
  settlement: SettlementRow | null;
}

function issuerOf(facts: LoadFacts) {
  const org = facts.carrierOrg;
  if (!org) return undefined;
  return clean({ name: org.legal_name ?? org.name, address: joinParts(org.address, org.city, org.state, org.pincode), gstin: org.gstin, phone: org.phone });
}

const cargoOf = (load: Record<string, any>): Record<string, any> => (load.metadata && typeof load.metadata === 'object' && load.metadata.cargo) || {};

function freightRupees(g: Gen): number | undefined {
  if (g.settlement) return toRupees(g.settlement.agreed_freight);
  const cost = Number(g.access.load.cost);
  return Number.isFinite(cost) && cost > 0 ? cost : undefined;
}

function buildLr(g: Gen): Record<string, any> {
  const { load, main } = g.access;
  const { vendorOrg, carrierOrg, vehicle, driver } = g.facts;
  const cargo = cargoOf(load);
  const pickup = load.pickup_address ?? load.pickup_location;
  const drop = load.delivery_address ?? load.drop_location;
  const freight = freightRupees(g);
  return clean({
    issuer: issuerOf(g.facts),
    load_number: loadCode(load),
    transporter_name: carrierOrg ? carrierOrg.legal_name ?? carrierOrg.name : undefined,
    transporter_gstin: carrierOrg?.gstin,
    consignor_name: vendorOrg ? vendorOrg.legal_name ?? vendorOrg.name : undefined,
    consignor_gstin: vendorOrg?.gstin,
    consignee_name: main?.consignee_name ?? load.delivery_contact_name,
    pickup_address: pickup,
    delivery_address: drop,
    vehicle_number: vehicle?.plate_number,
    driver_name: driver?.name,
    driver_phone: driver?.phone,
    goods_description: cargo.description ?? cargo.name ?? cargo.category,
    packages: Number.isFinite(Number(cargo.noOfPackages ?? main?.pieces_total)) && Number(cargo.noOfPackages ?? main?.pieces_total) > 0 ? Math.round(Number(cargo.noOfPackages ?? main?.pieces_total)) : undefined,
    actual_weight_kg: Number(load.total_weight_kg ?? load.required_capacity_kg) || undefined,
    route: pickup && drop ? `${pickup} to ${drop}` : undefined,
    freight_amount: freight,
    payment_terms: g.settlement?.payment_terms,
    invoice_number: activeDoc(g.docs, ...INVOICE_KINDS)?.number,
    eway_bill_number: activeDoc(g.docs, 'eway_bill')?.number,
  });
}

function buildFreightSheet(g: Gen): Record<string, any> {
  const { load, main } = g.access;
  const { vendorOrg, vehicle } = g.facts;
  const total = freightRupees(g);
  if (total === undefined) throw new HttpError(409, 'Agree the freight first (open the settlement or price the load)');
  const advance = g.settlement ? toRupees(g.settlement.advance_paid) : 0;
  const toPay = total - advance;
  return clean({
    issuer: issuerOf(g.facts),
    load_number: loadCode(load),
    lr_number: activeDoc(g.docs, 'lr')?.number,
    vehicle_number: vehicle?.plate_number,
    from_location: load.pickup_address ?? load.pickup_location,
    to_location: load.delivery_address ?? load.drop_location,
    consignor_name: vendorOrg ? vendorOrg.legal_name ?? vendorOrg.name : undefined,
    consignee_name: main?.consignee_name ?? load.delivery_contact_name,
    actual_weight_kg: Number(load.total_weight_kg ?? load.required_capacity_kg) || undefined,
    rate: Number(load.cost_per_km) > 0 ? Number(load.cost_per_km) : undefined,
    rate_basis: Number(load.cost_per_km) > 0 ? 'per km' : undefined,
    total_freight: total,
    paid_advance: advance,
    amount_to_pay: Math.round(toPay * 100) / 100,
    payment_terms: g.settlement?.payment_terms ?? 'to_be_billed',
  });
}

const custodyLines = (events: CustodyEvent[]) => events.map(e => ({
  at: e.recorded_at, kind: e.kind, pieces: e.pieces, weight_kg: e.weight_kg, condition: e.condition, receiver_name: e.receiver_name, notes: e.notes,
}));

function buildHandling(g: Gen, kind: 'loading_report' | 'unloading_report', events: CustodyEvent[]): Record<string, any> {
  const wanted = events.filter(e => (kind === 'loading_report' ? LOADING_KINDS : UNLOADING_KINDS).includes(e.kind));
  if (wanted.length === 0) throw new HttpError(409, `No ${kind === 'loading_report' ? 'loading' : 'unloading'} has been recorded for this load yet`);
  const last = wanted[wanted.length - 1];
  const sum = (pick: (e: CustodyEvent) => number | null) => wanted.reduce((s, e) => s + (Number(pick(e)) || 0), 0);
  const pieces = sum(e => e.pieces);
  const weight = sum(e => e.weight_kg);
  const photos = [...new Set(wanted.flatMap(e => e.photo_paths ?? []))].slice(0, 10);
  return clean({
    issuer: issuerOf(g.facts),
    load_number: loadCode(g.access.load),
    occurred_at: last.recorded_at,
    location: kind === 'loading_report' ? g.access.load.pickup_address ?? g.access.load.pickup_location : g.access.load.delivery_address ?? g.access.load.drop_location,
    loaded_quantity: pieces || undefined,
    weight_kg: weight || undefined,
    confirmed_by: kind === 'unloading_report' ? last.receiver_name : undefined,
    photo_paths: photos,
    events: custodyLines(wanted),
  });
}

async function buildDamage(g: Gen, events: CustodyEvent[]): Promise<Record<string, any>> {
  const cases = await exceptionsOf(g.access);
  if (cases.length === 0) throw new HttpError(409, 'No damage or shortage has been recorded for this load');
  const items = cases.flatMap(c => c.items.map(i => ({ ...i, exception_code: c.code, type: c.type })));
  const affected = items.reduce((s, i) => s + (Number(i.pieces_affected) || 0), 0);
  const names = await userNames(cases.map(c => c.owner_id));
  const owner = cases.find(c => c.owner_id)?.owner_id;
  const remarks = events.filter(e => ['delivery', 'partial_delivery', 'refused'].includes(e.kind) && e.notes).map(e => e.notes as string).join(' ');
  return clean({
    issuer: issuerOf(g.facts),
    load_number: loadCode(g.access.load),
    exception_type: cases[0].type,
    affected_quantity: affected || undefined,
    description: cases.map(c => c.description).filter(Boolean).join(' ').slice(0, 1000),
    photo_paths: [...new Set(events.filter(e => e.condition && e.condition !== 'good').flatMap(e => e.photo_paths ?? []))].slice(0, 10),
    receiver_remarks: remarks.slice(0, 1000),
    report_date: g.today,
    responsible_person: owner ? names.get(owner) : undefined,
    items: items.map(i => clean({ exception_code: i.exception_code, type: i.type, pieces_affected: i.pieces_affected, weight_affected_kg: i.weight_affected_kg, condition: i.condition, note: i.note })),
  });
}

/** The trip closure's values from the settlement (also used when the trip is closed). */
export function buildClosureFields(g: Pick<Gen, 'access' | 'facts' | 'today' | 'docs'> & { settlement: SettlementRow }): Record<string, any> {
  const s = g.settlement;
  const approved = (s.extra_charges ?? []).filter(e => !!e.approved_at);
  const extras = approved.reduce((sum, e) => sum + e.amount, 0);
  const deductions = (s.deductions ?? []).reduce((sum, d) => sum + d.amount, 0);
  const pod = activeDoc(g.docs, 'pod');
  return clean({
    issuer: issuerOf(g.facts),
    load_number: loadCode(g.access.load),
    final_delivery_status: pod?.status === 'final' ? 'Delivered' : 'Not delivered',
    pod_reference: pod ? `POD ${pod.fields?.delivered_at ? String(pod.fields.delivered_at).slice(0, 10) : pod.id.slice(0, 8)}` : undefined,
    final_freight: toRupees(s.agreed_freight),
    additional_charges: toRupees(extras),
    deductions_total: toRupees(deductions),
    advance_paid: toRupees(s.advance_paid),
    balance_payable: toRupees(s.agreed_freight + extras - deductions - s.advance_paid),
    closure_date: s.closed_at ? indianDateKey(new Date(s.closed_at)) : g.today,
    payment_status: s.payment_status,
    extra_charges: (s.extra_charges ?? []).map(e => ({ label: e.label, amount: toRupees(e.amount), approved: !!e.approved_at })),
    deductions: (s.deductions ?? []).map(d => clean({ label: d.label, amount: toRupees(d.amount), reason: d.reason })),
  });
}

async function gather(access: LoadAccess): Promise<Gen> {
  const [facts, docs, settlement] = await Promise.all([
    loadFacts(access),
    listDocuments(access) as Promise<DocumentRow[]>,
    findSettlement(access.load.id),
  ]);
  return { access, facts, docs, settlement, today: indianDateKey(new Date()) };
}

/** The trip closure report of a settlement, written (final) when the trip is closed. */
export async function upsertClosureDocument(access: LoadAccess, settlement: SettlementRow): Promise<DocumentRow> {
  const g = await gather(access);
  const fields = parseFields('trip_closure', buildClosureFields({ ...g, settlement }));
  const row = await upsertGenerated(access, 'trip_closure', fields, { status: 'final', existing: activeDoc(g.docs, 'trip_closure') ?? null });
  await auditDocument(access, 'load_document_generated', { document_id: row.id, kind: 'trip_closure', version: row.version });
  return row;
}

/** Generates (or regenerates) one of the carrier's documents for the load. Carrier only. */
export async function generateDocument(access: LoadAccess, kind: unknown, rawBody: unknown): Promise<DocumentView> {
  requireCarrier(access);
  if (!isGeneratedKind(kind)) throw new HttpError(404, 'This document is not generated; record it with POST /documents');
  const body = parseBody(generateBody, rawBody);
  const g = await gather(access);
  const existing = activeDoc(g.docs, kind) ?? null;
  const events = ['loading_report', 'unloading_report', 'damage_report', 'pod'].includes(kind) ? await custodyEventsOf(access) : [];

  let built: Record<string, any>;
  let status: 'draft' | 'final' = body.status ?? 'final';
  let number: string | null = existing?.number ?? null;

  switch (kind) {
    case 'lr':
      if (!transporterAccepted(access)) throw new HttpError(409, 'The load has not been accepted by a logistic company yet');
      built = buildLr(g);
      if (!number) number = await nextDocumentNumber(access.carrierOrgId!, lrPrefixOf(g.facts.carrierOrg));
      break;
    case 'freight_sheet':
      built = buildFreightSheet(g);
      if (!number) number = await nextDocumentNumber(access.carrierOrgId!, FREIGHT_SHEET_PREFIX);
      break;
    case 'loading_report':
    case 'unloading_report':
      built = buildHandling(g, kind, events);
      break;
    case 'damage_report':
      built = await buildDamage(g, events);
      break;
    case 'pod': {
      const pod = buildPodFields(access, events);
      if (!pod) throw new HttpError(409, 'No delivery has been recorded for this load yet');
      built = { ...pod.fields, issuer: issuerOf(g.facts), load_number: loadCode(access.load) };
      status = body.status ?? (pod.complete ? 'final' : 'draft');
      break;
    }
    case 'trip_closure': {
      if (!g.settlement) throw new HttpError(409, 'Open the settlement before the trip closure report');
      built = buildClosureFields({ ...g, settlement: g.settlement });
      status = g.settlement.status === 'closed' ? 'final' : 'draft';
      break;
    }
  }
  const fields = parseFields(kind, { ...built, ...(body.overrides ?? {}) });
  const row = await upsertGenerated(access, kind, fields, { status, number, existing });
  await auditDocument(access, 'load_document_generated', { document_id: row.id, kind, number: row.number, version: row.version });
  return toView(row);
}

export { manifestIds };
