/**
 * margixindia — A customer reports a payment or queries an invoice (ROL-19).
 *
 * Payments are made offline and staff mark an invoice paid when the money arrives. A customer who has
 * paid says so here (amount, date, method and reference such as the UTR or cheque number), or asks a
 * question about an invoice. Staff see every open report and act on it:
 *   - confirm a payment: recorded through the same path as "Mark paid" (invoice-payment.service.ts), once;
 *   - reject a payment, with a reason the customer is shown;
 *   - answer a query.
 * A report never changes an invoice by itself. Staff and the customer are told through the
 * notification service (types in docs/notifications.md).
 *
 * Invoices have no part payments, so a report can only say the invoice was paid in full or less than
 * what is outstanding; confirming a smaller amount is refused (the staff member rejects it, with the reason).
 */
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { OWNED, isScoped, scopeQuery } from '../core/org-scope';
import { HttpError } from '../core/errors';
import { consumeRateLimit } from '../core/rate-limit';
import { indianDateKey } from '../core/istDate';
import { formatINR } from '../core/format';
import { customerDisplayName } from '../core/customer-name';
import type { TokenData } from '../core/auth';
import { INVOICE_COLUMNS, invoiceOwnerId, type InvoiceRecord } from './invoice-detail.service';
import { markInvoicePaid, parsePayment } from './invoice-payment.service';
import { notificationService } from './notification.service';
import { selectIn } from './finance.service';

export const REPORT_METHODS = ['upi', 'neft', 'rtgs', 'imps', 'cheque', 'cash', 'other'] as const;
export const REPORT_COLUMNS = 'id, invoice_id, customer_id, kind, amount, paid_on, method, reference, message, attachment_path, status, staff_note, handled_by, handled_at, created_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unprocessable = { status: 422 };
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date you paid').refine(d => !Number.isNaN(Date.parse(d)) && new Date(Date.parse(d)).toISOString().slice(0, 10) === d, 'Enter a valid date');

const PaymentReportSchema = z.object({
  kind: z.literal('payment'),
  amount: z.number({ invalid_type_error: 'Enter the amount you paid' }).positive('Enter the amount you paid').max(99_999_999.99, 'That amount is too large')
    .refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'The amount can have at most 2 decimals'),
  paid_on: DATE,
  method: z.enum(REPORT_METHODS, { errorMap: () => ({ message: 'Choose how you paid' }) }),
  reference: z.string().trim().max(100, 'The reference can be at most 100 characters').optional().nullable(),
});
const QueryReportSchema = z.object({
  kind: z.literal('query'),
  message: z.string().trim().min(3, 'Write your question').max(1000, 'Your message can be at most 1000 characters'),
});
export const ReportSchema = z.discriminatedUnion('kind', [PaymentReportSchema, QueryReportSchema], { errorMap: () => ({ message: 'Say whether you paid or have a question' }) }).superRefine((r, ctx) => {
  if (r.kind === 'payment' && r.method !== 'cash' && r.method !== 'other' && !r.reference) {
    ctx.addIssue({ code: 'custom', path: ['reference'], message: r.method === 'cheque' ? 'Enter the cheque number' : 'Enter the UTR or transaction reference' });
  }
});

export interface InvoiceReport {
  id: string; invoice_id: string; customer_id: string; kind: 'payment' | 'query';
  amount: number | null; paid_on: string | null; method: string | null; reference: string | null; message: string | null;
  attachment_path: string | null; status: 'open' | 'confirmed' | 'rejected' | 'answered';
  staff_note: string | null; handled_by: string | null; handled_at: string | null; created_at: string;
}

const shape = (r: any): InvoiceReport => ({ ...r, amount: r.amount != null ? Number(r.amount) : null });

async function loadInvoice(id: string): Promise<InvoiceRecord> {
  if (!UUID.test(id)) throw new HttpError(404, 'Invoice not found');
  const { data, error } = await scopeQuery(supabase.from('invoices').select(INVOICE_COLUMNS).eq('id', id), OWNED.invoice).maybeSingle();
  if (error) throw new Error(`Failed to read invoice: ${error.message}`);
  if (!data) throw new HttpError(404, 'Invoice not found');
  return data as unknown as InvoiceRecord;
}

/** The invoice if it is the customer's own and a customer invoice; anyone else's is the same 404 as a missing one. */
async function ownInvoice(customerId: string, invoiceId: string): Promise<InvoiceRecord> {
  const inv = await loadInvoice(invoiceId);
  if (inv.vendor_id || (await invoiceOwnerId(inv)) !== customerId) throw new HttpError(404, 'Invoice not found');
  return inv;
}

const label = (inv: Pick<InvoiceRecord, 'invoice_number'>) => inv.invoice_number ?? 'the invoice';
const totalOf = (inv: Pick<InvoiceRecord, 'total' | 'amount'>) => Number(inv.total ?? inv.amount ?? 0);

// ── The customer ───────────────────────────────────────────

export async function createReport(customerId: string, invoiceId: string, body: unknown): Promise<InvoiceReport> {
  const parsed = ReportSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0].message);
  const input = parsed.data;
  const inv = await ownInvoice(customerId, invoiceId);
  if (inv.status === 'void') throw new HttpError(409, 'This invoice has been cancelled, so there is nothing to report on it');

  if (input.kind === 'payment') {
    if (inv.status === 'paid') throw new HttpError(409, 'This invoice is already marked as paid');
    const outstanding = totalOf(inv);
    if (input.amount > outstanding + 0.001) {
      throw new HttpError(422, `The amount is more than what is due on this invoice (${formatINR(outstanding)})`);
    }
    if (input.paid_on > indianDateKey(new Date())) throw new HttpError(422, 'The payment date cannot be in the future');
    if (inv.issued_at && input.paid_on < indianDateKey(new Date(inv.issued_at))) throw new HttpError(422, 'The payment date cannot be before the invoice date');
    const reference = input.reference || null;
    const { data: open } = await supabase.from('invoice_payment_reports').select('id, reference').eq('invoice_id', inv.id).eq('kind', 'payment').eq('status', 'open');
    if ((open ?? []).some((r: any) => (r.reference ?? null) === reference && reference !== null)) {
      throw new HttpError(409, 'You have already reported this payment. We will confirm it soon');
    }
  }
  if (!(await consumeRateLimit(`invoice-report:user:${customerId}`, 20, 60 * 60))) {
    throw new HttpError(429, 'You have sent many reports. Please try again in a while.');
  }

  const row = input.kind === 'payment'
    ? { kind: 'payment', amount: input.amount, paid_on: input.paid_on, method: input.method, reference: input.reference || null }
    : { kind: 'query', message: input.message };
  const { data, error } = await supabase
    .from('invoice_payment_reports').insert({ invoice_id: inv.id, customer_id: customerId, status: 'open', ...row }).select(REPORT_COLUMNS).single();
  if (error || !data) throw new Error(`Failed to save the report: ${error?.message}`);

  await tellStaff(shape(data), inv, customerId);
  return shape(data);
}

async function tellStaff(report: InvoiceReport, inv: InvoiceRecord, customerId: string): Promise<void> {
  try {
    const { data: customer } = await supabase.from('customers').select('full_name, company_name, phone').eq('id', customerId).maybeSingle();
    const who = customerDisplayName(customer);
    const ids = { invoice_id: inv.id, report_id: report.id, invoice_number: inv.invoice_number ?? null };
    if (report.kind === 'payment') {
      await notificationService.notifyStaff(
        'Customer reported a payment',
        `${who} says they paid ${formatINR(report.amount)} for ${label(inv)}${report.reference ? ` (${report.reference})` : ''}. Check it and confirm.`,
        'invoice_payment_reported', ids);
    } else {
      await notificationService.notifyStaff('Customer has a question about an invoice', `${who} asked about ${label(inv)}: ${report.message}`, 'invoice_query', ids);
    }
  } catch (e) {
    console.error('[invoice-report] could not notify staff:', e);
  }
}

/** The customer's own reports, newest first; all of them, or those on one invoice. */
export async function listCustomerReports(customerId: string, invoiceId?: string): Promise<InvoiceReport[]> {
  if (invoiceId) await ownInvoice(customerId, invoiceId);
  let q = supabase.from('invoice_payment_reports').select(REPORT_COLUMNS).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(200);
  if (invoiceId) q = q.eq('invoice_id', invoiceId);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list reports: ${error.message}`);
  return (data ?? []).map(shape);
}

// ── Staff ──────────────────────────────────────────────────

/** The reports a company may see are those on its own invoices: the report has no owner column of its own. */
async function visibleInvoiceIds(ids: string[]): Promise<Set<string>> {
  const rows = await selectIn<{ id: string }>('invoices', 'id', ids, 'id', q => scopeQuery(q, OWNED.invoice));
  return new Set(rows.map(r => r.id));
}

/** Open reports waiting for staff: how many, and how many are payments. */
export async function openReportCounts(): Promise<{ open: number; payments: number; queries: number }> {
  if (isScoped(OWNED.invoice)) {
    const { data, error } = await supabase.from('invoice_payment_reports').select('invoice_id, kind').eq('status', 'open');
    if (error) throw new Error(`Failed to count reports: ${error.message}`);
    const mine = await visibleInvoiceIds((data ?? []).map((r: any) => r.invoice_id));
    const own = (data ?? []).filter((r: any) => mine.has(r.invoice_id));
    const payments = own.filter((r: any) => r.kind === 'payment').length;
    const queries = own.filter((r: any) => r.kind === 'query').length;
    return { open: payments + queries, payments, queries };
  }
  const count = async (kind?: string) => {
    let q = supabase.from('invoice_payment_reports').select('id', { count: 'exact', head: true }).eq('status', 'open');
    if (kind) q = q.eq('kind', kind);
    const { count: n, error } = await q;
    if (error) throw new Error(`Failed to count reports: ${error.message}`);
    return n ?? 0;
  };
  const [payments, queries] = await Promise.all([count('payment'), count('query')]);
  return { open: payments + queries, payments, queries };
}

/** Reports for staff, each with its invoice and who reported it. Oldest open first when listing the open ones. */
export async function listReports(filter: { status?: string; kind?: string; invoiceId?: string } = {}) {
  let q = supabase.from('invoice_payment_reports').select(REPORT_COLUMNS).limit(500);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.kind) q = q.eq('kind', filter.kind);
  if (filter.invoiceId) q = q.eq('invoice_id', filter.invoiceId);
  q = q.order('created_at', { ascending: filter.status === 'open' });
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list reports: ${error.message}`);
  let rows = (data ?? []).map(shape);
  if (isScoped(OWNED.invoice)) {
    const mine = await visibleInvoiceIds(rows.map(r => r.invoice_id));
    rows = rows.filter(r => mine.has(r.invoice_id));
  }
  const [invoices, customers] = await Promise.all([
    selectIn<any>('invoices', 'id', rows.map(r => r.invoice_id), 'id, invoice_number, total, amount, status'),
    selectIn<any>('customers', 'id', rows.map(r => r.customer_id), 'id, full_name, company_name, phone'),
  ]);
  const inv = new Map(invoices.map(i => [i.id, i]));
  const cust = new Map(customers.map(c => [c.id, c]));
  return rows.map(r => ({
    ...r,
    invoice_number: inv.get(r.invoice_id)?.invoice_number ?? null,
    invoice_total: inv.get(r.invoice_id)?.total != null ? Number(inv.get(r.invoice_id).total) : null,
    invoice_status: inv.get(r.invoice_id)?.status ?? null,
    customer_name: customerDisplayName(cust.get(r.customer_id)),
    customer_phone: cust.get(r.customer_id)?.phone ?? null,
  }));
}

async function loadReport(id: string): Promise<InvoiceReport> {
  if (!UUID.test(id)) throw new HttpError(404, 'Report not found');
  const { data, error } = await supabase.from('invoice_payment_reports').select(REPORT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read report: ${error.message}`);
  if (!data) throw new HttpError(404, 'Report not found');
  // A report on another company's invoice is the same 404 as a missing one
  if (isScoped(OWNED.invoice) && !(await visibleInvoiceIds([data.invoice_id])).size) throw new HttpError(404, 'Report not found');
  return shape(data);
}

const note = (v: unknown, what: string, min: number, required: boolean): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && !required) return null;
  if (s.length < min) throw new HttpError(400, `Write ${what}`);
  if (s.length > 1000) throw new HttpError(400, `${what[0].toUpperCase()}${what.slice(1)} can be at most 1000 characters`);
  return s;
};

/** Marks the report handled, only while it is still open. Returns null when someone else handled it first. */
async function settle(report: InvoiceReport, status: InvoiceReport['status'], user: TokenData, staffNote: string | null): Promise<InvoiceReport | null> {
  const { data, error } = await supabase
    .from('invoice_payment_reports')
    .update({ status, staff_note: staffNote, handled_by: user.user_id, handled_at: new Date().toISOString() })
    .eq('id', report.id).eq('status', 'open').select(REPORT_COLUMNS).maybeSingle();
  if (error) throw new Error(`Failed to update report: ${error.message}`);
  return data ? shape(data) : null;
}

async function tellCustomer(report: InvoiceReport, inv: Pick<InvoiceRecord, 'id' | 'invoice_number'>, title: string, body: string, type: string): Promise<void> {
  try {
    await notificationService.sendNotificationOnce(
      report.customer_id, title, body, type, { invoice_id: inv.id, report_id: report.id, invoice_number: inv.invoice_number ?? null }, 'report_id', 24 * 365);
  } catch (e) {
    console.error(`[invoice-report] could not notify the customer (${type}):`, e);
  }
}

/**
 * Confirms a reported payment: the invoice is marked paid through the same path as "Mark paid", with the
 * customer's method, reference and date (staff may correct them). Safe to repeat: a report already confirmed
 * is returned as it is and nothing is recorded twice. An invoice that was already marked paid (by staff, after
 * the customer reported) only has its report confirmed.
 */
export async function confirmReport(reportId: string, user: TokenData, body: any = {}): Promise<{ report: InvoiceReport; recorded: boolean }> {
  const report = await loadReport(reportId);
  if (report.kind !== 'payment') throw new HttpError(409, 'This is a question, not a payment. Answer it instead');
  if (report.status === 'confirmed') return { report, recorded: false };
  if (report.status !== 'open') throw new HttpError(409, `This report was already ${report.status}`);

  const inv = await loadInvoice(report.invoice_id);
  const staffNote = note(body?.note, 'a note', 1, false);
  if (inv.status === 'void') throw new HttpError(409, 'This invoice has been cancelled, so a payment cannot be recorded on it');

  let recorded = false;
  if (inv.status === 'issued') {
    if ((report.amount ?? 0) + 0.001 < totalOf(inv)) {
      throw new HttpError(409, `The customer reported ${formatINR(report.amount)} of ${formatINR(totalOf(inv))}. Part payments cannot be recorded yet: reject this report, or record the payment when the full amount has arrived`);
    }
    // The customer's method decides it, unless staff pick one (a transfer is "bank"; "other" needs a choice)
    const fallback = report.method === 'upi' ? 'upi' : report.method === 'cash' ? 'cash' : report.method === 'cheque' ? 'cheque' : report.method === 'other' ? undefined : 'bank';
    const payment = parsePayment({
      method: body?.method ?? fallback,
      reference: body?.reference ?? report.reference ?? '',
      paid_on: body?.paid_on ?? report.paid_on,
    }, inv.issued_at);
    try {
      await markInvoicePaid(inv.id, payment, user, { announce: false, via: 'customer report' });
      recorded = true;
    } catch (e) {
      // A second confirm racing this one: the first has recorded it and settles the report
      if (!(e instanceof HttpError) || e.status !== 409) throw e;
      const again = await loadReport(reportId);
      if (again.status === 'confirmed') return { report: again, recorded: false };
    }
  }

  const settled = await settle(report, 'confirmed', user, staffNote);
  if (!settled) return { report: await loadReport(reportId), recorded };
  await tellCustomer(
    settled, inv, `Payment confirmed for ${label(inv)}`,
    `We received your payment${settled.amount != null ? ` of ${formatINR(settled.amount)}` : ''} for ${label(inv)}. Thank you.`,
    'payment_report_confirmed');
  return { report: settled, recorded };
}

/** Rejects a reported payment with a reason the customer is shown. */
export async function rejectReport(reportId: string, user: TokenData, body: any): Promise<InvoiceReport> {
  const report = await loadReport(reportId);
  if (report.kind !== 'payment') throw new HttpError(409, 'This is a question, not a payment. Answer it instead');
  if (report.status === 'rejected') return report;
  if (report.status !== 'open') throw new HttpError(409, `This report was already ${report.status}`);
  const reason = note(body?.reason, 'why the payment is rejected', 3, true)!;
  const settled = await settle(report, 'rejected', user, reason);
  if (!settled) return loadReport(reportId);
  const inv = await loadInvoice(settled.invoice_id);
  await tellCustomer(settled, inv, `Payment not confirmed for ${label(inv)}`, `We could not confirm your payment for ${label(inv)}: ${reason}`, 'payment_report_rejected');
  return settled;
}

/** Answers a customer's question about an invoice. */
export async function answerReport(reportId: string, user: TokenData, body: any): Promise<InvoiceReport> {
  const report = await loadReport(reportId);
  if (report.kind !== 'query') throw new HttpError(409, 'This is a payment, not a question. Confirm or reject it instead');
  if (report.status === 'answered') return report;
  if (report.status !== 'open') throw new HttpError(409, `This report was already ${report.status}`);
  const answer = note(body?.answer, 'your answer', 1, true)!;
  const settled = await settle(report, 'answered', user, answer);
  if (!settled) return loadReport(reportId);
  const inv = await loadInvoice(settled.invoice_id);
  await tellCustomer(settled, inv, `Answer about ${label(inv)}`, answer, 'invoice_query_answered');
  return settled;
}
