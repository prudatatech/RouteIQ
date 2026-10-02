import { describe, expect, it } from 'vitest'
import type { LoadDocument } from '@/types/loadDocuments'
import {
  closeBlockedReason, computeBalance, emptyUpload, groupByKind, uploadFields, validateUpload,
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
    expect(f).toEqual({ valid_until: '2026-10-05', vehicle_number: 'MH12AB1234', distance_km: 450 })
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

describe('settlement maths', () => {
  const s = {
    agreed_freight: 50000, advance_paid: 10000,
    extra_charges: [
      { label: 'Detention', amount: 2000, approved_by: 'u', approved_at: '2026-10-02T00:00:00Z' },
      { label: 'Toll', amount: 900, approved_by: null, approved_at: null },
    ],
    deductions: [{ label: 'Late', amount: 500, reason: 'A day late' }],
  }
  it('counts only approved extras: freight + extras - deductions - advance', () => {
    expect(computeBalance(s)).toBe(41500)
  })
  it('blocks closing without a final POD, and says why', () => {
    const open = { id: 's', ...s, balance: 41500, payment_terms: null, payment_status: null, pod_document_id: null, closed_at: null, status: 'open' as const }
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
