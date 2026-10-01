/**
 * margixindia — Organisations, members and 3PL affiliations (docs/tenancy-design.md §5).
 *
 * Reads and writes use the service role, so every rule lives here: who may do what is decided by the
 * caller's role in the organisation they act for, and the platform admin's decisions are the only way an
 * organisation becomes active, rejected or suspended. Each change is written to the audit trail.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { invalidateOrgContext, type OrgKind, type OrgRole, type OrgStatus } from '../core/org-context';
import { notificationService } from './notification.service';
import { auditService, type AuditActor } from './audit.service';
import { normalizePhone } from '../utils/phone';
import type { MemberInvite, MemberUpdate, OrgCreate, OrgUpdate } from '../schemas/org';

const ORG_COLUMNS = 'id, kind, name, legal_name, gstin, pan, state, city, address, pincode, phone, email, status, profile, approved_by, approved_at, created_by, created_at, updated_at';
const MEMBER_ROLES_WHO_MANAGE: OrgRole[] = ['owner', 'admin'];

export interface OrgRow {
  id: string;
  kind: OrgKind;
  name: string;
  status: OrgStatus;
  profile: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** Tell the active owners and admins of an organisation. Never blocks or undoes the action. */
async function notifyOrg(orgId: string, title: string, body: string, type: string, data: Record<string, unknown>): Promise<void> {
  try {
    const { data: seats } = await supabase.from('org_members').select('user_id').eq('org_id', orgId).eq('status', 'active').in('role', ['owner', 'admin']);
    for (const seat of seats ?? []) await notificationService.sendNotification(seat.user_id as string, title, body, type, data);
  } catch (e) {
    console.error('[org] could not notify:', e);
  }
}

const audit = (actor: AuditActor, action: string, subject: Record<string, unknown>, outcome?: string) =>
  auditService.record('staff-console', actor, action, subject, outcome);

/** Drops empty strings and undefined so a PATCH changes only what was sent; null clears a field. */
function definedOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ── Organisations ──────────────────────────────────────────

export async function getOrg(id: string): Promise<OrgRow> {
  const { data, error } = await supabase.from('organizations').select(ORG_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the organisation: ${error.message}`);
  if (!data) throw new HttpError(404, 'Organisation not found');
  return data as OrgRow;
}

export async function updateOrg(actor: AuditActor, orgId: string, input: OrgUpdate): Promise<OrgRow> {
  const { profile, ...columns } = input;
  const patch: Record<string, unknown> = definedOnly(columns);
  if (profile !== undefined) {
    // The profile is merged key by key; keys the organisation was created with (where it came from) stay
    const current = await getOrg(orgId);
    patch.profile = { ...(current.profile ?? {}), ...profile };
  }
  if (Object.keys(patch).length === 0) throw new HttpError(422, 'Nothing to change');
  const { data, error } = await supabase.from('organizations').update(patch).eq('id', orgId).select(ORG_COLUMNS).maybeSingle();
  if (error) throw new Error(`Failed to update the organisation: ${error.message}`);
  if (!data) throw new HttpError(404, 'Organisation not found');
  invalidateOrgContext();
  await audit(actor, 'org.updated', { org_id: orgId, fields: Object.keys(patch) });
  return data as OrgRow;
}

/** A new logistic company or vendor organisation: pending until the platform approves it; the creator owns it. */
export async function createOrg(actor: AuditActor, input: OrgCreate): Promise<OrgRow> {
  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ id: crypto.randomUUID(), ...definedOnly(input), status: 'pending', created_by: actor.user_id })
    .select(ORG_COLUMNS)
    .single();
  if (error || !org) throw new Error(`Failed to create the organisation: ${error?.message}`);
  const { error: memberErr } = await supabase
    .from('org_members')
    .insert({ org_id: org.id, user_id: actor.user_id, role: 'owner', status: 'active' });
  if (memberErr) {
    await supabase.from('organizations').delete().eq('id', org.id);
    throw new Error(`Failed to add the owner: ${memberErr.message}`);
  }
  invalidateOrgContext(actor.user_id);
  await audit(actor, 'org.created', { org_id: org.id, kind: input.kind, name: input.name });
  return org as OrgRow;
}

// ── Members ────────────────────────────────────────────────

export async function listMembers(orgId: string) {
  const { data, error } = await supabase
    .from('org_members')
    .select('user_id, role, status, invited_by, created_at')
    .eq('org_id', orgId)
    .neq('status', 'removed')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to read members: ${error.message}`);
  const members = data ?? [];
  const ids = members.map(m => m.user_id as string);
  const { data: users, error: userErr } = ids.length
    ? await supabase.from('users').select('id, full_name, email, phone, role, is_active').in('id', ids)
    : { data: [] as Array<Record<string, any>>, error: null };
  if (userErr) throw new Error(`Failed to read members: ${userErr.message}`);
  const byId = new Map((users ?? []).map(u => [u.id as string, u]));
  return members.map(m => {
    const u = byId.get(m.user_id as string);
    return {
      user_id: m.user_id, role: m.role, status: m.status, created_at: m.created_at, invited_by: m.invited_by,
      name: u?.full_name ?? null, email: u?.email ?? null, phone: u?.phone ?? null, app_role: u?.role ?? null, is_active: u?.is_active ?? null,
    };
  });
}

async function memberOf(orgId: string, userId: string): Promise<{ role: OrgRole; status: string } | null> {
  const { data, error } = await supabase.from('org_members').select('role, status').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Failed to read the member: ${error.message}`);
  return (data as { role: OrgRole; status: string } | null) ?? null;
}

async function activeOwnerCount(orgId: string): Promise<number> {
  const { data, error } = await supabase.from('org_members').select('user_id').eq('org_id', orgId).eq('role', 'owner').eq('status', 'active');
  if (error) throw new Error(`Failed to read owners: ${error.message}`);
  return (data ?? []).length;
}

/** Only an owner may hand out, change or take away ownership. */
function assertCanTouchRole(actorRole: OrgRole, role: OrgRole): void {
  if (role === 'owner' && actorRole !== 'owner') throw new HttpError(403, 'Only an owner can add, change or remove an owner');
}

/** Add an existing user (found by email or phone) to the organisation with a role. They are active at once. */
export async function inviteMember(actor: AuditActor, actorRole: OrgRole, orgId: string, input: MemberInvite) {
  assertCanTouchRole(actorRole, input.role);
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) throw new HttpError(422, 'Phone number is not valid', { field: 'phone' });
  const lookup = supabase.from('users').select('id, full_name, email, phone');
  const { data: users, error } = await (input.email ? lookup.eq('email', input.email) : lookup.eq('phone', phone as string)).limit(2);
  if (error) throw new Error(`Failed to look the person up: ${error.message}`);
  if (!users || users.length === 0) throw new HttpError(422, 'No account with that email or phone', { field: input.email ? 'email' : 'phone' });
  if (users.length > 1) throw new HttpError(409, 'More than one user has that phone number. Use their email instead.');
  const user = users[0];

  const existing = await memberOf(orgId, user.id);
  if (existing && existing.status === 'active') throw new HttpError(409, 'This person is already a member');
  if (existing?.role === 'owner' && actorRole !== 'owner') throw new HttpError(403, 'Only an owner can change an owner');

  const row = { org_id: orgId, user_id: user.id, role: input.role, status: 'active', invited_by: actor.user_id };
  const { error: writeErr } = existing
    ? await supabase.from('org_members').update({ role: input.role, status: 'active', invited_by: actor.user_id }).eq('org_id', orgId).eq('user_id', user.id)
    : await supabase.from('org_members').insert(row);
  if (writeErr) throw new Error(`Failed to add the member: ${writeErr.message}`);
  invalidateOrgContext(user.id);
  await audit(actor, 'org.member_added', { org_id: orgId, user_id: user.id, role: input.role });
  return { user_id: user.id, name: user.full_name ?? null, email: user.email ?? null, phone: user.phone ?? null, role: input.role, status: 'active' };
}

/** Change a member's role, or remove them (or bring a removed one back). The last owner cannot leave or be demoted. */
export async function updateMember(actor: AuditActor, actorRole: OrgRole, orgId: string, userId: string, input: MemberUpdate) {
  const current = await memberOf(orgId, userId);
  if (!current) throw new HttpError(404, 'Member not found');
  assertCanTouchRole(actorRole, current.role);
  if (input.role) assertCanTouchRole(actorRole, input.role);

  const nextRole = input.role ?? current.role;
  const nextStatus = input.status ?? current.status;
  const losesOwnership = current.role === 'owner' && current.status === 'active' && (nextRole !== 'owner' || nextStatus !== 'active');
  if (losesOwnership && (await activeOwnerCount(orgId)) <= 1) throw new HttpError(409, 'An organisation needs at least one owner');

  const { error } = await supabase.from('org_members').update({ role: nextRole, status: nextStatus }).eq('org_id', orgId).eq('user_id', userId);
  if (error) throw new Error(`Failed to update the member: ${error.message}`);
  invalidateOrgContext(userId);
  await audit(actor, 'org.member_updated', { org_id: orgId, user_id: userId, role: nextRole, status: nextStatus });
  return { user_id: userId, role: nextRole, status: nextStatus };
}

export const canManageMembers = (role: OrgRole | undefined): boolean => !!role && MEMBER_ROLES_WHO_MANAGE.includes(role);

// ── Platform admin: approval ───────────────────────────────

export async function listOrgs(filter: { kind?: OrgKind; status?: OrgStatus; limit?: number; offset?: number }) {
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  let q = supabase.from('organizations').select(ORG_COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (filter.kind) q = q.eq('kind', filter.kind);
  if (filter.status) q = q.eq('status', filter.status);
  const { data, error, count } = await q;
  if (error) throw new Error(`Failed to list organisations: ${error.message}`);
  return { items: (data ?? []) as OrgRow[], total: count ?? (data ?? []).length, limit, offset };
}

type Decision = 'approve' | 'reject' | 'suspend';
const FROM_STATUSES: Record<Decision, OrgStatus[]> = {
  approve: ['pending', 'suspended'],
  reject: ['pending'],
  suspend: ['active'],
};
const TO_STATUS: Record<Decision, OrgStatus> = { approve: 'active', reject: 'rejected', suspend: 'suspended' };

/** Approve (or reinstate), reject or suspend an organisation. The reason is kept in its profile. */
export async function decideOrg(actor: AuditActor, id: string, decision: Decision, reason?: string): Promise<OrgRow> {
  const org = await getOrg(id);
  if (org.kind === 'platform') throw new HttpError(400, 'The platform organisation cannot be approved, rejected or suspended');
  if (!FROM_STATUSES[decision].includes(org.status)) {
    throw new HttpError(409, `A ${org.status} organisation cannot be ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'suspended'}`);
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: TO_STATUS[decision] };
  if (decision === 'approve') Object.assign(patch, { approved_by: actor.user_id, approved_at: now });
  if (decision !== 'approve' && reason) patch.profile = { ...(org.profile ?? {}), [`${decision}_reason`]: reason };
  const { data, error } = await supabase.from('organizations').update(patch).eq('id', id).eq('status', org.status).select(ORG_COLUMNS).maybeSingle();
  if (error) throw new Error(`Failed to update the organisation: ${error.message}`);
  if (!data) throw new HttpError(409, 'This organisation changed while you were deciding. Refresh and try again');
  invalidateOrgContext();
  await audit(actor, `org.${decision}`, { org_id: id, kind: org.kind, name: org.name, reason: reason ?? null }, `Organisation ${TO_STATUS[decision]}`);
  const said = { approve: 'is approved', reject: 'was not approved', suspend: 'is suspended' }[decision];
  await notifyOrg(id, `${org.name} ${said}`, reason ? `Reason: ${reason}` : decision === 'approve' ? 'You can now work on MargixIndia.' : 'Contact the platform team for details.', `org_${decision}`, { org_id: id, status: TO_STATUS[decision] });
  return data as OrgRow;
}

// ── 3PL affiliations ───────────────────────────────────────

export type AffiliationAction = 'approve' | 'pause' | 'end';
const AFFILIATION_FROM: Record<AffiliationAction, string[]> = {
  approve: ['pending', 'paused'],
  pause: ['active'],
  end: ['pending', 'active', 'paused'],
};
const AFFILIATION_TO: Record<AffiliationAction, string> = { approve: 'active', pause: 'paused', end: 'ended' };

/** A 3PL organisation asks to join a logistic company. The company approves it. */
export async function requestAffiliation(actor: AuditActor, tplOrgId: string, companyId: string) {
  const company = await getOrg(companyId).catch(e => { if (e instanceof HttpError) throw new HttpError(404, 'Logistic company not found'); throw e; });
  if (company.kind !== 'logistic_company') throw new HttpError(422, 'That organisation is not a logistic company', { field: 'company_id' });
  if (company.status !== 'active') throw new HttpError(409, 'That company is not accepting partners right now');

  const { data: existing, error } = await supabase.from('tpl_affiliations').select('status').eq('company_id', companyId).eq('tpl_id', tplOrgId).maybeSingle();
  if (error) throw new Error(`Failed to read the affiliation: ${error.message}`);
  if (existing && existing.status !== 'ended') throw new HttpError(409, `You already have a ${existing.status} affiliation with this company`);

  const fields = { status: 'pending', requested_by: actor.user_id, approved_by: null, approved_at: null };
  const { data, error: writeErr } = existing
    ? await supabase.from('tpl_affiliations').update(fields).eq('company_id', companyId).eq('tpl_id', tplOrgId).select('company_id, tpl_id, status, created_at').single()
    : await supabase.from('tpl_affiliations').insert({ company_id: companyId, tpl_id: tplOrgId, ...fields }).select('company_id, tpl_id, status, created_at').single();
  if (writeErr || !data) throw new Error(`Failed to request the affiliation: ${writeErr?.message}`);
  await audit(actor, 'tpl_affiliation.requested', { company_id: companyId, tpl_id: tplOrgId });
  const tpl = await getOrg(tplOrgId);
  await notifyOrg(companyId, `${tpl.name} wants to join as a 3PL partner`, 'Approve or decline the request under 3PL partners.', 'tpl_affiliation_requested', { company_id: companyId, tpl_id: tplOrgId });
  return data;
}

/** The 3PL partners of a company, with their organisation details. */
export async function listCompanyAffiliations(companyId: string) {
  const { data, error } = await supabase
    .from('tpl_affiliations')
    .select('tpl_id, status, requested_by, approved_by, approved_at, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to read affiliations: ${error.message}`);
  return withOrgs(data ?? [], 'tpl_id');
}

/** The companies a 3PL partner has joined or asked to join. */
export async function listTplAffiliations(tplOrgId: string) {
  const { data, error } = await supabase
    .from('tpl_affiliations')
    .select('company_id, status, requested_by, approved_by, approved_at, created_at')
    .eq('tpl_id', tplOrgId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to read affiliations: ${error.message}`);
  return withOrgs(data ?? [], 'company_id');
}

async function withOrgs<T extends Record<string, any>>(rows: T[], idKey: string) {
  const ids = rows.map(r => r[idKey] as string);
  const { data, error } = ids.length ? await supabase.from('organizations').select('id, name, legal_name, city, state, status, phone, email').in('id', ids) : { data: [] as Array<Record<string, any>>, error: null };
  if (error) throw new Error(`Failed to read organisations: ${error.message}`);
  const byId = new Map((data ?? []).map(o => [o.id as string, o]));
  return rows.map(r => ({ ...r, organization: byId.get(r[idKey] as string) ?? null }));
}

/** The company approves, pauses or ends the affiliation with one of its 3PL partners. */
export async function decideAffiliation(actor: AuditActor, companyId: string, tplId: string, action: AffiliationAction) {
  const { data: current, error } = await supabase.from('tpl_affiliations').select('status').eq('company_id', companyId).eq('tpl_id', tplId).maybeSingle();
  if (error) throw new Error(`Failed to read the affiliation: ${error.message}`);
  if (!current) throw new HttpError(404, 'Affiliation not found');
  if (!AFFILIATION_FROM[action].includes(current.status)) throw new HttpError(409, `A ${current.status} affiliation cannot be ${action === 'approve' ? 'approved' : action === 'pause' ? 'paused' : 'ended'}`);
  const patch: Record<string, unknown> = { status: AFFILIATION_TO[action] };
  if (action === 'approve') Object.assign(patch, { approved_by: actor.user_id, approved_at: new Date().toISOString() });
  const { data, error: writeErr } = await supabase
    .from('tpl_affiliations').update(patch).eq('company_id', companyId).eq('tpl_id', tplId).eq('status', current.status)
    .select('company_id, tpl_id, status, approved_at').maybeSingle();
  if (writeErr) throw new Error(`Failed to update the affiliation: ${writeErr.message}`);
  if (!data) throw new HttpError(409, 'This affiliation changed while you were deciding. Refresh and try again');
  await audit(actor, `tpl_affiliation.${action}`, { company_id: companyId, tpl_id: tplId }, `Affiliation ${AFFILIATION_TO[action]}`);
  const company = await getOrg(companyId);
  const said = { approve: 'approved your request', pause: 'paused your partnership', end: 'ended your partnership' }[action];
  await notifyOrg(tplId, `${company.name} ${said}`, 'See your companies under Partnerships.', `tpl_affiliation_${action}`, { company_id: companyId, tpl_id: tplId, status: AFFILIATION_TO[action] });
  return data;
}
