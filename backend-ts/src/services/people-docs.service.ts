/**
 * margixindia — People documents: the rules, and what is derived from them.
 *
 * Which documents each role needs, whether a document is currently expired or
 * about to be, how complete a person's file is, the driving-licence status
 * dispatch warns on, and the daily job that marks documents expired and
 * reminds staff (and the driver) at 30 days, 7 days and on the day.
 */
import { supabase } from '../core/supabase';
import { indianDateKey } from '../core/istDate';
import { selectIn } from './finance.service';
import { notificationService } from './notification.service';

export const DOC_TYPES = [
  'driving_licence', 'aadhaar', 'pan', 'photo', 'police_verification',
  'medical_fitness', 'address_proof', 'offer_letter', 'other',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_LABELS: Record<DocType, string> = {
  driving_licence: 'Driving licence',
  aadhaar: 'Aadhaar',
  pan: 'PAN',
  photo: 'Photo',
  police_verification: 'Police verification',
  medical_fitness: 'Medical fitness',
  address_proof: 'Address proof',
  offer_letter: 'Offer letter',
  other: 'Document',
};

export const DOC_NEEDS_NUMBER: ReadonlySet<DocType> = new Set(['driving_licence', 'aadhaar', 'pan']);
export const DOC_NEEDS_EXPIRY: ReadonlySet<DocType> = new Set(['driving_licence', 'police_verification', 'medical_fitness']);

const REQUIRED_FOR_DRIVER: readonly DocType[] = ['driving_licence', 'aadhaar', 'pan', 'photo'];
const REQUIRED_FOR_STAFF: readonly DocType[] = ['aadhaar', 'pan', 'photo'];

/** Documents a person of this role must have on file. */
export const requiredDocTypes = (role: string): readonly DocType[] => (role === 'driver' ? REQUIRED_FOR_DRIVER : REQUIRED_FOR_STAFF);

/** Days before expiry at which a document counts as "expiring". */
export const EXPIRING_WITHIN_DAYS = 30;

export interface DocRow {
  id: string;
  user_id: string;
  doc_type: string;
  status: string;
  expires_on: string | null;
  archived_at?: string | null;
  metadata?: Record<string, any> | null;
  [key: string]: any;
}

export const todayKey = (now = new Date()): string => indianDateKey(now);

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative once it has passed. */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Stored status, except that a document past its expiry date is expired whether or not the daily job has run yet. */
export function effectiveStatus(doc: Pick<DocRow, 'status' | 'expires_on'>, today = todayKey()): string {
  if (doc.status === 'rejected') return 'rejected';
  if (doc.expires_on && doc.expires_on < today) return 'expired';
  return doc.status;
}

export function isExpiring(doc: Pick<DocRow, 'status' | 'expires_on'>, today = todayKey()): boolean {
  if (!doc.expires_on || effectiveStatus(doc, today) === 'rejected' || effectiveStatus(doc, today) === 'expired') return false;
  return daysBetween(today, doc.expires_on) <= EXPIRING_WITHIN_DAYS;
}

export interface DocSummary { required: number; verified: number; pending: number; expiring: number; expired: number; missing: number }

/**
 * How complete a person's file is. `required` counts the role's required types.
 * `verified`: required types with a verified, unexpired document. `pending`:
 * required types waiting for review. `missing`: required types with no live
 * document or only a rejected one. `expired` and `expiring` count live
 * documents of any type.
 */
export function summarizeDocuments(role: string, liveDocs: DocRow[], today = todayKey()): DocSummary {
  const required = requiredDocTypes(role);
  const summary: DocSummary = { required: required.length, verified: 0, pending: 0, expiring: 0, expired: 0, missing: 0 };
  for (const type of required) {
    const doc = liveDocs.find(d => d.doc_type === type);
    const status = doc ? effectiveStatus(doc, today) : 'missing';
    if (status === 'verified') summary.verified += 1;
    else if (status === 'pending') summary.pending += 1;
    else if (status === 'missing' || status === 'rejected') summary.missing += 1;
  }
  for (const doc of liveDocs) {
    if (effectiveStatus(doc, today) === 'expired') summary.expired += 1;
    else if (isExpiring(doc, today)) summary.expiring += 1;
  }
  return summary;
}

/** Required types a person still has to provide (none on file, or the last one was rejected). */
export function missingDocTypes(role: string, liveDocs: DocRow[], today = todayKey()): DocType[] {
  return requiredDocTypes(role).filter(type => {
    const doc = liveDocs.find(d => d.doc_type === type);
    return !doc || effectiveStatus(doc, today) === 'rejected';
  });
}

/** Live (not archived) documents of the given people, grouped by person. */
export async function liveDocumentsByUser(userIds: string[]): Promise<Map<string, DocRow[]>> {
  const rows = await selectIn<DocRow>('user_documents', 'user_id', userIds,
    'id, user_id, doc_type, status, expires_on, doc_number, archived_at, metadata', q => q.is('archived_at', null));
  const out = new Map<string, DocRow[]>();
  for (const row of rows) {
    if (row.archived_at) continue;
    const list = out.get(row.user_id) ?? [];
    list.push(row);
    out.set(row.user_id, list);
  }
  return out;
}

// ── Driving licence, for dispatch ──────────────────────────

export type DriverLicenceStatus = 'ok' | 'expiring' | 'expired' | 'missing';

/** Status of the live driving licence: no document (or a rejected one) is `missing`. */
export function licenceStatus(docs: DocRow[] | undefined, today = todayKey()): DriverLicenceStatus {
  const licence = docs?.find(d => d.doc_type === 'driving_licence');
  if (!licence) return 'missing';
  const status = effectiveStatus(licence, today);
  if (status === 'rejected') return 'missing';
  if (status === 'expired') return 'expired';
  return isExpiring(licence, today) ? 'expiring' : 'ok';
}

/**
 * `driver_licence_status` for each vehicle: computed from its driver's live
 * driving licence, or null when the vehicle has no driver. Warning only;
 * assignment is never blocked by it.
 */
export async function withDriverLicenceStatus<T extends { driver_id?: string | null }>(vehicles: T[]): Promise<Array<T & { driver_licence_status: DriverLicenceStatus | null }>> {
  const driverIds = vehicles.map(v => v.driver_id).filter((id): id is string => !!id);
  const docs = driverIds.length ? await liveDocumentsByUser(driverIds) : new Map<string, DocRow[]>();
  const today = todayKey();
  return vehicles.map(v => ({ ...v, driver_licence_status: v.driver_id ? licenceStatus(docs.get(v.driver_id), today) : null }));
}

// ── Daily expiry job ───────────────────────────────────────

type Marker = 'd30' | 'd7' | 'd0';

export interface ExpiryJobResult { expired: number; reminders: number }

function markerFor(days: number): Marker | null {
  if (days > EXPIRING_WITHIN_DAYS) return null;
  if (days > 7) return 'd30';
  if (days > 0) return 'd7';
  return 'd0';
}

const phrase = (days: number) => (days < 0 ? 'has expired' : days === 0 ? 'expires today' : days === 1 ? 'expires tomorrow' : `expires in ${days} days`);

/**
 * Marks documents past `expires_on` as expired and sends the 30-day, 7-day and
 * day-of reminders, each once per document (recorded in `metadata.reminders_sent`).
 * A document that turns expired without a day-of reminder gets one message then.
 * Only the newest live document of each type is looked at; replaced ones are archived.
 */
export async function runDocumentExpiryJob(now = new Date()): Promise<ExpiryJobResult> {
  const today = todayKey(now);
  const horizon = todayKey(new Date(now.getTime() + EXPIRING_WITHIN_DAYS * 86_400_000));
  const { data, error } = await supabase
    .from('user_documents')
    .select('id, user_id, doc_type, status, expires_on, metadata')
    .is('archived_at', null)
    .in('status', ['pending', 'verified'])
    .lte('expires_on', horizon);
  if (error) throw new Error(`Failed to read documents: ${error.message}`);

  const due = ((data ?? []) as DocRow[]).filter(d => d.expires_on && d.expires_on <= horizon);
  if (due.length === 0) return { expired: 0, reminders: 0 };

  const people = await selectIn<{ id: string; full_name: string | null; role: string; is_active: boolean }>(
    'users', 'id', due.map(d => d.user_id), 'id, full_name, role, is_active');
  const personById = new Map(people.map(p => [p.id, p]));

  let expired = 0;
  let reminders = 0;
  for (const doc of due) {
    const person = personById.get(doc.user_id);
    if (!person || !person.is_active) continue;
    const days = daysBetween(today, doc.expires_on!);
    const sent: Record<string, string> = { ...((doc.metadata?.reminders_sent as Record<string, string> | undefined) ?? {}) };
    const marker = days < 0 ? 'd0' : markerFor(days);
    const patch: Record<string, unknown> = {};
    const isExpired = days < 0;

    if (isExpired) {
      patch.status = 'expired';
      expired += 1;
    }
    if (marker && !sent[marker]) {
      const label = DOC_LABELS[doc.doc_type as DocType] ?? 'Document';
      const name = person.full_name || 'A team member';
      let notified = false;
      try {
        await notificationService.notifyStaff(
          `${label} ${isExpired ? 'expired' : 'expiring'}`,
          `${name}'s ${label.toLowerCase()} ${phrase(days)}.`,
          'document_expiring',
          { user_id: doc.user_id, doc_id: doc.id },
        );
        if (person.role === 'driver') {
          await notificationService.sendNotification(
            doc.user_id,
            `Your ${label.toLowerCase()} ${isExpired ? 'has expired' : 'is expiring'}`,
            `Your ${label.toLowerCase()} ${phrase(days)}. Upload the renewed one in Profile, My documents.`,
            'document_expiring',
            { user_id: doc.user_id, doc_id: doc.id },
          );
        }
        notified = true;
        reminders += 1;
      } catch (e: any) {
        console.error('[people-expiry] notification failed:', e.message);
        // marker stays unset so the next run tries again
      }
      if (notified) {
        const stamp = now.toISOString();
        sent[marker] = stamp;
        // A closer reminder makes the farther ones pointless
        if (marker === 'd0') { sent.d7 ??= stamp; sent.d30 ??= stamp; }
        if (marker === 'd7') sent.d30 ??= stamp;
        patch.metadata = { ...(doc.metadata ?? {}), reminders_sent: sent };
      }
    }

    if (Object.keys(patch).length > 0) {
      patch.updated_at = now.toISOString();
      const { error: updateError } = await supabase.from('user_documents').update(patch).eq('id', doc.id);
      if (updateError) console.error('[people-expiry] could not update document:', updateError.message);
    }
  }
  return { expired, reminders };
}
