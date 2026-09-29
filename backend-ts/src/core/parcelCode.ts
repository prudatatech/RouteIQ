/**
 * margixindia — Parcel codes
 *
 * The QR code or barcode on a parcel encodes its tracking ID as shown in the
 * console: `RTX-…` for a shipment, `CM-XXXXXXXX` (first 8 characters of the id)
 * for a vendor load. A scanner or a manual entry may add spaces, use lower
 * case, or hand back a tracking link, so the code is normalised first.
 */

/** The code as it should be compared: trimmed, upper case, link prefix removed. */
export function normalizeParcelCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let code = raw.trim();
  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code);
      const last = url.pathname.split('/').filter(Boolean).pop();
      if (last) code = decodeURIComponent(last);
    } catch {
      // Not a URL after all; compare as typed
    }
  }
  return code.replace(/\s+/g, '').toUpperCase();
}

/** The tracking ID printed for a cargo manifest (same rule as ShipmentService). */
export function manifestParcelCode(manifestId: string): string {
  return `CM-${manifestId.substring(0, 8).toUpperCase()}`;
}
