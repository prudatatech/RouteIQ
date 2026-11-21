// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const api = vi.hoisted(() => ({
  adminResolveKycApplicant: vi.fn(),
  adminKycUploadUrlFor: vi.fn(),
  adminCreateKycOnBehalf: vi.fn(),
}))
vi.mock('@/services/api', () => ({
  vendorAPI: api,
  bankAPI: { ifsc: vi.fn().mockRejectedValue(new Error('not needed in this test')) },
}))
// uploadKycDocumentFor's own job is to call vendorAPI.adminKycUploadUrlFor (endpoint #2) with the
// applicant's id - kept real here (not stubbed) so the test proves that call happens, as
// uploadKycDocument.ts does for the self-service upload path.
vi.mock('@/services/kycDocuments', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/kycDocuments')>()
  return { ...actual, getKycDocumentUrl: vi.fn().mockResolvedValue('https://signed/doc.pdf') }
})
vi.mock('@/services/supabase', () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: vi.fn().mockResolvedValue({ error: null }) }) } },
  openChannel: vi.fn(),
}))
vi.mock('@/components/map/AddressPicker', () => ({
  default: ({ label, onChange }: { label: string; onChange: (p: { address: string; lat: number; lng: number; parts?: { city?: string; state?: string; pincode?: string } }) => void }) => (
    <button type="button" onClick={() => onChange({ address: '1 MG Road, Pune', lat: 18.5, lng: 73.8, parts: { city: 'Pune', state: 'Maharashtra', pincode: '411001' } })}>
      {label}
    </button>
  ),
}))
vi.mock('@/components/tpl/GstinStatus', () => ({ GstinStatus: () => null }))
vi.mock('@/components/ui/DocumentViewerModal', () => ({ default: () => null }))

import EnterVendorKycPage from './EnterVendorKycPage'

const show = () => render(
  <MemoryRouter initialEntries={['/admin/kyc/enter-on-behalf']}>
    <Routes><Route path="/admin/kyc/enter-on-behalf" element={<EnterVendorKycPage />} /></Routes>
  </MemoryRouter>,
)

const file = (name: string) => new File(['x'], name, { type: 'application/pdf' })

vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

beforeEach(() => {
  Object.values(api).forEach(m => m.mockReset())
  api.adminResolveKycApplicant.mockResolvedValue({ vendorUserId: 'vendor-user-1', invited: true })
  api.adminKycUploadUrlFor.mockResolvedValue({ path: 'vendor-user-1/panScan_1.pdf', token: 't', signed_url: 'https://signed' })
  api.adminCreateKycOnBehalf.mockResolvedValue({ id: 'vendor-user-1', kyc_status: 'submitted' })
})
afterEach(() => cleanup())

describe('EnterVendorKycPage', () => {
  it('renders the applicant step first', () => {
    show()
    expect(screen.getByRole('heading', { name: 'Enter an application for someone' })).toBeTruthy()
    expect(screen.getByLabelText(/Applicant email/)).toBeTruthy()
  })

  it('resolves the applicant, uploads a document under their id, then submits in the same shape submitKyc uses', async () => {
    show()

    // Step 0 - Applicant: resolving the account is required before the rest of the form is reachable.
    fireEvent.change(screen.getByLabelText(/Applicant email/), { target: { value: 'new-vendor@example.test' } })
    fireEvent.change(screen.getByLabelText("Applicant's name"), { target: { value: 'Phoned-in Owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(api.adminResolveKycApplicant).toHaveBeenCalledWith({
      email: 'new-vendor@example.test', full_name: 'Phoned-in Owner', company_name: undefined,
    }))
    expect(await screen.findByLabelText(/Company name/)).toBeTruthy()

    // Step 1 - Company
    fireEvent.change(screen.getByLabelText(/^Company name/), { target: { value: 'Phoned-in Traders' } })
    fireEvent.change(screen.getByLabelText(/PAN number/), { target: { value: 'ABCDE1234F' } })
    fireEvent.change(screen.getByLabelText(/Entity type/), { target: { value: 'Proprietorship' } })
    fireEvent.change(screen.getByLabelText(/Authorized signatory name/), { target: { value: 'Phoned-in Owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Step 2 - Contact & address
    expect(await screen.findByLabelText(/Contact person/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Contact person/), { target: { value: 'Phoned-in Owner' } })
    fireEvent.change(screen.getByLabelText(/Contact email/), { target: { value: 'owner@phoned-in.test' } })
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '9800000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registered address / operating base' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Step 3 - Bank & documents
    expect(await screen.findByLabelText(/Beneficiary account name/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Beneficiary account name/), { target: { value: 'Phoned-in Owner' } })
    fireEvent.change(screen.getByLabelText(/Bank account number/), { target: { value: '123456789012' } })
    fireEvent.change(screen.getByLabelText(/IFSC code/), { target: { value: 'HDFC0001234' } })
    fireEvent.change(screen.getByLabelText(/^Bank name/), { target: { value: 'HDFC Bank' } })
    fireEvent.change(screen.getByLabelText(/^Branch/), { target: { value: 'Pune Camp' } })

    const panUpload = screen.getByText('PAN card').closest('.rounded-card')!
    const panInput = panUpload.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(panInput, { target: { files: [file('pan.pdf')] } })
    await waitFor(() => expect(api.adminKycUploadUrlFor).toHaveBeenCalledWith('vendor-user-1', {
      key: 'panScan', content_type: 'application/pdf', size: expect.any(Number),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Step 4 - Review & submit
    const declaration = await screen.findByRole('checkbox')
    fireEvent.click(declaration)
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    await waitFor(() => expect(api.adminCreateKycOnBehalf).toHaveBeenCalled())
    expect(api.adminCreateKycOnBehalf).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new-vendor@example.test',
      full_name: 'Phoned-in Owner',
      companyName: 'Phoned-in Traders',
      gstNumber: '',
      city: 'Pune',
      address: '1 MG Road, Pune',
      lat: 18.5,
      lng: 73.8,
      kycData: expect.objectContaining({
        data: expect.objectContaining({ name: 'Phoned-in Traders', entityType: 'Proprietorship', docUrls: { panScan: 'vendor-user-1/panScan_1.pdf' } }),
        otherDocs: [],
      }),
    }))

    // Resolve happens only once - the second (final) call reuses the same id, no re-invite.
    expect(api.adminResolveKycApplicant).toHaveBeenCalledTimes(1)

    expect(await screen.findByText('Application entered')).toBeTruthy()
    expect(screen.getByText(/invited new-vendor@example.test to set a password/)).toBeTruthy()
  })
})
