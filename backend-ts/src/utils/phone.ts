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

/**
 * A strict Indian mobile number as +91XXXXXXXXXX; null when it is not one.
 * Spaces and dashes are ignored; 10 digits starting 6-9, optionally prefixed by +91, 91 or 0.
 */
export function normalizeIndianMobile(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.replace(/[\s-]+/g, '').match(/^(?:\+91|91|0)?([6-9][0-9]{9})$/);
  return m ? `+91${m[1]}` : null;
}
