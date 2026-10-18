// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OrgRow } from '@/utils/orgs'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  decide: vi.fn(),
  flagDocuments: vi.fn(),
  saveKycDocuments: vi.fn(),
}))
const uploadAdminOrgKycDocument = vi.hoisted(() => vi.fn())

vi.mock('@/services/api', () => ({ adminOrgsAPI: api }))
vi.mock('@/services/supabase', () => ({ supabase: {} }))
vi.mock('@/services/kycDocuments', () => ({
  uploadAdminOrgKycDocument,
  getKycDocumentUrl: vi.fn().mockResolvedValue('https://signed/doc.pdf'),
}))
vi.mock('@/components/admin/RegisterCompanyModal', () => ({ default: () => null }))
vi.mock('@/components/admin/FlagDocumentsModal', () => ({ FlagDocumentsModal: () => null }))

import PlatformOrganisationsPage from './OrganisationsPage'
import { ConfirmProvider } from '@/components/ui'
import { useOrgStore } from '@/store/orgStore'

const ORG: OrgRow = {
  id: 'org-1', kind: 'logistic_company', name: 'Acme Carriers', status: 'active',
  kyc_submitted_at: '2026-09-01T00:00:00Z',
  kyc_documents: { docUrls: { gstRegistration: 'org-1/gstRegistration_1.pdf' } },
}

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/platform/organisations']}>
        <PlatformOrganisationsPage />
      </MemoryRouter>
    </ConfirmProvider>
  </QueryClientProvider>,
)

beforeEach(() => {
  Object.values(api).forEach(m => m.mockReset())
  uploadAdminOrgKycDocument.mockReset()
  api.list.mockResolvedValue({ items: [ORG], total: 1, limit: 50, offset: 0 })
  useOrgStore.getState().setMemberships([
    { org: { id: 'platform-1', kind: 'platform', name: 'MargixIndia', status: 'active' }, role: 'owner' },
  ])
})
afterEach(() => { useOrgStore.getState().reset(); cleanup() })

describe('PlatformOrganisationsPage document renewal', () => {
  it('lets staff replace an active company\'s document without re-registering it', async () => {
    uploadAdminOrgKycDocument.mockResolvedValue('org-1/gstRegistration_2.pdf')
    api.saveKycDocuments.mockResolvedValue({ success: true, data: true })

    show()
    fireEvent.click((await screen.findAllByText('Acme Carriers'))[0])
    await screen.findByRole('heading', { name: 'Acme Carriers' })

    const replaceInput = screen.getByLabelText('Replace')
    const file = new File(['dummy'], 'gst-renewed.pdf', { type: 'application/pdf' })
    fireEvent.change(replaceInput, { target: { files: [file] } })

    await waitFor(() => expect(uploadAdminOrgKycDocument).toHaveBeenCalledWith('org-1', 'gstRegistration', file))
    await waitFor(() => expect(api.saveKycDocuments).toHaveBeenCalledWith('org-1', {
      docUrls: { gstRegistration: 'org-1/gstRegistration_2.pdf' },
    }))
  })

  it('lets staff upload a document the company never provided, even once active', async () => {
    api.list.mockResolvedValue({ items: [{ ...ORG, kyc_documents: { docUrls: {} } }], total: 1, limit: 50, offset: 0 })
    uploadAdminOrgKycDocument.mockResolvedValue('org-1/panScan_1.pdf')
    api.saveKycDocuments.mockResolvedValue({ success: true, data: true })

    show()
    fireEvent.click((await screen.findAllByText('Acme Carriers'))[0])
    await screen.findByRole('heading', { name: 'Acme Carriers' })

    // ORG_KYC_DOCUMENTS renders every document slot in order [gstRegistration, panScan, ...]
    // regardless of whether it is already uploaded - index 0 is gstRegistration's.
    const uploadInputs = screen.getAllByLabelText('Upload')
    const file = new File(['dummy'], 'gst.pdf', { type: 'application/pdf' })
    fireEvent.change(uploadInputs[0], { target: { files: [file] } })

    await waitFor(() => expect(uploadAdminOrgKycDocument).toHaveBeenCalledWith('org-1', 'gstRegistration', file))
    await waitFor(() => expect(api.saveKycDocuments).toHaveBeenCalledWith('org-1', { docUrls: { gstRegistration: 'org-1/panScan_1.pdf' } }))
  })
})
