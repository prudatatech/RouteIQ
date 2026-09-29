import { settings } from '../core/config';
import { HttpError } from '../core/errors';
import { externalHttp } from '../core/http';
import { cacheGet, cacheSet } from '../core/redis';

/** Razorpay's free public IFSC API: one GET per code, no key. */
const LOOKUP_TIMEOUT_MS = 5000;
const FOUND_TTL_S = 30 * 24 * 3600;
const NOT_FOUND_TTL_S = 24 * 3600;
const IFSC_FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const IFSC_NOT_FOUND_MESSAGE = 'No bank branch has this IFSC';
export const IFSC_UNAVAILABLE_MESSAGE = 'Bank lookup is unavailable, check the IFSC yourself';
export const IFSC_BAD_FORMAT_MESSAGE = 'IFSC must be 4 letters, a zero and 6 letters or digits (for example HDFC0001234)';

export interface IfscDetails {
  ifsc: string;
  bank: string | null;
  bank_code: string | null;
  branch: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  centre: string | null;
  micr: string | null;
  contact: string | null;
  neft: boolean;
  rtgs: boolean;
  imps: boolean;
  upi: boolean;
  swift: string | null;
}

export type IfscLookup = ({ found: true } & IfscDetails) | { found: false };

export const normalizeIfscCode = (code: unknown): string => (typeof code === 'string' ? code.trim().toUpperCase() : '');
export const isValidIfscFormat = (code: unknown): boolean => IFSC_FORMAT.test(normalizeIfscCode(code));

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function normalise(code: string, raw: Record<string, unknown>): IfscDetails {
  return {
    ifsc: text(raw.IFSC) ?? code,
    bank: text(raw.BANK), bank_code: text(raw.BANKCODE), branch: text(raw.BRANCH), address: text(raw.ADDRESS),
    city: text(raw.CITY), district: text(raw.DISTRICT), state: text(raw.STATE), centre: text(raw.CENTRE),
    micr: text(raw.MICR), contact: text(raw.CONTACT),
    neft: raw.NEFT === true, rtgs: raw.RTGS === true, imps: raw.IMPS === true, upi: raw.UPI === true,
    swift: text(raw.SWIFT),
  };
}

/**
 * Looks one IFSC up. Throws a 400 for a badly formed code and a 503 when the
 * lookup service cannot be reached; a well-formed code no branch has gives `{ found: false }`.
 */
export async function lookupIfsc(code: unknown): Promise<IfscLookup> {
  const ifsc = normalizeIfscCode(code);
  if (!IFSC_FORMAT.test(ifsc)) throw new HttpError(400, IFSC_BAD_FORMAT_MESSAGE);

  const key = `ifsc:${ifsc}`;
  const cached = await cacheGet<IfscLookup>(key);
  if (cached && typeof cached === 'object' && 'found' in cached) return cached;

  let result: IfscLookup;
  try {
    const raw = await externalHttp.getJson<Record<string, unknown>>(
      `${settings.IFSC_LOOKUP_BASE_URL.replace(/\/+$/, '')}/${ifsc}`, LOOKUP_TIMEOUT_MS,
    );
    result = raw && typeof raw === 'object' && (raw.BANK || raw.BRANCH)
      ? { found: true, ...normalise(ifsc, raw) }
      : { found: false };
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      result = { found: false };
    } else {
      console.error('[ifsc] Lookup failed:', (e as Error).message);
      throw new HttpError(503, IFSC_UNAVAILABLE_MESSAGE);
    }
  }
  await cacheSet(key, result, result.found ? FOUND_TTL_S : NOT_FOUND_TTL_S);
  return result;
}

export interface IfscCheck {
  /** The looked-up branch, or null when the service was down. */
  details: IfscDetails | null;
  /** When the branch was confirmed; null when it could not be checked. */
  verifiedAt: string | null;
  /** Warning codes: `ifsc_unverified`, `ifsc_no_neft_imps`. */
  warnings: string[];
}

/**
 * The check every save that stores an IFSC runs. An unknown IFSC is a 400; a
 * lookup service that is down lets the save through with a warning.
 */
export async function checkIfscForSave(code: unknown): Promise<IfscCheck> {
  try {
    const found = await lookupIfsc(code);
    if (!found.found) throw new HttpError(400, IFSC_NOT_FOUND_MESSAGE);
    const { found: _found, ...details } = found;
    return {
      details,
      verifiedAt: new Date().toISOString(),
      warnings: details.neft || details.imps ? [] : ['ifsc_no_neft_imps'],
    };
  } catch (e) {
    if (e instanceof HttpError && e.status === 503) return { details: null, verifiedAt: null, warnings: ['ifsc_unverified'] };
    throw e;
  }
}
