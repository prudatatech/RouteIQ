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
