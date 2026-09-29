import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'
import { EXPENSE_CSV_COLUMNS, INVOICE_CSV_COLUMNS, categoryLabel, expenseCsvRows, invoiceCsvRows, type Expense, type Invoice } from './finance'

const expense: Expense = {
  id: 'e1', vehicle_id: 'v1', route_id: null, plate_number: 'MH12AB1234', category: 'toll', amount: 400.5,
  expense_date: '2026-09-29', litres: null, note: 'Pune, expressway', receipt_path: null,
}

describe('finance CSV', () => {
  it('exports expenses with readable categories and quoted notes', () => {
    const csv = toCsv(expenseCsvRows([expense]), EXPENSE_CSV_COLUMNS)
    expect(csv.split('\r\n')).toEqual([
      'Date,Category,Vehicle,Amount (INR),Litres,Note,Receipt',
      '2026-09-29,Tolls,MH12AB1234,400.5,,"Pune, expressway",No',
    ])
  })

  it('exports invoices with dates only', () => {
    const invoice: Invoice = {
      id: 'i1', invoice_number: 'INV-202609-0001', reference: 'RTX-1', vendor_name: 'Acme', amount: 1000, gst_rate: 12,
      gst_amount: 120, total: 1120, status: 'paid', issued_at: '2026-09-29T08:00:00Z', paid_at: '2026-09-30T08:00:00Z',
    }
    const rows = toCsv(invoiceCsvRows([invoice]), INVOICE_CSV_COLUMNS).split('\r\n')
    expect(rows[1]).toBe('INV-202609-0001,2026-09-29,RTX-1,Acme,1000,120,1120,paid,2026-09-30')
  })

  it('falls back to the raw value for an unknown category', () => {
    expect(categoryLabel('fuel')).toBe('Fuel')
    expect(categoryLabel('mystery')).toBe('mystery')
  })
})
