/**
 * margixindia — Create or update the load's one document of a generated kind.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { indianDateKey } from '../../core/istDate';
import type { LoadAccess } from './context';
import type { DocKind, GeneratedKind } from './kinds';
import { diffDocument, recordEvent, type DocumentRow } from './documents.service';

export const activeDoc = (docs: DocumentRow[], ...kinds: DocKind[]) =>
  docs.find(d => kinds.includes(d.kind) && d.status !== 'cancelled' && d.status !== 'superseded');

/**
 * Creates or updates (a new version, same number) the load's document of a generated kind.
 * `draft`/`final` is the document's status; a POD for a part-delivered load is a draft.
 */
export async function upsertGenerated(
  access: LoadAccess, kind: GeneratedKind, fields: Record<string, any>,
  opts: { status: 'draft' | 'final'; number?: string | null; docDate?: string; existing?: DocumentRow | null },
): Promise<DocumentRow> {
  const now = new Date().toISOString();
  const existing = opts.existing ?? null;
  if (existing) {
    const next = { number: existing.number, fields, status: opts.status, doc_date: opts.docDate ?? existing.doc_date };
    const changes = diffDocument(existing, next);
    if (Object.keys(changes).length === 0) return existing;
    const version = existing.version + 1;
    const { data, error } = await supabase.from('load_documents')
      .update({ fields, status: opts.status, doc_date: next.doc_date, version, updated_by: access.userId, updated_at: now })
      .eq('id', existing.id).eq('version', existing.version).select('*').maybeSingle();
    if (error) throw new Error(`Failed to update the document: ${error.message}`);
    if (!data) throw new HttpError(409, 'The document was changed by someone else. Reload and try again.');
    await recordEvent(access, existing.id, 'generated', version, changes);
    return data as DocumentRow;
  }
  const orgId = access.carrierOrgId;
  if (!orgId) throw new HttpError(409, 'This load has no logistic company yet');
  const { data, error } = await supabase.from('load_documents').insert({
    load_id: access.load.id, shipment_id: null, org_id: orgId, vendor_org_id: access.vendorOrgId, carrier_org_id: access.carrierOrgId,
    kind, number: opts.number ?? null, doc_date: opts.docDate ?? indianDateKey(new Date()), fields, file_path: null, status: opts.status,
    valid_until: null, version: 1, supersedes: null, created_by: access.userId, created_at: now, updated_by: access.userId, updated_at: now,
  }).select('*').single();
  if (error) throw new Error(`Failed to save the document: ${error.message}`);
  const row = data as DocumentRow;
  await recordEvent(access, row.id, 'generated', 1, diffDocument({ fields: {} }, row));
  return row;
}

