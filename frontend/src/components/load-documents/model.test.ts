import { describe, expect, it } from 'vitest'
import type { LoadDocument } from '@/types/loadDocuments'
import {
  closeBlockedReason, emptyUpload, groupByKind, uploadFields, validateUpload,
} from './model'

const doc = (over: Partial<LoadDocument>): LoadDocument => ({
  id: 'd1', kind: 'tax_invoice', number: 'INV-1', doc_date: '2026-10-01', fields: {}, file_path: null, status: 'final',
  valid_until: null, version: 1, created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
})

const eway = (over: Partial<ReturnType<typeof emptyUpload>> = {}) => ({
  ...emptyUpload('eway_bill'), number: '123456789012', doc_date: '2026-10-01', valid_until: '2026-10-05', ...over,
})

describe('e-way bill validation', () => {
  it('accepts exactly 12 digits', () => {
    expect(validateUpload(eway())).toEqual({})
  })
  it.each(['12345678901', '1234567890123', '12345678901a', '1234 5678 9012'])('rejects %s', number => {
    expect(validateUpload(eway({ number })).number).toMatch(/12 digits/)
  })
  it('asks for the number, dates and rejects validity before generation', () => {
    const e = validateUpload(eway({ number: '', doc_date: '', valid_until: '' }))
    expect(e.number).toBeTruthy()
    expect(e.doc_date).toBeTruthy()
    expect(e.valid_until).toBeTruthy()
    expect(validateUpload(eway({ valid_until: '2026-09-30' })).valid_until).toMatch(/before/)
  })
  it('sends the vehicle number tidy and leaves empty fields out', () => {
    const f = uploadFields(eway({ vehicle_number: 'mh 12 ab 1234', distance_km: '450' }))
    // The validity is the document's own valid_until, not a field; the dates and number use the backend's names
    expect(f).toEqual({ ewb_number: '123456789012', generated_on: '2026-10-01', vehicle_number: 'MH12AB1234', approx_distance_km: 450 })
  })
})

describe('invoice validation', () => {
  it('needs a number and a date, and a valid GSTIN when one is given', () => {
    const v = emptyUpload('tax_invoice')
    expect(Object.keys(validateUpload(v)).sort()).toEqual(['doc_date', 'number'])
    expect(validateUpload({ ...v, number: 'A1', doc_date: '2026-10-01', seller_gstin: '123' }).seller_gstin).toBeTruthy()
    expect(validateUpload({ ...v, number: 'A1', doc_date: '2026-10-01' })).toEqual({})
  })
})

describe('invoice fields', () => {
  it('uses the backend names for the dispatch and delivery addresses', () => {
    const f = uploadFields({ ...emptyUpload('tax_invoice'), number: 'A1', from_address: 'Pune', to_address: 'Delhi', seller_gstin: '27aaapl1234c1zv', total_value: '900' })
    expect(f).toEqual({ seller_gstin: '27AAAPL1234C1ZV', dispatch_from: 'Pune', ship_to: 'Delhi', total_value: 900 })
  })
})

describe('closing a trip', () => {
  it('blocks closing without a final POD, and says why', () => {
    const open = {
      id: 's', agreed_freight: 50000, advance_paid: 10000,
      extra_charges: [], deductions: [], approved_extras_total: 0, pending_extras_total: 0, deductions_total: 0,
      balance: 40000, payment_terms: 'to_pay' as const, payment_status: 'pending' as const, pod_document_id: null, closed_at: null, status: 'open' as const,
    }
    expect(closeBlockedReason(open, [])).toMatch(/proof of delivery/)
    expect(closeBlockedReason(open, [doc({ kind: 'pod', status: 'draft' })])).toMatch(/proof of delivery/)
    expect(closeBlockedReason(open, [doc({ kind: 'pod', status: 'final' })])).toBeNull()
    expect(closeBlockedReason({ ...open, status: 'closed' }, [doc({ kind: 'pod' })])).toMatch(/already closed/)
  })
})

describe('grouping', () => {
  it('groups by kind in display order, newest version first', () => {
    const g = groupByKind([doc({ id: 'a', kind: 'lr', version: 1 }), doc({ id: 'b', kind: 'tax_invoice' }), doc({ id: 'c', kind: 'lr', version: 2 })])
    expect(g.map(x => x.kind)).toEqual(['tax_invoice', 'lr'])
    expect(g[1].docs.map(d => d.id)).toEqual(['c', 'a'])
  })
})
