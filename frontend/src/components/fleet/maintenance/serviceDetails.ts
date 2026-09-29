import { moneyOrNull, recordTotal, type DraftItem } from './items'
import type { AttachmentInput } from './types'

/** The details shared by "Log a service" and "Return to service": cost, workshop, parts, files. */
export interface ServiceDetails {
  cost: string
  labour: string
  workshop: string
  invoice: string
  note: string
  items: (DraftItem & { key: string })[]
  attachments: AttachmentInput[]
}

export const emptyDetails = (workshop = ''): ServiceDetails => ({
  cost: '', labour: '', workshop, invoice: '', note: '', items: [], attachments: [],
})

/** The total the form shows: items plus labour when there are any, otherwise the typed total. */
export function detailsTotal(d: ServiceDetails): number | null {
  const labour = moneyOrNull(d.labour)
  return recordTotal(d.items, labour === undefined ? null : labour, moneyOrNull(d.cost) ?? null)
}

/** The request body for the details, or the message to show when a number is wrong. */
export function detailsPayload(d: ServiceDetails): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const cost = moneyOrNull(d.cost)
  const labour = moneyOrNull(d.labour)
  if (cost === undefined) return { ok: false, error: 'Enter the total cost as a number, in rupees.' }
  if (labour === undefined) return { ok: false, error: 'Enter the labour cost as a number, in rupees.' }
  return {
    ok: true,
    body: {
      cost: d.items.length > 0 || labour != null ? null : cost,
      labour_cost: labour,
      workshop: d.workshop.trim() || null,
      invoice_number: d.invoice.trim() || null,
      note: d.note.trim() || null,
      items: d.items.map(({ description, kind, quantity, unit_cost }) => ({ description, kind, quantity, unit_cost })),
      attachments: d.attachments,
    },
  }
}
