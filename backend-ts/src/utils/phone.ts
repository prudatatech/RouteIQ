/**
 * Phone numbers as the app stores and looks them up: E.164 (+91XXXXXXXXXX).
 * Driver OTP login and staff-created drivers both use this, so a driver
 * created by staff is the record the driver lands on after signing in.
 */

/** Normalise an Indian phone number to E.164 (+91XXXXXXXXXX); null when invalid. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let phone = raw.replace(/\s+/g, '').replace(/^0+/, '');
  if (!phone.startsWith('+')) {
    if (phone.startsWith('91') && phone.length === 12) phone = '+' + phone;
    else if (phone.length === 10) phone = '+91' + phone;
    else phone = '+' + phone;
  }
  return phone.replace(/\D/g, '').length >= 10 ? phone : null;
}
