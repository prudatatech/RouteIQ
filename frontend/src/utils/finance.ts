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
  payment_method?: string | null
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
}

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
    kind: 'vendor' | 'customer' | 'unknown'
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
