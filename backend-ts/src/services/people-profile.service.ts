/**
 * margixindia — People profile fields and phone numbers.
 *
 * Parsing and checking of the profile a person has (employment, address, dates,
 * employer), and the rules for phone numbers: unique, kept in a history when
 * changed, and not reused by someone else for 90 days after their owner
 * stopped using them.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { parseCoordinate } from '../core/validate';
import { normalizePhone } from '../utils/phone';
import { ageOn, isCalendarDate, isPincode } from '../utils/people-validators';
import {
  Actor, PersonRow, RECYCLE_BLOCK_DAYS, STAFF_PERSON_ROLES, isPeoplePathFor, isUuid, logActivity, membersAmong, nowIso, parseEmail,
} from './people-common';
import { addDays, licenceClasses, todayKey } from './people-docs.service';

export const EMPLOYMENT_TYPES = ['permanent', 'contract', 'on_call'] as const;
export const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const EMPLOYER_TYPES = ['company', 'partner'] as const;
export const MINIMUM_AGE = 18;
export const TRANSPORT_LICENCE_AGE = 20;
const TRANSPORT_CLASSES = ['HMV', 'HGMV', 'HPMV', 'TRANS'];

export const PROFILE_COLUMNS = [
  'employee_code', 'designation', 'department', 'employment_type', 'date_of_joining', 'date_of_birth', 'gender',
  'blood_group', 'alternate_phone', 'personal_email', 'address_line', 'city', 'state', 'pincode', 'latitude',
  'longitude', 'base_depot_id', 'reporting_manager_id', 'photo_path', 'employer_type', 'employer_partner_id', 'no_pan_reason',
  'suspended_until', 'leave_from', 'leave_until', 'consent_at', 'consent_by', 'consent_method', 'invite_sent_at',
  'anonymised_at', 'created_at', 'updated_at', 'updated_by',
] as const;

/** A profile with every field present (null where nothing is stored yet). */
export function profileOut(row: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const column of PROFILE_COLUMNS) out[column] = row?.[column] ?? null;
  out.employer_type = row?.employer_type ?? 'company';
  return out;
}

export async function getProfile(userId: string): Promise<Record<string, any> | null> {
  const { data, error } = await supabase.from('user_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Failed to read profile: ${error.message}`);
  return data ?? null;
}

/** Writes profile columns, creating the profile row when there is none. */
export async function saveProfile(userId: string, actorId: string | null, patch: Record<string, unknown>): Promise<Record<string, any>> {
  const existing = await getProfile(userId);
  const values = { ...patch, updated_at: nowIso(), updated_by: actorId };
  if (existing) {
    const { data, error } = await supabase.from('user_profiles').update(values).eq('user_id', userId).select().single();
    if (error) throw mapUnique(error);
    return data;
  }
  const { data, error } = await supabase.from('user_profiles').insert({ user_id: userId, ...values }).select().single();
  if (error) throw mapUnique(error);
  return data;
}

function mapUnique(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new HttpError(409, 'That employee code is already used by someone else');
  return new Error(`Failed to save profile: ${error.message}`);
}

// ── Parsing ────────────────────────────────────────────────

const blank = (v: unknown) => v === null || v === '' || v === undefined;

function text(v: unknown, label: string, max: number): string {
  if (typeof v !== 'string') throw new HttpError(400, `${label} must be text`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return t;
}

function oneOf<T extends string>(v: unknown, label: string, allowed: readonly T[], normalise = (x: string) => x): T {
  const value = typeof v === 'string' ? normalise(v.trim()) : '';
  if (!(allowed as readonly string[]).includes(value)) throw new HttpError(400, `${label} must be one of ${allowed.join(', ')}`);
  return value as T;
}

export function parseDate(v: unknown, label: string): string {
  if (!isCalendarDate(v)) throw new HttpError(400, `${label} must be a date written YYYY-MM-DD`);
  return v;
}

/** Date of birth: a real past date that makes the person at least 18. */
export function parseDateOfBirth(v: unknown, today = todayKey()): string {
  const dob = parseDate(v, 'Date of birth');
  if (dob > today) throw new HttpError(400, "Date of birth can't be in the future");
  const age = ageOn(dob, today);
  if (age < MINIMUM_AGE) throw new HttpError(400, `Date of birth means this person is under ${MINIMUM_AGE}. Check the date`);
  if (age > 90) throw new HttpError(400, 'Date of birth looks wrong. Check the date');
  return dob;
}

/** A driver holding a transport class must be 20 or older. */
export function assertAgeForLicenceClasses(dob: string | null | undefined, classes: string[], today = todayKey()): void {
  if (!dob || !classes.some(c => TRANSPORT_CLASSES.includes(c))) return;
  if (ageOn(dob, today) < TRANSPORT_LICENCE_AGE) {
    throw new HttpError(400, `A transport licence class (${classes.filter(c => TRANSPORT_CLASSES.includes(c)).join(', ')}) needs the holder to be at least ${TRANSPORT_LICENCE_AGE}`);
  }
}

async function exists(table: string, id: string, extra?: (q: any) => any): Promise<boolean> {
  let q = supabase.from(table).select('id').eq('id', id);
  if (extra) q = extra(q);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`Failed to check ${table}: ${error.message}`);
  return !!data;
}

/**
 * Checks the profile fields present in `input` and returns the columns to
 * write (null clears a field). `existing` is the stored profile, so combined
 * rules (employer) see the final state. `subject` is who the profile is for.
 */
export async function parseProfileInput(
  input: Record<string, any>,
  subject: { id: string | null; role: string },
  existing: Record<string, any> | null,
  actor: Actor,
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const field = (k: string, fn: (v: unknown) => unknown) => {
    if (!has(k)) return;
    patch[k] = blank(input[k]) ? null : fn(input[k]);
  };

  field('designation', v => text(v, 'Designation', 80));
  field('department', v => text(v, 'Department', 80));
  field('address_line', v => text(v, 'Address', 200));
  field('city', v => text(v, 'City', 80));
  field('state', v => text(v, 'State', 80));
  field('pincode', v => {
    const pin = text(v, 'PIN code', 6);
    if (!isPincode(pin)) throw new HttpError(400, 'PIN code must be 6 digits');
    return pin;
  });
  field('employment_type', v => oneOf(v, 'Employment type', EMPLOYMENT_TYPES, x => x.toLowerCase().replace(/-/g, '_')));
  field('gender', v => oneOf(v, 'Gender', GENDERS, x => x.toLowerCase().replace(/[\s-]/g, '_')));
  field('blood_group', v => oneOf(v, 'Blood group', BLOOD_GROUPS, x => x.toUpperCase()));
  field('date_of_joining', v => {
    const d = parseDate(v, 'Date of joining');
    if (d > addDays(todayKey(), 365)) throw new HttpError(400, 'Date of joining is too far in the future');
    return d;
  });
  field('date_of_birth', v => parseDateOfBirth(v));
  field('alternate_phone', v => {
    const phone = normalizePhone(v);
    if (!phone) throw new HttpError(400, 'Alternate phone is not a valid phone number');
    return phone;
  });
  field('personal_email', v => parseEmail(v, 'Personal email'));
  field('no_pan_reason', v => {
    const reason = text(v, 'The reason for having no PAN', 200);
    if (reason.length < 3) throw new HttpError(400, 'Give the reason this person has no PAN (at least 3 characters)');
    return reason;
  });
  if (has('latitude')) patch.latitude = parseCoordinate(input.latitude, 'Latitude', 90);
  if (has('longitude')) patch.longitude = parseCoordinate(input.longitude, 'Longitude', 180);

  if (has('employee_code') && !blank(input.employee_code)) {
    const code = text(input.employee_code, 'Employee code', 30).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9/_-]*$/.test(code)) throw new HttpError(400, 'Employee code can use letters, digits, - / and _');
    const { data } = await supabase.from('user_profiles').select('user_id').eq('employee_code', code);
    const clash = (data ?? []).find(r => r.user_id !== subject.id);
    if (clash) {
      const { data: other } = await supabase.from('users').select('id, full_name, role, status').eq('id', clash.user_id).maybeSingle();
      if (!other) throw new HttpError(409, `Employee code ${code} is already used by another person`);
      throw await duplicateError(`Employee code ${code} is already used by ${other.full_name ?? 'another person'}`, other as PersonRow, `Employee code ${code} is already in use`);
    }
    patch.employee_code = code;
  } else if (has('employee_code')) {
    patch.employee_code = null;
  }

  if (has('base_depot_id') && !blank(input.base_depot_id)) {
    if (!isUuid(input.base_depot_id) || !(await exists('depots', input.base_depot_id))) throw new HttpError(400, 'Base depot not found');
    patch.base_depot_id = input.base_depot_id;
  } else if (has('base_depot_id')) patch.base_depot_id = null;

  if (has('reporting_manager_id') && !blank(input.reporting_manager_id)) {
    const id = input.reporting_manager_id;
    if (!isUuid(id) || id === subject.id) throw new HttpError(400, 'Reporting manager must be another staff member');
    const okay = await exists('users', id, q => q.in('role', [...STAFF_PERSON_ROLES]));
    if (!okay) throw new HttpError(400, 'Reporting manager must be a staff member');
    patch.reporting_manager_id = id;
  } else if (has('reporting_manager_id')) patch.reporting_manager_id = null;

  if (has('photo_path') && !blank(input.photo_path)) {
    if (!subject.id || !isPeoplePathFor(input.photo_path, subject.id, 'photo')) throw new HttpError(400, "Photo must be uploaded to this person's own folder");
    patch.photo_path = input.photo_path;
  } else if (has('photo_path')) patch.photo_path = null;

  // Employer: company, or a 3PL partner who pays the driver
  if (has('employer_type') || has('employer_partner_id')) {
    const type = has('employer_type') && !blank(input.employer_type)
      ? oneOf(input.employer_type, 'Employer type', EMPLOYER_TYPES, x => x.toLowerCase())
      : (existing?.employer_type ?? 'company');
    let partnerId: string | null = has('employer_partner_id') ? (blank(input.employer_partner_id) ? null : input.employer_partner_id) : (existing?.employer_partner_id ?? null);
    if (type === 'partner') {
      if (subject.role !== 'driver') throw new HttpError(400, 'Only drivers can be employed by a partner');
      if (!partnerId || !isUuid(partnerId) || !(await exists('tpl_partners', partnerId))) throw new HttpError(400, 'Choose the 3PL partner who employs this driver');
    } else {
      partnerId = null;
    }
    patch.employer_type = type;
    patch.employer_partner_id = partnerId;
  }

  if (has('consent_method') && !blank(input.consent_method)) {
    patch.consent_method = text(input.consent_method, 'Consent method', 50);
    patch.consent_at = nowIso();
    patch.consent_by = actor.user_id;
  }

  // Age rule for a transport licence
  if (patch.date_of_birth && subject.id && subject.role === 'driver') {
    const { data: licence } = await supabase.from('user_documents').select('metadata').eq('user_id', subject.id).eq('doc_type', 'driving_licence').is('archived_at', null).maybeSingle();
    if (licence) assertAgeForLicenceClasses(patch.date_of_birth as string, licenceClasses(licence as any));
  }
  return patch;
}

// ── Phone numbers ──────────────────────────────────────────

/**
 * The 409 for a phone, email, document number or employee code somebody already uses. Numbers are unique across the
 * platform, but a person of another company is not this company's to see: for them the answer is neutral (no name,
 * id, role or status), so a company cannot probe who works for a competitor.
 */
export async function duplicateError(
  message: string,
  person: Pick<PersonRow, 'id' | 'full_name' | 'role' | 'status'>,
  neutral = 'This is already registered to someone else',
): Promise<HttpError> {
  const members = await membersAmong([person.id]);
  if (members && !members.has(person.id)) return new HttpError(409, neutral);
  return new HttpError(409, message, { existing_person: { id: person.id, full_name: person.full_name, role: person.role, status: person.status } });
}

/** The date someone left (their last move to inactive), as YYYY-MM-DD; falls back to when the record last changed. */
async function leftOn(holder: PersonRow): Promise<string> {
  const { data } = await supabase.from('user_status_history').select('created_at').eq('user_id', holder.id).eq('to_status', 'inactive');
  const times = (data ?? []).map(r => Date.parse(r.created_at)).filter(Number.isFinite);
  const t = times.length ? Math.max(...times) : Date.parse(holder.updated_at ?? holder.created_at ?? nowIso());
  return new Date(t).toISOString().slice(0, 10);
}

export interface PhoneClearance { releaseFrom: { holder: PersonRow; leftOn: string } | null }

/**
 * Refuses a phone number someone else uses, or used within the last 90 days.
 * A number held by someone who left more than 90 days ago is allowed; the
 * caller then releases it from the old record with `releasePhone`.
 */
export async function assertPhoneAvailable(phone: string, exceptUserId: string | null): Promise<PhoneClearance> {
  const today = todayKey();
  const { data: holders, error } = await supabase.from('users').select('id, email, full_name, role, phone, is_active, status, last_login, created_at, updated_at').eq('phone', phone);
  if (error) throw new Error(`Failed to check phone: ${error.message}`);
  let releaseFrom: PhoneClearance['releaseFrom'] = null;
  for (const holder of (holders ?? []) as PersonRow[]) {
    if (holder.id === exceptUserId) continue;
    if (holder.status !== 'inactive') throw await duplicateError(`This phone number already belongs to ${holder.full_name ?? 'another person'}`, holder, 'This phone number is already registered to someone else');
    const left = await leftOn(holder);
    const until = addDays(left, RECYCLE_BLOCK_DAYS);
    if (until > today) {
      throw await duplicateError(`This number belonged to ${holder.full_name ?? 'someone'}, who left on ${left}. It can be reused after ${until}`, holder, `This number was used by someone else recently. It can be reused after ${until}`);
    }
    releaseFrom = { holder, leftOn: left };
  }

  const { data: history, error: historyError } = await supabase.from('user_phone_history').select('user_id, phone, to_at').eq('phone', phone);
  if (historyError) throw new Error(`Failed to check phone history: ${historyError.message}`);
  for (const row of history ?? []) {
    if (row.user_id === exceptUserId || !row.to_at || row.user_id === releaseFrom?.holder.id) continue;
    const stopped = new Date(row.to_at).toISOString().slice(0, 10);
    const until = addDays(stopped, RECYCLE_BLOCK_DAYS);
    if (until > today) throw new HttpError(409, `This number was used by another person until ${stopped}. It can be reused after ${until}`);
  }
  return { releaseFrom };
}

/** Takes a number off a former owner's record (their history keeps it). */
export async function releasePhone(holder: PersonRow, leftDate: string, actorId: string | null): Promise<void> {
  await supabase.from('users').update({ phone: null, updated_at: nowIso() }).eq('id', holder.id);
  await supabase.from('user_phone_history').update({ to_at: `${leftDate}T00:00:00Z` }).eq('user_id', holder.id).eq('phone', holder.phone as string).is('to_at', null);
  await logActivity(holder.id, actorId, 'phone_released', { phone_last4: (holder.phone ?? '').slice(-4), reason: 'reused by a new person after 90 days' });
}

/** Records that `phone` is now the person's number, closing the previous one. */
export async function recordPhoneChange(userId: string, oldPhone: string | null, newPhone: string | null): Promise<void> {
  if (oldPhone) await supabase.from('user_phone_history').update({ to_at: nowIso() }).eq('user_id', userId).eq('phone', oldPhone).is('to_at', null);
  if (newPhone) await supabase.from('user_phone_history').insert({ user_id: userId, phone: newPhone, from_at: nowIso() });
}
