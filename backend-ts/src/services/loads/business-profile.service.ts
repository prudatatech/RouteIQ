/**
 * margixindia — The vendor's business profile (docs/load-posting-design.md section 9).
 *
 * Stored on the vendor organisation (name, gstin, address, pincode, state, email, and profile.account_type /
 * business_type / monthly_loads / contact_name) and mirrored to vendor_profiles (company_name, gst_number, address,
 * city) so the older screens and the KYC flow see the same business. GSTIN is required for a business partner and is
 * checked with gstinService.verify.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { GST_STATES } from '../../core/gst';
import { gstinService } from '../gstin.service';
import type { BusinessProfileInput } from '../../schemas/loads';
import type { Caller } from './loads.service';

export interface BusinessProfile {
  full_name: string | null;
  business_name: string | null;
  account_type: 'customer' | 'business_partner' | null;
  gstin: string | null;
  address: string | null;
  pincode: string | null;
  state_code: string | null;
  state: string | null;
  email: string | null;
  business_type: string | null;
  monthly_loads: string | null;
  /** True when every field this account type needs is filled in. */
  complete: boolean;
  /** What the GST portal said when the GSTIN was last saved (only when the portal check is configured). */
  gstin_status: string | null;
}

const ORG_COLUMNS = 'id, name, legal_name, gstin, address, pincode, state, email, profile';
/** A login address made for a phone sign-in is not a mailbox. */
const realEmail = (e: string | null | undefined) => (e && !/\.margixindia\.local$/i.test(e) ? e : null);

export function isComplete(p: Omit<BusinessProfile, 'complete' | 'gstin_status'>): boolean {
  const base = !!(p.full_name && p.account_type && p.address && p.pincode && p.email);
  return p.account_type === 'business_partner' ? base && !!p.business_name && !!p.gstin : base;
}

function requireVendorOrg(c: Caller): string {
  if (!c.vendorOrg) throw new HttpError(403, 'Your account has no business to save a profile for yet. Sign in again and retry.');
  return c.vendorOrg.id;
}

export async function getBusinessProfile(c: Caller): Promise<BusinessProfile> {
  const orgId = requireVendorOrg(c);
  const [{ data: org, error }, { data: user }] = await Promise.all([
    supabase.from('organizations').select(ORG_COLUMNS).eq('id', orgId).maybeSingle(),
    supabase.from('users').select('full_name, email').eq('id', c.userId).maybeSingle(),
  ]);
  if (error) throw new Error(`Failed to read the business profile: ${error.message}`);
  if (!org) throw new HttpError(404, 'Business not found');
  const meta = (org.profile ?? {}) as Record<string, any>;
  const stateCode = (meta.state_code as string | undefined) ?? null;
  const base = {
    full_name: (meta.contact_name as string | undefined) ?? user?.full_name ?? null,
    business_name: org.legal_name ?? null,
    account_type: (meta.account_type as BusinessProfile['account_type']) ?? null,
    gstin: org.gstin ?? null,
    address: org.address ?? null,
    pincode: org.pincode ?? null,
    state_code: stateCode,
    state: org.state ?? null,
    email: org.email ?? realEmail(user?.email),
    business_type: (meta.business_type as string | undefined) ?? null,
    monthly_loads: (meta.monthly_loads as string | undefined) ?? null,
  };
  return { ...base, complete: isComplete(base), gstin_status: (meta.gstin_status as string | undefined) ?? null };
}

/** A 400 with the reason when the GSTIN is malformed or the GST portal says it is inactive or unknown. */
async function checkGstin(gstin: string): Promise<string> {
  const result = await gstinService.verify(gstin);
  if (!result.valid) throw new HttpError(400, result.message ?? 'This GSTIN is not valid');
  if (result.online.status === 'inactive' || result.online.status === 'not_found') throw new HttpError(400, result.summary);
  return result.online.status;
}

export async function saveBusinessProfile(c: Caller, input: BusinessProfileInput): Promise<BusinessProfile> {
  const orgId = requireVendorOrg(c);
  let gstinStatus: string | null = null;
  if (input.gstin) gstinStatus = await checkGstin(input.gstin);

  const stateCode = input.gstin ? input.gstin.slice(0, 2) : (input.state_code ?? null);
  const { data: current, error: curErr } = await supabase.from('organizations').select('id, profile').eq('id', orgId).maybeSingle();
  if (curErr) throw new Error(`Failed to read the business: ${curErr.message}`);
  if (!current) throw new HttpError(404, 'Business not found');

  const name = input.business_name ?? input.full_name;
  const { error } = await supabase.from('organizations').update({
    name,
    legal_name: input.business_name,
    gstin: input.gstin,
    address: input.address,
    pincode: input.pincode,
    state: stateCode ? (GST_STATES[stateCode] ?? null) : null,
    email: input.email,
    profile: {
      ...(current.profile ?? {}),
      account_type: input.account_type,
      business_type: input.business_type ?? null,
      monthly_loads: input.monthly_loads ?? null,
      contact_name: input.full_name,
      state_code: stateCode,
      gstin_status: gstinStatus,
    },
  }).eq('id', orgId);
  if (error) throw new Error(`Failed to save the business profile: ${error.message}`);

  await mirrorToVendorProfile(c.userId, input, name);
  return getBusinessProfile(c);
}

/**
 * The same business on vendor_profiles. A change to the legal name, GSTIN or address of an approved profile sends it
 * back to KYC review, exactly as vendorService.upsertProfile does.
 */
async function mirrorToVendorProfile(userId: string, input: BusinessProfileInput, companyName: string): Promise<void> {
  const { data: existing, error: readErr } = await supabase.from('vendor_profiles').select('kyc_status, company_name, gst_number, address, city').eq('id', userId).maybeSingle();
  if (readErr) throw new Error(`Failed to read the vendor profile: ${readErr.message}`);
  const changes: Record<string, unknown> = {
    id: userId,
    company_name: companyName,
    gst_number: input.gstin ?? '',
    address: input.address,
    updated_at: new Date().toISOString(),
  };
  if (existing?.city == null || existing.city === '') changes.city = '';
  if (existing?.kyc_status === 'approved'
      && (['company_name', 'gst_number', 'address'] as const).some(f => (changes[f] ?? null) !== (existing[f] ?? null))) {
    Object.assign(changes, { kyc_status: 'submitted', kyc_reviewed_at: null, kyc_reviewed_by: null });
  }
  const { error } = await supabase.from('vendor_profiles').upsert(changes);
  if (error) throw new Error(`Failed to save the vendor profile: ${error.message}`);
}
