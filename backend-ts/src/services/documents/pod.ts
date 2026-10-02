/**
 * margixindia — The proof of delivery as a document, over the custody delivery data.
 *
 * The driver's delivery (cargo_custody_events kind delivery / partial_delivery, and the pieces counted on the
 * manifests) is the evidence; this builds the POD document from it (receiver, time, delivered quantity, shortage
 * and damage, photo and signature paths). A POD is `final` once the goods are fully delivered; a part delivery
 * is a draft. Closing a trip needs a final POD, either uploaded/recorded by the carrier or taken from here.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { indianDateKey } from '../../core/istDate';
import { loadCode, requireCarrier, type LoadAccess } from './context';
import { custodyEventsOf, type CustodyEvent } from './data';
import { upsertGenerated } from './upsert';
import type { DocumentRow } from './documents.service';

/** The load's live POD document (the newest that is not cancelled or superseded), or null. */
export async function findPodDocument(loadId: string): Promise<DocumentRow | null> {
  const { data, error } = await supabase.from('load_documents').select('*').eq('load_id', loadId).eq('kind', 'pod')
    .not('status', 'in', '(cancelled,superseded)').order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(`Failed to read the proof of delivery: ${error.message}`);
  return ((data ?? [])[0] as DocumentRow | undefined) ?? null;
}

export interface PodDraft { complete: boolean; fields: Record<string, any> }

const DELIVERED_STATUSES = ['delivered', 'completed'];

/** The POD's values from the load's custody data, or null when nothing has been delivered yet. */
export function buildPodFields(access: LoadAccess, events: CustodyEvent[]): PodDraft | null {
  const deliveries = events.filter(e => e.kind === 'delivery' || e.kind === 'partial_delivery');
  if (deliveries.length === 0) return null;
  const last = deliveries[deliveries.length - 1];
  const leaves = access.manifests.some(m => !m.is_master) ? access.manifests.filter(m => !m.is_master) : access.manifests;
  const sum = (key: string) => leaves.reduce((s, m) => s + (Number(m[key]) || 0), 0);
  const complete = deliveries.some(e => e.kind === 'delivery') || (leaves.length > 0 && leaves.every(m => DELIVERED_STATUSES.includes(m.status)));
  const photos = [...new Set([...deliveries.flatMap(e => e.photo_paths ?? []), ...(access.main?.photo_url ? [access.main.photo_url as string] : [])])].slice(0, 10);
  const damage = deliveries.filter(e => e.condition && e.condition !== 'good').map(e => `${e.condition}${e.notes ? `: ${e.notes}` : ''}`).join('; ');
  const clean: Record<string, any> = {
    delivered_at: last.recorded_at,
    receiver_name: last.receiver_name ?? access.main?.received_by ?? undefined,
    signature_path: last.signature_path ?? access.main?.signature_url ?? undefined,
    photo_paths: photos.length ? photos : undefined,
    delivered_quantity: sum('pieces_delivered') || undefined,
    shortage_quantity: sum('pieces_short') || undefined,
    damaged_quantity: sum('pieces_damaged') || undefined,
    damage_details: damage ? damage.slice(0, 1000) : undefined,
    complete,
  };
  for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
  return { complete, fields: clean };
}

/**
 * The load's final POD document: the recorded one, else (once the goods are fully delivered) one created from the
 * custody data. Null when the load is not fully delivered and no final POD was recorded.
 */
export async function ensureFinalPod(access: LoadAccess): Promise<{ id: string; created: boolean } | null> {
  requireCarrier(access);
  const existing = await findPodDocument(access.load.id);
  if (existing?.status === 'final') return { id: existing.id, created: false };
  const draft = buildPodFields(access, await custodyEventsOf(access));
  if (!draft?.complete) return null;
  const row = await upsertGenerated(access, 'pod', { ...draft.fields, load_number: loadCode(access.load) }, { status: 'final', existing, docDate: indianDateKey(new Date()) });
  return { id: row.id, created: true };
}

export async function assertFinalPod(access: LoadAccess): Promise<string> {
  const pod = await ensureFinalPod(access);
  if (!pod) throw new HttpError(409, 'A final proof of delivery is required: the goods are not fully delivered and no final POD is recorded');
  return pod.id;
}
