// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { VendorReview } from '@/components/admin/vendor-review/types'

const api = vi.hoisted(() => ({
  review: vi.fn(), approveKyc: vi.fn(), rejectKyc: vi.fn(), requestKycInfo: vi.fn(),
}))
vi.mock('@/services/api', () => ({ vendorAPI: api }))
vi.mock('@/services/supabase', () => ({ supabase: {} }))
vi.mock('@/services/kycDocuments', () => ({ getKycDocumentUrl: vi.fn().mockResolvedValue('https://signed/doc.pdf') }))
vi.mock('@/components/tpl/GstinStatus', () => ({ GstinStatus: () => null }))
vi.mock('@/components/ui/DocumentViewerModal', () => ({
  default: ({ isOpen, fileName }: { isOpen: boolean; fileName: string }) => (isOpen ? <div data-testid="viewer">{fileName}</div> : null),
}))

import VendorReviewPage from './VendorReviewPage'
import { ConfirmProvider } from '@/components/ui'

const fixture = (over: Partial<VendorReview['kyc']> = {}): VendorReview => ({
  account: { id: 'v1', email: 'owner@acme.in', phone: '+919800000000', full_name: 'Asha Rao', created_at: '2026-09-01T05:00:00Z', last_sign_in_at: '2026-09-30T05:00:00Z' },
  business: {
    org_id: 'o1', org_status: 'active', business_name: 'Acme Traders', contact_name: 'Asha Rao', account_type: 'business', business_type: 'Trader',
    monthly_loads: '10-50', gstin: '27AAAPL1234C1ZV', gstin_status: 'unverified', address: '12 MG Road', pincode: '411001', state: 'Maharashtra', state_code: '27', email: 'owner@acme.in',
  },
  kyc: {
    status: 'submitted', reviewed_at: null, rejection_reason: null, updated_at: '2026-09-10T05:00:00Z', ifsc_verified_at: null,
    form: { name: 'Acme Traders Pvt Ltd', panNumber: 'AAAPL1234C', bankAccountNumber: '123456789012', extra: { 'Latest GST return': 'Filed 20 Sep' } },
    documents: [{ key: 'panScan', label: 'PAN card', path: 'v1/pan.pdf' }],
    ...over,
  },
  info_requests: [{
    id: 'r1', message: 'Please clarify', items: [{ key: 'i1', label: 'Latest GST return', kind: 'text', hint: null }],
    status: 'answered', requested_at: '2026-09-11T05:00:00Z', requested_by_name: 'Priya', answered_at: '2026-09-12T05:00:00Z', answers: [{ key: 'i1', text: 'Filed 20 Sep' }],
  }],
  history: [
    { at: '2026-09-10T05:00:00Z', actor: 'Asha', action: 'KYC submitted', detail: null },
    { at: '2026-09-12T05:00:00Z', actor: 'Priya', action: 'Asked for more details', detail: null },
  ],
  activity: { loads_total: 4, loads_open: 1, loads_awarded: 2, invoices: 3, last_load_at: '2026-09-29T05:00:00Z' },
})

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/admin/kyc/v1']}>
        <Routes><Route path="/admin/kyc/:vendorId" element={<VendorReviewPage />} /></Routes>
      </MemoryRouter>
    </ConfirmProvider>
  </QueryClientProvider>,
)

beforeEach(() => {
  Object.values(api).forEach(m => m.mockReset())
  api.approveKyc.mockResolvedValue({}); api.rejectKyc.mockResolvedValue({}); api.requestKycInfo.mockResolvedValue({ success: true })
})
afterEach(() => cleanup())

describe('VendorReviewPage', () => {
  it('renders every section from the review', async () => {
    api.review.mockResolvedValue(fixture())
    show()
    expect(await screen.findByRole('heading', { name: /Acme Traders/ })).toBeTruthy()
    for (const h of ['Summary', 'Account', 'Business', 'KYC form', 'Documents', 'More-details requests', 'Activity', 'History']) {
      expect(screen.getByRole('heading', { name: h })).toBeTruthy()
    }
    expect(screen.getByText('owner@acme.in', { selector: 'dd' })).toBeTruthy()
    expect(screen.getByText('12 MG Road')).toBeTruthy()
    expect(screen.getByText('AAAPL1234C')).toBeTruthy()
    expect(screen.getAllByText('Not given').length).toBeGreaterThan(0)
    expect(screen.getByText('Filed 20 Sep', { selector: 'dd' })).toBeTruthy()
    expect(screen.getByText('Answered')).toBeTruthy()
    expect(screen.getByRole('link', { name: /KYC review/ }).getAttribute('href')).toBe('/admin/kyc')
    fireEvent.click(screen.getByRole('button', { name: 'View PAN card' }))
    expect((await screen.findByTestId('viewer')).textContent).toBe('PAN card')
  })

  it('approves after a confirmation', async () => {
    api.review.mockResolvedValue(fixture())
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve KYC' }))
    await waitFor(() => expect(api.approveKyc).toHaveBeenCalledWith('v1'))
  })

  it('rejects only with a reason', async () => {
    api.review.mockResolvedValue(fixture())
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('button', { name: 'Reject KYC' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'PAN is blurry' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject KYC' }))
    await waitFor(() => expect(api.rejectKyc).toHaveBeenCalledWith('v1', 'PAN is blurry'))
  })

  it('asks for more details with a validated list of items', async () => {
    api.review.mockResolvedValue(fixture())
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for more details' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }))
    expect(await within(dialog).findByText('Give every item a name.')).toBeTruthy()
    expect(api.requestKycInfo).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText('Item 1'), { target: { value: 'Cancelled cheque' } })
    fireEvent.change(within(dialog).getByLabelText('Answer as'), { target: { value: 'document' } })
    fireEvent.change(within(dialog).getByLabelText(/Message/), { target: { value: 'Need this' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add another item' }))
    fireEvent.change(within(dialog).getByLabelText('Item 2'), { target: { value: 'Owner name' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(api.requestKycInfo).toHaveBeenCalledWith('v1', {
      message: 'Need this',
      items: [{ label: 'Cancelled cheque', kind: 'document' }, { label: 'Owner name', kind: 'text' }],
    }))
  })

  it.each(['pending', 'info_requested', 'approved', 'rejected'] as const)('disables the actions when the KYC is %s and says why', async status => {
    api.review.mockResolvedValue(fixture({ status }))
    show()
    await screen.findByRole('heading', { name: /Acme Traders/ })
    for (const name of ['Approve', 'Reject', 'Ask for more details']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getAllByText(/./).some(e => /can decide once|already approved|rejected/i.test(e.textContent ?? ''))).toBe(true)
  })

  it('shows a not-found state and an error with retry', async () => {
    api.review.mockRejectedValue({ response: { status: 404 } })
    show()
    expect(await screen.findByText('No vendor here')).toBeTruthy()
    cleanup()
    api.review.mockRejectedValue(new Error('boom'))
    show()
    expect(await screen.findByText('We could not load this vendor', {}, { timeout: 6000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Try again|Retry/i })).toBeTruthy()
  }, 12_000)
})
