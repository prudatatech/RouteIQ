/**
 * margixindia — Shared pieces of the people services: who is who, the activity
 * trail, access rules that depend on the subject, and small input parsers.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { settings } from '../core/config';

export interface Actor { user_id: string; role: string }

export const PERSON_ROLES = ['superadmin', 'admin', 'manager', 'driver'] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];
export const STAFF_PERSON_ROLES = ['superadmin', 'admin', 'manager'] as const;

export const PERSON_STATUSES = ['onboarding', 'active', 'on_leave', 'suspended', 'inactive'] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];
/** Statuses that can sign in: users.is_active follows this. */
export const SIGN_IN_STATUSES: ReadonlySet<string> = new Set(['onboarding', 'active', 'on_leave']);

export const RECYCLE_BLOCK_DAYS = 90;
export const DRIVER_EMAIL_DOMAIN = 'driver.margixindia.local';

export interface PersonRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: PersonRole;
  phone: string | null;
  is_active: boolean;
  status: PersonStatus;
  last_login: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const PERSON_COLUMNS = 'id, email, full_name, role, phone, is_active, status, last_login, created_at, updated_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Loads a driver or staff member; anything else (vendors, customers, unknown ids) is a 404. */
export async function loadPerson(id: string): Promise<PersonRow> {
  if (!isUuid(id)) throw new HttpError(404, 'Person not found');
  const { data, error } = await supabase.from('users').select(PERSON_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read person: ${error.message}`);
  if (!data || !(PERSON_ROLES as readonly string[]).includes(data.role)) throw new HttpError(404, 'Person not found');
  return data as PersonRow;
}

export const isStaffRole = (role: string): boolean => (STAFF_PERSON_ROLES as readonly string[]).includes(role);
export const canManage = (actor: Actor): boolean => actor.role === 'admin' || actor.role === 'superadmin';

/** Only a superadmin may change a superadmin's record (profile, status, bank, documents). */
export function assertCanModify(actor: Actor, subject: Pick<PersonRow, 'role'>): void {
  if (subject.role === 'superadmin' && actor.role !== 'superadmin') {
    throw new HttpError(403, 'Only a superadmin can change a superadmin');
  }
}

export const nowIso = (): string => new Date().toISOString();

/** One row in the person's activity trail. Never blocks or undoes the change it describes. */
export async function logActivity(userId: string, actorId: string | null, action: string, details: Record<string, unknown> = {}): Promise<void> {
  try {
    const { error } = await supabase.from('user_activity').insert({ user_id: userId, actor_id: actorId, action, details });
    if (error) console.error('[people] could not record activity:', error.message);
  } catch (e) {
    console.error('[people] could not record activity:', e);
  }
}

/**
 * Optimistic concurrency: an edit that sends the `updated_at` it loaded is
 * refused (409) when the record has changed since. Sending none skips the check.
 */
export function assertFresh(current: string | null | undefined, sent: unknown): void {
  if (sent === undefined || sent === null || sent === '') return;
  const a = typeof sent === 'string' ? Date.parse(sent) : NaN;
  const b = current ? Date.parse(current) : NaN;
  if (!Number.isFinite(a)) throw new HttpError(400, 'updated_at must be the timestamp you loaded');
  if (!Number.isFinite(b) || a !== b) {
    throw new HttpError(409, 'Someone else changed this profile. Reload to see their changes.', { code: 'stale_update' });
  }
}

/** A required text of 1..max characters, trimmed. */
export function parseRequiredText(value: unknown, label: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new HttpError(400, min > 1 ? `${label} must be ${min} to ${max} characters` : `${label} is required (at most ${max} characters)`);
  }
  return value.trim();
}

export const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A normalised (trimmed, lower-cased) email or a 400. */
export function parseEmail(value: unknown, label = 'Email'): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_FORMAT.test(email) || email.length > 254) throw new HttpError(400, `${label} is not a valid email address`);
  return email;
}

export const last4 = (value: string | null | undefined): string | null => (value ? value.slice(-4) : null);

/** Everyone who signs in to the console: used to tell superadmins and the person about sensitive changes. */
export async function superadminIds(): Promise<string[]> {
  const { data } = await supabase.from('users').select('id').eq('role', 'superadmin').eq('is_active', true);
  return (data ?? []).map(u => u.id as string);
}

// ── Files ──────────────────────────────────────────────────

/** Folder of one person's files in the private bucket. */
export const peopleFolder = (userId: string) => `people/${userId}/`;

/**
 * A stored path is accepted only as `people/<user_id>/<folder>/<file>`, inside
 * that person's own folder (and `<folder>` matching `folder` when given).
 */
export function isPeoplePathFor(path: unknown, userId: string, folder?: string): path is string {
  if (typeof path !== 'string' || path.length > 300 || path.includes('..') || path.includes('\\')) return false;
  if (!path.startsWith(peopleFolder(userId))) return false;
  const rest = path.slice(peopleFolder(userId).length).split('/');
  if (rest.length !== 2 || !rest[0] || !rest[1]) return false;
  if (folder && rest[0] !== folder) return false;
  return /^[A-Za-z0-9_-]+$/.test(rest[0]) && /^[A-Za-z0-9_.-]+$/.test(rest[1]);
}

/** Deletes files from the private bucket. Failures are logged; the record is what matters. */
export async function removeStoredFiles(paths: Array<string | null | undefined>): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length === 0) return;
  const { error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).remove(list);
  if (error) console.error('[people] could not delete stored files:', error.message);
}

/** Plain-language text for the soft warning codes the people endpoints return in `warnings`. */
export const WARNING_TEXT: Record<string, string> = {
  licence_number_format: "This licence number doesn't look like the usual state code plus digits. It was saved. Check it against the card.",
  name_mismatch: "The name on the document doesn't match the profile name. It was saved. Add a note when you verify it.",
  account_holder_mismatch: "The account holder name doesn't match the person. It was saved. Add a note when you verify it.",
  ifsc_unverified: "The IFSC could not be checked against bank records right now. It was saved. Check it yourself.",
  ifsc_no_neft_imps: "Payouts may fail: this branch doesn't support NEFT or IMPS.",
};

/** `warnings` (codes) plus `warning_messages` (text) for an endpoint response. */
export const withWarnings = <T extends object>(out: T, warnings: string[]) => ({
  ...out, warnings, warning_messages: warnings.map(w => WARNING_TEXT[w] ?? w),
});
