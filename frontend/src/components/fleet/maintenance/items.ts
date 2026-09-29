/** A part replaced or a repair done, before it is saved. */
export interface DraftItem {
  description: string
  kind: 'part' | 'repair'
  quantity: number
  unit_cost: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export const lineTotal = (item: { quantity: number; unit_cost: number }) => round2(item.quantity * item.unit_cost)

/**
 * A record's total: its items plus labour. With no items and no labour it is the total typed in,
 * or null when nothing was entered. The server works it out the same way.
 */
export function recordTotal(items: { quantity: number; unit_cost: number }[], labour: number | null, entered: number | null): number | null {
  if (items.length > 0 || labour != null) return round2(items.reduce((sum, i) => sum + lineTotal(i), 0) + (labour ?? 0))
  return entered
}

/** Empty box means "not set"; anything else must be a non-negative number (undefined when it is not). */
export function moneyOrNull(value: string): number | null | undefined {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
