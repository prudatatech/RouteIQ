/**
 * margixindia — Documents of a vendor load: record, update with history, upload, list.
 *
 * Every change writes a load_document_events row (who, when, what changed), and each update bumps `version`; the
 * update is conditional on the version it read, so two people editing at once cannot silently overwrite each other.
 * The vendor organisation records and updates its own uploads (invoice, bill of supply, challan, e-way bill); the
 * carrier organisation any kind; a platform admin only reads. Files go to the private bucket `load_documents`
 * under loads/<load id>/ with a signed upload URL for one path the backend chooses, and are shown through
 * short-lived signed links.
 */
import crypto from 'crypto';
import { supabase } from '../../core/supabase';
import { settings } from '../../core/config';
import { HttpError } from '../../core/errors';
import { auditService } from '../audit.service';
import { signedUrl as kycSignedUrl } from '../pod.service';
import {
  DOC_KINDS, DOC_LABELS, VENDOR_KINDS, isGeneratedKind, isLoadPath, loadFolder, type DocKind, type DocStatus,
} from './kinds';
import { normaliseDocument, parseBody, uploadUrlBody, createDocumentBody, updateDocumentBody } from './schemas';
import type { LoadAccess, Viewer } from './context';

const SIGNED_URL_SECONDS = 600;
const UPLOAD_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export interface DocumentRow {
  id: string;
  load_id: string | null;
  shipment_id: string | null;
  org_id: string;
  vendor_org_id: string | null;
  carrier_org_id: string | null;
  kind: DocKind;
  number: string | null;
  doc_date: string | null;
  fields: Record<string, any>;
  file_path: string | null;
  status: DocStatus;
  valid_until: string | null;
  version: number;
  supersedes: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface DocumentView extends DocumentRow {
  label: string;
  /** `draft`/`final` becomes `expired` once an e-way bill is past `valid_until`. */
  effective_status: DocStatus;
  expired: boolean;
  /** Generated documents are rendered to PDF on request (GET .../pdf); an upload has a `file_url` instead. */
  generated: boolean;
  /** A 10-minute signed link to the uploaded file, or null. */
  file_url: string | null;
  /** For a POD: signed links to the delivery photos and the signature (from the custody data or the load folder). */
  evidence?: { photo_urls: string[]; signature_url: string | null };
}

export interface DocumentEvent {
  id: string;
  document_id: string;
  action: 'created' | 'updated' | 'uploaded' | 'generated' | 'status';
  changes: Record<string, { from: unknown; to: unknown }>;
  version: number;
  by: string | null;
  by_name: string | null;
  by_role: string | null;
  at: string;
}

export const isExpired = (row: Pick<DocumentRow, 'valid_until' | 'status'>, now = Date.now()): boolean =>
  !!row.valid_until && Date.parse(row.valid_until) < now && row.status !== 'cancelled' && row.status !== 'superseded';

/** A 10-minute signed link to a stored file, or null when it cannot be signed. */
export async function signedFileUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(settings.LOAD_DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

/** A stored path is in the load's own bucket (loads/...) or, for custody evidence, in the KYC/POD bucket. */
const evidenceUrl = (path: string) => (path.startsWith('loads/') ? signedFileUrl(path) : kycSignedUrl(path));

export async function toView(row: DocumentRow): Promise<DocumentView> {
  const expired = isExpired(row);
  let evidence: DocumentView['evidence'];
  if (row.kind === 'pod') {
    const photos: string[] = Array.isArray(row.fields?.photo_paths) ? row.fields.photo_paths : [];
    const signature: string | undefined = row.fields?.signature_path;
    evidence = {
      photo_urls: (await Promise.all(photos.map(evidenceUrl))).filter((u): u is string => !!u),
      signature_url: signature ? await evidenceUrl(signature) : null,
    };
  }
  return {
    ...(evidence ? { evidence } : {}),
    ...row,
    label: DOC_LABELS[row.kind],
    expired,
    effective_status: expired && (row.status === 'draft' || row.status === 'final') ? 'expired' : row.status,
    generated: isGeneratedKind(row.kind) && !row.file_path,
    file_url: await signedFileUrl(row.file_path),
  };
}

const sourceOf = (viewer: Viewer) => (viewer === 'vendor' ? 'vendor-portal' : 'staff-console');

export async function auditDocument(access: LoadAccess, action: string, subject: Record<string, unknown>): Promise<void> {
  await auditService.record(sourceOf(access.viewer), { user_id: access.userId, role: access.viewer }, action, { load_id: access.load.id, ...subject });
}

/** The documents of the load, oldest first. */
export async function listDocuments(access: LoadAccess): Promise<DocumentView[]> {
  const { data, error } = await supabase.from('load_documents').select('*').eq('load_id', access.load.id).order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to read documents: ${error.message}`);
  return Promise.all(((data ?? []) as DocumentRow[]).map(toView));
}

/** One document of the load, or a 404. */
export async function getDocument(access: LoadAccess, docId: unknown): Promise<DocumentRow> {
  if (typeof docId !== 'string' || !/^[0-9a-f-]{36}$/i.test(docId)) throw new HttpError(404, 'Document not found');
  const { data, error } = await supabase.from('load_documents').select('*').eq('id', docId).eq('load_id', access.load.id).maybeSingle();
  if (error) throw new Error(`Failed to read the document: ${error.message}`);
  if (!data) throw new HttpError(404, 'Document not found');
  return data as DocumentRow;
}

/** Who may write what: the carrier any kind, the vendor its own papers, a platform admin nothing. */
export function assertMayWrite(access: LoadAccess, kind: DocKind, existing?: DocumentRow): void {
  if (access.viewer === 'platform') throw new HttpError(403, 'Platform admins can read documents but not change them');
  if (access.viewer === 'carrier') return;
  if (!VENDOR_KINDS.includes(kind)) throw new HttpError(403, `The ${DOC_LABELS[kind].toLowerCase()} is issued by the logistic company`);
  if (existing && existing.org_id !== access.vendorOrgId && existing.created_by !== access.userId) {
    throw new HttpError(403, 'You can only change documents you uploaded');
  }
}

/** A signed upload URL for exactly one path in the private bucket. */
export async function createDocumentUploadUrl(access: LoadAccess, raw: unknown) {
  const input = parseBody(uploadUrlBody, raw);
  assertMayWrite(access, input.kind);
  const extension = UPLOAD_TYPES[input.content_type.toLowerCase()];
  if (!extension) throw new HttpError(415, 'Upload a PDF, JPG or PNG file');
  if (input.size > UPLOAD_MAX_BYTES) throw new HttpError(413, `File must be at most ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
  const path = `${loadFolder(access.load.id)}${input.kind}/${crypto.randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from(settings.LOAD_DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message}`);
  // The web PUTs the file straight to upload_url with the file's content type
  return { path: data.path, token: data.token, upload_url: data.signedUrl, signed_url: data.signedUrl, bucket: settings.LOAD_DOCUMENTS_BUCKET };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What differs between two versions: top-level columns and each key of `fields`, as { from, to }. */
export function diffDocument(before: Partial<DocumentRow>, after: Partial<DocumentRow>): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const col of ['number', 'doc_date', 'valid_until', 'status', 'file_path', 'shipment_id'] as const) {
    if (col in after && !same(before[col], after[col])) changes[col] = { from: before[col] ?? null, to: after[col] ?? null };
  }
  const b = before.fields ?? {};
  const a = after.fields ?? {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (!same(b[key], a[key])) changes[`fields.${key}`] = { from: b[key] ?? null, to: a[key] ?? null };
  }
  return changes;
}

export async function recordEvent(
  access: LoadAccess, documentId: string, action: DocumentEvent['action'], version: number, changes: DocumentEvent['changes'],
): Promise<void> {
  const { error } = await supabase.from('load_document_events').insert({
    document_id: documentId, load_id: access.load.id, action, changes, version, by: access.userId, by_role: access.viewer, at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to record the document history: ${error.message}`);
}

/** Paths in a user's fields must be inside the load's folder; one load cannot point at another's files. */
function assertOwnPaths(access: LoadAccess, fields: Record<string, any>, filePath?: string | null): void {
  const loadId = access.load.id;
  if (filePath && !isLoadPath(filePath, loadId)) throw new HttpError(400, 'file_path is not a file uploaded for this load');
  for (const p of [...(fields.photo_paths ?? []), ...(fields.signature_path ? [fields.signature_path] : [])]) {
    if (!isLoadPath(p, loadId)) throw new HttpError(400, 'A photo or signature path is not a file uploaded for this load');
  }
}

async function assertShipmentOfLoad(access: LoadAccess, shipmentId: string | undefined | null): Promise<void> {
  if (!shipmentId) return;
  const { data, error } = await supabase.from('shipments').select('id, vendor_org_id, carrier_org_id').eq('id', shipmentId).maybeSingle();
  if (error) throw new Error(`Failed to read the shipment: ${error.message}`);
  const s = data as { vendor_org_id?: string | null; carrier_org_id?: string | null } | null;
  const ok = !!s && ((!!s.carrier_org_id && s.carrier_org_id === access.carrierOrgId) || (!!s.vendor_org_id && s.vendor_org_id === access.vendorOrgId));
  if (!ok) throw new HttpError(400, 'shipment_id is not a shipment of this load');
}

/** The organisation that owns a new document: the vendor for its uploads, else the carrier. */
function ownerOrg(access: LoadAccess): string {
  const org = access.viewer === 'vendor' ? access.vendorOrgId : access.carrierOrgId ?? access.vendorOrgId;
  if (!org) throw new HttpError(409, 'This load has no organisation to own the document yet');
  return org;
}

/** Records a document (metadata, with or without an uploaded file). */
export async function createDocument(access: LoadAccess, raw: unknown): Promise<DocumentView> {
  const input = parseBody(createDocumentBody, raw);
  assertMayWrite(access, input.kind);
  const doc = normaliseDocument(input.kind, input);
  assertOwnPaths(access, doc.fields, input.file_path);
  await assertShipmentOfLoad(access, input.shipment_id);

  let superseded: DocumentRow | null = null;
  if (input.supersedes) {
    superseded = await getDocument(access, input.supersedes);
    if (superseded.kind !== input.kind) throw new HttpError(400, 'A document can only supersede one of the same kind');
    assertMayWrite(access, input.kind, superseded);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase.from('load_documents').insert({
    load_id: access.load.id,
    shipment_id: input.shipment_id ?? null,
    org_id: ownerOrg(access),
    vendor_org_id: access.vendorOrgId,
    carrier_org_id: access.carrierOrgId,
    kind: input.kind,
    number: doc.number,
    doc_date: doc.doc_date,
    fields: doc.fields,
    file_path: input.file_path ?? null,
    status: input.status ?? 'final',
    valid_until: doc.valid_until,
    version: 1,
    supersedes: superseded?.id ?? null,
    created_by: access.userId,
    created_at: now,
    updated_by: access.userId,
    updated_at: now,
  }).select('*').single();
  if (error) throw new Error(`Failed to save the document: ${error.message}`);
  const row = data as DocumentRow;
  await recordEvent(access, row.id, input.file_path ? 'uploaded' : 'created', 1, diffDocument({ fields: {} }, row));

  if (superseded && superseded.status !== 'superseded') {
    await supabase.from('load_documents').update({ status: 'superseded', version: superseded.version + 1, updated_by: access.userId, updated_at: now }).eq('id', superseded.id);
    await recordEvent(access, superseded.id, 'status', superseded.version + 1, { status: { from: superseded.status, to: 'superseded' } });
  }
  await auditDocument(access, 'load_document_created', { document_id: row.id, kind: row.kind, number: row.number });
  return toView(row);
}

/** Changes a document and writes a new version with what changed. Fields are merged into the stored ones. */
export async function updateDocument(access: LoadAccess, docId: unknown, raw: unknown): Promise<DocumentView> {
  const input = parseBody(updateDocumentBody, raw);
  const current = await getDocument(access, docId);
  assertMayWrite(access, current.kind, current);
  if (current.status === 'superseded' && input.status === undefined) throw new HttpError(409, 'This document was superseded by a newer one');
  if ((input.status === 'expired' || input.status === 'superseded') && input.status !== current.status) {
    throw new HttpError(400, `status ${input.status} is set by the system`);
  }

  const merged = normaliseDocument(current.kind, {
    number: input.number ?? current.number,
    doc_date: input.doc_date ?? current.doc_date,
    valid_until: input.valid_until ?? current.valid_until,
    fields: { ...current.fields, ...(input.fields ?? {}) },
  });
  assertOwnPaths(access, merged.fields, input.file_path);
  await assertShipmentOfLoad(access, input.shipment_id);

  const next: Partial<DocumentRow> = {
    number: merged.number,
    doc_date: merged.doc_date,
    valid_until: merged.valid_until,
    fields: merged.fields,
    file_path: input.file_path ?? current.file_path,
    status: input.status ?? current.status,
    shipment_id: input.shipment_id ?? current.shipment_id,
  };
  // An e-way bill given a later validity is live again
  if (current.kind === 'eway_bill' && !input.status && current.status === 'expired' && merged.valid_until && Date.parse(merged.valid_until) > Date.now()) next.status = 'final';
  const changes = diffDocument(current, next);
  if (Object.keys(changes).length === 0) return toView(current);

  const version = current.version + 1;
  const { data, error } = await supabase.from('load_documents')
    .update({ ...next, version, updated_by: access.userId, updated_at: new Date().toISOString() })
    .eq('id', current.id).eq('version', current.version)
    .select('*').maybeSingle();
  if (error) throw new Error(`Failed to update the document: ${error.message}`);
  if (!data) throw new HttpError(409, 'The document was changed by someone else. Reload and try again.');
  const keys = Object.keys(changes);
  const action = keys.length === 1 && keys[0] === 'status' ? 'status' : changes.file_path ? 'uploaded' : 'updated';
  await recordEvent(access, current.id, action, version, changes);
  await auditDocument(access, 'load_document_updated', { document_id: current.id, kind: current.kind, version, changed: keys });
  return toView(data as DocumentRow);
}

/** The history of one document, newest first, with who made each change. */
export async function documentHistory(access: LoadAccess, docId: unknown): Promise<DocumentEvent[]> {
  const doc = await getDocument(access, docId);
  const { data, error } = await supabase.from('load_document_events').select('*').eq('document_id', doc.id).order('at', { ascending: false });
  if (error) throw new Error(`Failed to read the document history: ${error.message}`);
  const events = (data ?? []) as Omit<DocumentEvent, 'by_name'>[];
  const ids = [...new Set(events.map(e => e.by).filter((v): v is string => !!v))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', ids);
    for (const u of users ?? []) names.set((u as any).id, (u as any).full_name ?? null);
  }
  return events.map(e => ({ ...e, by_name: e.by ? names.get(e.by) ?? null : null }));
}

export { DOC_KINDS };
