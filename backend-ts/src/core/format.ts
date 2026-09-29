/**
 * margixindia — Text formatting for notifications, emails and public pages.
 *
 * Money is shown the Indian way (₹1,25,000), dates and times in India Standard
 * Time with en-IN wording, so a message reads the same wherever the server runs.
 */

/** ₹1,25,000 — whole rupees, with paise only when the amount has them (₹499.50). Non-numbers give "". */
export function formatINR(amount: number | string | null | undefined): string {
  if (amount == null || amount === '') return '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const paise = Math.round(Math.abs(n) * 100) % 100;
  const text = Math.abs(n).toLocaleString('en-IN', {
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: paise ? 2 : 0,
  });
  return `${n < 0 ? '-' : ''}₹${text}`;
}

/** "500 kg" — weight with the digits grouped the Indian way. */
export function formatKg(kg: number | string | null | undefined): string {
  const n = Number(kg);
  return Number.isFinite(n) ? `${n.toLocaleString('en-IN')} kg` : '';
}

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "29 Sep 2026" in IST. */
export function formatISTDate(value: Date | string | number): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** "29 Sep 2026, 3:45 pm" in IST. */
export function formatISTDateTime(value: Date | string | number): string {
  const d = toDate(value);
  return d
    ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    : '';
}
