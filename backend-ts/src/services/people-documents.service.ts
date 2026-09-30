/**
 * margixindia — People documents: upload, review and files.
 *
 * Files sit in the private kyc_documents bucket under people/<user_id>/<type>/,
 * uploaded with a signed URL for one path. Only that person's own folder is
 * accepted when the document is saved. The full Aadhaar number is never kept:
 * a document stores the last four digits and a keyed hash used to find
 * duplicates. A replaced document is archived, never deleted.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { HttpError, parseRejectionReason } from '../core/errors';
import { settings } from '../core/config';
import { createKycUploadUrl, signedUrl } from './pod.service';
import { notificationService } from './notification.service';
import {
  isAadhaarFormat, isPassportNumber, isPanFormat, isVoterId, looksLikeDrivingLicence, maskAadhaar, normalizeAadhaar,
  normalizeCode, normalizePan, sameName,
} from '../utils/people-validators';
import {
  Actor, PersonRow, assertCanModify, assertFresh, isPeoplePathFor, logActivity, nowIso, parseRequiredText, withWarnings,
} from './people-common';
import {
  DOC_LABELS, DOC_NEEDS_EXPIRY, DOC_NEEDS_NUMBER, DOC_TYPES, DocRow, DocType, addDays, daysBetween, effectiveStatus,
  isExpiring, todayKey,
} from './people-docs.service';
import { getPeopleSettings, hashIdentifier } from './people-settings.service';
import { assertAgeForLicenceClasses, duplicateError, getProfile, parseDate } from './people-profile.service';

const CONTENT_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const MAX_EXTRA_FILES = 4;
const LICENCE_CLASSES = ['LMV', 'HMV', 'HGMV', 'HPMV', 'TRANS', 'MCWG', 'MCWOG'];
/** Metadata keys the server owns; clients can't set them. */
const RESERVED_METADATA = new Set(['reminders_sent', 'verification_note', 'retention_purged_at']);

// ── Output ─────────────────────────────────────────────────

export interface DocContext { today: string; personName: string | null; graceDays: number }

export async function documentContext(person: Pick<PersonRow, 'full_name'>): Promise<DocContext> {
  return { today: todayKey(), personName: person.full_name, graceDays: (await getPeopleSettings()).licence_grace_days };
}

/** A document as clients see it: no hash, Aadhaar masked, status as of today. */
export function serializeDocument(doc: Record<string, any>, ctx: DocContext): Record<string, any> {
  const status = effectiveStatus(doc as DocRow, ctx.today);
  const metadata = { ...(doc.metadata ?? {}) };
  delete metadata.reminders_sent;
  const isLicence = doc.doc_type === 'driving_licence';
  const inGrace = isLicence && status === 'expired' && !!doc.expires_on && ctx.graceDays > 0 && daysBetween(doc.expires_on, ctx.today) <= ctx.graceDays;
  const { number_hash: _hash, ...rest } = doc;
  return {
    ...rest,
    label: DOC_LABELS[doc.doc_type as DocType] ?? 'Document',
    doc_number: doc.doc_type === 'aadhaar' ? maskAadhaar(doc.number_last4 ? `00000000${doc.number_last4}` : null) : (doc.doc_number ?? null),
    number_last4: doc.number_last4 ?? null,
    extra_file_paths: doc.extra_file_paths ?? [],
    metadata,
    status,
    stored_status: doc.status,
    verification_note: typeof metadata.verification_note === 'string' ? metadata.verification_note : (doc.metadata?.verification_note ?? null),
    days_to_expiry: doc.expires_on ? daysBetween(ctx.today, doc.expires_on) : null,
    expiring: isExpiring(doc as DocRow, ctx.today),
    review_due: !!doc.review_by && doc.review_by <= ctx.today,
    in_grace: inGrace,
    grace_until: inGrace ? addDays(doc.expires_on, ctx.graceDays) : null,
    name_mismatch: !!doc.name_on_document && !sameName(doc.name_on_document, ctx.personName),
  };
}

// ── Input ──────────────────────────────────────────────────

function parseDocType(value: unknown): DocType {
  if (typeof value !== 'string' || !(DOC_TYPES as readonly string[]).includes(value)) {
    throw new HttpError(400, `doc_type must be one of ${DOC_TYPES.join(', ')}`);
  }
  return value as DocType;
}

interface PreparedNumber { display: string | null; last4: string; hash: string; warnings: string[] }

/** Checks a document number for its type and returns what is stored (never the full Aadhaar) plus soft warnings. */
export function prepareNumber(type: DocType, raw: unknown): PreparedNumber {
  if (typeof raw !== 'string' || !raw.trim()) throw new HttpError(400, `${DOC_LABELS[type]} number is required`);
  const warnings: string[] = [];
  let normalized: string;
  let display: string | null;
  switch (type) {
    case 'aadhaar':
      normalized = normalizeAadhaar(raw);
      if (!isAadhaarFormat(normalized)) throw new HttpError(400, 'Aadhaar must be 12 digits and pass the checksum. Check for a typing mistake');
      display = null;
      break;
    case 'pan':
      normalized = normalizePan(raw);
      if (!isPanFormat(normalized)) throw new HttpError(400, 'PAN must look like ABCDE1234F');
      display = normalized;
      break;
    case 'voter_id':
      normalized = normalizeCode(raw);
      if (!isVoterId(normalized)) throw new HttpError(400, 'Voter ID must be three letters and seven digits');
      display = normalized;
      break;
    case 'passport':
      normalized = normalizeCode(raw);
      if (!isPassportNumber(normalized)) throw new HttpError(400, 'Passport number must be a letter and seven digits');
      display = normalized;
      break;
    case 'driving_licence':
      normalized = normalizeCode(raw);
      if (normalized.length < 5 || normalized.length > 20 || !/^[A-Z0-9/]+$/.test(normalized)) throw new HttpError(400, 'Driving licence number must be 5 to 20 letters and digits');
      if (!looksLikeDrivingLicence(normalized)) warnings.push('licence_number_format');
      display = normalized;
      break;
    default:
      normalized = normalizeCode(raw);
      if (!normalized || normalized.length > 40) throw new HttpError(400, 'Document number must be at most 40 characters');
      display = normalized;
  }
  return { display, last4: normalized.slice(-4), hash: hashIdentifier(type, normalized), warnings };
}

function parseMetadata(input: unknown, type: DocType): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'metadata must be an object');
  const out: Record<string, unknown> = {};
  const entries = Object.entries(input as Record<string, unknown>).filter(([k]) => !RESERVED_METADATA.has(k));
  if (entries.length > 20) throw new HttpError(400, 'metadata has too many fields');
  for (const [key, value] of entries) {
    if (!/^[a-z0-9_]{1,40}$/.test(key)) throw new HttpError(400, `metadata key ${key} is not allowed`);
    if (key === 'licence_classes' || key === 'licence_class') continue; // handled below
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new HttpError(400, `metadata ${key} must be text, a number or true/false`);
    out[key] = typeof value === 'string' ? value.trim().slice(0, 200) : value;
  }
  if (type === 'driving_licence') {
    const raw = (input as any).licence_classes ?? ((input as any).licence_class ? [(input as any).licence_class] : []);
    if (!Array.isArray(raw)) throw new HttpError(400, 'licence_classes must be a list');
    const classes = [...new Set(raw.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean))];
    const bad = classes.find(c => !LICENCE_CLASSES.includes(c));
    if (bad) throw new HttpError(400, `Licence class ${bad} is not one of ${LICENCE_CLASSES.join(', ')}`);
    if (classes.length) out.licence_classes = classes;
  }
  if (type === 'other') {
    const title = typeof out.title === 'string' ? out.title : '';
    if (!title) throw new HttpError(400, 'A title is required for this document (metadata.title)');
  }
  return out;
}

function parseExtraFiles(value: unknown, userId: string, type: DocType): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_EXTRA_FILES) throw new HttpError(400, `extra_file_paths can hold up to ${MAX_EXTRA_FILES} files`);
  for (const path of value) {
    if (!isPeoplePathFor(path, userId, type)) throw new HttpError(400, "Every file must be uploaded to this person's own folder for this document type");
  }
  return value as string[];
}

function parseVerificationMethod(value: unknown): void {
  if (value === undefined || value === null || value === 'manual') return;
  throw new HttpError(400, 'Only manual verification is available for now');
}

const optionalDate = (body: any, key: string, label: string): string | null | undefined =>
  Object.prototype.hasOwnProperty.call(body, key) ? (body[key] === null || body[key] === '' ? null : parseDate(body[key], label)) : undefined;

/** Documents can be stored only after the person's consent is on record. */
export async function assertConsent(userId: string): Promise<void> {
  const profile = await getProfile(userId);
  if (!profile?.consent_at) {
    throw new HttpError(409, "Record this person's consent before adding documents", { code: 'consent_required' });
  }
}

function assertNotAnonymised(profile: Record<string, any> | null): void {
  if (profile?.anonymised_at) throw new HttpError(409, 'This person has been anonymised');
}

async function assertNotDuplicate(type: DocType, hash: string, exceptUserId: string): Promise<void> {
  const { data, error } = await supabase.from('user_documents').select('user_id').eq('doc_type', type).eq('number_hash', hash);
  if (error) throw new Error(`Failed to check duplicates: ${error.message}`);
  const other = (data ?? []).find(r => r.user_id !== exceptUserId);
  if (!other) return;
  const { data: person } = await supabase.from('users').select('id, full_name, role, status').eq('id', other.user_id).maybeSingle();
  if (person) throw duplicateError(`This ${DOC_LABELS[type]} number is already on file for ${person.full_name ?? 'another person'}`, person as PersonRow);
  throw new HttpError(409, `This ${DOC_LABELS[type]} number is already on file for another person`);
}

/** Who already has this number, without saving anything (for the screens to warn early). */
export async function findDocumentDuplicate(type: unknown, number: unknown, exceptUserId?: string): Promise<Array<Record<string, any>>> {
  const docType = parseDocType(type);
  const { hash } = prepareNumber(docType, number);
  const { data } = await supabase.from('user_documents').select('user_id').eq('doc_type', docType).eq('number_hash', hash);
  const ids = [...new Set((data ?? []).map(r => r.user_id).filter(id => id !== exceptUserId))];
  if (ids.length === 0) return [];
  const { data: people } = await supabase.from('users').select('id, full_name, role, status').in('id', ids);
  return (people ?? []).map(p => ({ ...p, matched_on: docType }));
}

// ── Upload ─────────────────────────────────────────────────

export async function createUploadUrl(subject: PersonRow, body: Record<string, any>) {
  const type = parseDocType(body.doc_type);
  const fileName = parseRequiredText(body.file_name, 'file_name', 200);
  const extension = typeof body.content_type === 'string' ? CONTENT_TYPES[body.content_type.toLowerCase()] : undefined;
  if (!extension) throw new HttpError(415, 'Upload a PDF, JPG or PNG file');
  if (body.size !== undefined && body.size !== null) {
    const bytes = Number(body.size);
    if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size must be a whole number of bytes');
    if (bytes > settings.PEOPLE_UPLOAD_MAX_BYTES) {
      throw new HttpError(413, `File must be at most ${Math.floor(settings.PEOPLE_UPLOAD_MAX_BYTES / 1024 / 1024)} MB`);
    }
  }
  await assertConsent(subject.id);
  const path = `people/${subject.id}/${type}/${crypto.randomUUID()}.${extension}`;
  void fileName;
  return createKycUploadUrl(path);
}

// ── Create ─────────────────────────────────────────────────

export async function createDocument(actor: Actor, subject: PersonRow, body: Record<string, any>) {
  const profile = await getProfile(subject.id);
  assertNotAnonymised(profile);
  if (!profile?.consent_at) throw new HttpError(409, "Record this person's consent before adding documents", { code: 'consent_required' });

  const type = parseDocType(body.doc_type);
  const metadata = parseMetadata(body.metadata, type);
  const warnings: string[] = [];

  let number: PreparedNumber | null = null;
  if (DOC_NEEDS_NUMBER.has(type)) number = prepareNumber(type, body.doc_number);
  else if (typeof body.doc_number === 'string' && body.doc_number.trim() && type !== 'other') number = prepareNumber(type, body.doc_number);
  if (number) warnings.push(...number.warnings);
  if (number) await assertNotDuplicate(type, number.hash, subject.id);

  const issuedOn = optionalDate(body, 'issued_on', 'Issue date') ?? null;
  const expiresOn = optionalDate(body, 'expires_on', 'Expiry date') ?? null;
  const reviewBy = optionalDate(body, 'review_by', 'Review date') ?? null;
  if (DOC_NEEDS_EXPIRY.has(type) && !expiresOn) throw new HttpError(400, `${DOC_LABELS[type]} needs an expiry date`);
  if (issuedOn && issuedOn > todayKey()) throw new HttpError(400, "Issue date can't be in the future");
  if (issuedOn && expiresOn && expiresOn < issuedOn) throw new HttpError(400, 'Expiry date is before the issue date');

  if (!isPeoplePathFor(body.file_path, subject.id, type)) throw new HttpError(400, "file_path must be a file you uploaded to this person's own folder for this document type");
  const filePath: string = body.file_path;
  const extra = parseExtraFiles(body.extra_file_paths, subject.id, type);
  parseVerificationMethod(body.verification_method);
  const nameOnDocument = body.name_on_document ? parseRequiredText(body.name_on_document, 'name_on_document', 100) : null;

  if (type === 'driving_licence') assertAgeForLicenceClasses(profile.date_of_birth, (metadata.licence_classes as string[]) ?? []);

  // The live document this one replaces (for "other", one with the same title)
  const { data: liveRows, error: liveError } = await supabase.from('user_documents')
    .select('id, doc_type, status, resubmission_count, metadata').eq('user_id', subject.id).eq('doc_type', type).is('archived_at', null);
  if (liveError) throw new Error(`Failed to read documents: ${liveError.message}`);
  const replaced = (liveRows ?? []).filter(d => type !== 'other' || (d.metadata as any)?.title === metadata.title);
  const previous = replaced[0];
  const resubmission = previous?.status === 'rejected' ? Number(previous.resubmission_count ?? 0) + 1 : 0;

  const row = {
    user_id: subject.id,
    doc_type: type,
    doc_number: number?.display ?? null,
    number_last4: number?.last4 ?? null,
    number_hash: number?.hash ?? null,
    issued_on: issuedOn,
    expires_on: expiresOn,
    review_by: reviewBy,
    file_path: filePath,
    extra_file_paths: extra.length ? extra : null,
    name_on_document: nameOnDocument,
    status: 'pending',
    metadata,
    verification_method: 'manual',
    resubmission_count: resubmission,
    uploaded_by: actor.user_id,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data: created, error } = await supabase.from('user_documents').insert(row).select().single();
  if (error || !created) throw new Error(`Failed to save document: ${error?.message}`);

  if (replaced.length > 0) {
    await supabase.from('user_documents').update({ archived_at: nowIso(), updated_at: nowIso() }).in('id', replaced.map(d => d.id));
  }
  await logActivity(subject.id, actor.user_id, 'document_added', {
    doc_id: created.id, doc_type: type, replaced: replaced.map(d => d.id), resubmission_count: resubmission,
  });
  // Staff review what a person uploads themselves; a document staff add on someone's behalf needs no notice
  if (actor.user_id === subject.id && subject.role === 'driver') {
    try {
      await notificationService.notifyStaff(
        'Document uploaded',
        `${subject.full_name ?? 'A driver'} uploaded a ${DOC_LABELS[type].toLowerCase()} to review.`,
        'document_uploaded',
        { user_id: subject.id, doc_id: created.id, doc_type: type },
      );
    } catch (e: any) {
      console.error('[people] could not notify staff about an uploaded document:', e.message);
    }
  }
  const ctx = await documentContext(subject);
  const out = serializeDocument(created, ctx);
  if (out.name_mismatch) warnings.push('name_mismatch');
  return withWarnings(out, warnings);
}

// ── Review and edit ────────────────────────────────────────

async function loadLiveDocument(subjectId: string, docId: string): Promise<Record<string, any>> {
  if (!/^[0-9a-f-]{36}$/i.test(docId)) throw new HttpError(404, 'Document not found');
  const { data, error } = await supabase.from('user_documents').select('*').eq('id', docId).eq('user_id', subjectId).is('archived_at', null).maybeSingle();
  if (error) throw new Error(`Failed to read document: ${error.message}`);
  if (!data) throw new HttpError(404, 'Document not found');
  return data;
}

export async function updateDocument(actor: Actor, subject: PersonRow, docId: string, body: Record<string, any>) {
  assertCanModify(actor, subject);
  const profile = await getProfile(subject.id);
  assertNotAnonymised(profile);
  const doc = await loadLiveDocument(subject.id, docId);
  assertFresh(doc.updated_at, body.updated_at);

  const type = doc.doc_type as DocType;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const patch: Record<string, any> = {};
  const changed: string[] = [];
  const warnings: string[] = [];

  if (has('doc_number')) {
    if (type === 'aadhaar' && actor.role === 'manager') throw new HttpError(403, 'Only an admin can change an Aadhaar number');
    const number = prepareNumber(type, body.doc_number);
    warnings.push(...number.warnings);
    await assertNotDuplicate(type, number.hash, subject.id);
    Object.assign(patch, { doc_number: number.display, number_last4: number.last4, number_hash: number.hash });
    changed.push('doc_number');
  }
  for (const [key, label] of [['issued_on', 'Issue date'], ['expires_on', 'Expiry date'], ['review_by', 'Review date']] as const) {
    const value = optionalDate(body, key, label);
    if (value !== undefined) {
      if (key === 'expires_on' && value === null && DOC_NEEDS_EXPIRY.has(type)) throw new HttpError(400, `${DOC_LABELS[type]} needs an expiry date`);
      patch[key] = value;
      changed.push(key);
    }
  }
  const issued = 'issued_on' in patch ? patch.issued_on : doc.issued_on;
  const expires = 'expires_on' in patch ? patch.expires_on : doc.expires_on;
  if (issued && issued > todayKey()) throw new HttpError(400, "Issue date can't be in the future");
  if (issued && expires && expires < issued) throw new HttpError(400, 'Expiry date is before the issue date');

  if (has('name_on_document')) {
    patch.name_on_document = body.name_on_document ? parseRequiredText(body.name_on_document, 'name_on_document', 100) : null;
    changed.push('name_on_document');
  }
  if (has('extra_file_paths')) {
    patch.extra_file_paths = parseExtraFiles(body.extra_file_paths, subject.id, type);
    if ((patch.extra_file_paths as string[]).length === 0) patch.extra_file_paths = null;
    changed.push('extra_file_paths');
  }
  parseVerificationMethod(body.verification_method);

  let metadata: Record<string, any> = { ...(doc.metadata ?? {}) };
  if (has('metadata')) {
    const incoming = parseMetadata(body.metadata, type);
    const kept = Object.fromEntries(Object.entries(metadata).filter(([k]) => RESERVED_METADATA.has(k)));
    metadata = { ...kept, ...incoming };
    changed.push('metadata');
    if (type === 'driving_licence') assertAgeForLicenceClasses(profile?.date_of_birth, (incoming.licence_classes as string[]) ?? []);
  }
  if (changed.includes('expires_on')) delete metadata.reminders_sent; // reminders start again for the new date
  if (changed.includes('review_by')) delete metadata.reminders_sent;

  // Status: verify or reject; any other edit of a checked document needs checking again
  let status: string | undefined;
  const editedContent = changed.length > 0;
  if (has('status')) {
    if (body.status !== 'verified' && body.status !== 'rejected') throw new HttpError(400, "status can only be set to 'verified' or 'rejected'");
    if (actor.user_id === subject.id) throw new HttpError(403, "You can't verify or reject your own documents");
    status = body.status;
  }
  const merged: Record<string, any> = { ...doc, ...patch, metadata };
  const mismatch = !!merged.name_on_document && !sameName(merged.name_on_document, subject.full_name);
  let event: 'document_updated' | 'document_verified' | 'document_rejected' = 'document_updated';
  let rejectionReason: string | null = null;

  if (status === 'verified') {
    if (!merged.file_path) throw new HttpError(409, 'This document has no file to verify');
    if (merged.expires_on && merged.expires_on < todayKey()) throw new HttpError(409, 'This document has expired. Update the expiry date, or reject it');
    if (mismatch) {
      const note = typeof body.verification_note === 'string' ? body.verification_note.trim() : '';
      if (note.length < 3) {
        throw new HttpError(409, `The name on this document (${merged.name_on_document}) doesn't match the profile name. Add a verification note to verify it`, { code: 'name_mismatch' });
      }
      metadata.verification_note = note.slice(0, 300);
    }
    Object.assign(patch, { status: 'verified', verified_by: actor.user_id, verified_at: nowIso(), rejection_reason: null });
    event = 'document_verified';
  } else if (status === 'rejected') {
    rejectionReason = parseRejectionReason(body.rejection_reason);
    Object.assign(patch, { status: 'rejected', rejection_reason: rejectionReason, verified_by: null, verified_at: null });
    event = 'document_rejected';
  } else if (editedContent && (doc.status === 'verified' || doc.status === 'expired')) {
    Object.assign(patch, { status: 'pending', verified_by: null, verified_at: null });
  }

  if (Object.keys(patch).length === 0 && !has('metadata')) throw new HttpError(400, 'Nothing to update');
  patch.metadata = metadata;
  patch.updated_at = nowIso();
  const { data: updated, error } = await supabase.from('user_documents').update(patch).eq('id', doc.id).select().single();
  if (error || !updated) throw new Error(`Failed to update document: ${error?.message}`);

  await logActivity(subject.id, actor.user_id, event, {
    doc_id: doc.id, doc_type: type, fields: changed, ...(rejectionReason ? { reason: rejectionReason } : {}),
    ...(metadata.verification_note && status === 'verified' ? { note: metadata.verification_note } : {}),
  });
  if (status === 'verified' && doc.status !== 'verified' && actor.user_id !== subject.id) {
    try {
      await notificationService.sendNotification(
        subject.id,
        `${DOC_LABELS[type]} verified`,
        `Your ${DOC_LABELS[type].toLowerCase()} was checked and verified.`,
        'document_verified',
        { user_id: subject.id, doc_id: doc.id, doc_type: type },
      );
    } catch (e: any) {
      console.error('[people] could not notify about a verified document:', e.message);
    }
  }
  if (status === 'rejected') {
    try {
      await notificationService.sendNotification(
        subject.id,
        `${DOC_LABELS[type]} rejected`,
        `Your ${DOC_LABELS[type].toLowerCase()} was rejected: ${rejectionReason}. Please upload a new one.`,
        'document_rejected',
        { user_id: subject.id, doc_id: doc.id, doc_type: type },
      );
    } catch (e: any) {
      console.error('[people] could not notify about a rejected document:', e.message);
    }
  }
  const out = serializeDocument(updated, await documentContext(subject));
  if (out.name_mismatch) warnings.push('name_mismatch');
  return withWarnings(out, warnings);
}

// ── Files and archive ──────────────────────────────────────

/**
 * A 10-minute signed link. Without `index` it is the main file; `index` n picks
 * extra page n (the back of a card), counting from 0.
 */
export async function getDocumentFile(actor: Actor, subject: PersonRow, docId: string, index?: number) {
  const doc = await loadLiveDocument(subject.id, docId);
  const extra = ((doc.extra_file_paths ?? []) as string[]);
  let path: string | null = doc.file_path;
  if (index !== undefined) {
    if (!Number.isInteger(index) || index < 0 || index >= extra.length) throw new HttpError(404, 'This document has no such page');
    path = extra[index];
  }
  if (!path) throw new HttpError(404, 'This document has no file');
  const url = await signedUrl(path);
  if (!url) throw new HttpError(502, 'Could not open the file. Try again');
  if (actor.user_id !== subject.id) await logActivity(subject.id, actor.user_id, 'document_viewed', { doc_id: doc.id, doc_type: doc.doc_type, page: index ?? 'main' });
  return { url, extra_pages: extra.length };
}

export async function archiveDocument(actor: Actor, subject: PersonRow, docId: string): Promise<void> {
  assertCanModify(actor, subject);
  const doc = await loadLiveDocument(subject.id, docId);
  const { error } = await supabase.from('user_documents').update({ archived_at: nowIso(), updated_at: nowIso() }).eq('id', doc.id);
  if (error) throw new Error(`Failed to archive document: ${error.message}`);
  await logActivity(subject.id, actor.user_id, 'document_archived', { doc_id: doc.id, doc_type: doc.doc_type });
}

/** Live documents of a person, as clients see them. */
export async function listDocuments(subject: PersonRow): Promise<Array<Record<string, any>>> {
  const { data, error } = await supabase.from('user_documents').select('*').eq('user_id', subject.id).is('archived_at', null);
  if (error) throw new Error(`Failed to read documents: ${error.message}`);
  const ctx = await documentContext(subject);
  return (data ?? [])
    .filter(d => !d.archived_at)
    .sort((a, b) => String(a.doc_type).localeCompare(String(b.doc_type)))
    .map(d => serializeDocument(d, ctx));
}
