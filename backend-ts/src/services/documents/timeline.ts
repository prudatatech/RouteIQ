/**
 * margixindia — One timeline for a load (PRD A3: track from acceptance through dispatch, delivery and closure).
 *
 * Merges the load's own status changes, its documents (each version), custody events, exception cases and the
 * trip settlement into one chronological list, oldest first.
 */
import { supabase } from '../../core/supabase';
import { DOC_LABELS, isDocKind } from './kinds';
import { custodyEventsOf, exceptionsOf, userNames } from './data';
import { findSettlement } from './settlement';
import type { LoadAccess } from './context';
import { loadCode } from './context';

export interface TimelineEntry {
  at: string;
  type: 'load' | 'document' | 'custody' | 'exception' | 'settlement';
  title: string;
  detail: string | null;
  by: string | null;
  ref: Record<string, string | null>;
}

const CUSTODY_TITLES: Record<string, string> = {
  booked: 'Booked', accepted: 'Accepted', arrived_pickup: 'Arrived at pickup', pickup: 'Goods picked up', departed: 'Departed',
  arrived_drop: 'Arrived at delivery point', delivery: 'Delivered', partial_delivery: 'Partly delivered', refused: 'Delivery refused',
  undelivered: 'Not delivered', handover_out: 'Handed over', handover_in: 'Taken over', hub_in: 'Received at hub', hub_out: 'Left hub',
  return_pickup: 'Return picked up', return_delivery: 'Returned to sender', inspection: 'Inspected', hold: 'Put on hold',
  release_hold: 'Hold released', lost: 'Reported lost', split: 'Split into lots', merge: 'Lots merged',
};

const ACTION_TITLES: Record<string, string> = { created: 'recorded', updated: 'updated', uploaded: 'file uploaded', generated: 'generated', status: 'status changed' };

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const rupees = (n: number) => `Rs. ${(n / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function loadTimeline(access: LoadAccess): Promise<TimelineEntry[]> {
  const { load } = access;
  const [{ data: docEvents, error }, custody, exceptions, settlement] = await Promise.all([
    supabase.from('load_document_events').select('document_id, action, version, by, at, changes').eq('load_id', load.id),
    custodyEventsOf(access),
    exceptionsOf(access),
    findSettlement(load.id),
  ]);
  if (error) throw new Error(`Failed to read the document history: ${error.message}`);
  const { data: docs, error: dErr } = await supabase.from('load_documents').select('id, kind, number').eq('load_id', load.id);
  if (dErr) throw new Error(`Failed to read documents: ${dErr.message}`);
  const docById = new Map((docs ?? []).map((d: any) => [d.id as string, d]));
  const names = await userNames([...(docEvents ?? []).map((e: any) => e.by), ...custody.map(c => c.recorded_by), settlement?.closed_by]);
  const who = (id: string | null | undefined) => (id ? names.get(id) ?? null : null);

  const out: TimelineEntry[] = [];
  const code = loadCode(load);
  if (load.created_at) out.push({ at: load.created_at, type: 'load', title: 'Load posted', detail: code, by: null, ref: { load_id: load.id } });
  for (const m of access.manifests) {
    if (m.created_at && !m.parent_manifest_id) out.push({ at: m.created_at, type: 'load', title: 'Vehicle assigned', detail: null, by: null, ref: { manifest_id: m.id } });
  }
  if (load.updated_at && load.status && load.status !== 'pending' && load.updated_at !== load.created_at) {
    out.push({ at: load.updated_at, type: 'load', title: `Load ${String(load.status).replace(/_/g, ' ')}`, detail: load.rejection_reason ?? null, by: null, ref: { load_id: load.id } });
  }

  for (const e of (docEvents ?? []) as any[]) {
    const d = docById.get(e.document_id);
    const kind: unknown = d?.kind;
    const label = isDocKind(kind) ? DOC_LABELS[kind] : 'Document';
    const changed = Object.keys(e.changes ?? {}).filter(k => k !== 'status');
    out.push({
      at: e.at, type: 'document',
      title: `${label}${d?.number ? ` ${d.number}` : ''} ${ACTION_TITLES[e.action] ?? e.action}`,
      detail: e.action === 'updated' && changed.length ? `Changed: ${changed.map(k => k.replace(/^fields\./, '')).join(', ')} (version ${e.version})` : e.version > 1 ? `Version ${e.version}` : null,
      by: who(e.by), ref: { document_id: e.document_id },
    });
  }

  for (const c of custody) {
    const parts = [c.pieces != null ? `${c.pieces} pieces` : null, c.condition && c.condition !== 'good' ? c.condition.replace(/_/g, ' ') : null, c.receiver_name ? `received by ${c.receiver_name}` : null, c.notes].filter(Boolean);
    out.push({ at: c.recorded_at, type: 'custody', title: CUSTODY_TITLES[c.kind] ?? titleCase(c.kind), detail: parts.join(', ') || null, by: who(c.recorded_by), ref: { custody_event_id: c.id } });
  }

  for (const x of exceptions) {
    out.push({ at: x.created_at, type: 'exception', title: `Problem reported: ${titleCase(x.type)}`, detail: x.description, by: null, ref: { exception_id: x.id } });
    if (x.resolved_at) out.push({ at: x.resolved_at, type: 'exception', title: `Problem resolved: ${titleCase(x.type)}`, detail: x.resolution ? titleCase(x.resolution) : null, by: null, ref: { exception_id: x.id } });
  }

  if (settlement) {
    out.push({ at: settlement.created_at, type: 'settlement', title: 'Settlement opened', detail: `Agreed freight ${rupees(settlement.agreed_freight)}`, by: null, ref: { settlement_id: settlement.id } });
    for (const e of settlement.extra_charges ?? []) {
      if (e.added_at) out.push({ at: e.added_at, type: 'settlement', title: `Extra charge added: ${e.label}`, detail: rupees(e.amount), by: null, ref: { settlement_id: settlement.id } });
      if (e.approved_at) out.push({ at: e.approved_at, type: 'settlement', title: `Extra charge approved: ${e.label}`, detail: rupees(e.amount), by: null, ref: { settlement_id: settlement.id } });
    }
    for (const d of settlement.deductions ?? []) {
      if (d.added_at) out.push({ at: d.added_at, type: 'settlement', title: `Deduction: ${d.label}`, detail: `${rupees(d.amount)}${d.reason ? `, ${d.reason}` : ''}`, by: null, ref: { settlement_id: settlement.id } });
    }
    if (settlement.closed_at) out.push({ at: settlement.closed_at, type: 'settlement', title: 'Trip closed', detail: `Balance ${rupees(settlement.balance)}`, by: who(settlement.closed_by), ref: { settlement_id: settlement.id } });
  }

  return out.filter(e => !!e.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
