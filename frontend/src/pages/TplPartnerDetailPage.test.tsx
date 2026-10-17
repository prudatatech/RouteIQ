// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  getPartner: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  flagDocuments: vi.fn(),
  updateApplication: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/services/api', () => ({ tplAPI: api }))

const docs = vi.hoisted(() => ({ uploadTplDocument: vi.fn() }))
vi.mock('@/services/tplDocuments', () => ({ uploadTplDocument: docs.uploadTplDocument }))
vi.mock('@/services/kycDocuments', () => ({ getKycDocumentUrl: vi.fn().mockResolvedValue('https://signed/doc.pdf') }))
vi.mock('@/components/tpl/GstinStatus', () => ({ GstinStatus: () => null }))
const channel = vi.hoisted(() => ({ on: vi.fn(), subscribe: vi.fn() }))
channel.on.mockReturnValue(channel)
channel.subscribe.mockReturnValue(channel)
vi.mock('@/services/supabase', () => ({
  supabase: { auth: {}, removeChannel: vi.fn(), storage: { from: vi.fn() } },
  openChannel: vi.fn(() => channel),
}))

const role = vi.hoisted(() => ({ role: 'superadmin' }))
vi.mock('@/store/effectiveRole', () => ({ useEffectiveRole: () => ({ role: role.role }) }))

import TplPartnerDetailPage from './TplPartnerDetailPage'
import { ConfirmProvider } from '@/components/ui'

interface PartnerOverrides {
  status?: string
  tpl_documents?: { id: string; doc_type: string; file_url: string }[]
}

function fixture(over: PartnerOverrides = {}) {
  return {
    id: 'p1',
    custom_id: 'acme_3pl',
    company_name: 'Acme Logistics',
    contact_name: 'Priya Rao',
    email: 'ops@acme.example',
    phone: '9800000000',
    status: 'pending',
    rejection_reason: null,
    created_at: '2026-10-01T05:00:00Z',
    pan_number: 'ABCDE1234F',
    gstin: null,
    tax_treatment: '12% GTA (With ITC) - Forward Charge',
    msme_status: 'Not Registered',
    sla_commitment: '2 Hours',
    bank_account_no: null,
    bank_ifsc: null,
    tpl_documents: [],
    tpl_corridors: [],
    document_issues: null,
    pending_updates: null,
    ...over,
  }
}

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/return-trips/tpl/p1']}>
        <Routes><Route path="/return-trips/tpl/:id" element={<TplPartnerDetailPage />} /></Routes>
      </MemoryRouter>
    </ConfirmProvider>
  </QueryClientProvider>,
)

beforeEach(() => {
  Object.values(api).forEach(m => m.mockReset())
  docs.uploadTplDocument.mockReset()
  role.role = 'superadmin'
})
afterEach(cleanup)

describe('TplPartnerDetailPage document upload', () => {
  it('lets staff upload a document on a pending application with none yet', async () => {
    api.getPartner.mockResolvedValue(fixture({ status: 'pending', tpl_documents: [] }))
    docs.uploadTplDocument.mockResolvedValue('p1/pan_card_xyz.pdf')
    api.updateApplication.mockResolvedValue({ success: true, data: true })

    show()
    await screen.findByRole('heading', { name: /Acme Logistics/ })

    expect(screen.getByText('PAN Card')).toBeTruthy()
    expect(screen.getByText('GST Certificate')).toBeTruthy()

    const fileInputs = document.body.querySelectorAll('input[type="file"]')
    expect(fileInputs.length).toBe(4)
    const file = new File(['dummy'], 'pan.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInputs[0], { target: { files: [file] } })

    await waitFor(() => expect(docs.uploadTplDocument).toHaveBeenCalledTimes(1))
    expect(docs.uploadTplDocument).toHaveBeenCalledWith(file, 'PAN Card', { applicationId: 'p1' })

    await waitFor(() => expect(api.updateApplication).toHaveBeenCalledTimes(1))
    expect(api.updateApplication).toHaveBeenCalledWith('p1', {
      documents: [{ type: 'PAN Card', url: 'p1/pan_card_xyz.pdf' }],
    })
  })

  it('carries over existing documents so the PATCH does not wipe them', async () => {
    api.getPartner.mockResolvedValue(fixture({
      status: 'rejected',
      tpl_documents: [{ id: 'd1', doc_type: 'PAN Card', file_url: 'p1/pan_card_abc.pdf' }],
    }))
    docs.uploadTplDocument.mockResolvedValue('p1/gst_certificate_xyz.pdf')
    api.updateApplication.mockResolvedValue({ success: true, data: true })

    show()
    await screen.findByRole('heading', { name: /Acme Logistics/ })

    const fileInputs = document.body.querySelectorAll('input[type="file"]')
    const file = new File(['dummy'], 'gst.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInputs[1], { target: { files: [file] } })

    await waitFor(() => expect(api.updateApplication).toHaveBeenCalledTimes(1))
    expect(api.updateApplication).toHaveBeenCalledWith('p1', {
      documents: [
        { type: 'PAN Card', url: 'p1/pan_card_abc.pdf' },
        { type: 'GST Certificate', url: 'p1/gst_certificate_xyz.pdf' },
      ],
    })
  })

  it('does not show the upload control once the application is approved', async () => {
    api.getPartner.mockResolvedValue(fixture({ status: 'active', tpl_documents: [] }))
    show()
    await screen.findByRole('heading', { name: /Acme Logistics/ })
    expect(screen.queryByText('PAN Card')).toBeNull()
    expect(document.body.querySelectorAll('input[type="file"]').length).toBe(0)
  })

  it('does not show the upload control to staff who cannot decide', async () => {
    role.role = 'admin'
    api.getPartner.mockResolvedValue(fixture({ status: 'pending', tpl_documents: [] }))
    show()
    await screen.findByRole('heading', { name: /Acme Logistics/ })
    expect(document.body.querySelectorAll('input[type="file"]').length).toBe(0)
  })
})
