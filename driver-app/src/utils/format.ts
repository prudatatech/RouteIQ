/**
 * India-locale formatting helpers (en-IN, Asia/Kolkata). Use these instead of
 * bare toLocaleString/toLocaleDateString calls so numbers, currency and
 * dates read the same way across every screen.
 */

const LOCALE = 'en-IN';
const TIME_ZONE = 'Asia/Kolkata';

/** ₹ amount in whole rupees, paise only when non-zero: 125000 -> "₹1,25,000", 99.5 -> "₹99.50". */
export function formatINR(amount: number, options: Intl.NumberFormatOptions = {}): string {
  const hasPaise = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
    ...options,
  }).format(amount);
}

/** Plain number with Indian digit grouping, e.g. formatNumber(125000) -> "1,25,000". */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

/** Date only, in Asia/Kolkata, e.g. "29 Sep 2026". Accepts a Date, ISO string or epoch ms. */
export function formatDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: TIME_ZONE,
    ...options,
  }).format(date);
}

/** Date + time, in Asia/Kolkata, e.g. "29 Sep 2026, 6:30 pm". */
export function formatDateTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIME_ZONE,
    ...options,
  }).format(date);
}

/** Time only, in Asia/Kolkata, e.g. "6:30 pm". */
export function formatTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIME_ZONE,
    ...options,
  }).format(date);
}
