/** "67%", or a dash before the partner has answered any offer. */
export function formatPercent(rate: number | null | undefined): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`
}

/** "12 min" or "1.5 h". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`
  return `${(minutes / 60).toLocaleString('en-IN', { maximumFractionDigits: 1 })} h`
}

/** "4.5 out of 5", or a dash before the first rating. */
export function formatRating(avg: number | null | undefined): string {
  return avg == null ? '—' : `${avg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} out of 5`
}
