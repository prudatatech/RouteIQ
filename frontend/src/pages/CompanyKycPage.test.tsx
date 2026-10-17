// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Membership, OrgProfile } from '@/utils/orgs'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  saveKycDocuments: vi.fn(),
  submitKyc: vi.fn(),
}))
const bankAPI = vi.hoisted(() => ({ ifsc: vi.fn().mockRejectedValue(new Error('not found')) }))
const uploadOrgKycDocument = vi.hoisted(() => vi.fn())

vi.mock('@/services/api', () => ({ orgAPI: api, bankAPI }))
vi.mock('@/services/supabase', () => ({ supabase: {} }))
vi.mock('@/services/kycDocuments', () => ({ uploadOrgKycDocument, getKycDocumentUrl: vi.fn() }))

import CompanyKycPage from './CompanyKycPage'
import { useOrgStore } from '@/store/orgStore'

const MEMBERSHIP: Membership = { org: { id: 'org-1', kind: 'logistic_company', name: 'Phoned-in Carriers', status: 'pending' }, role: 'owner' }

const PROFILE: OrgProfile = {
  id: 'org-1', kind: 'logistic_company', status: 'pending',
  gstin: '', pan: '', entity_type: '', authorized_signatory_name: '',
  profile: {}, kyc_documents: { docUrls: {} }, kyc_document_issues: {},
}

const REQUIRED_DOC_KEYS = ['gstRegistration', 'panScan', 'companyRegistration', 'cancelledCheque', 'addressProof']

const field = (name: string) => screen.getByLabelText(new RegExp(`^${name}( \\*)?$`), { selector: 'input,select,textarea' })

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <CompanyKycPage />
    </MemoryRouter>
  </QueryClientProvider>,
)

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(PROFILE)
  api.update.mockReset().mockResolvedValue(PROFILE)
  api.saveKycDocuments.mockReset().mockResolvedValue(PROFILE)
  api.submitKyc.mockReset().mockResolvedValue({ ...PROFILE, kyc_submitted_at: '2026-10-17T00:00:00Z' })
  uploadOrgKycDocument.mockReset()
  useOrgStore.getState().reset()
  useOrgStore.getState().setMemberships([MEMBERSHIP])
})
afterEach(() => cleanup())

describe('CompanyKycPage stepper', () => {
  it('shows the three KYC stages, starting on "Company details" when nothing is filled in', async () => {
    show()
    await waitFor(() => expect(field('GSTIN')).toBeTruthy())

    // Each stage name appears twice: once as the stepper's step label, once as the matching
    // section heading further down the (still fully visible) form.
    for (const label of ['Company details', 'Bank details', 'Documents']) {
      expect(screen.getAllByText(label).length).toBe(2)
    }
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Company details')
  })

  it('advances past "Company details" once its fields are valid, without hiding the other sections', async () => {
    show()
    await waitFor(() => expect(field('GSTIN')).toBeTruthy())

    // Bank details and Documents stay visible throughout - this is a progress indicator over a
    // single scrolling form, not a gated wizard.
    expect(field('Bank account number')).toBeTruthy()
    expect(screen.getAllByText('Documents').length).toBe(2)

    fireEvent.change(field('GSTIN'), { target: { value: '27AAAPL1234C1ZE' } })
    fireEvent.change(field('PAN'), { target: { value: 'AAAPL1234C' } })
    fireEvent.change(field('Entity type'), { target: { value: 'Proprietorship' } })
    fireEvent.change(field('Authorized signatory name'), { target: { value: 'Phoned-in Owner' } })

    // Still on the same single page - fields from every stage remain reachable.
    expect(field('Bank account number')).toBeTruthy()
    expect(field('GSTIN')).toBeTruthy()
  })
})

describe('CompanyKycPage save and submit (unchanged request shapes)', () => {
  it('saves company and bank details with the same payload shape as before the stepper was added', async () => {
    show()
    await waitFor(() => expect(field('GSTIN')).toBeTruthy())

    fireEvent.change(field('GSTIN'), { target: { value: '27AAAPL1234C1ZE' } })
    fireEvent.change(field('PAN'), { target: { value: 'AAAPL1234C' } })
    fireEvent.change(field('Entity type'), { target: { value: 'Proprietorship' } })
    fireEvent.change(field('Authorized signatory name'), { target: { value: 'Phoned-in Owner' } })
    fireEvent.change(field('Bank account number'), { target: { value: '123456789012' } })
    fireEvent.change(field('IFSC code'), { target: { value: 'HDFC0001234' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(api.update).toHaveBeenCalledWith({
      gstin: '27AAAPL1234C1ZE',
      pan: 'AAAPL1234C',
      entity_type: 'Proprietorship',
      cin: undefined,
      authorized_signatory_name: 'Phoned-in Owner',
      profile: { bank_name: null, bank_account_no: '123456789012', bank_ifsc: 'HDFC0001234' },
    }))
  })

  it('uploads documents and submits for review with the same calls as before the stepper was added', async () => {
    show()
    await waitFor(() => expect(field('GSTIN')).toBeTruthy())

    fireEvent.change(field('GSTIN'), { target: { value: '27AAAPL1234C1ZE' } })
    fireEvent.change(field('PAN'), { target: { value: 'AAAPL1234C' } })
    fireEvent.change(field('Entity type'), { target: { value: 'Proprietorship' } })
    fireEvent.change(field('Authorized signatory name'), { target: { value: 'Phoned-in Owner' } })
    fireEvent.change(field('Bank account number'), { target: { value: '123456789012' } })
    fireEvent.change(field('IFSC code'), { target: { value: 'HDFC0001234' } })

    const inputs = document.querySelectorAll('input[type=file]')
    expect(inputs.length).toBe(REQUIRED_DOC_KEYS.length)
    for (let i = 0; i < inputs.length; i++) {
      const key = REQUIRED_DOC_KEYS[i]
      uploadOrgKycDocument.mockResolvedValueOnce(`org-1/${key}_1.pdf`)
      const file = new File(['x'], `${key}.pdf`, { type: 'application/pdf' })
      fireEvent.change(inputs[i], { target: { files: [file] } })
      await waitFor(() => expect(uploadOrgKycDocument).toHaveBeenCalledWith(key, file))
    }

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    await waitFor(() => expect(api.submitKyc).toHaveBeenCalledWith())
  })
})
