/**
 * margixindia — A customer's profile: who they are and who an invoice is billed to.
 *
 * The customer reads and edits their own (`GET`/`PATCH /customer/profile`); staff read and edit any
 * customer's (`/customers/:id/profile`). Everything is optional, trimmed, and checked the same way:
 * GSTIN (format and check character, and its state must be the state given), Indian PIN code, and a
 * state from the GST state list. Invoices read it when they are issued (invoice-recipient.service.ts);
 * invoices already issued are never rewritten.
 */
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { GST_STATES, stateCodeByName, stateOf } from '../core/gst';
import { customerDisplayName, givenName } from '../core/customer-name';
import { checkGstin, normalizeGstin } from '../utils/gstin';
import { isPincode } from '../utils/people-validators';

export const PROFILE_COLUMNS = 'id, phone, full_name, company_name, gstin, email, billing_address, city, state, pincode';

/** Names of the states and union territories a customer can pick, from the GST state list. */
export const INDIAN_STATES: string[] = [...new Set(Object.values(GST_STATES))].filter(s => s !== 'Other Territory').sort();

/** A zod issue that wants a 422 (a well-formed value that is not acceptable). */
const unprocessable = { status: 422 };

/** An empty string clears a field (null); a field that was not sent stays undefined, so it is left alone. */
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);

const text = (max: number, what: string) =>
  z.string().trim().max(max, `${what} can be at most ${max} characters`).transform(blank).nullable().optional();

export const ProfileSchema = z.object({
  full_name: text(120, 'The name'),
  company_name: text(160, 'The company name'),
  gstin: z.string().nullable().optional().transform(v => (v === undefined ? undefined : v ? normalizeGstin(v) : null)).superRefine((v, ctx) => {
    if (!v) return;
    const check = checkGstin(v);
    if (!check.valid) ctx.addIssue({ code: 'custom', message: check.message ?? 'This GSTIN is not valid', params: unprocessable });
  }),
  email: z.string().trim().max(254, 'The email can be at most 254 characters').nullable().optional().transform(blank).superRefine((v, ctx) => {
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) ctx.addIssue({ code: 'custom', message: 'Enter a valid email address', params: unprocessable });
  }),
  billing_address: text(500, 'The address'),
  city: text(100, 'The city'),
  state: z.string().trim().nullable().optional().transform(blank).superRefine((v, ctx) => {
    if (v && !stateCodeByName(v)) ctx.addIssue({ code: 'custom', message: 'Choose a state from the list', params: unprocessable });
  }),
  pincode: z.string().trim().nullable().optional().transform(blank).superRefine((v, ctx) => {
    if (v && !isPincode(v)) ctx.addIssue({ code: 'custom', message: 'Enter a 6-digit PIN code', params: unprocessable });
  }),
}).strict('Only the profile fields can be saved');

const FIELDS = ['full_name', 'company_name', 'gstin', 'email', 'billing_address', 'city', 'state', 'pincode'] as const;

export interface CustomerProfile {
  id: string;
  phone: string;
  full_name: string | null;
  company_name: string | null;
  gstin: string | null;
  email: string | null;
  billing_address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  /** What staff see as the customer's name: company, else name, else the phone-based label. */
  display_name: string;
  /** True when a GSTIN, an address and a state are on record, so invoices bill the customer by them. */
  billing_ready: boolean;
}

const canonicalState = (s: unknown): string | null =>
  typeof s === 'string' && s.trim() ? (INDIAN_STATES.find(x => x.toLowerCase() === s.trim().toLowerCase()) ?? s.trim()) : null;

function shape(row: any): CustomerProfile {
  const state = canonicalState(row.state);
  return {
    id: row.id,
    phone: row.phone,
    full_name: givenName(row.full_name),
    company_name: row.company_name ?? null,
    gstin: row.gstin ?? null,
    email: row.email ?? null,
    billing_address: row.billing_address ?? null,
    city: row.city ?? null,
    state,
    pincode: row.pincode ?? null,
    display_name: customerDisplayName(row),
    billing_ready: !!(row.gstin && row.billing_address && (state || stateOf(row.gstin).code)),
  };
}

export async function getCustomerProfile(customerId: string): Promise<CustomerProfile> {
  const { data, error } = await supabase.from('customers').select(PROFILE_COLUMNS).eq('id', customerId).maybeSingle();
  if (error) throw new Error(`Failed to read customer: ${error.message}`);
  if (!data) throw new HttpError(404, 'Customer not found');
  return shape(data);
}

/** Validates the body and saves only the fields that were sent. An empty value clears a field. */
export async function updateCustomerProfile(customerId: string, body: unknown): Promise<CustomerProfile> {
  const parsed = ProfileSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const asked = (issue as { params?: { status?: number } }).params?.status;
    throw new HttpError(asked ?? (issue.code === 'unrecognized_keys' ? 400 : 422), issue.message);
  }
  const patch: Record<string, string | null> = {};
  for (const f of FIELDS) if (parsed.data[f] !== undefined) patch[f] = parsed.data[f] ?? null;
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to save');
  if (typeof patch.state === 'string') patch.state = canonicalState(patch.state);

  const current = await getCustomerProfile(customerId);
  const gstin = 'gstin' in patch ? patch.gstin : current.gstin;
  const state = 'state' in patch ? patch.state : current.state;
  const gstinState = stateOf(gstin).name;
  if (gstin && state && gstinState && gstinState.toLowerCase() !== state.toLowerCase()) {
    throw new HttpError(422, `This GSTIN is registered in ${gstinState}, not ${state}`);
  }

  const { error } = await supabase.from('customers').update(patch).eq('id', customerId);
  if (error) throw new Error(`Failed to save customer: ${error.message}`);
  return getCustomerProfile(customerId);
}
