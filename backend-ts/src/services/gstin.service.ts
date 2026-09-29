import axios from 'axios';
import { settings } from '../core/config';
import { checkGstin, gstinError, type GstinCheck } from '../utils/gstin';

/**
 * Online GSTIN lookup through the e-way bill GSP, used only when its credentials
 * are configured. The checksum result never depends on it.
 *
 * `not_configured`  no GSP credentials, so no online check was tried
 * `active`          the portal knows the GSTIN and it is active
 * `inactive`        the portal knows it but it is cancelled, suspended or otherwise not active
 * `not_found`       the portal does not know this GSTIN
 * `unavailable`     the GSP could not be reached or answered with an error
 */
export type OnlineStatus = 'not_configured' | 'active' | 'inactive' | 'not_found' | 'unavailable';

export interface OnlineGstinResult {
  status: OnlineStatus;
  legal_name?: string | null;
  trade_name?: string | null;
  /** The portal's own status text, e.g. "Active". */
  gst_status?: string | null;
}

export interface GstinVerification extends GstinCheck {
  online: OnlineGstinResult;
  /** One plain sentence for the person looking at the screen. */
  summary: string;
}

const ONLINE_TIMEOUT_MS = 8000;

export function gspConfigured(): boolean {
  return !!(settings.EWAYBILL_GSP_USERNAME && settings.EWAYBILL_GSP_PASSWORD
    && settings.EWAYBILL_GSP_CLIENT_ID && settings.EWAYBILL_GSP_BASE_URL);
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Looks the GSTIN up at the GSP. The request follows the common e-way bill master
 * "GetGSTINDetails" shape; adjust here if your GSP differs. Responses are read
 * tolerantly: legal name as `LegalName`/`lgnm`, trade name as `TradeName`/`tradeNam`,
 * status as `Status`/`sts`.
 */
export async function lookupGstinOnline(gstin: string): Promise<OnlineGstinResult> {
  if (!gspConfigured()) return { status: 'not_configured' };
  try {
    const res = await axios.get(`${settings.EWAYBILL_GSP_BASE_URL.replace(/\/+$/, '')}/ewaybillapi/v1.03/Master/GetGSTINDetails`, {
      params: { GSTIN: gstin },
      headers: {
        'client-id': settings.EWAYBILL_GSP_CLIENT_ID,
        username: settings.EWAYBILL_GSP_USERNAME,
        password: settings.EWAYBILL_GSP_PASSWORD,
      },
      timeout: ONLINE_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (res.status === 404) return { status: 'not_found' };
    if (res.status < 200 || res.status >= 300) return { status: 'unavailable' };
    const body = (res.data?.data ?? res.data) as Record<string, unknown> | null;
    const gstStatus = text(body?.Status) ?? text(body?.sts);
    const legal = text(body?.LegalName) ?? text(body?.lgnm);
    if (!body || (!gstStatus && !legal)) return { status: 'not_found' };
    const active = /^(act|active)$/i.test(gstStatus ?? '');
    return {
      status: active ? 'active' : 'inactive',
      legal_name: legal,
      trade_name: text(body.TradeName) ?? text(body.tradeNam),
      gst_status: gstStatus,
    };
  } catch (e) {
    console.error('[gstin] Online lookup failed:', (e as Error).message);
    return { status: 'unavailable' };
  }
}

function summarize(check: GstinCheck, online: OnlineGstinResult, panError: string | undefined): string {
  if (!check.valid) return check.message ?? 'This GSTIN is not valid';
  if (panError) return panError;
  switch (online.status) {
    case 'active': return `Active on the GST portal${online.legal_name ? ` as ${online.legal_name}` : ''}`;
    case 'inactive': return `Found on the GST portal but not active${online.gst_status ? ` (${online.gst_status})` : ''}`;
    case 'not_found': return 'Checksum valid, but the GST portal does not know this GSTIN';
    case 'unavailable': return 'Checksum valid; the online check could not be completed. Try again later';
    default: return 'Checksum valid; online check not configured';
  }
}

export const gstinService = {
  /** Checksum and PAN check, plus the online lookup when the GSTIN passes and the GSP is configured. */
  async verify(gstin: unknown, pan?: unknown): Promise<GstinVerification> {
    const check = checkGstin(gstin);
    const panError = check.valid ? gstinError(gstin, pan) : undefined;
    const online: OnlineGstinResult = check.valid && !panError
      ? await lookupGstinOnline(check.gstin)
      : { status: 'not_configured' };
    return { ...check, online, summary: summarize(check, online, panError) };
  },
};
