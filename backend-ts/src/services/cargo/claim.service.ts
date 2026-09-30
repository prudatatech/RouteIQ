/**
 * margixindia — Cargo claims: damage, shortage, loss, theft and delay
 *
 *   draft ──▶ filed ──▶ surveyed ──▶ approved ──▶ settled
 *                 │           └────▶ rejected
 *                 └──────────────────▶ approved | rejected
 *   withdrawn from draft, filed or surveyed
 *
 * Staff raise claims on any consignment (as a draft); a customer on their own delivered or
 * returned shipment, and a vendor on their own delivered, partly delivered, returned or lost load,
 * both within CUSTOMER_CLAIM_DAYS of delivery, file them directly. The declared value comes from shipment_hsn (or the vendor's declared value).
 * Documents are uploaded straight to private storage with signed URLs, like proof of delivery.
 */
import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { settings } from '../../core/config';
import { isStaff, canAccessManifest } from '../../core/ownership';
import type { TokenData } from '../../core/auth';
import { createKycUploadUrl, signedUrl } from '../pod.service';
import { manifestParcelCode } from '../../core/parcelCode';
import { RefSchema, customerOwnsShipment, manifestVendorId, refColumns, resolveRef, type Actor, type Consignment } from './consignment';
import { insertWithCode } from './exception.service';
import { notifyStaffSafe, notifyUserSafe, ownerRefs } from './notify';

export const CLAIM_TYPES = ['damage', 'shortage', 'loss', 'theft', 'delay'] as const;
export const CLAIM_STATUSES = ['draft', 'filed', 'surveyed', 'approved', 'rejected', 'settled', 'withdrawn'] as const;
/** Days after delivery (or return) within which a customer can raise a claim. */
export const CUSTOMER_CLAIM_DAYS = 7;

export const CLAIM_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['filed', 'withdrawn'],
  filed: ['surveyed', 'approved', 'rejected', 'withdrawn'],
  surveyed: ['approved', 'rejected', 'withdrawn'],
  approved: ['settled'],
  rejected: [],
  settled: [],
  withdrawn: [],
};

/** A customer claims only on goods that reached the end of their trip. */
const CUSTOMER_CLAIMABLE = ['delivered', 'returned', 'partially_delivered', 'lost'];
const CLOSED = ['rejected', 'settled', 'withdrawn'];

const CLAIM_COLUMNS =
  'id, code, exception_id, shipment_id, manifest_id, claim_type, declared_value, claimed_amount, approved_amount, settled_amount, status, raised_by_role, raised_by, ' +
  'insurer, policy_number, fir_number, surveyor_name, survey_date, document_paths, notes, created_at, updated_at, settled_at';

const amount = z.number().min(0).max(1_000_000_000);

export const CreateClaimSchema = z.object({
  exception_id: z.string().uuid().nullable().optional(),
  ref: RefSchema,
  claim_type: z.enum(CLAIM_TYPES),
  claimed_amount: amount.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const UpdateClaimSchema = z.object({
  status: z.enum(CLAIM_STATUSES).optional(),
  insurer: z.string().trim().max(120).nullable().optional(),
  policy_number: z.string().trim().max(80).nullable().optional(),
  fir_number: z.string().trim().max(80).nullable().optional(),
  surveyor_name: z.string().trim().max(120).nullable().optional(),
  survey_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'survey_date must be YYYY-MM-DD').nullable().optional(),
  claimed_amount: amount.nullable().optional(),
  approved_amount: amount.nullable().optional(),
  settled_amount: amount.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' });

type ClaimRole = 'staff' | 'customer' | 'vendor';

function claimRole(role: string): ClaimRole {
  if (['admin', 'manager', 'superadmin'].includes(role)) return 'staff';
  if (role === 'customer' || role === 'vendor') return role;
  throw new HttpError(403, 'Only staff, customers and vendors raise claims');
}

/** What the goods were declared worth: the HSN lines of a shipment, or the vendor's declared value for a load. */
export async function declaredValueOf(c: Consignment): Promise<number | null> {
  // A lot carries its share of the value (docs/cargo-plan.md, Lots); so may any consignment
  if (c.row.declared_value != null && Number.isFinite(Number(c.row.declared_value))) return Number(c.row.declared_value);
  if (c.kind === 'shipment') {
    const { data } = await supabase.from('shipment_hsn').select('declared_value').eq('shipment_id', c.id);
    const values = (data ?? []).map((r: any) => Number(r.declared_value)).filter(n => Number.isFinite(n));
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  }
  if (!c.row.vendor_request_id) return null;
  const { data } = await supabase.from('vendor_shipment_requests').select('metadata').eq('id', c.row.vendor_request_id).maybeSingle();
  const raw = data?.metadata?.cargo?.declaredValue;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[,₹\s]/g, '')) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** When the goods reached the end of their trip: the latest delivery, return or loss on record. */
export async function deliveredAt(c: Consignment): Promise<string | null> {
  const column = c.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const { data: events } = await supabase.from('cargo_custody_events').select('kind, recorded_at').eq(column, c.id).in('kind', ['delivery', 'partial_delivery', 'return_delivery', 'lost']);
  const latest = (events ?? []).map((e: any) => String(e.recorded_at)).sort().pop();
  if (latest) return latest;
  if (c.kind === 'shipment') {
    const { data: logs } = await supabase.from('shipment_logs').select('status, timestamp').eq('shipment_id', c.id).in('status', CUSTOMER_CLAIMABLE);
    const logged = (logs ?? []).map((l: any) => String(l.timestamp)).sort().pop();
    if (logged) return logged;
  }
  return c.row.updated_at ?? null;
}

/** Custody events that mean the goods reached the end of their trip, wholly or in part, or were lost. */
const CLAIMABLE_EVENTS = ['delivery', 'partial_delivery', 'return_delivery', 'lost'];

export interface ClaimWindow {
  allowed: boolean;
  /** Why not, in words for the vendor. Null when allowed. */
  reason: string | null;
  /** The last moment a claim can be raised (CUSTOMER_CLAIM_DAYS after delivery), or null before delivery. */
  until: string | null;
}

/**
 * Whether a vendor can raise a claim on one of their loads now: it must be delivered, partly
 * delivered, returned or lost (a status, or a delivery, return or loss on its custody record), and
 * within CUSTOMER_CLAIM_DAYS of that. A load still on the road can not be claimed on.
 */
export async function vendorClaimWindow(c: Consignment): Promise<ClaimWindow> {
  const column = c.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const { data: events } = await supabase.from('cargo_custody_events').select('kind').eq(column, c.id).in('kind', CLAIMABLE_EVENTS).limit(1);
  const reached = CUSTOMER_CLAIMABLE.includes(c.status) || (events ?? []).length > 0;
  if (!reached) {
    return { allowed: false, reason: 'A claim can be raised once your load is delivered, partly delivered or lost.', until: null };
  }
  const at = await deliveredAt(c);
  const until = at ? new Date(Date.parse(at) + CUSTOMER_CLAIM_DAYS * 86_400_000).toISOString() : null;
  if (until && Date.now() > Date.parse(until)) {
    return { allowed: false, reason: `Claims can be raised within ${CUSTOMER_CLAIM_DAYS} days of delivery. Please contact support.`, until };
  }
  return { allowed: true, reason: null, until };
}

/** Whether the caller may see or add to a claim. */
async function assertClaimAccess(user: TokenData, claim: any): Promise<void> {
  if (isStaff(user)) return;
  if (claim.raised_by === user.user_id) return;
  if (user.role === 'customer' && claim.shipment_id && (await customerOwnsShipment(user.user_id, claim.shipment_id))) return;
  if (user.role === 'vendor' && claim.manifest_id && (await manifestVendorId(claim.manifest_id)) === user.user_id) return;
  throw new HttpError(404, 'Claim not found');
}

export async function createClaim(input: unknown, actor: Actor): Promise<any> {
  const parsed = CreateClaimSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const body = parsed.data;
  const role = claimRole(actor.role);
  const c = await resolveRef(body.ref);

  if (role === 'customer') {
    if (c.kind !== 'shipment' || !(await customerOwnsShipment(actor.id, c.id))) throw new HttpError(404, 'Consignment not found');
    if (!CUSTOMER_CLAIMABLE.includes(c.status)) throw new HttpError(409, 'A claim can be raised once your goods are delivered or returned.');
    const at = await deliveredAt(c);
    if (at && Date.now() - Date.parse(at) > CUSTOMER_CLAIM_DAYS * 86_400_000) {
      throw new HttpError(409, `Claims can be raised within ${CUSTOMER_CLAIM_DAYS} days of delivery. Please contact support.`);
    }
  }
  if (role === 'vendor') {
    if (c.kind !== 'manifest' || !(await canAccessManifest({ user_id: actor.id, role: 'vendor' } as TokenData, c.id))) throw new HttpError(404, 'Consignment not found');
    const window = await vendorClaimWindow(c);
    if (!window.allowed) throw new HttpError(409, window.reason ?? 'A claim can not be raised on this load.');
  }
  if (body.exception_id) {
    const { data: item } = await supabase
      .from('cargo_exception_items').select('id').eq('exception_id', body.exception_id).eq(c.kind === 'shipment' ? 'shipment_id' : 'manifest_id', c.id).limit(1);
    if (!item || item.length === 0) throw new HttpError(400, 'That case does not include this consignment');
  }

  // One open claim of a type per consignment
  const { data: existing } = await supabase
    .from('cargo_claims').select('id, code, status, claim_type').eq(c.kind === 'shipment' ? 'shipment_id' : 'manifest_id', c.id).eq('claim_type', body.claim_type);
  const open = (existing ?? []).find((r: any) => !CLOSED.includes(r.status));
  if (open) throw new HttpError(409, `Claim ${open.code} for ${body.claim_type} is already open on these goods.`, { claim_id: open.id });

  const now = new Date().toISOString();
  const claim = await insertWithCode('cargo_claims', 'CLM', {
    exception_id: body.exception_id ?? null,
    ...refColumns(c),
    claim_type: body.claim_type,
    declared_value: await declaredValueOf(c),
    claimed_amount: body.claimed_amount ?? null,
    status: role === 'staff' ? 'draft' : 'filed',
    raised_by_role: role,
    raised_by: actor.id,
    document_paths: [],
    notes: body.notes ?? null,
    created_at: now,
    updated_at: now,
  }, CLAIM_COLUMNS);

  const by = role === 'staff' ? 'staff' : `the ${role}`;
  await notifyStaffSafe(`Claim ${claim.code} ${claim.status === 'draft' ? 'drafted' : 'filed'}`, `${body.claim_type} claim on ${c.code} by ${by}${body.claimed_amount != null ? ` for ₹${body.claimed_amount.toLocaleString('en-IN')}` : ''}.`, 'cargo_claim_update', { claim_id: claim.id, code: claim.code });
  return claimView(claim);
}

/** Claims in list form: the tracking ids of the shipments are read in one query, not one per claim. */
async function claimViews(claims: any[]) {
  const ids = [...new Set(claims.filter(c => !c.manifest_id && c.shipment_id).map(c => String(c.shipment_id)))];
  const codes = new Map<string, string>();
  for (const part of chunks(ids, ID_CHUNK)) {
    const { data, error } = await supabase.from('shipments').select('id, tracking_id').in('id', part);
    if (error) throw new Error(`Failed to read the shipments: ${error.message}`);
    for (const r of data ?? []) codes.set(String(r.id), r.tracking_id);
  }
  return Promise.all(claims.map(c => claimView(c, c.manifest_id ? undefined : codes.get(String(c.shipment_id)) ?? null)));
}

async function claimView(claim: any, code?: string | null) {
  const documents = [];
  for (const path of (claim.document_paths ?? []) as string[]) {
    const url = await signedUrl(path);
    if (url) documents.push({ path, url });
  }
  return { ...claim, consignment_code: code !== undefined ? code : await consignmentCode(claim), documents };
}

/** The RTX- tracking id or CM- load code of the claimed goods, so lists can show them without another read. */
async function consignmentCode(claim: { shipment_id?: string | null; manifest_id?: string | null }): Promise<string | null> {
  if (claim.manifest_id) return manifestParcelCode(claim.manifest_id);
  if (!claim.shipment_id) return null;
  const { data } = await supabase.from('shipments').select('tracking_id').eq('id', claim.shipment_id).maybeSingle();
  return data?.tracking_id ?? null;
}

async function loadClaim(id: string): Promise<any> {
  const { data, error } = await supabase.from('cargo_claims').select(CLAIM_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the claim: ${error.message}`);
  if (!data) throw new HttpError(404, 'Claim not found');
  return data;
}

const DOC_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
export const MAX_CLAIM_DOCUMENTS = 20;

/**
 * A signed upload URL for one claim document (photo or PDF). The path, inside the claim's own
 * folder, is recorded on the claim so staff see it once the file is there.
 */
export async function claimDocumentUploadUrl(id: string, input: { content_type?: unknown; size?: unknown }, user: TokenData) {
  const claim = await loadClaim(id);
  await assertClaimAccess(user, claim);
  if (CLOSED.includes(claim.status)) throw new HttpError(409, `This claim is ${claim.status}.`);
  const paths: string[] = claim.document_paths ?? [];
  if (paths.length >= MAX_CLAIM_DOCUMENTS) throw new HttpError(409, `A claim holds at most ${MAX_CLAIM_DOCUMENTS} documents.`);
  const extension = typeof input.content_type === 'string' ? DOC_TYPES[input.content_type.toLowerCase()] : undefined;
  if (!extension) throw new HttpError(415, 'Upload a JPG, PNG or PDF');
  const bytes = Number(input.size);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
  if (bytes > settings.CLAIM_DOCUMENT_MAX_BYTES) throw new HttpError(413, `Files must be at most ${Math.floor(settings.CLAIM_DOCUMENT_MAX_BYTES / 1024 / 1024)} MB`);
  const upload = await createKycUploadUrl(`claims/${claim.id}/${crypto.randomUUID()}.${extension}`);
  const { data: saved } = await supabase
    .from('cargo_claims').update({ document_paths: [...paths, upload.path], updated_at: new Date().toISOString() })
    .eq('id', claim.id).eq('updated_at', claim.updated_at).select('id').maybeSingle();
  if (!saved) throw new HttpError(409, 'This claim was just changed. Try again.');
  return upload;
}

export async function updateClaim(id: string, input: unknown): Promise<any> {
  const parsed = UpdateClaimSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const { status, ...fields } = parsed.data;
  const claim = await loadClaim(id);
  const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
  if (status && status !== claim.status) {
    if (!(CLAIM_TRANSITIONS[claim.status] ?? []).includes(status)) {
      throw new HttpError(409, `This claim is ${claim.status} and can't be changed to ${status}.`);
    }
    const approved = fields.approved_amount ?? claim.approved_amount;
    const settled = fields.settled_amount ?? claim.settled_amount;
    if (status === 'approved' && approved == null) throw new HttpError(400, 'Enter the approved amount');
    if (status === 'settled') {
      if (settled == null) throw new HttpError(400, 'Enter the settled amount');
      patch.settled_at = new Date().toISOString();
    }
    if (status === 'surveyed' && !(fields.surveyor_name ?? claim.surveyor_name)) throw new HttpError(400, 'Enter the surveyor');
    patch.status = status;
  } else if (CLOSED.includes(claim.status)) {
    throw new HttpError(409, `This claim is ${claim.status}.`);
  }
  const { data, error } = await supabase
    .from('cargo_claims').update(patch).eq('id', id).eq('status', claim.status).select(CLAIM_COLUMNS).maybeSingle();
  if (error) throw new Error(`Failed to update the claim: ${error.message}`);
  if (!data) throw new HttpError(409, 'This claim was just changed by someone else. Refresh and try again.');
  const saved = data as any;

  if (patch.status && claim.raised_by_role !== 'staff') {
    const money = (n: unknown) => (n == null ? '' : `: ₹${Number(n).toLocaleString('en-IN')}`);
    const text: Record<string, string> = {
      filed: `Your claim ${claim.code} has been filed.`,
      surveyed: `A surveyor has assessed your claim ${claim.code}.`,
      approved: `Your claim ${claim.code} was approved${money(saved.approved_amount)}.`,
      rejected: `Your claim ${claim.code} was not approved.${saved.notes ? ` ${saved.notes}` : ''}`,
      settled: `Your claim ${claim.code} was settled${money(saved.settled_amount)}.`,
      withdrawn: `Your claim ${claim.code} was withdrawn.`,
    };
    const refs = (await ownerRefs(claim))?.ids ?? {};
    const consignment = await resolveRef(claim.manifest_id ? { manifest_id: claim.manifest_id } : { shipment_id: claim.shipment_id }).catch(() => null);
    await notifyUserSafe(claim.raised_by, `Claim ${claim.code} update`, text[String(patch.status)] ?? `Your claim ${claim.code} is now ${patch.status}.`, 'cargo_claim_update', { ...refs, claim_id: claim.id, code: claim.code, consignment_code: consignment?.code ?? null, status: patch.status });
  }
  return claimView(saved);
}

export const CLAIM_PAGE_DEFAULT = 50;
export const CLAIM_PAGE_MAX = 200;
/** Ids per `in.(...)` filter: keeps each request URL well under the gateway's limit. */
const ID_CHUNK = 100;
const ROW_PAGE = 1000;

export interface ClaimListFilters {
  status?: string;
  ref?: string;
  limit?: string | number;
  cursor?: string;
}

export interface ClaimPage {
  items: any[];
  next_cursor: string | null;
}

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Every row of a query, read in pages so a long list is not cut at the API's row cap. */
async function readAll(build: () => any, what: string): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += ROW_PAGE) {
    const { data, error } = await build().range(from, from + ROW_PAGE - 1);
    if (error) throw new Error(`Failed to read ${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < ROW_PAGE) return rows;
  }
}

/** ids of `table` whose `column` is one of `values`, read in chunks. */
async function idsWhereIn(table: string, column: string, values: string[], what: string): Promise<string[]> {
  const found = await Promise.all(chunks(values, ID_CHUNK).map(part => readAll(() => supabase.from(table).select('id').in(column, part).order('id'), what)));
  return found.flat().map(r => String(r.id));
}

/**
 * The claims a customer or vendor may see, as PostgREST `or` filters (one per chunk of ids, so no
 * request grows with the account). A customer: claims on their booked shipments and on those
 * shipments' lots; a vendor: claims on their loads and those loads' lots. Both also see claims
 * they raised themselves.
 */
async function claimScopes(user: TokenData): Promise<string[]> {
  const own = `raised_by.eq.${user.user_id}`;
  let column: 'shipment_id' | 'manifest_id';
  let ids: string[];
  if (user.role === 'customer') {
    column = 'shipment_id';
    const bookings = await readAll(() => supabase.from('customer_bookings').select('id, shipment_id').eq('customer_id', user.user_id).not('shipment_id', 'is', null).order('id'), 'the bookings');
    const masters = bookings.map(b => String(b.shipment_id));
    ids = [...new Set([...masters, ...(await idsWhereIn('shipments', 'parent_shipment_id', masters, 'the lots'))])];
  } else if (user.role === 'vendor') {
    column = 'manifest_id';
    const requests = (await readAll(() => supabase.from('vendor_shipment_requests').select('id').eq('vendor_id', user.user_id).order('id'), 'the requests')).map(r => String(r.id));
    const loads = await idsWhereIn('cargo_manifest', 'vendor_request_id', requests, 'the loads');
    ids = [...new Set([...loads, ...(await idsWhereIn('cargo_manifest', 'parent_manifest_id', loads, 'the lots'))])];
  } else {
    throw new HttpError(403, 'Not authorized');
  }
  const scopes = chunks(ids, ID_CHUNK).map(part => `${column}.in.(${part.join(',')})`);
  // The claims they raised themselves ride along with the first chunk
  return scopes.length > 0 ? [`${own},${scopes[0]}`, ...scopes.slice(1)] : [own];
}

/** created_at as a sortable number, microseconds included (Postgres trims trailing zeros, so strings do not sort). */
function stampOf(value: unknown): number {
  const text = String(value);
  const micros = /\.(\d+)/.exec(text)?.[1]?.padEnd(6, '0').slice(3, 6) ?? '0';
  return Date.parse(text) * 1000 + Number(micros);
}

const newestFirst = (a: any, b: any) => stampOf(b.created_at) - stampOf(a.created_at) || String(b.id).localeCompare(String(a.id));

export function encodeClaimCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.created_at, row.id])).toString('base64url');
}

function decodeClaimCursor(cursor: string): { created_at: string; id: string } {
  try {
    const [created_at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof created_at === 'string' && Number.isFinite(Date.parse(created_at)) && typeof id === 'string' && z.string().uuid().safeParse(id).success) return { created_at, id };
  } catch { /* falls through */ }
  throw new HttpError(400, 'cursor is not valid');
}

/**
 * One page of claims, newest first. Staff read every claim; a customer or vendor only their own,
 * chosen in the database query. `next_cursor` (created_at, id) continues after the last item.
 */
export async function listClaims(filters: ClaimListFilters, user: TokenData): Promise<ClaimPage> {
  const rawLimit = filters.limit == null || filters.limit === '' ? CLAIM_PAGE_DEFAULT : Number(filters.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) throw new HttpError(400, 'limit must be a whole number of at least 1');
  const limit = Math.min(rawLimit, CLAIM_PAGE_MAX);
  if (filters.status && !(CLAIM_STATUSES as readonly string[]).includes(filters.status)) throw new HttpError(400, `status must be one of: ${CLAIM_STATUSES.join(', ')}`);
  const cursor = filters.cursor ? decodeClaimCursor(filters.cursor) : null;
  const ref = filters.ref ? await resolveRef(filters.ref) : null;
  const scopes: Array<string | null> = isStaff(user) ? [null] : await claimScopes(user);

  const pages = await Promise.all(scopes.map(async scope => {
    let q = supabase.from('cargo_claims').select(CLAIM_COLUMNS);
    if (scope) q = q.or(scope);
    if (filters.status) q = q.eq('status', filters.status);
    if (ref) q = q.eq(ref.kind === 'shipment' ? 'shipment_id' : 'manifest_id', ref.id);
    if (cursor) q = q.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`);
    const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (error) throw new Error(`Failed to list claims: ${error.message}`);
    return (data ?? []) as any[];
  }));

  const merged = [...new Map(pages.flat().map(c => [c.id, c])).values()].sort(newestFirst);
  const more = merged.length > limit;
  const rows = merged.slice(0, limit);
  return {
    items: await claimViews(rows),
    next_cursor: more ? encodeClaimCursor(rows[rows.length - 1]) : null,
  };
}

export async function getClaim(id: string, user: TokenData) {
  const claim = await loadClaim(id);
  await assertClaimAccess(user, claim);
  return claimView(claim);
}

/**
 * Claims on a booking's master and on each of its lots, in the short form the customer view
 * shows. Each carries `lot_code`: the lot's code, or null for a claim on the master itself.
 */
export async function claimsForBooking(master: { id: string }, lots: Array<{ id: string; code: string }>) {
  const { data, error } = await supabase
    .from('cargo_claims').select('id, code, shipment_id, claim_type, status, claimed_amount, approved_amount, settled_amount, created_at, updated_at, settled_at')
    .in('shipment_id', [master.id, ...lots.map(l => l.id)]).order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error) throw new Error(`Failed to read the claims: ${error.message}`);
  const codes = new Map(lots.map(l => [l.id, l.code]));
  return ((data ?? []) as any[]).map(c => ({ ...c, lot_code: codes.get(c.shipment_id) ?? null }));
}
