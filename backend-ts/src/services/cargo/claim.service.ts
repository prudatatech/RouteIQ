/**
 * margixindia — Cargo claims: damage, shortage, loss, theft and delay
 *
 *   draft ──▶ filed ──▶ surveyed ──▶ approved ──▶ settled
 *                 │           └────▶ rejected
 *                 └──────────────────▶ approved | rejected
 *   withdrawn from draft, filed or surveyed
 *
 * Staff raise claims on any consignment (as a draft); a customer on their own delivered or
 * returned shipment within CUSTOMER_CLAIM_DAYS of delivery, and a vendor on their own load, file
 * them directly. The declared value comes from shipment_hsn (or the vendor's declared value).
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
import { notifyStaffSafe, notifyUserSafe } from './notify';

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

async function claimView(claim: any) {
  const documents = [];
  for (const path of (claim.document_paths ?? []) as string[]) {
    const url = await signedUrl(path);
    if (url) documents.push({ path, url });
  }
  return { ...claim, consignment_code: await consignmentCode(claim), documents };
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
    await notifyUserSafe(claim.raised_by, `Claim ${claim.code} update`, text[String(patch.status)] ?? `Your claim ${claim.code} is now ${patch.status}.`, 'cargo_claim_update', { claim_id: claim.id, code: claim.code, status: patch.status });
  }
  return claimView(saved);
}

export async function listClaims(filters: { status?: string; ref?: string }, user: TokenData): Promise<any[]> {
  let q = supabase.from('cargo_claims').select(CLAIM_COLUMNS).order('created_at', { ascending: false }).limit(300);
  if (filters.status) {
    if (!(CLAIM_STATUSES as readonly string[]).includes(filters.status)) throw new HttpError(400, `status must be one of: ${CLAIM_STATUSES.join(', ')}`);
    q = q.eq('status', filters.status);
  }
  if (filters.ref) {
    const c = await resolveRef(filters.ref);
    q = q.eq(c.kind === 'shipment' ? 'shipment_id' : 'manifest_id', c.id);
  }
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list claims: ${error.message}`);
  const out = [];
  for (const claim of data ?? []) {
    if (!isStaff(user)) {
      try {
        await assertClaimAccess(user, claim);
      } catch {
        continue;
      }
    }
    out.push(await claimView(claim));
  }
  return out;
}

export async function getClaim(id: string, user: TokenData) {
  const claim = await loadClaim(id);
  await assertClaimAccess(user, claim);
  return claimView(claim);
}

/** Claims on one consignment, in the short form the customer view shows. */
export async function claimsFor(c: { kind: 'shipment' | 'manifest'; id: string }) {
  const { data } = await supabase
    .from('cargo_claims').select('id, code, claim_type, status, claimed_amount, approved_amount, settled_amount, created_at, settled_at')
    .eq(c.kind === 'shipment' ? 'shipment_id' : 'manifest_id', c.id);
  return data ?? [];
}
