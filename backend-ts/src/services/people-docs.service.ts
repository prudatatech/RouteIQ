/**
 * margixindia — People documents: the rules, and what is derived from them.
 *
 * Which documents each role needs (as groups: identity proof is one of Aadhaar,
 * voter ID or passport), whether a document is currently expired or about to
 * be, how complete a person's file is, the driving-licence status dispatch
 * warns on (and, when the setting says so, blocks on).
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { indianDateKey } from '../core/istDate';
import { selectIn } from './finance.service';
import { getPeopleSettings } from './people-settings.service';

export const DOC_TYPES = [
  'driving_licence', 'aadhaar', 'pan', 'photo', 'police_verification', 'medical_fitness',
  'address_proof', 'offer_letter', 'voter_id', 'passport', 'bank_proof', 'other',
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
  voter_id: 'Voter ID',
  passport: 'Passport',
  bank_proof: 'Bank proof',
  other: 'Document',
};

export const DOC_NEEDS_NUMBER: ReadonlySet<DocType> = new Set(['driving_licence', 'aadhaar', 'voter_id', 'passport', 'pan']);
export const DOC_NEEDS_EXPIRY: ReadonlySet<DocType> = new Set(['driving_licence', 'police_verification', 'medical_fitness']);

export type DocGroupKey = 'driving_licence' | 'identity' | 'tax' | 'photo';
export interface DocGroup { key: DocGroupKey; label: string; types: readonly DocType[] }

const GROUPS: Record<DocGroupKey, DocGroup> = {
  driving_licence: { key: 'driving_licence', label: 'Driving licence', types: ['driving_licence'] },
  identity: { key: 'identity', label: 'Identity proof (Aadhaar, voter ID or passport)', types: ['aadhaar', 'voter_id', 'passport'] },
  tax: { key: 'tax', label: 'PAN (or no PAN, with a reason)', types: ['pan'] },
  photo: { key: 'photo', label: 'Photo', types: ['photo'] },
};

/** Groups a person of this role must satisfy; a group is met by any one of its document types. */
export const requiredGroups = (role: string): DocGroup[] =>
  (role === 'driver' ? ['driving_licence', 'identity', 'tax', 'photo'] : ['identity', 'tax', 'photo']).map(k => GROUPS[k as DocGroupKey]);

/** Days before expiry at which a document counts as "expiring". */
export const EXPIRING_WITHIN_DAYS = 30;

export interface DocRow {
  id: string;
  user_id: string;
  doc_type: string;
  status: string;
  expires_on: string | null;
  review_by?: string | null;
  archived_at?: string | null;
  metadata?: Record<string, any> | null;
  [key: string]: any;
}

export const todayKey = (now = new Date()): string => indianDateKey(now);

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative once it has passed. */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Stored status, except that a document past its expiry date is expired whether or not the daily job has run yet. */
export function effectiveStatus(doc: Pick<DocRow, 'status' | 'expires_on'>, today = todayKey()): string {
  if (doc.status === 'rejected') return 'rejected';
  if (doc.expires_on && doc.expires_on < today) return 'expired';
  return doc.status;
}

/** Expiring within 30 days (not yet expired, not rejected). */
export function isExpiring(doc: Pick<DocRow, 'status' | 'expires_on'>, today = todayKey()): boolean {
  if (!doc.expires_on) return false;
  const status = effectiveStatus(doc, today);
  return status !== 'rejected' && status !== 'expired' && daysBetween(today, doc.expires_on) <= EXPIRING_WITHIN_DAYS;
}

/** A review date has passed or is within 30 days (documents that don't expire but need re-checking). */
export function isReviewSoon(doc: Pick<DocRow, 'status' | 'review_by'>, today = todayKey()): boolean {
  return !!doc.review_by && doc.status !== 'rejected' && daysBetween(today, doc.review_by) <= EXPIRING_WITHIN_DAYS;
}

export interface DocSummary { required: number; verified: number; pending: number; expiring: number; expired: number; missing: number }

/**
 * How complete a person's file is. `required` counts the role's required
 * groups. `verified`: groups met by a verified, unexpired document. `pending`:
 * groups waiting for review. `missing`: groups with no live document, or only a
 * rejected one. `expired` and `expiring` count live documents of any type
 * (a review date counts as expiring).
 */
export function summarizeDocuments(role: string, liveDocs: DocRow[], today = todayKey(), options: { noPan?: boolean } = {}): DocSummary {
  const groups = requiredGroups(role);
  const summary: DocSummary = { required: groups.length, verified: 0, pending: 0, expiring: 0, expired: 0, missing: 0 };
  for (const group of groups) {
    const statuses = liveDocs.filter(d => group.types.includes(d.doc_type as DocType)).map(d => effectiveStatus(d, today));
    if (group.key === 'tax' && options.noPan) summary.verified += 1; // "No PAN" with a reason meets the tax ID group
    else if (statuses.includes('verified')) summary.verified += 1;
    else if (statuses.includes('pending')) summary.pending += 1;
    else if (statuses.includes('expired')) continue; // counted under `expired`, not missing
    else summary.missing += 1;
  }
  for (const doc of liveDocs) {
    if (effectiveStatus(doc, today) === 'expired') summary.expired += 1;
    else if (isExpiring(doc, today) || isReviewSoon(doc, today)) summary.expiring += 1;
  }
  return summary;
}

/** Groups a person still has to provide (nothing on file, or only a rejected document). */
export function missingGroups(role: string, liveDocs: DocRow[], today = todayKey(), options: { noPan?: boolean } = {}): DocGroup[] {
  return requiredGroups(role).filter(group => {
    if (group.key === 'tax' && options.noPan) return false;
    const statuses = liveDocs.filter(d => group.types.includes(d.doc_type as DocType)).map(d => effectiveStatus(d, today));
    return !statuses.some(s => s === 'verified' || s === 'pending' || s === 'expired');
  });
}

/** Live (not archived) documents of the given people, grouped by person. */
export async function liveDocumentsByUser(userIds: string[]): Promise<Map<string, DocRow[]>> {
  const rows = await selectIn<DocRow>('user_documents', 'user_id', userIds,
    'id, user_id, doc_type, status, expires_on, review_by, number_last4, archived_at, metadata', q => q.is('archived_at', null));
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

export type DriverLicenceStatus = 'valid' | 'expiring' | 'expired' | 'missing';
export type DispatchIssue = 'not_active' | 'licence_missing' | 'licence_expired' | 'licence_class';

export interface LicenceInfo { status: DriverLicenceStatus; in_grace: boolean; classes: string[] }

/** Licence classes on the licence document: `metadata.licence_classes`, or the older single `metadata.licence_class`. */
export function licenceClasses(doc: Pick<DocRow, 'metadata'> | undefined): string[] {
  const meta = doc?.metadata ?? {};
  const list: unknown[] = Array.isArray(meta.licence_classes) ? meta.licence_classes : meta.licence_class ? [meta.licence_class] : [];
  return [...new Set(list.filter((c): c is string => typeof c === 'string').map(c => c.trim().toUpperCase()).filter(Boolean))];
}

/**
 * Status of the live driving licence. No document (or a rejected one) is
 * `missing`. A licence past its expiry is `expired`, and `in_grace` when it is
 * still within `graceDays` of expiry (usable, but flagged).
 */
export function licenceInfo(docs: DocRow[] | undefined, today = todayKey(), graceDays = 0): LicenceInfo {
  const licence = docs?.find(d => d.doc_type === 'driving_licence');
  if (!licence) return { status: 'missing', in_grace: false, classes: [] };
  const classes = licenceClasses(licence);
  const status = effectiveStatus(licence, today);
  if (status === 'rejected') return { status: 'missing', in_grace: false, classes };
  if (status === 'expired') {
    const inGrace = !!licence.expires_on && graceDays > 0 && daysBetween(licence.expires_on, today) <= graceDays;
    return { status: 'expired', in_grace: inGrace, classes };
  }
  return { status: isExpiring(licence, today) ? 'expiring' : 'valid', in_grace: false, classes };
}

export const licenceStatus = (docs: DocRow[] | undefined, today = todayKey(), graceDays = 0): DriverLicenceStatus =>
  licenceInfo(docs, today, graceDays).status;

const LIGHT_CLASSES = ['LMV', 'HMV', 'HGMV', 'HPMV', 'TRANS'];
const HEAVY_CLASSES = ['HMV', 'HGMV', 'TRANS'];
/** Capacity from which a goods vehicle needs a heavy class. */
export const HEAVY_VEHICLE_KG = 7500;

/** True when the licence lists classes and none of them covers the vehicle. Unknown classes are not a problem. */
export function licenceClassProblem(classes: string[], vehicle: { capacity_kg?: unknown; vehicle_type?: unknown } | undefined): boolean {
  if (classes.length === 0 || !vehicle) return false;
  if (String(vehicle.vehicle_type ?? '').toLowerCase() === 'bike') return false;
  const heavy = Number(vehicle.capacity_kg) >= HEAVY_VEHICLE_KG;
  const allowed = heavy ? HEAVY_CLASSES : LIGHT_CLASSES;
  return !classes.some(c => allowed.includes(c));
}

/** Everything that makes this driver a poor choice for this vehicle right now. */
export function dispatchIssues(input: {
  personStatus?: string | null;
  docs: DocRow[] | undefined;
  vehicle?: { capacity_kg?: unknown; vehicle_type?: unknown };
  today?: string;
  graceDays?: number;
}): { issues: DispatchIssue[]; licence: LicenceInfo } {
  const licence = licenceInfo(input.docs, input.today, input.graceDays ?? 0);
  const issues: DispatchIssue[] = [];
  if (input.personStatus && input.personStatus !== 'active') issues.push('not_active');
  if (licence.status === 'missing') issues.push('licence_missing');
  if (licence.status === 'expired' && !licence.in_grace) issues.push('licence_expired');
  if (licenceClassProblem(licence.classes, input.vehicle)) issues.push('licence_class');
  return { issues, licence };
}

const ISSUE_TEXT: Record<DispatchIssue, string> = {
  not_active: 'is not active',
  licence_missing: 'has no driving licence on file',
  licence_expired: 'has an expired driving licence',
  licence_class: "has a licence class that doesn't cover this vehicle",
};

/**
 * `driver_licence_status` (plus `driver_licence_in_grace` and
 * `driver_dispatch_issues`) for each vehicle, from its driver's live driving
 * licence; null status when the vehicle has no driver. Warning data only:
 * whether it blocks is the driver_document_enforcement setting.
 */
export async function withDriverLicenceStatus<T extends { driver_id?: string | null }>(vehicles: T[]): Promise<Array<T & {
  driver_licence_status: DriverLicenceStatus | null;
  driver_licence_in_grace: boolean;
  driver_dispatch_issues: DispatchIssue[];
}>> {
  const blank = { driver_licence_status: null, driver_licence_in_grace: false, driver_dispatch_issues: [] as DispatchIssue[] };
  const driverIds = [...new Set(vehicles.map(v => v.driver_id).filter((id): id is string => !!id))];
  if (driverIds.length === 0) return vehicles.map(v => ({ ...v, ...blank }));

  const [docs, people, settings] = await Promise.all([
    liveDocumentsByUser(driverIds),
    selectIn<{ id: string; status: string | null }>('users', 'id', driverIds, 'id, status'),
    getPeopleSettings(),
  ]);
  const statusById = new Map(people.map(p => [p.id, p.status]));
  const today = todayKey();
  return vehicles.map(v => {
    if (!v.driver_id) return { ...v, ...blank };
    const { issues, licence } = dispatchIssues({
      personStatus: statusById.get(v.driver_id) ?? null,
      docs: docs.get(v.driver_id),
      vehicle: v as any,
      today,
      graceDays: settings.licence_grace_days,
    });
    return { ...v, driver_licence_status: licence.status, driver_licence_in_grace: licence.in_grace, driver_dispatch_issues: issues };
  });
}

/**
 * When `driver_document_enforcement` is `block`, refuses (409) to put work on a
 * vehicle whose driver is not active, has no usable licence, or holds the wrong
 * licence class. Any other setting, or a vehicle without a driver, passes.
 */
export async function assertDriverDispatchable(vehicleId: string): Promise<void> {
  const settings = await getPeopleSettings();
  if (settings.driver_document_enforcement !== 'block') return;
  const { data: vehicle } = await supabase.from('vehicles').select('id, driver_id, capacity_kg, vehicle_type').eq('id', vehicleId).maybeSingle();
  if (!vehicle?.driver_id) return;
  const [docs, person] = await Promise.all([
    liveDocumentsByUser([vehicle.driver_id]),
    supabase.from('users').select('full_name, status').eq('id', vehicle.driver_id).maybeSingle(),
  ]);
  const { issues } = dispatchIssues({
    personStatus: person.data?.status ?? null,
    docs: docs.get(vehicle.driver_id),
    vehicle,
    graceDays: settings.licence_grace_days,
  });
  if (issues.length > 0) {
    const name = person.data?.full_name || 'The driver of this vehicle';
    throw new HttpError(409, `${name} ${ISSUE_TEXT[issues[0]]}, so this vehicle can't take work. Fix it on their profile or change the document setting.`, { dispatch_issues: issues });
  }
}
