/**
 * margixindia — SMS through Twilio (REST API, no SDK).
 *
 * Used for the phone login codes and the delivery OTP. Outside production, with no Twilio
 * account configured, the message is logged instead so development can proceed.
 */
import { settings } from '../core/config';

/** True when a Twilio account is configured. */
export function smsConfigured(): boolean {
  return Boolean(settings.TWILIO_ACCOUNT_SID && settings.TWILIO_AUTH_TOKEN && settings.TWILIO_PHONE_NUMBER);
}

/** Sends one SMS. Returns false when it could not be sent. */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const accountSid = settings.TWILIO_ACCOUNT_SID;
  const authToken = settings.TWILIO_AUTH_TOKEN;
  const from = settings.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    if (settings.isProduction) return false;
    console.warn(`[DEV SMS] Twilio not configured. To: ${to}, Message: ${body}`);
    return true;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams({ To: to, From: from, Body: body });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (response.ok) {
      console.log(`SMS sent to ${to}`);
      return true;
    }
    const errData: any = await response.json();
    console.error(`Twilio SMS failed: ${errData.message || response.status}`);
    return false;
  } catch (e: any) {
    console.error(`Twilio SMS error: ${e.message}`);
    return false;
  }
}
