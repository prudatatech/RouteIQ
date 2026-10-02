/**
 * margixindia — WhatsApp messages through the Meta WhatsApp Cloud API (REST, no SDK).
 *
 * Only template messages are sent (WhatsApp requires an approved template to start a conversation).
 * When WHATSAPP_TOKEN, WHATSAPP_PHONE_ID or the template name is not set, nothing is sent and a line is logged.
 * Nothing here ever throws: a failed WhatsApp message must never undo the action that caused it.
 */
import { settings } from '../core/config';

export function whatsappConfigured(): boolean {
  return Boolean(settings.WHATSAPP_TOKEN && settings.WHATSAPP_PHONE_ID && settings.WHATSAPP_TEMPLATE_LOAD_POSTED);
}

/** A WhatsApp number as the Cloud API wants it: digits only, with the country code (no +). */
export function whatsappNumber(phone: string): string {
  return phone.replace(/\D/g, '');
}

export interface WhatsappTemplate {
  name: string;
  language: string;
  /** Body parameters, in order ({{1}}, {{2}} ...). */
  params: string[];
}

/** The request body of one template message (exported so it can be checked on its own). */
export function templatePayload(to: string, t: WhatsappTemplate) {
  return {
    messaging_product: 'whatsapp',
    to: whatsappNumber(to),
    type: 'template',
    template: {
      name: t.name,
      language: { code: t.language },
      components: [{ type: 'body', parameters: t.params.map(text => ({ type: 'text', text })) }],
    },
  };
}

/** Sends one template message. Returns false when it was not sent (not configured, or the API refused). */
export async function sendWhatsappTemplate(to: string, t: WhatsappTemplate): Promise<boolean> {
  if (!settings.WHATSAPP_TOKEN || !settings.WHATSAPP_PHONE_ID) {
    console.warn(`[whatsapp] Not configured; "${t.name}" to ${to} not sent`);
    return false;
  }
  try {
    const url = `https://graph.facebook.com/${settings.WHATSAPP_API_VERSION}/${settings.WHATSAPP_PHONE_ID}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(templatePayload(to, t)),
    });
    if (response.ok) return true;
    const body: any = await response.json().catch(() => ({}));
    console.error(`[whatsapp] Send failed: ${body?.error?.message ?? response.status}`);
    return false;
  } catch (e: any) {
    console.error(`[whatsapp] Send error: ${e?.message ?? e}`);
    return false;
  }
}

export interface LoadPostedMessage {
  loadNumber: string;
  route: string;
  pickupDate: string;
  vehicle: string;
  totalWeightKg: number;
  /** The vendor's business is not verified yet: the load is saved, not yet with any logistic company. */
  held?: boolean;
}

/** The PRD 10.3 parameters, in the order of the approved `load_posted` template body. */
export function loadPostedParams(m: LoadPostedMessage): string[] {
  return [m.loadNumber, m.route, m.pickupDate, m.vehicle, `${Math.round(m.totalWeightKg).toLocaleString('en-IN')} kg`];
}

/** Sends the load-posted confirmation (PRD 10.3). A no-op plus a log when WhatsApp is not configured. */
export async function sendLoadPosted(phone: string | null | undefined, m: LoadPostedMessage): Promise<boolean> {
  if (!phone) return false;
  if (!whatsappConfigured()) {
    console.warn(`[whatsapp] Not configured; load-posted message for ${m.loadNumber} not sent`);
    return false;
  }
  // A held load must not get the "matching a carrier" template; with no held template set, only the email goes out
  const name = m.held ? settings.WHATSAPP_TEMPLATE_LOAD_HELD : settings.WHATSAPP_TEMPLATE_LOAD_POSTED;
  if (!name) {
    console.warn(`[whatsapp] No pending-verification template set; message for ${m.loadNumber} not sent`);
    return false;
  }
  return sendWhatsappTemplate(phone, { name, language: 'en', params: loadPostedParams(m) });
}
