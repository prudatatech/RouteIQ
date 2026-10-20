/**
 * Vehicle RC verification, through Cashfree's Vehicle RC Verification API
 * (POST then GET /verification/vehicle-rc, under the verification suite - not
 * the payments API). Runs only when CASHFREE_CLIENT_ID/CLIENT_SECRET/
 * CASHFREE_VERIFICATION_BASE_URL are all set; unset means it stays off and a
 * vehicle still saves, the same way IFSC lets a save through when the lookup
 * service is down. Every check, whatever its outcome, is kept as its own row
 * in vehicle_rc_verifications - a vehicle's RC status, insurance, PUC and
 * permit all change over its life, and that history is the audit trail.
 */
import axios from 'axios';
import { settings } from '../core/config';
import { HttpError } from '../core/errors';
import { supabase } from '../core/supabase';

const REQUEST_TIMEOUT_MS = 10_000;

export function cashfreeConfigured(): boolean {
  return !!(settings.CASHFREE_CLIENT_ID && settings.CASHFREE_CLIENT_SECRET && settings.CASHFREE_VERIFICATION_BASE_URL);
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Cashfree's dates are DD/MM/YYYY; the vehicle's own expiry columns are `date`. Unparseable input is dropped, never guessed. */
function parseCashfreeDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = d.padStart(2, '0');
  const month = mo.padStart(2, '0');
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${y}-${month}-${day}`;
}

/**
 * Where a confirmed RC check also updates the vehicle's own working fields - only the ones with a
 * real one-to-one equivalent (document numbers and their expiry). Vehicle_type, capacity_kg and
 * body_type are never touched: they drive this app's own matching and dispatch logic, and Cashfree's
 * "class"/"gross vehicle weight" measure a different thing, not a correction to them. Staff can
 * still edit anything here by hand afterwards - this only ever pre-fills, never locks a field.
 */
function autofillFromRc(raw: CashfreeRcResponse): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const rcExpiry = parseCashfreeDate(text(raw.rc_expiry_date));
  if (rcExpiry) patch.rc_expiry = rcExpiry;
  if (text(raw.vehicle_insurance_policy_number)) patch.insurance_number = text(raw.vehicle_insurance_policy_number);
  const insuranceExpiry = parseCashfreeDate(text(raw.vehicle_insurance_upto));
  if (insuranceExpiry) patch.insurance_expiry = insuranceExpiry;
  if (text(raw.pucc_number)) patch.puc_number = text(raw.pucc_number);
  const puccExpiry = parseCashfreeDate(text(raw.pucc_upto));
  if (puccExpiry) patch.puc_expiry = puccExpiry;
  if (text(raw.permit_number)) patch.permit_number = text(raw.permit_number);
  const permitExpiry = parseCashfreeDate(text(raw.permit_valid_upto));
  if (permitExpiry) patch.permit_expiry = permitExpiry;
  return patch;
}

/** Cashfree's own field names, read tolerantly - see docs/api-reference/vrs/v2/vehicle-rc. */
interface CashfreeRcResponse {
  verification_id?: string;
  reference_id?: number | string;
  status?: string; // VALID | INVALID
  [key: string]: unknown;
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-client-id': settings.CASHFREE_CLIENT_ID,
    'x-client-secret': settings.CASHFREE_CLIENT_SECRET,
  };
}

/** Submits the check, then reads its result. Cashfree's RC check answers synchronously in practice. */
async function submitAndFetch(verificationId: string, rcNumber: string): Promise<CashfreeRcResponse> {
  const base = settings.CASHFREE_VERIFICATION_BASE_URL!.replace(/\/+$/, '');
  const headers = authHeaders();
  const submitted = await axios.post(`${base}/verification/vehicle-rc`, { verification_id: verificationId, vehicle_number: rcNumber }, {
    headers, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true,
  });
  if (submitted.status < 200 || submitted.status >= 300) {
    throw Object.assign(new Error(`Cashfree rejected the verification request (${submitted.status})`), { status: submitted.status });
  }
  const fetched = await axios.get(`${base}/verification/vehicle-rc`, {
    params: { verification_id: verificationId }, headers, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true,
  });
  if (fetched.status < 200 || fetched.status >= 300) {
    throw Object.assign(new Error(`Could not retrieve the RC verification result (${fetched.status})`), { status: fetched.status });
  }
  return fetched.data as CashfreeRcResponse;
}

export type RcVerificationStatus = 'valid' | 'invalid' | 'unavailable' | 'not_configured';

/** What the caller needs right away; everything Cashfree returned is kept in the database row. */
export interface RcVerificationResult {
  id: string;
  status: RcVerificationStatus;
  rc_number: string;
  verification_id: string | null;
  reference_id: string | null;
  owner_name: string | null;
  rc_status: string | null;
  rc_expiry_date: string | null;
  insurance_upto: string | null;
  pucc_upto: string | null;
  permit_valid_upto: string | null;
  blacklist_status: string | null;
  error_message: string | null;
}

/** Every column vehicle_rc_verifications has, built from Cashfree's response (or none of it, for an unreachable/unconfigured check). */
function buildRow(
  vehicleId: string, verificationId: string, rcNumber: string, raw: CashfreeRcResponse | null,
  status: RcVerificationStatus, errorMessage: string | null, requestedBy: string | null,
) {
  return {
    vehicle_id: vehicleId,
    verification_id: verificationId,
    reference_id: raw?.reference_id != null ? String(raw.reference_id) : null,
    rc_number: rcNumber,
    status,
    chassis_number: text(raw?.chassis), engine_number: text(raw?.engine),
    vehicle_class: text(raw?.class), vehicle_category: text(raw?.vehicle_category),
    manufacturer_name: text(raw?.vehicle_manufacturer_name), model_name: text(raw?.model),
    vehicle_colour: text(raw?.vehicle_colour), fuel_type: text(raw?.type), norms_type: text(raw?.norms_type),
    body_type: text(raw?.body_type), cubic_capacity: text(raw?.vehicle_cubic_capacity),
    cylinders_count: text(raw?.vehicle_cylinders_no), gross_vehicle_weight: text(raw?.gross_vehicle_weight),
    unladen_weight: text(raw?.unladen_weight), seat_capacity: text(raw?.vehicle_seat_capacity),
    sleeper_capacity: text(raw?.vehicle_sleeper_capacity), standing_capacity: text(raw?.vehicle_standing_capacity),
    wheelbase: text(raw?.wheelbase), is_commercial: typeof raw?.is_commercial === 'boolean' ? raw.is_commercial : null,
    manufacturing_month_year: text(raw?.vehicle_manufacturing_month_year),
    owner_name: text(raw?.owner), owner_father_name: text(raw?.owner_father_name), owner_count: text(raw?.owner_count),
    owner_mobile_number: text(raw?.mobile_number), present_address: text(raw?.present_address), permanent_address: text(raw?.permanent_address),
    rc_status: text(raw?.rc_status), rc_status_as_on: text(raw?.status_as_on), reg_authority: text(raw?.reg_authority),
    reg_date: text(raw?.reg_date), rc_expiry_date: text(raw?.rc_expiry_date), rc_standard_cap: text(raw?.rc_standard_cap),
    tax_upto: text(raw?.vehicle_tax_upto), pucc_number: text(raw?.pucc_number), pucc_upto: text(raw?.pucc_upto),
    insurance_company_name: text(raw?.vehicle_insurance_company_name), insurance_policy_number: text(raw?.vehicle_insurance_policy_number),
    insurance_upto: text(raw?.vehicle_insurance_upto), financer_name: text(raw?.rc_financer),
    permit_number: text(raw?.permit_number), permit_type: text(raw?.permit_type), permit_issue_date: text(raw?.permit_issue_date),
    permit_valid_from: text(raw?.permit_valid_from), permit_valid_upto: text(raw?.permit_valid_upto),
    national_permit_number: text(raw?.national_permit_number), national_permit_upto: text(raw?.national_permit_upto),
    national_permit_issued_by: text(raw?.national_permit_issued_by),
    non_use_status: text(raw?.non_use_status), non_use_from: text(raw?.non_use_from), non_use_to: text(raw?.non_use_to),
    blacklist_status: text(raw?.blacklist_status), blacklist_details: raw?.blacklist_details ?? null, challan_details: raw?.challan_details ?? null,
    noc_details: text(raw?.noc_details),
    raw_response: raw ?? null,
    error_message: errorMessage,
    requested_by: requestedBy,
  };
}

function toResult(id: string, status: RcVerificationStatus, rcNumber: string, verificationId: string | null, raw: CashfreeRcResponse | null, errorMessage: string | null): RcVerificationResult {
  return {
    id, status, rc_number: rcNumber, verification_id: verificationId,
    reference_id: raw?.reference_id != null ? String(raw.reference_id) : null,
    owner_name: text(raw?.owner), rc_status: text(raw?.rc_status), rc_expiry_date: text(raw?.rc_expiry_date),
    insurance_upto: text(raw?.vehicle_insurance_upto), pucc_upto: text(raw?.pucc_upto), permit_valid_upto: text(raw?.permit_valid_upto),
    blacklist_status: text(raw?.blacklist_status), error_message: errorMessage,
  };
}

async function recordAndSummarize(
  vehicleId: string, verificationId: string, rcNumber: string, raw: CashfreeRcResponse | null,
  status: RcVerificationStatus, errorMessage: string | null, requestedBy: string | null,
): Promise<RcVerificationResult> {
  const row = buildRow(vehicleId, verificationId, rcNumber, raw, status, errorMessage, requestedBy);
  const { data, error } = await supabase.from('vehicle_rc_verifications').insert(row).select('id').single();
  if (error) throw new Error(`Failed to record the RC check: ${error.message}`);
  await supabase.from('vehicles').update({
    rc_verification_status: status,
    rc_verified_at: new Date().toISOString(),
    rc_verification_id: data.id,
    // Pre-fills the vehicle's own document numbers/expiries from a confirmed check; staff can
    // still override any of them by hand afterwards.
    ...(status === 'valid' && raw ? autofillFromRc(raw) : {}),
  }).eq('id', vehicleId);
  return toResult(data.id, status, rcNumber, verificationId, raw, errorMessage);
}

/**
 * Verifies one vehicle's RC number and records the result, win or lose. Never throws for a check
 * that could not be completed (not configured, or Cashfree unreachable) - those are recorded as
 * their own status so the vehicle can still be saved; a genuinely malformed number is a 400.
 */
export async function verifyVehicleRc(vehicleId: string, rcNumberInput: unknown, requestedBy: string | null = null): Promise<RcVerificationResult> {
  const rcNumber = typeof rcNumberInput === 'string' ? rcNumberInput.trim().toUpperCase().replace(/\s+/g, '') : '';
  if (!rcNumber) throw new HttpError(400, 'A vehicle registration number is required');
  if (!vehicleId) throw new HttpError(400, 'vehicle_id is required');

  if (!cashfreeConfigured()) {
    return recordAndSummarize(vehicleId, '', rcNumber, null, 'not_configured', null, requestedBy);
  }

  const verificationId = `margix_${vehicleId.replace(/-/g, '').slice(0, 20)}_${Date.now()}`;
  try {
    const raw = await submitAndFetch(verificationId, rcNumber);
    const status: RcVerificationStatus = raw.status === 'VALID' ? 'valid' : raw.status === 'INVALID' ? 'invalid' : 'unavailable';
    return recordAndSummarize(vehicleId, text(raw.verification_id) ?? verificationId, rcNumber, raw, status, null, requestedBy);
  } catch (e: any) {
    console.error('[vehicle-rc] Verification failed:', e.message);
    return recordAndSummarize(vehicleId, verificationId, rcNumber, null, 'unavailable', e.message, requestedBy);
  }
}

export const vehicleRcService = { verifyVehicleRc, cashfreeConfigured };
