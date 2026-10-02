/**
 * margixindia — Read scoping by organisation (docs/tenancy-design.md §5, Phase 1)
 *
 * One helper for every list and detail read: a logistic company (or 3PL partner) sees the rows whose
 * carrier column is its id, a vendor the rows whose vendor column is its id, and a platform admin acting as
 * the platform sees everything. A caller who belongs to no organisation sees nothing; so does an
 * organisation asking for a table that has no column for its kind.
 *
 * The active organisation comes from the request being handled (core/org-context.ts), so services use this
 * without being handed the request. Outside a request (the scheduler) and before the organisations
 * migration has run nothing is scoped, so today's single-company data reads exactly as before.
 *
 *   scopeQuery(supabase.from('vehicles').select('*'), { carrier: 'carrier_org_id' })
 *   scopeQuery(q, { carrier: 'issuer_org_id', vendor: 'bill_to_org_id' })   // invoices
 *   await assertVisible('invoices', id, { carrier: 'issuer_org_id', vendor: 'bill_to_org_id' }, 'Invoice not found')
 */
import { supabase } from './supabase';
import { HttpError } from './errors';
import { currentOrgContext, type OrgContext } from './org-context';

/** The owner columns of a table, per kind of organisation. */
export interface OwnerColumns {
  /** The logistic company (or 3PL partner) running the row. `null`: companies are not limited (a request open to every company). */
  carrier?: string | null;
  /** The vendor the row is for. */
  vendor?: string;
}

/** An id no row has: a filter on it matches nothing. */
const NO_ORG_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The filter that limits a read to the active organisation: `{ column, id }`, or null for no limit.
 * With nothing to match on (no organisation, or no column for its kind) the filter is one that matches no row.
 */
export function orgFilter(cols: OwnerColumns): { column: string; id: string } | null {
  const ctx = currentOrgContext();
  if (!ctx || !ctx.configured) return null;
  const fallback = cols.carrier ?? cols.vendor;
  if (!fallback) return null;
  const nothing = { column: fallback, id: NO_ORG_ID };
  if (cols.carrier === null && ctx.org && ctx.org.kind !== 'vendor' && ctx.org.kind !== 'platform') return null;
  const org = ctx.org;
  if (!org) return nothing;
  switch (org.kind) {
    case 'platform': return ctx.isPlatformAdmin ? null : nothing;
    case 'vendor': return cols.vendor ? { column: cols.vendor, id: org.id } : nothing;
    default: return cols.carrier ? { column: cols.carrier, id: org.id } : nothing;
  }
}

/** Whether reads of a table with these owner columns are limited for the active organisation. */
export const isScoped = (cols: OwnerColumns): boolean => orgFilter(cols) !== null;

/** Limit a query to the active organisation's rows (see the file header). Returns the query it was given. */
export function scopeQuery<Q>(query: Q, cols: OwnerColumns): Q {
  const f = orgFilter(cols);
  return f ? (query as unknown as { eq(c: string, v: string): Q }).eq(f.column, f.id) : query;
}

/**
 * A 404 (never a 403, so ids cannot be probed) unless the row `table.id` belongs to the active organisation.
 * Costs nothing when nothing is scoped.
 */
export async function assertVisible(table: string, id: string, cols: OwnerColumns, notFound: string, idColumn = 'id'): Promise<void> {
  if (!orgFilter(cols)) return;
  const { data, error } = await scopeQuery(supabase.from(table).select(idColumn).eq(idColumn, id), cols).maybeSingle();
  if (error) throw new Error(`Failed to check ${table}: ${error.message}`);
  if (!data) throw new HttpError(404, notFound);
}

/**
 * The organisation whose members a people list is limited to (any kind of organisation), or null for no limit
 * (before the migration, outside a request, or a platform admin acting as the platform).
 */
export function memberOrgId(): string | null {
  const ctx = currentOrgContext();
  if (!ctx || !ctx.configured) return null;
  if (!ctx.org) return NO_ORG_ID;
  if (ctx.org.kind === 'platform') return ctx.isPlatformAdmin ? null : NO_ORG_ID;
  return ctx.org.id;
}

/** A short key for caches that hold lists, so one organisation's list is never served to another. */
export function scopeKey(cols: OwnerColumns = { carrier: 'x' }): string {
  const f = orgFilter(cols);
  return f ? f.id : 'all';
}

/** Column sets for the tables scoped in Phase 1. */
export const OWNED = {
  carrier: { carrier: 'carrier_org_id' } as OwnerColumns,
  carrierAndVendor: { carrier: 'carrier_org_id', vendor: 'vendor_org_id' } as OwnerColumns,
  invoice: { carrier: 'issuer_org_id', vendor: 'bill_to_org_id' } as OwnerColumns,
};

/**
 * The company whose live events a staff connection receives: its id, or null for every company's
 * (a platform admin acting as the platform, or organisations not set up yet). Someone in no organisation
 * gets an id no event carries.
 */
export function feedScope(ctx: OrgContext): string | null {
  if (!ctx.configured) return null;
  if (!ctx.org) return NO_ORG_ID;
  if (ctx.org.kind === 'platform') return ctx.isPlatformAdmin ? null : NO_ORG_ID;
  return ctx.org.id;
}
