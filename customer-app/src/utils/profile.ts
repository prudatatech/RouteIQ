import type { CustomerProfile, ProfileUpdate } from '../services/api';

/** The text fields of the billing form, in the order they are shown. Every value is a string; empty means unset. */
export const PROFILE_FIELDS = ['full_name', 'company_name', 'gstin', 'email', 'billing_address', 'city', 'state', 'pincode'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileForm = Record<ProfileField, string>;

/** A new customer is saved as "Customer 1234" until they give a name; that is not a name to show or edit. */
export const isPlaceholderName = (name: string | null | undefined): boolean => /^customer(\s+\d+)?$/i.test((name ?? '').trim());

export function profileToForm(profile: CustomerProfile): ProfileForm {
  const form = {} as ProfileForm;
  for (const f of PROFILE_FIELDS) form[f] = (profile[f] ?? '').trim();
  if (isPlaceholderName(form.full_name)) form.full_name = '';
  return form;
}

/** Only the fields that differ from what was loaded; an emptied field is sent as '' so the server clears it. */
export function changedFields(initial: ProfileForm, current: ProfileForm): ProfileUpdate {
  const out: ProfileUpdate = {};
  for (const f of PROFILE_FIELDS) {
    const value = current[f].trim();
    if (value !== initial[f]) out[f] = value;
  }
  return out;
}

/** The first name for the home greeting: the person's name, else the company, never the placeholder. */
export function greetingName(info: { full_name?: string | null; company_name?: string | null } | null | undefined): string | null {
  const person = isPlaceholderName(info?.full_name) ? '' : (info?.full_name ?? '').trim().split(/\s+/)[0];
  const name = person || (info?.company_name ?? '').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : null;
}
