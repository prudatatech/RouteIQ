/** "67%", or a dash before the partner has answered any offer. */
export function formatPercent(rate: number | null | undefined): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`
}

/** "4.5 out of 5", or a dash before the first rating. */
export function formatRating(avg: number | null | undefined): string {
  return avg == null ? '—' : `${avg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} out of 5`
}
