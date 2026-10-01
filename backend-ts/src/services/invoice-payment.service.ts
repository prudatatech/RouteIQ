/**
 * margixindia — Recording that an invoice was paid.
 *
 * One path for every way money is recorded: staff marking an invoice paid (`PUT /finance/invoices/:id/pay`)
 * and staff confirming a payment a customer reported (invoice-reports.service.ts). An invoice has no part
 * payments: it is issued, then paid in full, so `paid` is set once and a second attempt is a 409.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { indianDateKey, indianDayStart } from '../core/istDate';
import { auditService } from './audit.service';
import { announceInvoice } from './invoice.service';
import type { TokenData } from '../core/auth';

export const PAYMENT_METHODS = ['bank', 'upi', 'cash', 'cheque'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

export interface PaymentFields { method: PaymentMethod; reference: string | null; paidAt: string }

/** Reads and checks what staff record when money arrives: method, an optional reference, the date received. */
export function parsePayment(body: any, issuedAt: string | null): PaymentFields {
  const method = body?.method;
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) throw new HttpError(400, 'Choose how it was paid: bank, UPI, cash or cheque');
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
  if (reference.length > 100) throw new HttpError(400, 'The reference can be at most 100 characters');
  const today = indianDateKey(new Date());
  const paidOn = body?.paid_on === undefined || body?.paid_on === '' ? today : body.paid_on;
  if (!validDate(paidOn)) throw new HttpError(400, 'Enter the date the money was received');
  if (paidOn > today) throw new HttpError(400, 'The payment date cannot be in the future');
  if (issuedAt && paidOn < indianDateKey(new Date(issuedAt))) throw new HttpError(400, 'The payment date cannot be before the invoice date');
  return { method, reference: reference || null, paidAt: paidOn === today ? new Date().toISOString() : indianDayStart(paidOn).toISOString() };
}

/**
 * Marks an issued invoice paid, audits it and (unless `announce` is false) tells the customer or vendor.
 * 404 when there is no such invoice, 409 when it is already paid or void.
 */
export async function markInvoicePaid(invoiceId: string, payment: PaymentFields, user: TokenData, opts: { announce?: boolean; via?: string } = {}) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: payment.paidAt, payment_method: payment.method, payment_reference: payment.reference, updated_at: now })
    .eq('id', invoiceId)
    .eq('status', 'issued')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to update invoice: ${error.message}`);
  if (!data) {
    const { data: existing } = await supabase.from('invoices').select('status').eq('id', invoiceId).maybeSingle();
    if (!existing) throw new HttpError(404, 'Invoice not found');
    throw new HttpError(409, `Invoice is already ${existing.status}`);
  }
  if (opts.announce !== false) await announceInvoice(data.id, 'paid');
  await auditService.record('staff-console', user, 'invoice_paid', {
    invoice_id: data.id, invoice_number: data.invoice_number ?? null, total: data.total ?? null,
    method: data.payment_method, reference: data.payment_reference, ...(opts.via ? { via: opts.via } : {}),
  });
  return data;
}
