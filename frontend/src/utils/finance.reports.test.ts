import { describe, expect, it } from 'vitest'
import { FINANCE_PAGE_SIZE, invoiceListParams, recordedMethodFor, reportMethodLabel, sortReports, type InvoiceReport } from './finance'

const report = (over: Partial<InvoiceReport>): InvoiceReport => ({
  id: 'r', invoice_id: 'i1', customer_id: 'c1', kind: 'payment', amount: 100, paid_on: '2026-09-30', method: 'upi', reference: 'UTR1', message: null,
  status: 'open', staff_note: null, handled_by: null, handled_at: null, created_at: '2026-09-30T10:00:00Z',
  invoice_number: 'INV-1', invoice_total: 100, invoice_status: 'issued', customer_name: 'Asha', customer_phone: '+919800007701', ...over,
})

describe('invoice reports', () => {
  it('maps the way a customer paid to how it is recorded; other has none', () => {
    expect(recordedMethodFor('neft')).toBe('bank')
    expect(recordedMethodFor('imps')).toBe('bank')
    expect(recordedMethodFor('upi')).toBe('upi')
    expect(recordedMethodFor('cheque')).toBe('cheque')
    expect(recordedMethodFor('other')).toBeNull()
    expect(recordedMethodFor(null)).toBeNull()
  })

  it('names the methods', () => {
    expect(reportMethodLabel('neft')).toBe('NEFT')
    expect(reportMethodLabel(null)).toBe('')
  })

  it('puts open reports first, oldest first, then handled ones newest first', () => {
    const sorted = sortReports([
      report({ id: 'done-old', status: 'confirmed', created_at: '2026-09-01T00:00:00Z' }),
      report({ id: 'open-new', created_at: '2026-09-30T00:00:00Z' }),
      report({ id: 'done-new', status: 'rejected', created_at: '2026-09-20T00:00:00Z' }),
      report({ id: 'open-old', created_at: '2026-09-10T00:00:00Z' }),
    ])
    expect(sorted.map(r => r.id)).toEqual(['open-old', 'open-new', 'done-new', 'done-old'])
  })

  it('leaves the date range out when listing invoices with open reports', () => {
    expect(invoiceListParams({ from: '2026-09-01', to: '2026-09-30', reportsOnly: true, page: 0 }))
      .toEqual({ reports: 'open', status: undefined, requester: undefined, overdue: undefined, limit: FINANCE_PAGE_SIZE, offset: 0 })
    expect(invoiceListParams({ from: '2026-09-01', to: '2026-09-30', status: 'issued', overdue: true, page: 0 }))
      .toEqual({ from: '2026-09-01', to: '2026-09-30', status: 'issued', requester: undefined, overdue: '1', limit: FINANCE_PAGE_SIZE, offset: 0 })
  })
})
