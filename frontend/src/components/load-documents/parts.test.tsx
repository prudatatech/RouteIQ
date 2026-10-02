// Rendered to static HTML: the project has no DOM test environment installed.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// The shared UI index reaches the API client, which needs Supabase settings that tests do not have.
vi.mock('@/services/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))

import type { DispatchCheck, LoadDocument, Settlement } from '@/types/loadDocuments'
import { DispatchChecklist } from './DispatchChecklist'
import { DocumentList } from './DocumentList'
import { GenerateButtons } from './GenerateButtons'
import { SettlementCard } from './SettlementCard'

const noop = () => undefined

const doc = (over: Partial<LoadDocument> = {}): LoadDocument => ({
  id: 'd1', kind: 'eway_bill', number: '123456789012', doc_date: '2026-10-01', fields: {}, file_path: 'x.pdf', status: 'final',
  valid_until: '2026-10-05', version: 1, created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
})

const settlement = (over: Partial<Settlement> = {}): Settlement => ({
  id: 's1', agreed_freight: 50000, advance_paid: 10000,
  extra_charges: [{ label: 'Detention', amount: 2000, approved_by: null, approved_at: null }],
  deductions: [{ label: 'Late', amount: 500, reason: 'A day late' }],
  balance: 41500, payment_terms: 'to_pay', payment_status: null, pod_document_id: null, closed_at: null, status: 'open', ...over,
})

describe('DispatchChecklist', () => {
  const check: DispatchCheck = {
    blocking: false,
    items: [
      { key: 'invoice', label: 'Invoice or challan', status: 'ok', detail: null, required: true },
      { key: 'eway', label: 'E-way bill', status: 'expired', detail: 'Expired on 5 Oct 2026', required: true },
      { key: 'lr', label: 'LR', status: 'missing', detail: null, required: true },
      { key: 'veh', label: 'Vehicle', status: 'mismatch', detail: 'Different vehicle on the e-way bill', required: true },
    ],
  }
  it('shows a pill for each status and the details', () => {
    const html = renderToStaticMarkup(<DispatchChecklist check={check} />)
    for (const word of ['In order', 'Expired', 'Missing', 'Does not match', 'Expired on 5 Oct 2026']) expect(html).toContain(word)
    expect(html).toContain('3 items need attention')
    expect(html).not.toContain('Dispatch is on hold')
  })
  it('says so when dispatch is blocked', () => {
    expect(renderToStaticMarkup(<DispatchChecklist check={{ ...check, blocking: true }} />)).toContain('Dispatch is on hold')
  })
})

describe('actions by role', () => {
  it('shows Generate buttons to the carrier only', () => {
    expect(renderToStaticMarkup(<GenerateButtons role="carrier" busyKind={null} onGenerate={noop} />)).toContain('Generate LR / GR')
    expect(renderToStaticMarkup(<GenerateButtons role="vendor" busyKind={null} onGenerate={noop} />)).toBe('')
    expect(renderToStaticMarkup(<GenerateButtons role="platform" busyKind={null} onGenerate={noop} />)).toBe('')
  })
  it('lists documents with number, status, validity and view/history for everyone, Update for vendor and carrier', () => {
    const list = (role: 'vendor' | 'carrier' | 'platform') =>
      renderToStaticMarkup(<DocumentList docs={[doc()]} role={role} onView={noop} onHistory={noop} onEdit={noop} />)
    const vendor = list('vendor')
    expect(vendor).toContain('123456789012')
    expect(vendor).toContain('Final')
    expect(vendor).toContain('valid until 5 Oct 2026')
    expect(vendor).toContain('View PDF')
    expect(vendor).toContain('History')
    expect(vendor).toContain('Update')
    expect(list('carrier')).toContain('Update')
    const platform = list('platform')
    expect(platform).toContain('View PDF')
    expect(platform).not.toContain('Update')
  })
})

describe('SettlementCard', () => {
  const props = { docs: [] as LoadDocument[], busy: false, onOpen: noop, onAddExtra: noop, onApprove: noop, onAddDeduction: noop, onClose: noop }
  it('shows freight, advance, charges, deductions and the server balance', () => {
    const html = renderToStaticMarkup(<SettlementCard role="carrier" settlement={settlement()} {...props} />)
    expect(html).toContain('₹50,000')
    expect(html).toContain('₹10,000')
    expect(html).toContain('Detention')
    expect(html).toContain('A day late')
    expect(html).toContain('₹41,500')
    expect(html).toContain('Approve')
  })
  it('disables Close trip with a reason until a final POD exists', () => {
    const without = renderToStaticMarkup(<SettlementCard role="carrier" settlement={settlement()} {...props} />)
    expect(without).toMatch(/<button[^>]*\sdisabled=""[^>]*>.*Close trip/)
    expect(without).toContain('A final proof of delivery is needed')
    const pod = doc({ id: 'p', kind: 'pod', status: 'final' })
    const withPod = renderToStaticMarkup(<SettlementCard role="carrier" settlement={settlement()} {...props} docs={[pod]} />)
    expect(withPod).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Close trip/)
    expect(withPod).not.toContain('A final proof of delivery is needed')
  })
  it('gives the vendor a read-only view: no Approve, no Close trip', () => {
    const html = renderToStaticMarkup(<SettlementCard role="vendor" settlement={settlement()} {...props} />)
    expect(html).toContain('₹41,500')
    expect(html).not.toContain('Approve')
    expect(html).not.toContain('Close trip')
    expect(html).not.toContain('Add charge')
  })
  it('offers to open the settlement to the carrier only', () => {
    expect(renderToStaticMarkup(<SettlementCard role="carrier" settlement={null} {...props} />)).toContain('Open settlement')
    expect(renderToStaticMarkup(<SettlementCard role="vendor" settlement={null} {...props} />)).not.toContain('Open settlement')
  })
})
