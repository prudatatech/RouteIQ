// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { VendorKycRequest } from '@/components/admin/vendor-review/types'

const api = vi.hoisted(() => ({ respondKyc: vi.fn() }))
const upload = vi.hoisted(() => vi.fn())
vi.mock('@/services/api', () => ({ vendorAPI: api }))
vi.mock('@/services/supabase', () => ({ supabase: {} }))
vi.mock('@/services/kycDocuments', () => ({ uploadKycDocument: upload }))

import { KycInfoRequests, collectAnswers } from './KycInfoRequests'

const request: VendorKycRequest = {
  id: 'r1', message: 'Please help us verify', requested_at: '2026-09-11T00:00:00Z',
  items: [
    { key: 'gst_1', label: 'Latest GST return', kind: 'text', hint: 'Month and status' },
    { key: 'cheque_2', label: 'Cancelled cheque', kind: 'document' },
  ],
}

const show = () => render(
  <QueryClientProvider client={new QueryClient()}><KycInfoRequests requests={[request]} /></QueryClientProvider>,
)

beforeEach(() => { api.respondKyc.mockReset(); upload.mockReset(); api.respondKyc.mockResolvedValue({ success: true }); upload.mockResolvedValue('v1/other/cheque.pdf') })
afterEach(() => cleanup())

describe('KycInfoRequests', () => {
  it('collects answers only when every item is answered', () => {
    expect(collectAnswers(request, { gst_1: 'Filed' }, {})).toBeNull()
    expect(collectAnswers(request, { gst_1: ' Filed ' }, { cheque_2: 'p' })).toEqual([
      { key: 'gst_1', text: 'Filed' }, { key: 'cheque_2', document_path: 'p' },
    ])
  })

  it('shows the banner and sends text and uploaded document answers', async () => {
    show()
    expect(screen.getByText('The review team needs more details')).toBeTruthy()
    expect(screen.getByText('Please help us verify')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to the review team' }))
    expect(api.respondKyc).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Latest GST return'), { target: { value: 'Filed 20 Sep' } })
    const file = new File(['x'], 'cheque.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [file] } })
    await waitFor(() => expect(upload).toHaveBeenCalledWith('other', file))
    await screen.findByText('cheque.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Send to the review team' }))
    await waitFor(() => expect(api.respondKyc).toHaveBeenCalledWith({
      request_id: 'r1',
      answers: [{ key: 'gst_1', text: 'Filed 20 Sep' }, { key: 'cheque_2', document_path: 'v1/other/cheque.pdf' }],
    }))
  })

  it('renders nothing without requests', () => {
    const { container } = render(<QueryClientProvider client={new QueryClient()}><KycInfoRequests requests={[]} /></QueryClientProvider>)
    expect(container.innerHTML).toBe('')
  })
})
