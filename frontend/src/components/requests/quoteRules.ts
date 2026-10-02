/** A direct accept at the vendor's budget is only for loads where no quote was asked for. */
export function canAcceptDirect(load: { status: string; quote_requested: boolean | null | undefined; budget_inr: number | null | undefined }, won: boolean): boolean {
  return load.status === 'pending' && !won && load.quote_requested === false && !!load.budget_inr && load.budget_inr > 0
}
