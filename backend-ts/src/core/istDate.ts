/**
 * margixindia — Indian Standard Time (UTC+5:30) day-boundary helpers.
 *
 * The product always reports "today" and date ranges as IST calendar days,
 * regardless of where the server runs, so this is the one place that math
 * lives.
 */

export const IST_OFFSET_MS = 330 * 60 * 1000;

/** Midnight in India `daysAgo` days before today, as an absolute instant. */
export function startOfIndianDay(daysAgo: number): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const midnightUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo);
  return new Date(midnightUtc - IST_OFFSET_MS);
}

/** YYYY-MM-DD of the Indian calendar day that contains `date`. */
export function indianDateKey(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a `YYYY-MM-DD` IST calendar date into the UTC instant of its IST midnight. */
export function indianDayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

/** Parses a `YYYY-MM-DD` IST calendar date into the UTC instant just after that day ends (exclusive). */
export function indianDayEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1) - IST_OFFSET_MS);
}

/**
 * Resolves optional `from`/`to` query params (`YYYY-MM-DD`, IST calendar days)
 * into a `[start, end)` instant range. Falls back to the last `defaultDays`
 * days (inclusive of today) when neither is given. Invalid values are ignored.
 */
export function resolveIndianDateRange(
  from: unknown,
  to: unknown,
  defaultDays: number
): { start: Date; end: Date } {
  const fromStr = typeof from === 'string' && DATE_RE.test(from) ? from : null;
  const toStr = typeof to === 'string' && DATE_RE.test(to) ? to : null;
  const start = fromStr ? indianDayStart(fromStr) : startOfIndianDay(defaultDays - 1);
  const end = toStr ? indianDayEnd(toStr) : startOfIndianDay(-1);
  return { start, end };
}
