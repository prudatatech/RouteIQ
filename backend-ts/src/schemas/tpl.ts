/**
 * Checks for 3PL partner forms (onboarding, application edits and the
 * partner's settings). Messages are written for the person filling the form.
 */
import { HttpError } from '../core/errors';

export const TPL_SLA_OPTIONS = ['2 Hours', '4 Hours', '6 Hours', '12 Hours'] as const;
export const TPL_TAX_OPTIONS = ['12% GTA (With ITC) - Forward Charge', '5% GTA (No ITC) - Reverse Charge'] as const;
export const TPL_MSME_OPTIONS = ['Not Registered', 'Micro', 'Small', 'Medium'] as const;

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
const ACCOUNT_PATTERN = /^\d{9,18}$/;

const MAX_CORRIDORS = 30;
const MAX_RATE = 1_000_000;

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const blank = (v: unknown) => v === undefined || v === null || v === '';

function oneOf(value: unknown, options: readonly string[], label: string): void {
  if (!blank(value) && !options.includes(value as string)) {
    throw new HttpError(400, `${label} must be one of: ${options.join(', ')}`);
  }
}

/**
 * Corridor rows as the forms send them: { name, vehicles (comma separated),
 * rate, priority }. Returns the rows unchanged once they are known to be sane.
 */
export function assertCorridors(corridors: unknown): void {
  if (blank(corridors)) return;
  if (!Array.isArray(corridors)) throw new HttpError(400, 'Corridors must be a list');
  if (corridors.length > MAX_CORRIDORS) throw new HttpError(400, `Add at most ${MAX_CORRIDORS} corridors`);
  for (const c of corridors) {
    if (!c || typeof c !== 'object') throw new HttpError(400, 'A corridor is not valid');
    const row = c as Record<string, unknown>;
    if (!isText(row.name, 100)) throw new HttpError(400, 'Each corridor needs a name of up to 100 characters');
    if (!blank(row.vehicles) && (typeof row.vehicles !== 'string' || row.vehicles.length > 300)) {
      throw new HttpError(400, 'The vehicle types of a corridor are too long');
    }
    if (!blank(row.rate)) {
      const rate = Number(row.rate);
      if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_RATE) {
        throw new HttpError(400, `A corridor rate must be a number above 0 and up to ${MAX_RATE.toLocaleString('en-IN')}`);
      }
    }
    if (!blank(row.priority) && !['1', '2', '3'].includes(String(row.priority))) {
      throw new HttpError(400, 'Corridor priority must be 1, 2 or 3');
    }
  }
}

/** What a partner may change on their own dashboard: SLA, tax treatment and corridors. */
export function assertPartnerSettings(input: Record<string, unknown>): { sla_commitment: string; tax_treatment: string; corridors: unknown[] } {
  const { sla_commitment, tax_treatment, corridors } = input;
  if (blank(sla_commitment) || blank(tax_treatment)) throw new HttpError(400, 'Choose an SLA commitment and a tax treatment');
  oneOf(sla_commitment, TPL_SLA_OPTIONS, 'SLA commitment');
  oneOf(tax_treatment, TPL_TAX_OPTIONS, 'Tax treatment');
  assertCorridors(corridors ?? []);
  return {
    sla_commitment: sla_commitment as string,
    tax_treatment: tax_treatment as string,
    corridors: (corridors as unknown[] | undefined) ?? [],
  };
}

/**
 * Company, tax and bank details of an application. Onboarding needs the company
 * name and PAN; an edit (`partial`) checks only the fields it carries.
 */
export function assertApplicationFields(data: Record<string, unknown>, partial = false): void {
  if (!(partial && data.companyName === undefined) && !isText(data.companyName, 200)) {
    throw new HttpError(400, 'Company name is required (up to 200 characters)');
  }
  if (!(partial && data.pan === undefined) && (typeof data.pan !== 'string' || !PAN_PATTERN.test(data.pan.trim()))) {
    throw new HttpError(400, 'PAN looks incorrect (for example ABCDE1234F)');
  }
  if (!blank(data.gst) && (typeof data.gst !== 'string' || !GST_PATTERN.test(data.gst.trim()))) {
    throw new HttpError(400, 'GSTIN looks incorrect (for example 07ABCDE1234F1Z5)');
  }
  if (!blank(data.bankIfsc) && (typeof data.bankIfsc !== 'string' || !IFSC_PATTERN.test(data.bankIfsc.trim()))) {
    throw new HttpError(400, 'IFSC looks incorrect (for example HDFC0001234)');
  }
  if (!blank(data.bankAccount) && (typeof data.bankAccount !== 'string' || !ACCOUNT_PATTERN.test(data.bankAccount.trim()))) {
    throw new HttpError(400, 'Account number must be 9 to 18 digits');
  }
  oneOf(data.msmeStatus, TPL_MSME_OPTIONS, 'MSME status');
  oneOf(data.slaCommitment, TPL_SLA_OPTIONS, 'SLA commitment');
  oneOf(data.taxTreatment, TPL_TAX_OPTIONS, 'Tax treatment');
  assertCorridors(data.corridors);
}
