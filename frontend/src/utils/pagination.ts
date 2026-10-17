/**
 * The "Showing X-Y of total" footer and Previous/Next state shared by every list that pages server-side
 * with `{ items, total, limit, offset }` (GET /admin/orgs, GET /finance/invoices, GET /finance/expenses, ...).
 */
export function pageRange(total: number, limit: number, offset: number): { from: number; to: number; hasPrev: boolean; hasNext: boolean } {
  if (total <= 0) return { from: 0, to: 0, hasPrev: false, hasNext: false }
  const from = offset + 1
  const to = Math.min(offset + limit, total)
  return { from, to, hasPrev: offset > 0, hasNext: offset + limit < total }
}
