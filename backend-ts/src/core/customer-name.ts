/**
 * margixindia — How a customer is named wherever staff see them (Requests, Shipments, Money,
 * notifications): the company, else the person's name, else the phone-based label.
 *
 * Customers signed up before they could give a name were stored as "Customer 7701" (the last four
 * digits of the phone). That placeholder is not a name: it is shown only as the last choice.
 */

const PLACEHOLDER = /^customer\s+\d{4}$/i;
const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** True for the "Customer 7701" label a new sign-up is given, which is not a real name. */
export const isPlaceholderName = (name: unknown): boolean => PLACEHOLDER.test(clean(name) ?? '');

/** The name a person gave, or null when it is empty or the placeholder. */
export const givenName = (name: unknown): string | null => {
  const n = clean(name);
  return n && !PLACEHOLDER.test(n) ? n : null;
};

export interface CustomerNameFields {
  company_name?: string | null;
  full_name?: string | null;
  phone?: string | null;
}

/** Company name, else full name, else "Customer 7701" from the phone, else "Customer". */
export function customerDisplayName(c: CustomerNameFields | null | undefined): string {
  if (!c) return 'Customer';
  const digits = (c.phone ?? '').replace(/\D/g, '');
  return clean(c.company_name) ?? givenName(c.full_name) ?? (digits.length >= 4 ? `Customer ${digits.slice(-4)}` : 'Customer');
}
