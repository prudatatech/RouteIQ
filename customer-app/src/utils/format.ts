/**
 * India formatting helpers. Numbers and rupees use Indian grouping (en-IN,
 * 1,25,000) in every language; dates are in India time and use the chosen
 * language's month and weekday names. Use these instead of bare
 * toLocaleString/toLocaleDateString calls so everything reads the same way
 * across every screen.
 */

import { translateNow } from '../locales';

const LOCALE = 'en-IN';
const TIME_ZONE = 'Asia/Kolkata';

/** ₹ amount in whole rupees, with paise only when there are some: 125000 -> "₹1,25,000", 1250.5 -> "₹1,250.50". */
export function formatINR(amount: number, options: Intl.NumberFormatOptions = {}): string {
  const paise = Math.round(Math.abs(amount) * 100) % 100 !== 0;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: paise ? 2 : 0,
    ...options,
  }).format(amount);
}

/** Plain number with Indian digit grouping, e.g. formatNumber(125000) -> "1,25,000". */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

/** India has no daylight saving, so IST is always UTC+5:30. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The wall-clock parts of an instant in India. */
function istParts(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    day: ist.getUTCDate(),
    month: ist.getUTCMonth() + 1,
    year: ist.getUTCFullYear(),
    weekday: ist.getUTCDay(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

/**
 * Month and weekday names come from the language files instead of Intl, so
 * they are the same on every phone (Hermes uses whatever locale data the
 * device ships) and digits always stay 0-9.
 */

/** Date only, in India time and the chosen language, e.g. "29 Sep 2026" or "29 सित॰ 2026". Accepts a Date, ISO string or epoch ms. */
export function formatDate(value: Date | string | number, options: { weekday?: boolean } = {}): string {
  const p = istParts(value);
  const text = `${p.day} ${translateNow(`month_short_${p.month}`)} ${p.year}`;
  return options.weekday ? `${translateNow(`weekday_short_${p.weekday}`)}, ${text}` : text;
}

/** Date + time, in India time and the chosen language, e.g. "29 Sep 2026, 6:30 pm". */
export function formatDateTime(value: Date | string | number): string {
  const p = istParts(value);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const time = `${hour12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'am' : 'pm'}`;
  return `${formatDate(value)}, ${time}`;
}

/** The India calendar day `daysFromToday` days from now, as YYYY-MM-DD (the format the API uses). */
export function dayKey(daysFromToday = 0): string {
  const date = new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIME_ZONE }).format(date);
}

/** A YYYY-MM-DD day for people, e.g. "Wed, 30 Sep 2026", in the chosen language. */
export function formatDay(day: string): string {
  return formatDate(`${day}T12:00:00+05:30`, { weekday: true });
}
