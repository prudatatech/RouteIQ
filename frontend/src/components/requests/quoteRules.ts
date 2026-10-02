/** The recommended freight range of a load, or null when the server could not work one out. */
export function freightRange(load: { price_min_inr?: number | null; price_max_inr?: number | null }): { min: number; max: number } | null {
  const min = Number(load.price_min_inr)
  const max = Number(load.price_max_inr)
  return load.price_min_inr != null && load.price_max_inr != null && min > 0 && max >= min ? { min, max } : null
}

/** An amount is fine when it is a positive number inside the range; with no range any positive amount is. */
export function amountInRange(amount: number, range: { min: number; max: number } | null): boolean {
  return amount > 0 && (!range || (amount >= range.min && amount <= range.max))
}

/**
 * A direct booking is for loads where no quote was asked for: at any price in the recommended range, or (an older load
 * with no range) at the vendor's budget.
 */
export function canAcceptDirect(
  load: { status: string; quote_requested: boolean | null | undefined; budget_inr: number | null | undefined; price_min_inr?: number | null; price_max_inr?: number | null },
  won: boolean,
): boolean {
  if (load.status !== 'pending' || won || load.quote_requested !== false) return false
  return freightRange(load) !== null || (!!load.budget_inr && load.budget_inr > 0)
}
