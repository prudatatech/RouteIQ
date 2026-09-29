import tokens from '@/theme/tokens.json'

export const chartColors = tokens.color

/** Series colours in fixed order, with the matching class for legend dots. Both pass contrast and colour-blind checks on white. */
export const seriesPalette = [
  { color: tokens.color.accent, dotClass: 'bg-brand' },
  { color: tokens.color.info, dotClass: 'bg-info' },
] as const

export const formatNumber = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-IN'))
export const formatRupees = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`)
export const formatPercent = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`)

/** Short axis numbers in the Indian system: 1,200 → 1.2K, 3,50,000 → 3.5L, 2,00,00,000 → 2Cr. */
export function formatCompact(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`
  if (abs >= 1e5) return `${+(n / 1e5).toFixed(1)}L`
  if (abs >= 1e3) return `${+(n / 1e3).toFixed(1)}K`
  return n.toLocaleString('en-IN')
}

/** "2026-09-29" → "29 Sep". */
export function formatDay(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`)
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function formatTime(value: string | number | Date) {
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(value: string | number | Date) {
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
