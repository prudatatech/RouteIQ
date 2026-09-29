/**
 * margixindia — People: drivers and staff.
 *
 * One record per person (public.users plus user_profiles). This file holds
 * the list and profile views, creating a person, editing, status changes,
 * invites, duplicate checks and anonymising. Documents, bank details,
 * contacts and notes live in their own services.
 *
 * Drivers sign in with an OTP on their phone: the account made here is the one
 * the OTP flow finds (same normalised phone, same placeholder email), so a
 * driver added by staff never turns into a second record at first sign-in.
 * Staff are invited through Supabase Auth and set their own password; no
 * password is ever set or returned here.
 */
import { supabase } from '../core/supabase';
import { HttpError, parseRejectionReason } from '../core/errors';
import { invalidateRoleCache } from '../core/auth';
import { findAuthUserByEmail } from '../core/auth-users';
import { cacheDeletePattern } from '../core/redis';
import { invalidateDriverVehicles } from '../core/ownership';
import { parseOptionalText } from '../core/validate';
import { normalizePhone } from '../utils/phone';
import { selectIn } from './finance.service';
import { notificationService } from './notification.service';
import { signedUrl } from './pod.service';
import { buildEarnings } from '../routes/auth.routes';
import { driverWindows, getDriverStats } from './driver-assignments.service';
import {
  Actor, DRIVER_EMAIL_DOMAIN, PERSON_COLUMNS, PERSON_ROLES, PERSON_STATUSES, PersonRole, PersonRow, PersonStatus,
  SIGN_IN_STATUSES, STAFF_PERSON_ROLES, assertCanModify, assertFresh, canManage, isStaffRole, isUuid, loadPerson,
  logActivity, nowIso, parseEmail, parseRequiredText, removeStoredFiles,
} from './people-common';
import { DocRow, liveDocumentsByUser, missingGroups, summarizeDocuments, todayKey } from './people-docs.service';
import {
  assertPhoneAvailable, duplicateError, getProfile, parseProfileInput, profileOut, recordPhoneChange, releasePhone, saveProfile,
} from './people-profile.service';
import { findDocumentDuplicate, listDocuments } from './people-documents.service';
import { listBankAccounts, listContacts, listNotes } from './people-bank.service';

/** Placeholder sign-in email driver OTP login uses for a phone. Never shown as the person's email. */
export const driverEmailFor = (phone: string): string => `driver_${phone.replace(/\+/g, '')}@${DRIVER_EMAIL_DOMAIN}`;
const isPlaceholderEmail = (email: string | null | undefined): boolean => !!email && email.endsWith(`@${DRIVER_EMAIL_DOMAIN}`);
const publicEmail = (email: string | null | undefined): string | null => (isPlaceholderEmail(email) ? null : email ?? null);

const PROFILE_INPUT_KEYS = [
  'employee_code', 'designation', 'department', 'employment_type', 'date_of_joining', 'date_of_birth', 'gender',
  'blood_group', 'alternate_phone', 'personal_email', 'address_line', 'city', 'state', 'pincode', 'latitude',
  'longitude', 'base_depot_id', 'reporting_manager_id', 'photo_path', 'employer_type', 'employer_partner_id',
  'consent_method',
];

function profileInput(body: Record<string, any>): Record<string, any> {
  const flat = Object.fromEntries(PROFILE_INPUT_KEYS.filter(k => Object.prototype.hasOwnProperty.call(body, k)).map(k => [k, body[k]]));
  const nested = body.profile && typeof body.profile === 'object' && !Array.isArray(body.profile) ? body.profile : {};
  return { ...flat, ...nested };
}

// ── List ───────────────────────────────────────────────────

export interface ListQuery {
  role?: string;
  status?: string;
  q?: string;
  docs?: string;
  limit?: number;
  offset?: number;
}

async function fetchAllUsers(roles: string[], status?: string): Promise<PersonRow[]> {
  const out: PersonRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from('users').select(PERSON_COLUMNS).in('role', roles);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('full_name', { ascending: true }).order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to read people: ${error.message}`);
    out.push(...((data ?? []) as PersonRow[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Every person matching the filters, with document summary, profile basics and vehicle. */
export async function listPeopleAll(query: ListQuery): Promise<Array<Record<string, any>>> {
  if (query.status && !(PERSON_STATUSES as readonly string[]).includes(query.status)) throw new HttpError(400, `status must be one of ${PERSON_STATUSES.join(', ')}`);
  if (query.docs && !['expiring', 'expired', 'missing', 'pending'].includes(query.docs)) throw new HttpError(400, 'docs must be expiring, expired, missing or pending');
  let roles: string[] = [...PERSON_ROLES];
  if (query.role === 'staff') roles = [...STAFF_PERSON_ROLES];
  else if (query.role) {
    if (!(PERSON_ROLES as readonly string[]).includes(query.role)) throw new HttpError(400, `role must be staff or one of ${PERSON_ROLES.join(', ')}`);
    roles = [query.role];
  }
  let people = await fetchAllUsers(roles, query.status);
  const term = query.q?.trim().toLowerCase();
  const ids = people.map(p => p.id);
  const [profiles, docs] = await Promise.all([
    selectIn<any>('user_profiles', 'user_id', ids, 'user_id, employee_code, designation, employer_type, employer_partner_id, no_pan_reason, anonymised_at'),
    liveDocumentsByUser(ids),
  ]);
  const profileById = new Map(profiles.map(p => [p.user_id, p]));
  if (term) {
    people = people.filter(p => {
      const profile = profileById.get(p.id);
      return [p.full_name, p.phone, publicEmail(p.email), profile?.employee_code].some(v => typeof v === 'string' && v.toLowerCase().includes(term));
    });
  }
  const driverIds = people.filter(p => p.role === 'driver').map(p => p.id);
  const vehicles = driverIds.length
    ? await selectIn<any>('vehicles', 'driver_id', driverIds, 'id, plate_number, driver_id, status')
    : [];
  const plateByDriver = new Map<string, string>();
  for (const v of vehicles) if (v.status !== 'archived' && !plateByDriver.has(v.driver_id)) plateByDriver.set(v.driver_id, v.plate_number);

  const partnerIds = profiles.map(p => p.employer_partner_id).filter(Boolean);
  const partners = partnerIds.length ? await selectIn<any>('tpl_partners', 'id', partnerIds, 'id, company_name') : [];
  const partnerName = new Map(partners.map(p => [p.id, p.company_name]));

  const today = todayKey();
  const items = people.map(p => {
    const profile = profileById.get(p.id);
    return {
      id: p.id,
      full_name: p.full_name,
      role: p.role,
      phone: p.phone,
      email: publicEmail(p.email),
      status: p.status,
      is_active: p.is_active,
      employee_code: profile?.employee_code ?? null,
      designation: profile?.designation ?? null,
      employer_type: profile?.employer_type ?? 'company',
      employer_partner_name: profile?.employer_partner_id ? partnerName.get(profile.employer_partner_id) ?? null : null,
      vehicle_plate: plateByDriver.get(p.id) ?? null,
      doc_summary: summarizeDocuments(p.role, docs.get(p.id) ?? [], today, { noPan: !!profile?.no_pan_reason }),
      last_login: p.last_login,
      anonymised: !!profile?.anonymised_at,
    };
  });
  const filter = query.docs;
  return filter
    ? items.filter(i => (filter === 'expiring' ? i.doc_summary.expiring > 0 : filter === 'expired' ? i.doc_summary.expired > 0 : filter === 'missing' ? i.doc_summary.missing > 0 : i.doc_summary.pending > 0))
    : items;
}

export async function listPeople(query: ListQuery) {
  const all = await listPeopleAll(query);
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 50) || 50, 1), 500);
  const offset = Math.max(Math.floor(query.offset ?? 0) || 0, 0);
  return { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
}

// ── Profile view ───────────────────────────────────────────

async function namesOf(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  const rows = unique.length ? await selectIn<any>('users', 'id', unique, 'id, full_name') : [];
  return new Map(rows.map(r => [r.id, r.full_name ?? '']));
}

async function authInfo(person: PersonRow, profile: Record<string, any> | null) {
  const base = { method: person.role === 'driver' ? 'otp' : 'invite', invite_sent_at: profile?.invite_sent_at ?? null };
  try {
    const { data, error } = await supabase.auth.admin.getUserById(person.id);
    if (error || !data?.user) return { ...base, has_sign_in_account: false, invite_pending: false };
    return { ...base, has_sign_in_account: true, invite_pending: person.role !== 'driver' && !data.user.last_sign_in_at };
  } catch {
    return { ...base, has_sign_in_account: null, invite_pending: false };
  }
}

/**
 * The whole profile. `self` is the person looking at their own record: they get
 * their documents and contacts but not staff notes, activity, history or bank data.
 */
export async function getPersonDetail(actor: Actor, id: string) {
  const subject = await loadPerson(id);
  const self = actor.user_id === subject.id;
  const staff = isStaffRole(actor.role);
  const profileRow = await getProfile(id);
  const profile = profileOut(profileRow);
  const today = todayKey();

  const documents = await listDocuments(subject);
  const raw = documents as unknown as DocRow[];
  const noPan = !!profile.no_pan_reason;
  const doc_summary = summarizeDocuments(subject.role, raw, today, { noPan });
  const missing = missingGroups(subject.role, raw, today, { noPan }).map(g => ({ key: g.key, label: g.label }));

  const bankAllowed = canManage(actor) && !(subject.role === 'superadmin' && actor.role !== 'superadmin') && profile.employer_type !== 'partner';
  const [contacts, bank, history, notes, activity, phoneHistory, auth] = await Promise.all([
    listContacts(id),
    bankAllowed ? listBankAccounts(subject) : Promise.resolve(null),
    staff && !self ? supabase.from('user_status_history').select('*').eq('user_id', id).then(r => r.data ?? []) : Promise.resolve([]),
    staff && !self ? listNotes(id) : Promise.resolve([]),
    staff && !self ? supabase.from('user_activity').select('*').eq('user_id', id).then(r => r.data ?? []) : Promise.resolve([]),
    staff && !self ? supabase.from('user_phone_history').select('*').eq('user_id', id).then(r => r.data ?? []) : Promise.resolve([]),
    self ? Promise.resolve(null) : authInfo(subject, profileRow),
  ]);

  const sorted = <T extends Record<string, any>>(rows: T[]) => [...rows].sort((a, b) => String(b.created_at ?? b.from_at).localeCompare(String(a.created_at ?? a.from_at)));
  const historyRows = sorted(history as any[]);
  const activityRows = sorted(activity as any[]).slice(0, 50);
  let assignmentRows: any[] = [];
  if (subject.role === 'driver' && staff && !self) {
    const { data } = await supabase.from('driver_vehicle_assignments').select('*').eq('driver_id', id);
    assignmentRows = [...(data ?? [])].sort((a, b) => String(b.assigned_at).localeCompare(String(a.assigned_at)));
  }
  const names = await namesOf([
    ...historyRows.map(h => h.changed_by), ...activityRows.map(a => a.actor_id), ...assignmentRows.map(a => a.assigned_by),
    profile.reporting_manager_id,
  ]);
  const plates = new Map<string, string>();
  if (assignmentRows.length) {
    const rows = await selectIn<any>('vehicles', 'id', assignmentRows.map(a => a.vehicle_id), 'id, plate_number');
    for (const v of rows) plates.set(v.id, v.plate_number);
  }
  let depotName: string | null = null;
  if (profile.base_depot_id) {
    const { data } = await supabase.from('depots').select('name').eq('id', profile.base_depot_id).maybeSingle();
    depotName = data?.name ?? null;
  }
  let vehicle: Record<string, any> | null = null;
  let performance: Record<string, any> | null = null;
  if (subject.role === 'driver') {
    const { windows, vehicleIds, currentVehicles } = await driverWindows(id);
    vehicle = (currentVehicles as any[]).find(v => v.status !== 'archived') ?? null;
    if (vehicle) vehicle = { id: vehicle.id, plate_number: vehicle.plate_number, vehicle_type: vehicle.vehicle_type, status: vehicle.status };
    const stats = await getDriverStats(id, windows, vehicleIds);
    const earnings = await buildEarnings(id);
    performance = { ...stats, earnings: { total_earnings: earnings.total_earnings, completed_trips: earnings.completed_trips } };
  }

  let partnerName: string | null = null;
  if (profile.employer_partner_id) {
    const { data } = await supabase.from('tpl_partners').select('company_name').eq('id', profile.employer_partner_id).maybeSingle();
    partnerName = data?.company_name ?? null;
  }
  const photoPath = profile.photo_path ?? (documents.find(d => d.doc_type === 'photo')?.file_path ?? null);

  return {
    user: {
      id: subject.id,
      full_name: subject.full_name,
      email: publicEmail(subject.email),
      phone: subject.phone,
      role: subject.role,
      status: subject.status,
      is_active: subject.is_active,
      last_login: subject.last_login,
      created_at: subject.created_at,
      updated_at: subject.updated_at,
      has_sign_in_account: auth ? auth.has_sign_in_account : true,
    },
    profile: {
      ...profile,
      base_depot_name: depotName,
      reporting_manager_name: profile.reporting_manager_id ? names.get(profile.reporting_manager_id) ?? null : null,
      employer_partner_name: partnerName,
    },
    photo_url: await signedUrl(photoPath),
    employer: { type: profile.employer_type, partner_id: profile.employer_partner_id, partner_name: partnerName },
    documents,
    doc_summary,
    missing_documents: missing,
    complete: doc_summary.required > 0 && doc_summary.verified === doc_summary.required,
    emergency_contacts: contacts,
    bank_accounts: bank,
    bank_access: profile.employer_type === 'partner' ? 'partner' : bankAllowed ? 'full' : 'none',
    status_history: historyRows.map(h => ({ ...h, changed_by_name: names.get(h.changed_by) ?? null })),
    notes,
    activity: activityRows.map(a => ({ ...a, actor_name: names.get(a.actor_id) ?? null })),
    phone_history: sorted(phoneHistory as any[]),
    auth,
    vehicle,
    vehicle_assignments: assignmentRows.map(a => ({
      id: a.id, vehicle_id: a.vehicle_id, plate_number: plates.get(a.vehicle_id) ?? null,
      assigned_at: a.assigned_at, unassigned_at: a.unassigned_at, assigned_by_name: names.get(a.assigned_by) ?? null,
    })),
    performance,
  };
}

// ── Duplicates ─────────────────────────────────────────────

export async function findDuplicates(query: { phone?: unknown; doc_type?: unknown; doc_number?: unknown; exclude?: unknown }) {
  const matches: Array<Record<string, any>> = [];
  const except = isUuid(query.exclude) ? query.exclude : undefined;
  if (typeof query.phone === 'string' && query.phone.trim()) {
    const phone = normalizePhone(query.phone);
    if (!phone) throw new HttpError(400, 'Phone is not a valid phone number');
    const { data } = await supabase.from('users').select('id, full_name, role, status').eq('phone', phone);
    for (const p of data ?? []) if (p.id !== except && (PERSON_ROLES as readonly string[]).includes(p.role)) matches.push({ ...p, matched_on: 'phone' });
  }
  if (query.doc_type !== undefined || query.doc_number !== undefined) {
    matches.push(...(await findDocumentDuplicate(query.doc_type, query.doc_number, except)));
  }
  return { matches };
}

// ── Sign-in accounts ───────────────────────────────────────

async function deleteAuthUser(id: string): Promise<void> {
  try {
    await supabase.auth.admin.deleteUser(id);
  } catch (e) {
    console.error('[people] could not roll back the sign-in account:', e);
  }
}

/** Creates the sign-in account the OTP flow would create, or finds it when it exists. */
async function ensureDriverAuthUser(phone: string, fullName: string, id?: string): Promise<string> {
  const email = driverEmailFor(phone);
  const { data, error } = await supabase.auth.admin.createUser({
    ...(id ? { id } : {}),
    email,
    email_confirm: true,
    app_metadata: { role: 'driver' },
    user_metadata: { full_name: fullName, role: 'driver', phone },
  });
  if (!error && data.user) return data.user.id;
  if (error && (error.message.includes('already been registered') || (error as any).code === 'email_exists')) {
    const existing = await findAuthUserByEmail(email);
    if (existing) return existing.id;
  }
  console.error('[people] could not create the driver sign-in account:', error?.message);
  throw new HttpError(502, 'Could not create the sign-in account. Try again');
}

// ── Create ─────────────────────────────────────────────────

const CREATABLE_ROLES: readonly string[] = PERSON_ROLES;

/**
 * Everything that can be checked about a new person without creating anything:
 * role rules, formats, duplicate phone and email, employee code. Throws a 400,
 * 403 or 409 (with the existing person) when something is wrong.
 */
export async function checkNewPerson(actor: Actor, body: Record<string, any>) {
  const role = typeof body.role === 'string' ? body.role : '';
  if (!CREATABLE_ROLES.includes(role)) throw new HttpError(400, `role must be one of ${PERSON_ROLES.join(', ')}`);
  if (role === 'superadmin' && actor.role !== 'superadmin') throw new HttpError(403, 'Only a superadmin can create a superadmin');
  if ((role === 'admin' || role === 'manager') && !canManage(actor)) throw new HttpError(403, 'Not authorized for this action');
  const fullName = parseRequiredText(body.full_name, 'Name', 100, 2);

  let phone: string | null = null;
  if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
    phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, 'Enter a valid phone number');
  }
  if (role === 'driver' && !phone) throw new HttpError(400, 'A driver needs a phone number: they sign in with an OTP sent to it');
  const email = role === 'driver' ? null : parseEmail(body.email);
  const personalEmail = role === 'driver' && body.email ? parseEmail(body.email) : null;

  const input = profileInput(body);
  if (personalEmail && !input.personal_email) input.personal_email = personalEmail;
  const profilePatch = await parseProfileInput(input, { id: null, role }, null, actor);

  // Duplicate checks before anything is created
  let clearance = { releaseFrom: null } as Awaited<ReturnType<typeof assertPhoneAvailable>>;
  if (phone) clearance = await assertPhoneAvailable(phone, null);
  if (email) {
    const { data: clash } = await supabase.from('users').select('id, full_name, role, status').eq('email', email).maybeSingle();
    if (clash) throw duplicateError(`${clash.full_name ?? 'Someone'} already has this email address`, clash as PersonRow);
  }
  return { role, fullName, phone, email, profilePatch, clearance };
}

export async function createPerson(actor: Actor, body: Record<string, any>) {
  const { role, fullName, phone, email, profilePatch, clearance } = await checkNewPerson(actor, body);
  if (clearance.releaseFrom) await releasePhone(clearance.releaseFrom.holder, clearance.releaseFrom.leftOn, actor.user_id);

  let id: string;
  if (role === 'driver') {
    id = await ensureDriverAuthUser(phone!, fullName);
    const { data: taken } = await supabase.from('users').select('id, full_name, role, status').eq('id', id).maybeSingle();
    if (taken && taken.role !== 'driver') throw new HttpError(409, 'That sign-in account belongs to someone else');
  } else {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email!, { data: { full_name: fullName, ...(phone ? { phone } : {}) } });
    if (error || !data?.user) {
      if (error && (error.message.includes('already been registered') || (error as any).code === 'email_exists')) {
        throw new HttpError(409, 'A sign-in account with this email already exists');
      }
      console.error('[people] invite failed:', error?.message);
      throw new HttpError(502, 'Could not send the invitation. Try again');
    }
    id = data.user.id;
    // The role is set by the server in app_metadata, which the person can't edit
    const { error: roleError } = await supabase.auth.admin.updateUserById(id, { app_metadata: { role } });
    if (roleError) {
      await deleteAuthUser(id);
      throw new HttpError(502, 'Could not set up the account. Try again');
    }
  }

  const { error: userError } = await supabase.from('users').upsert({
    id,
    email: role === 'driver' ? driverEmailFor(phone!) : email,
    phone,
    role,
    full_name: fullName,
    status: 'onboarding',
    is_active: true,
    updated_at: nowIso(),
  }, { onConflict: 'id' });
  if (userError) {
    await deleteAuthUser(id);
    throw new Error(`Failed to save person: ${userError.message}`);
  }

  try {
    await saveProfile(id, actor.user_id, {
      ...profilePatch,
      ...(role !== 'driver' ? { employer_type: 'company', employer_partner_id: null } : {}),
      ...(role !== 'driver' ? { invite_sent_at: nowIso() } : {}),
      created_at: nowIso(),
    });
  } catch (e) {
    await supabase.from('users').delete().eq('id', id);
    await deleteAuthUser(id);
    throw e;
  }
  if (phone) await recordPhoneChange(id, null, phone);
  await supabase.from('user_status_history').insert({ user_id: id, from_status: null, to_status: 'onboarding', reason: 'Person added', changed_by: actor.user_id, created_at: nowIso() });
  await logActivity(id, actor.user_id, 'person_created', { role, ...(clearance.releaseFrom ? { phone_reused_from: clearance.releaseFrom.holder.id } : {}) });
  return getPersonDetail(actor, id);
}

// ── Update ─────────────────────────────────────────────────

const ROLE_SWAP_MESSAGE = "A driver can't be turned into staff, or the reverse, on the same record. Create a new person instead";

async function assertNotLastSuperadmin(subject: PersonRow): Promise<void> {
  if (subject.role !== 'superadmin') return;
  const { data } = await supabase.from('users').select('id').eq('role', 'superadmin').eq('is_active', true);
  if (!(data ?? []).some(u => u.id !== subject.id)) throw new HttpError(409, "This is the last active superadmin, so it can't be deactivated or demoted");
}

export async function updatePerson(actor: Actor, id: string, body: Record<string, any>) {
  const subject = await loadPerson(id);
  assertCanModify(actor, subject);
  const profileRow = await getProfile(id);
  if (profileRow?.anonymised_at) throw new HttpError(409, 'This person has been anonymised');
  assertFresh(profileRow?.updated_at ?? subject.updated_at, body.updated_at);

  const changed: string[] = [];
  const userPatch: Record<string, any> = {};

  if (body.full_name !== undefined) {
    userPatch.full_name = parseRequiredText(body.full_name, 'Name', 100, 2);
    changed.push('full_name');
  }

  // Role: superadmin only, never between driver and staff, never your own, never the last superadmin down
  let newRole: PersonRole | null = null;
  if (body.role !== undefined && body.role !== subject.role) {
    if (actor.role !== 'superadmin') throw new HttpError(403, 'Only a superadmin can change a role');
    if (!(PERSON_ROLES as readonly string[]).includes(body.role)) throw new HttpError(400, `role must be one of ${PERSON_ROLES.join(', ')}`);
    if ((body.role === 'driver') !== (subject.role === 'driver')) throw new HttpError(409, ROLE_SWAP_MESSAGE);
    if (id === actor.user_id) throw new HttpError(409, "You can't change your own role. Ask another superadmin");
    if (subject.role === 'superadmin') await assertNotLastSuperadmin(subject);
    newRole = body.role;
    userPatch.role = newRole;
    changed.push('role');
  }

  // Phone
  let phoneClearance: Awaited<ReturnType<typeof assertPhoneAvailable>> | null = null;
  let newPhone: string | null = null;
  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === '') {
      if (subject.role === 'driver') throw new HttpError(400, 'A driver needs a phone number');
      newPhone = null;
    } else {
      newPhone = normalizePhone(body.phone);
      if (!newPhone) throw new HttpError(400, 'Enter a valid phone number');
    }
    if (newPhone !== subject.phone) {
      if (newPhone) phoneClearance = await assertPhoneAvailable(newPhone, id);
      userPatch.phone = newPhone;
      changed.push('phone');
    }
  }

  // Email: staff sign in with it, so it goes through the Auth admin API; a driver's email is only a contact detail
  const input = profileInput(body);
  let newEmail: string | null = null;
  if (body.email !== undefined) {
    if (subject.role === 'driver') {
      if (body.email !== null && body.email !== '') input.personal_email = body.email;
      else input.personal_email = null;
    } else {
      newEmail = parseEmail(body.email);
      if (newEmail !== (subject.email ?? '').toLowerCase()) {
        const { data: clash } = await supabase.from('users').select('id, full_name, role, status').eq('email', newEmail).maybeSingle();
        if (clash && clash.id !== id) throw duplicateError(`${clash.full_name ?? 'Someone'} already has this email address`, clash as PersonRow);
        userPatch.email = newEmail;
        changed.push('email');
      } else newEmail = null;
    }
  }

  const profilePatch = await parseProfileInput(input, { id, role: newRole ?? subject.role }, profileRow, actor);
  changed.push(...Object.keys(profilePatch).filter(k => !['consent_at', 'consent_by'].includes(k)));
  if (changed.length === 0) throw new HttpError(400, 'Nothing to update');

  // Sign-in account first: if it fails nothing else has changed
  if (newEmail) {
    const { error } = await supabase.auth.admin.updateUserById(id, { email: newEmail });
    if (error) {
      if ((error as any).code === 'email_exists') throw new HttpError(409, 'A sign-in account with this email already exists');
      console.error('[people] email change failed:', error.message);
      throw new HttpError(502, 'Could not change the sign-in email. Try again');
    }
  }
  if (newRole) {
    const { error } = await supabase.auth.admin.updateUserById(id, { app_metadata: { role: newRole } });
    if (error) throw new HttpError(502, 'Could not change the role. Try again');
  }
  if (phoneClearance?.releaseFrom) await releasePhone(phoneClearance.releaseFrom.holder, phoneClearance.releaseFrom.leftOn, actor.user_id);

  if (Object.keys(userPatch).length > 0) {
    const { error } = await supabase.from('users').update({ ...userPatch, updated_at: nowIso() }).eq('id', id);
    if (error) throw new Error(`Failed to update person: ${error.message}`);
  }
  if (Object.keys(profilePatch).length > 0 || Object.keys(userPatch).length > 0 || !profileRow) {
    await saveProfile(id, actor.user_id, profilePatch);
  }
  if ('phone' in userPatch) await recordPhoneChange(id, subject.phone, userPatch.phone);

  // A driver's name and phone are copied onto their vehicles for dispatch screens
  if (subject.role === 'driver' && ('phone' in userPatch || 'full_name' in userPatch)) {
    const copy: Record<string, any> = {};
    if ('phone' in userPatch) copy.driver_phone = userPatch.phone;
    if ('full_name' in userPatch) copy.driver_name = userPatch.full_name;
    await supabase.from('vehicles').update(copy).eq('driver_id', id);
    await cacheDeletePattern('vehicles:list:*');
  }

  invalidateRoleCache(id);
  await logActivity(id, actor.user_id, 'profile_updated', {
    fields: changed,
    ...(newRole ? { role: { from: subject.role, to: newRole } } : {}),
    ...(userPatch.phone !== undefined ? { phone: { from_last4: (subject.phone ?? '').slice(-4), to_last4: (userPatch.phone ?? '').slice(-4) } } : {}),
  });
  if (newRole) await logActivity(id, actor.user_id, 'role_changed', { from: subject.role, to: newRole });
  if (newEmail) {
    await logActivity(id, actor.user_id, 'email_changed', { to: newEmail });
    try {
      await notificationService.sendNotification(id, 'Sign-in email changed', `Your sign-in email is now ${newEmail}. If you didn't expect this, tell an admin.`, 'account_changed', { user_id: id });
    } catch (e: any) {
      console.error('[people] could not notify about an email change:', e.message);
    }
  }
  return getPersonDetail(actor, id);
}

// ── Status ─────────────────────────────────────────────────

export async function setSignInBan(id: string, banned: boolean): Promise<void> {
  try {
    const { error } = await supabase.auth.admin.updateUserById(id, { ban_duration: banned ? '876000h' : 'none' });
    if (error && (error as any).status !== 404) console.error('[people] could not update sign-in access:', error.message);
  } catch (e) {
    console.error('[people] could not update sign-in access:', e);
  }
}

interface ReleaseCheck { vehicleIds: string[]; plates: string[]; pendingRoutes: number }

/** Refuses when the driver is on an active route; reports vehicles and pending routes that would have to be released. */
async function checkDriverBusy(subject: PersonRow, verb: string): Promise<ReleaseCheck> {
  const { data: vehicles } = await supabase.from('vehicles').select('id, plate_number').eq('driver_id', subject.id);
  const list = vehicles ?? [];
  if (list.length === 0) return { vehicleIds: [], plates: [], pendingRoutes: 0 };
  const ids = list.map(v => v.id as string);
  const { data: routes } = await supabase.from('routes').select('id, vehicle_id, status').in('vehicle_id', ids).in('status', ['active', 'pending']);
  const active = (routes ?? []).find(r => r.status === 'active');
  if (active) {
    const plate = list.find(v => v.id === active.vehicle_id)?.plate_number ?? 'their vehicle';
    throw new HttpError(409, `${subject.full_name ?? 'This driver'} is on an active route (${String(active.id).slice(0, 8)} on ${plate}). Finish or reassign it before you ${verb}`, { code: 'active_route', route_id: active.id });
  }
  return { vehicleIds: ids, plates: list.map(v => v.plate_number as string), pendingRoutes: (routes ?? []).filter(r => r.status === 'pending').length };
}

export async function changeStatus(actor: Actor, id: string, body: Record<string, any>) {
  const subject = await loadPerson(id);
  if (id === actor.user_id) throw new HttpError(403, "You can't change your own status");
  assertCanModify(actor, subject);
  const profileRow = await getProfile(id);
  if (profileRow?.anonymised_at) throw new HttpError(409, 'This person has been anonymised');

  const status = body.status as PersonStatus;
  if (!(PERSON_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, `status must be one of ${PERSON_STATUSES.join(', ')}`);
  if (status === subject.status) throw new HttpError(409, `This person is already ${status.replace('_', ' ')}`);
  if (subject.status === 'inactive' && status !== 'onboarding') throw new HttpError(409, 'Someone who left comes back through onboarding. Set the status to onboarding first');
  if (status === 'onboarding' && subject.status !== 'inactive') throw new HttpError(409, 'Only someone who left can go back to onboarding');

  const ends = status === 'suspended' || status === 'inactive';
  let reason: string | null = null;
  if (ends) reason = parseRejectionReason(body.reason);
  else if (body.reason !== undefined && body.reason !== null && body.reason !== '') reason = parseOptionalText(body.reason, 'Reason', 500) ?? null;

  const today = todayKey();
  const profilePatch: Record<string, any> = { suspended_until: null, leave_from: null, leave_until: null };
  if (status === 'suspended' && body.suspended_until) {
    if (typeof body.suspended_until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.suspended_until) || body.suspended_until <= today) {
      throw new HttpError(400, 'suspended_until must be a date after today (YYYY-MM-DD)');
    }
    profilePatch.suspended_until = body.suspended_until;
  }
  if (status === 'on_leave') {
    const from = body.leave_from ?? today;
    const until = body.leave_until;
    const valid = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!valid(until) || !valid(from)) throw new HttpError(400, 'Leave needs leave_until, and leave_from if it is not today (YYYY-MM-DD)');
    if (from > today) throw new HttpError(400, 'Leave starts today. Set the status on the day the leave begins');
    if (until < from || until < today) throw new HttpError(400, 'leave_until must not be before the start of the leave or before today');
    profilePatch.leave_from = from;
    profilePatch.leave_until = until;
  }

  if (ends) {
    await assertNotLastSuperadmin(subject);
    if (subject.role === 'driver') {
      const busy = await checkDriverBusy(subject, status === 'inactive' ? 'deactivate them' : 'suspend them');
      if (busy.vehicleIds.length > 0) {
        if (body.confirm_release !== true) {
          throw new HttpError(409, `${subject.full_name ?? 'This driver'} is assigned to ${busy.plates.join(', ')}${busy.pendingRoutes ? ` and has ${busy.pendingRoutes} pending route(s)` : ''}. Confirm to release the vehicle${busy.plates.length > 1 ? 's' : ''}`, {
            code: 'confirm_release', requires_confirmation: true, vehicles: busy.plates, pending_routes: busy.pendingRoutes,
          });
        }
        await supabase.from('vehicles').update({ driver_id: null, driver_name: null, driver_phone: null }).in('id', busy.vehicleIds);
        invalidateDriverVehicles();
        await cacheDeletePattern('vehicles:list:*');
        await logActivity(id, actor.user_id, 'vehicles_released', { vehicles: busy.plates, pending_routes: busy.pendingRoutes });
      }
    }
  }

  const isActive = SIGN_IN_STATUSES.has(status);
  const userPatch: Record<string, any> = { status, is_active: isActive, updated_at: nowIso() };
  if (ends) userPatch.push_token = null; // the app stops receiving work
  const { error } = await supabase.from('users').update(userPatch).eq('id', id);
  if (error) throw new Error(`Failed to change status: ${error.message}`);
  await saveProfile(id, actor.user_id, profilePatch);
  await supabase.from('user_status_history').insert({ user_id: id, from_status: subject.status, to_status: status, reason, changed_by: actor.user_id, created_at: nowIso() });
  await logActivity(id, actor.user_id, subject.status === 'inactive' ? 'rehired' : 'status_changed', { from: subject.status, to: status, reason, ...profilePatch });

  invalidateRoleCache(id);
  await setSignInBan(id, ends);
  return getPersonDetail(actor, id);
}

// ── Invite ─────────────────────────────────────────────────

export const INVITE_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Staff: sends (or resends) the sign-in invitation, at most one every 10 minutes,
 * recreating the sign-in account first when it was deleted. Drivers: recreates
 * their missing sign-in account (they sign in with an OTP, so nothing is sent).
 */
export async function sendInvite(actor: Actor, id: string) {
  const subject = await loadPerson(id);
  assertCanModify(actor, subject);
  const profileRow = await getProfile(id);
  if (profileRow?.anonymised_at) throw new HttpError(409, 'This person has been anonymised');
  if (!SIGN_IN_STATUSES.has(subject.status)) throw new HttpError(409, 'Reactivate this person before sending an invitation');

  const existing = await supabase.auth.admin.getUserById(id).then(r => r.data?.user ?? null).catch(() => null);
  if (subject.role === 'driver') {
    if (existing) return { repaired: false, message: 'This driver already has a sign-in account. They sign in with an OTP on their phone' };
    if (!subject.phone) throw new HttpError(409, 'Add a phone number first: drivers sign in with an OTP');
    await ensureDriverAuthUser(subject.phone, subject.full_name ?? 'Driver', id);
    await logActivity(id, actor.user_id, 'signin_account_restored', {});
    return { repaired: true, message: 'Sign-in account restored. The driver signs in with an OTP on their phone' };
  }

  if (!subject.email) throw new HttpError(409, 'Add an email address first');
  if (existing?.last_sign_in_at) throw new HttpError(409, 'This person has already signed in. They can reset their own password from the sign-in page');
  const sentAt = profileRow?.invite_sent_at ? Date.parse(profileRow.invite_sent_at) : 0;
  if (sentAt && Date.now() - sentAt < INVITE_COOLDOWN_MS) {
    const wait = Math.ceil((INVITE_COOLDOWN_MS - (Date.now() - sentAt)) / 60_000);
    throw new HttpError(429, `An invitation was sent a moment ago. Try again in ${wait} minute${wait === 1 ? '' : 's'}`, { code: 'invite_cooldown', retry_after_minutes: wait });
  }

  if (!existing) {
    // The account was deleted: recreate it with the same id so the profile, history and links stay
    const { error } = await supabase.auth.admin.createUser({
      id, email: subject.email, email_confirm: false,
      app_metadata: { role: subject.role }, user_metadata: { full_name: subject.full_name ?? '' },
    });
    if (error && (error as any).code !== 'email_exists') throw new HttpError(502, 'Could not restore the sign-in account. Try again');
  }
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(subject.email, { data: { full_name: subject.full_name ?? '' } });
  if (inviteError) {
    console.error('[people] invite failed:', inviteError.message);
    throw new HttpError(502, 'Could not send the invitation. Try again');
  }
  const stamp = nowIso();
  await saveProfile(id, actor.user_id, { invite_sent_at: stamp });
  await logActivity(id, actor.user_id, existing ? 'invite_resent' : 'invite_sent_after_restore', { email: subject.email });
  return { repaired: !existing, invite_sent_at: stamp, message: `Invitation sent to ${subject.email}` };
}

// ── Consent ────────────────────────────────────────────────

const CONSENT_METHODS = ['signed_form', 'in_app', 'verbal_recorded'];

/** Records the person's consent to keep their documents (by staff, or by the person in the app). */
export async function recordConsent(actor: Actor, id: string, body: Record<string, any>) {
  const subject = await loadPerson(id);
  const method = typeof body.method === 'string' ? body.method.trim().toLowerCase().replace(/[\s-]/g, '_') : '';
  if (!CONSENT_METHODS.includes(method)) throw new HttpError(400, `method must be one of ${CONSENT_METHODS.join(', ')}`);
  if (actor.user_id === subject.id && method !== 'in_app') throw new HttpError(400, 'Consent you give yourself is recorded as in_app');
  const profileRow = await getProfile(id);
  if (profileRow?.anonymised_at) throw new HttpError(409, 'This person has been anonymised');
  const saved = await saveProfile(id, actor.user_id, { consent_at: nowIso(), consent_by: actor.user_id, consent_method: method });
  await logActivity(id, actor.user_id, 'consent_recorded', { method });
  return { consent_at: saved.consent_at, consent_by: saved.consent_by, consent_method: saved.consent_method };
}

// ── Anonymise ──────────────────────────────────────────────

/**
 * Erases a person's personal data at their request, keeping the record id so routes,
 * invoices and history stay intact. Superadmin only, and only once they have left.
 */
export async function anonymisePerson(actor: Actor, id: string) {
  if (actor.role !== 'superadmin') throw new HttpError(403, 'Only a superadmin can anonymise a person');
  const subject = await loadPerson(id);
  if (id === actor.user_id) throw new HttpError(403, "You can't anonymise yourself");
  if (subject.status !== 'inactive') throw new HttpError(409, 'Only someone who has left (inactive) can be anonymised');
  const profileRow = await getProfile(id);
  if (profileRow?.anonymised_at) throw new HttpError(409, 'This person has already been anonymised');

  const { data: docs } = await supabase.from('user_documents').select('id, file_path, extra_file_paths').eq('user_id', id);
  await removeStoredFiles([...(docs ?? []).flatMap(d => [d.file_path, ...((d.extra_file_paths ?? []) as string[])]), profileRow?.photo_path]);
  const stamp = nowIso();
  await supabase.from('user_documents').update({
    doc_number: null, number_last4: null, number_hash: null, name_on_document: null, file_path: null, extra_file_paths: null,
    rejection_reason: null, metadata: {}, archived_at: stamp, updated_at: stamp,
  }).eq('user_id', id);
  await supabase.from('user_emergency_contacts').delete().eq('user_id', id);
  await supabase.from('user_bank_accounts').delete().eq('user_id', id);
  await supabase.from('user_notes').delete().eq('user_id', id);
  await supabase.from('user_phone_history').delete().eq('user_id', id);
  await supabase.from('users').update({
    full_name: 'Anonymised person', email: `anonymised-${id}@anonymised.invalid`, phone: null, push_token: null, updated_at: stamp,
  }).eq('id', id);
  await supabase.from('user_profiles').update({
    date_of_birth: null, gender: null, blood_group: null, alternate_phone: null, personal_email: null, address_line: null,
    city: null, state: null, pincode: null, latitude: null, longitude: null, photo_path: null, designation: null,
    department: null, reporting_manager_id: null, suspended_until: null, leave_from: null, leave_until: null,
    consent_at: null, consent_by: null, consent_method: null, invite_sent_at: null, anonymised_at: stamp, updated_at: stamp, updated_by: actor.user_id,
  }).eq('user_id', id);
  await supabase.from('vehicles').update({ driver_name: null, driver_phone: null }).eq('driver_id', id);
  try {
    await supabase.auth.admin.updateUserById(id, { email: `anonymised-${id}@anonymised.invalid`, ban_duration: '876000h', user_metadata: { full_name: 'Anonymised person', phone: null } });
  } catch (e) {
    console.error('[people] could not close the sign-in account:', e);
  }
  invalidateRoleCache(id);
  await logActivity(id, actor.user_id, 'anonymised', { previous_status: subject.status });
  return getPersonDetail(actor, id);
}
