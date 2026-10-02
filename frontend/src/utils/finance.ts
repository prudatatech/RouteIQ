import type { CsvColumn } from '@/utils/csv'

export const EXPENSE_CATEGORIES = [
  { value: 'fuel', label: 'Fuel' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'toll', label: 'Tolls' },
  { value: 'driver', label: 'Driver pay' },
  { value: 'other', label: 'Other' },
] as const

export const categoryLabel = (value: string) => EXPENSE_CATEGORIES.find(c => c.value === value)?.label ?? value

export interface Expense {
  id: string
  vehicle_id: string | null
  route_id: string | null
  plate_number: string | null
  category: string
  amount: number
  expense_date: string
  litres: number | null
  note: string | null
  receipt_path: string | null
}

export interface Invoice {
  id: string
  invoice_number: string
  reference: string | null
  vendor_name?: string | null
  amount: number
  gst_rate: number
  gst_amount: number
  total: number
  status: string
  issued_at: string
  paid_at: string | null
  /** From the staff list only. */
  due_date?: string | null
  overdue?: boolean
  days_overdue?: number
  requester_type?: 'vendor' | 'customer' | 'staff'
  requester_name?: string | null
  /** The party the invoice is billed to (stored on the invoice, or looked up from the delivery for older ones). */
  billed_to_name?: string | null
  payment_method?: string | null
  /** Customer reports (payments or questions) still waiting on staff. */
  open_reports?: number
}

/** What the server says when an invoice is refused for want of seller details (409). */
export const INVOICE_PROFILE_MESSAGE = 'Set your company name, GSTIN and state in Settings before issuing invoices'

/**
 * What is missing from the company details before any invoice can be issued: a name, a GSTIN and a state
 * (a GSTIN names its state). The server enforces it; this lets the page say so before a click is wasted.
 */
export function invoiceBlockers(c: Pick<CompanyProfile, 'legal_name' | 'gstin' | 'state'> | null | undefined): string[] {
  if (!c) return []
  const missing: string[] = []
  if (!c.legal_name?.trim()) missing.push('company name')
  if (!c.gstin?.trim()) missing.push('GSTIN')
  if (!c.state?.trim() && !/^\d{2}/.test(c.gstin?.trim() ?? '')) missing.push('state')
  return missing
}

/** True when an API error is the refusal to issue an invoice until the company details are set. */
export function isCompanyProfileError(err: unknown): boolean {
  return (err as { response?: { status?: number; data?: { code?: unknown } } } | null)?.response?.data?.code === 'company_profile_incomplete'
}

export const PAYMENT_METHODS = [
  { value: 'bank', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
] as const

export const paymentMethodLabel = (value: string | null | undefined) => PAYMENT_METHODS.find(m => m.value === value)?.label ?? value ?? ''

/** What is outstanding and what came in this month (GET /finance/invoices/summary). */
export interface InvoiceSummary {
  outstanding: number
  outstanding_count: number
  overdue: number
  overdue_count: number
  collected_this_month: number
  collected_count: number
  month: string
  /** Customer reports waiting on staff: all, payments, and questions. */
  open_reports?: number
  open_payment_reports?: number
  open_query_reports?: number
}

export interface CompanyProfile {
  legal_name: string | null
  gstin: string | null
  pan: string | null
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  phone: string | null
  email: string | null
  sac_code: string | null
  bank_name: string | null
  bank_account_no: string | null
  bank_ifsc: string | null
  upi_id: string | null
  payment_terms_days: number
  invoice_footer: string | null
  /** Letters invoice numbers start with, e.g. MIL for MIL-202610-0001. Unique per company; null until set or until the first invoice. */
  invoice_prefix: string | null
  /** How GST on freight is charged on new invoices. Reverse charge 5% (no GST on the invoice) unless the company chooses otherwise. */
  gta_gst_option: GtaGstOption
}

export type GtaGstOption = 'rcm_5' | 'fcm_5' | 'fcm_18'

/** The three ways to charge GST on freight, in the words the Settings page uses. */
export const GTA_GST_OPTIONS: { value: GtaGstOption; label: string }[] = [
  { value: 'rcm_5', label: 'Customer pays 5% themselves (reverse charge). The invoice shows no GST.' },
  { value: 'fcm_5', label: 'We charge 5% on the invoice, without input tax credit.' },
  { value: 'fcm_18', label: 'We charge 18% on the invoice, with input tax credit.' },
]

/** One invoice as its page shows it (GET /invoices/:id). */
export interface InvoiceDetail {
  id: string
  invoice_number: string | null
  status: 'issued' | 'paid' | 'void'
  overdue: boolean
  days_overdue: number
  issued_at: string | null
  due_date: string | null
  paid_at: string | null
  voided_at: string | null
  payment_method: string | null
  payment_reference: string | null
  void_reason: string | null
  amount: number
  gst_rate: number
  gst_amount: number
  total: number
  payment_terms_days: number
  seller: CompanyProfile & { state_code: string | null; state_name: string | null }
  seller_gaps: string[]
  buyer: {
    kind: 'vendor' | 'customer' | 'consignee' | 'unknown'
    id: string | null
    name: string | null
    gstin: string | null
    address: string | null
    phone: string | null
    email: string | null
    state_code: string | null
    state: string | null
  }
  lines: { description: string; sac_code: string | null; quantity: number; unit_price: number; amount: number }[]
  goods: { hsn_code: string | null; description: string | null; gst_rate: number | null }[]
  tax: { basis: 'intra' | 'inter' | 'unknown' | 'none'; rate: number; cgst: number; sgst: number; igst: number; total: number; note: string | null }
  total_in_words: string
  /** The MRX load number, when the invoice is for a vendor load that has one. */
  load_number?: string | null
  /** Set when no GST is charged because the recipient pays it under reverse charge. */
  reverse_charge?: { applies: boolean; rate: number; note: string | null }
  links: {
    shipment: { id: string; code: string } | null
    manifest_id: string | null
    request_id: string | null
    requester: { kind: string; id: string | null; name: string | null } | null
    trip: { id: string; status: string } | null
  }
}

export const EXPENSE_CSV_COLUMNS: CsvColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'category', header: 'Category' },
  { key: 'vehicle', header: 'Vehicle' },
  { key: 'amount', header: 'Amount (INR)' },
  { key: 'litres', header: 'Litres' },
  { key: 'note', header: 'Note' },
  { key: 'receipt', header: 'Receipt' },
]

export function expenseCsvRows(expenses: Expense[]) {
  return expenses.map(e => ({
    date: e.expense_date,
    category: categoryLabel(e.category),
    vehicle: e.plate_number ?? '',
    amount: e.amount,
    litres: e.litres,
    note: e.note ?? '',
    receipt: e.receipt_path ? 'Yes' : 'No',
  }))
}

export const INVOICE_CSV_COLUMNS: CsvColumn[] = [
  { key: 'number', header: 'Invoice' },
  { key: 'issued', header: 'Issued' },
  { key: 'reference', header: 'Delivery' },
  { key: 'vendor', header: 'Vendor' },
  { key: 'amount', header: 'Amount (INR)' },
  { key: 'gst', header: 'GST (INR)' },
  { key: 'total', header: 'Total (INR)' },
  { key: 'status', header: 'Status' },
  { key: 'paid', header: 'Paid on' },
]

export function invoiceCsvRows(invoices: Invoice[]) {
  return invoices.map(i => ({
    number: i.invoice_number,
    issued: i.issued_at.slice(0, 10),
    reference: i.reference ?? '',
    vendor: i.vendor_name ?? '',
    amount: i.amount,
    gst: i.gst_amount,
    total: i.total,
    status: i.status,
    paid: i.paid_at ? i.paid_at.slice(0, 10) : '',
  }))
}


export type InvoiceReportKind = 'payment' | 'query'
export type InvoiceReportStatus = 'open' | 'confirmed' | 'rejected' | 'answered'

/** A customer's report on an invoice (GET /finance/invoice-reports): money they say they paid, or a question. */
export interface InvoiceReport {
  id: string
  invoice_id: string
  customer_id: string
  kind: InvoiceReportKind
  amount: number | null
  paid_on: string | null
  /** As the customer chose it: upi, neft, rtgs, imps, cheque, cash or other. */
  method: string | null
  reference: string | null
  message: string | null
  status: InvoiceReportStatus
  staff_note: string | null
  handled_by: string | null
  handled_at: string | null
  created_at: string
  invoice_number: string | null
  invoice_total: number | null
  invoice_status: string | null
  customer_name: string | null
  customer_phone: string | null
}

const CUSTOMER_METHOD_LABELS: Record<string, string> = {
  upi: 'UPI', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', cheque: 'Cheque', cash: 'Cash', other: 'Other', bank: 'Bank transfer',
}

/** The way a customer said they paid, in words. */
export const reportMethodLabel = (method: string | null | undefined) => (method ? (CUSTOMER_METHOD_LABELS[method] ?? method) : '')

/** The recorded method that matches what the customer said (NEFT, RTGS and IMPS are bank transfers); "other" has none and must be chosen. */
export function recordedMethodFor(method: string | null | undefined): 'bank' | 'upi' | 'cash' | 'cheque' | null {
  switch (method) {
    case 'upi': return 'upi'
    case 'cash': return 'cash'
    case 'cheque': return 'cheque'
    case 'neft': case 'rtgs': case 'imps': case 'bank': return 'bank'
    default: return null
  }
}

export const REPORT_STATUS_LABELS: Record<InvoiceReportStatus, string> = {
  open: 'Waiting for you', confirmed: 'Confirmed', rejected: 'Rejected', answered: 'Answered',
}

/** Reports that still need staff, oldest first so the longest wait is on top. */
export const sortReports = (reports: InvoiceReport[]): InvoiceReport[] =>
  [...reports].sort((a, b) => {
    const open = Number(b.status === 'open') - Number(a.status === 'open')
    if (open) return open
    return a.status === 'open' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)
  })

/** The query string for the invoices list: open reports ignore the date range, as the server does. */
export function invoiceListParams(f: { from?: string; to?: string; status?: string; requester?: string; overdue?: boolean; reportsOnly?: boolean }) {
  return {
    ...(f.reportsOnly ? { reports: 'open' as const } : { from: f.from, to: f.to }),
    status: f.status || undefined,
    requester: f.requester || undefined,
    overdue: f.overdue ? '1' : undefined,
  }
}
