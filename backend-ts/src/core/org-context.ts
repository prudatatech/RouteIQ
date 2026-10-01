/**
 * margixindia — Organisation context (docs/tenancy-design.md)
 *
 * After a caller is authenticated, their active memberships are loaded (cached 60 s per user) and one of
 * them becomes the active organisation: the one named by the `X-Org-Id` header, else the user's only one,
 * else their first logistic company. A header naming an organisation the user is not a member of is a 403.
 *
 * The result is set on the request (`req.org`, `req.orgRole`, `req.memberships`, `req.isPlatformAdmin`) and
 * remembered for the rest of the request, so services can stamp new rows without being handed the request:
 * carrierStamp() / issuerStamp() / vendorOrgOf() give the owner columns to spread into an insert. Outside a
 * request (the scheduler) there is no organisation, and the database default (the default company) stamps.
 *
 * Until the organisations migration has run, no default company is configured: `configured` is false,
 * `req.org` is null and nothing is stamped, so the app behaves as it always did.
 */
import type { NextFunction, Request, Response } from 'express';
import { supabase } from './supabase';
import { HttpError } from './errors';
import { isUuid } from './validate';
import { memoize, registerClearable } from './memo';
import { getRequestOrg, setRequestOrg } from './timing';

export type OrgKind = 'platform' | 'logistic_company' | 'vendor' | 'tpl_partner';
export type OrgStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export const ORG_ROLES = ['owner', 'admin', 'ops', 'finance', 'dispatcher', 'driver', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export interface OrgSummary {
  id: string;
  kind: OrgKind;
  name: string;
  status: OrgStatus;
}

export interface Membership {
  org: OrgSummary;
  role: OrgRole;
}

export interface OrgContext {
  /** False until the organisations migration has run: nothing is scoped or stamped. */
  configured: boolean;
  org: OrgSummary | null;
  role: OrgRole | null;
  memberships: Membership[];
  isPlatformAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      /** The organisation the caller acts for (docs/tenancy-design.md §5); null when they belong to none. */
      org?: OrgSummary | null;
      orgRole?: OrgRole | null;
      memberships?: Membership[];
      isPlatformAdmin?: boolean;
    }
  }
}

const CACHE_TTL_MS = 60 * 1000;
const NO_ORG_ID = '00000000-0000-0000-0000-000000000000';
const KIND_ORDER: OrgKind[] = ['logistic_company', 'tpl_partner', 'vendor', 'platform'];

/** Whether the default company exists (the organisations migration has run). Checked at most every 30 s. */
const orgsConfigured = memoize(30_000, async (): Promise<boolean> => {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', 'default_company_org_id').maybeSingle();
  if (error) throw new Error(`Organisation settings lookup failed: ${error.message}`);
  const id = (data?.value as { value?: unknown } | null)?.value;
  return typeof id === 'string' && id.length > 0;
});

const membershipCache = new Map<string, { memberships: Membership[]; expiresAt: number }>();
registerClearable({ clear: () => membershipCache.clear() });

/** Drop a user's cached memberships (after a membership or organisation change); no argument drops everyone's. */
export function invalidateOrgContext(userId?: string): void {
  if (userId) membershipCache.delete(userId);
  else membershipCache.clear();
}

type MembershipRow = { role: string; organizations: OrgSummary | OrgSummary[] | null };

function sortMemberships(list: Membership[]): Membership[] {
  return [...list].sort((a, b) =>
    KIND_ORDER.indexOf(a.org.kind) - KIND_ORDER.indexOf(b.org.kind) || a.org.name.localeCompare(b.org.name) || a.org.id.localeCompare(b.org.id));
}

/** The user's active memberships, whatever the organisation's status (a pending organisation still sees itself). */
export async function loadMemberships(userId: string): Promise<Membership[]> {
  const cached = membershipCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.memberships;
  const { data, error } = await supabase
    .from('org_members')
    .select('role, organizations(id, kind, name, status)')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw new Error(`Membership lookup failed: ${error.message}`);
  const memberships: Membership[] = [];
  for (const row of (data ?? []) as unknown as MembershipRow[]) {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (org) memberships.push({ org, role: row.role as OrgRole });
  }
  const sorted = sortMemberships(memberships);
  membershipCache.set(userId, { memberships: sorted, expiresAt: Date.now() + CACHE_TTL_MS });
  return sorted;
}

/** The active organisation among `memberships`: the requested one, else the only one, else the first company. */
export function pickActive(memberships: Membership[], requested?: string): Membership | null {
  if (requested) {
    const match = memberships.find(m => m.org.id === requested.toLowerCase());
    if (!match) throw new HttpError(403, 'You are not a member of that organisation.');
    return match;
  }
  if (memberships.length <= 1) return memberships[0] ?? null;
  return memberships.find(m => m.org.kind === 'logistic_company' && m.org.status === 'active') ?? memberships[0];
}

export const isPlatformAdminOf = (memberships: Membership[]): boolean =>
  memberships.some(m => m.org.kind === 'platform' && m.org.status === 'active' && (m.role === 'owner' || m.role === 'admin'));

/** The X-Org-Id header: a uuid, or nothing. */
function requestedOrg(req: Request): string | undefined {
  const raw = req.headers['x-org-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') return undefined;
  if (!isUuid(value)) throw new HttpError(400, 'X-Org-Id is not valid.');
  return value;
}

/**
 * Resolve the caller's organisation context and attach it to the request. Customers sign in on their own
 * (they are not organisation members yet) and are left without one. Throws HttpError(403) for an X-Org-Id the
 * caller is not a member of.
 */
export async function attachOrgContext(req: Request, userId: string, role: string): Promise<OrgContext> {
  const none: OrgContext = { configured: false, org: null, role: null, memberships: [], isPlatformAdmin: false };
  let ctx = none;
  if (role !== 'customer' && (await orgsConfigured())) {
    const memberships = await loadMemberships(userId);
    const active = pickActive(memberships, requestedOrg(req));
    ctx = { configured: true, org: active?.org ?? null, role: active?.role ?? null, memberships, isPlatformAdmin: isPlatformAdminOf(memberships) };
  }
  req.org = ctx.org;
  req.orgRole = ctx.role;
  req.memberships = ctx.memberships;
  req.isPlatformAdmin = ctx.isPlatformAdmin;
  setRequestOrg(ctx);
  return ctx;
}

/** Whether this request is for an organisation that may not work any more (suspended or rejected). */
export function isOrgBlocked(ctx: OrgContext): boolean {
  return !!ctx.org && ctx.org.kind !== 'platform' && (ctx.org.status === 'suspended' || ctx.org.status === 'rejected');
}

/** The organisation context of the request being handled, if there is one. */
export function currentOrgContext(): OrgContext | undefined {
  return getRequestOrg<OrgContext>();
}

/** carrier_org_id for a row the active organisation creates (a logistic company or a 3PL partner). */
export function carrierStamp(): { carrier_org_id?: string } {
  const org = currentOrgContext()?.org;
  return org && (org.kind === 'logistic_company' || org.kind === 'tpl_partner') ? { carrier_org_id: org.id } : {};
}

/**
 * vendor_org_id for a row made for the vendor `userId` (their request, bid, claim or invoice): the vendor
 * organisation the request is acting as, else the first vendor organisation the user belongs to.
 */
export async function vendorOrgOf(userId: string | null | undefined): Promise<{ vendor_org_id?: string }> {
  if (!userId || !(await orgsConfigured())) return {};
  const memberships = await loadMemberships(userId);
  const acting = currentOrgContext()?.org;
  const match = (acting?.kind === 'vendor' ? memberships.find(m => m.org.id === acting.id) : undefined) ?? memberships.find(m => m.org.kind === 'vendor');
  return match ? { vendor_org_id: match.org.id } : {};
}

/** issuer_org_id for an invoice the active company issues. */
export function issuerStamp(): { issuer_org_id?: string } {
  const org = currentOrgContext()?.org;
  return org && (org.kind === 'logistic_company' || org.kind === 'tpl_partner') ? { issuer_org_id: org.id } : {};
}

/** The owner columns a row already has, for a child row to inherit (a lot of a shipment, a manifest of a request). */
export function ownersOf(row: Record<string, any> | null | undefined): { carrier_org_id?: string; vendor_org_id?: string } {
  const out: { carrier_org_id?: string; vendor_org_id?: string } = {};
  if (row?.carrier_org_id) out.carrier_org_id = row.carrier_org_id;
  if (row?.vendor_org_id) out.vendor_org_id = row.vendor_org_id;
  return out;
}

// ── What handlers use ───────────────────────────────────────

/** The organisation the caller acts for; a 403 when they belong to none. */
export function requireOrg(req: Request): OrgSummary {
  if (!req.org) throw new HttpError(403, 'You are not a member of an organisation.');
  return req.org;
}

/**
 * The logistic company the caller acts for: the active organisation's id when it is a logistic company, else null
 * (the platform, a vendor, a 3PL partner, no organisation, or organisations not set up yet).
 */
export function companyIdFor(req: Request): string | null {
  return req.org?.kind === 'logistic_company' ? req.org.id : null;
}

/** Whether the caller is an owner or admin of the organisation they act for. */
export function isOrgAdmin(req: Request): boolean {
  return !!req.org && (req.orgRole === 'owner' || req.orgRole === 'admin');
}

/** Middleware: only platform admins (owner or admin of the platform organisation) pass. Runs after requireAuth. */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isPlatformAdmin) {
    res.status(403).json({ detail: 'Platform admins only' });
    return;
  }
  next();
}
