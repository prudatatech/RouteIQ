import type { Invoice } from '../services/api';

/** How an invoice reads to the customer: paid, still to pay, or past its due date. */
export type InvoiceState = 'paid' | 'unpaid' | 'overdue';

export const invoiceState = (invoice: Pick<Invoice, 'status' | 'overdue'>): InvoiceState =>
  invoice.status === 'paid' ? 'paid' : invoice.overdue ? 'overdue' : 'unpaid';

export const INVOICE_TONE = { paid: 'success', unpaid: 'warning', overdue: 'danger' } as const;

/**
 * The invoice of a booking that still needs paying, for the bookings list: the overdue one first,
 * then the one due soonest. A split booking can have one invoice per lot.
 */
export function unpaidInvoiceFor(invoices: Invoice[], bookingId: string): { dueDate: string | null; overdue: boolean } | null {
  const open = invoices.filter((i) => i.booking_id === bookingId && i.status === 'issued');
  if (open.length === 0) return null;
  const first = [...open].sort((a, b) => Number(b.overdue) - Number(a.overdue) || String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')))[0];
  return { dueDate: first.due_date, overdue: first.overdue };
}

/** The invoices of one booking, newest first. */
export const invoicesOfBooking = (invoices: Invoice[], bookingId: string): Invoice[] =>
  invoices.filter((i) => i.booking_id === bookingId).sort((a, b) => String(b.issued_at ?? '').localeCompare(String(a.issued_at ?? '')));
