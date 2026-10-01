import { checkGstin, normalizeGstin } from '@/utils/gstin'

/** A customer's details for invoices (GET /bookings/customers/:id/profile). */
export interface CustomerProfile {
  id: string
  phone: string | null
  full_name: string | null
  company_name: string | null
  gstin: string | null
  email: string | null
  billing_address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  display_name: string
  billing_ready: boolean
}

export type CustomerProfileInput = Partial<Pick<CustomerProfile, 'full_name' | 'company_name' | 'gstin' | 'email' | 'billing_address' | 'city' | 'state' | 'pincode'>>

export const PROFILE_FIELDS = ['full_name', 'company_name', 'gstin', 'email', 'billing_address', 'city', 'state', 'pincode'] as const
export type ProfileField = typeof PROFILE_FIELDS[number]

/** The GST state names the server accepts. */
export const GST_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
] as const

/** The form's values: every field a string, empty when not set. */
export type ProfileForm = Record<ProfileField, string>

export const profileToForm = (p: Partial<CustomerProfile> | null | undefined): ProfileForm =>
  Object.fromEntries(PROFILE_FIELDS.map(f => [f, (p?.[f] ?? '') as string])) as ProfileForm

/** Problems with the values, by field. Empty values are fine: any of them can be cleared. */
export function validateProfile(form: ProfileForm): Partial<Record<ProfileField, string>> {
  const errors: Partial<Record<ProfileField, string>> = {}
  const gstin = form.gstin.trim()
  if (gstin) {
    const check = checkGstin(gstin)
    if (!check.valid) errors.gstin = check.message
  }
  if (form.pincode.trim() && !/^\d{6}$/.test(form.pincode.trim())) errors.pincode = 'A PIN code has 6 digits'
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address'
  if (form.state && !(GST_STATES as readonly string[]).includes(form.state)) errors.state = 'Choose a state from the list'
  return errors
}

/** Only the fields that differ from what is saved, trimmed (the GSTIN upper-cased); an empty string clears a field. */
export function profileChanges(form: ProfileForm, saved: Partial<CustomerProfile> | null | undefined): CustomerProfileInput {
  const out: CustomerProfileInput = {}
  for (const f of PROFILE_FIELDS) {
    const next = f === 'gstin' ? normalizeGstin(form[f]) : form[f].trim()
    if (next !== ((saved?.[f] ?? '') as string)) out[f] = next
  }
  return out
}

/** What a customer is called: company, else name, else the phone-based fallback. */
export function customerLabel(c: { name?: string | null; full_name?: string | null; company?: string | null; company_name?: string | null; phone?: string | null } | null | undefined, fallback = 'Customer'): string {
  const company = c?.company ?? c?.company_name
  const phone = c?.phone?.replace(/\D/g, '')
  return company?.trim() || c?.name?.trim() || c?.full_name?.trim() || (phone ? `Customer ${phone.slice(-4)}` : fallback)
}
