// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OrgRow } from '@/utils/orgs'

const api = vi.hoisted(() => ({
  createOnBehalf: vi.fn(),
  update: vi.fn(),
  kycUploadUrl: vi.fn(),
  saveKycDocuments: vi.fn(),
  submitKyc: vi.fn(),
}))
const bankAPI = vi.hoisted(() => ({ ifsc: vi.fn().mockRejectedValue(new Error('not found')) }))
const uploadAdminOrgKycDocument = vi.hoisted(() => vi.fn())

vi.mock('@/services/api', () => ({ adminOrgsAPI: api, bankAPI }))
vi.mock('@/services/supabase', () => ({ supabase: {} }))
vi.mock('@/services/kycDocuments', () => ({ uploadAdminOrgKycDocument, getKycDocumentUrl: vi.fn() }))

import RegisterCompanyModal from './RegisterCompanyModal'

const ORG: OrgRow = {
  id: 'org-1', kind: 'logistic_company', name: 'Phoned-in Carriers', status: 'pending',
}

// A company left stuck mid-registration (staff-entered or self-serve): the org row exists,
// `kyc_submitted_at` is still null, and it already has some - but not all - of its KYC filled in.
const RESUME_ORG: OrgRow = {
  id: 'org-2', kind: 'logistic_company', name: 'Unfinished Carriers', status: 'pending',
  email: 'unfinished@example.test', entity_type: 'Proprietorship', authorized_signatory_name: 'Existing Owner',
  profile: { bank_name: 'Existing Bank', bank_account_no: '999888777666', bank_ifsc: 'ICIC0005678' },
  kyc_documents: { docUrls: { gstRegistration: 'org-2/gstRegistration_1.pdf' } },
}

// Field labels add a trailing " *" when required, and getByLabelText's default fuzzy match can
// also catch unrelated text containing the same substring (e.g. "PAN" inside "Company") via
// aria-labelledby on the dialog itself - anchor to the exact label, with or without the asterisk,
// and restrict to actual form controls.
const field = (name: string) => screen.getByLabelText(new RegExp(`^${name}( \\*)?$`), { selector: 'input,select,textarea' })

const show = (onRegistered = vi.fn(), resumeOrg?: OrgRow | null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RegisterCompanyModal open onClose={vi.fn()} onRegistered={onRegistered} resumeOrg={resumeOrg} />
  </QueryClientProvider>,
)

const fillStep1 = () => {
  fireEvent.change(field('Applicant email'), { target: { value: 'applicant@example.test' } })
  fireEvent.change(field('Applicant name'), { target: { value: 'Phoned-in Owner' } })
  fireEvent.change(field('Company name'), { target: { value: 'Phoned-in Carriers' } })
  fireEvent.change(field('GSTIN'), { target: { value: '27AAAPL1234C1ZE' } })
  fireEvent.change(field('PAN'), { target: { value: 'AAAPL1234C' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create and continue' }))
}

const REQUIRED_DOC_KEYS = ['gstRegistration', 'panScan', 'companyRegistration', 'cancelledCheque', 'addressProof']

const uploadAllDocs = async () => {
  const inputs = document.querySelectorAll('input[type=file]')
  expect(inputs.length).toBe(REQUIRED_DOC_KEYS.length)
  for (let i = 0; i < inputs.length; i++) {
    const key = REQUIRED_DOC_KEYS[i]
    uploadAdminOrgKycDocument.mockResolvedValueOnce(`org-1/${key}_1.pdf`)
    const file = new File(['x'], `${key}.pdf`, { type: 'application/pdf' })
    fireEvent.change(inputs[i], { target: { files: [file] } })
    await waitFor(() => expect(uploadAdminOrgKycDocument).toHaveBeenCalledWith('org-1', key, file))
  }
}

const fillStep2Fields = () => {
  fireEvent.change(field('Entity type'), { target: { value: 'Proprietorship' } })
  fireEvent.change(field('Authorized signatory name'), { target: { value: 'Phoned-in Owner' } })
  fireEvent.change(field('Bank account number'), { target: { value: '123456789012' } })
  fireEvent.change(field('IFSC code'), { target: { value: 'HDFC0001234' } })
}

beforeEach(() => {
  api.createOnBehalf.mockReset().mockResolvedValue(ORG)
  api.update.mockReset().mockResolvedValue(ORG)
  api.kycUploadUrl.mockReset()
  api.saveKycDocuments.mockReset().mockResolvedValue(ORG)
  api.submitKyc.mockReset().mockResolvedValue({ ...ORG, kyc_submitted_at: '2026-10-17T00:00:00Z' })
  uploadAdminOrgKycDocument.mockReset()
})
afterEach(() => cleanup())

describe('RegisterCompanyModal', () => {
  it('renders the applicant and company step first', () => {
    show()
    expect(screen.getByText('Register a company for someone')).toBeTruthy()
    expect(field('Applicant email')).toBeTruthy()
    expect(field('Company name')).toBeTruthy()
    expect(screen.queryByLabelText('Entity type', { selector: 'input,select,textarea' })).toBeNull()
  })

  it('creates the company, then saves KYC details, uploads documents and submits for review, in order', async () => {
    show()
    fillStep1()

    await waitFor(() => expect(api.createOnBehalf).toHaveBeenCalledWith({
      applicant_email: 'applicant@example.test',
      applicant_full_name: 'Phoned-in Owner',
      name: 'Phoned-in Carriers',
      legal_name: undefined,
      gstin: '27AAAPL1234C1ZE',
      pan: 'AAAPL1234C',
      state: undefined,
      city: undefined,
      address: undefined,
      pincode: undefined,
      phone: undefined,
    }))

    await waitFor(() => expect(field('Entity type')).toBeTruthy())
    fillStep2Fields()
    await uploadAllDocs()

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('org-1', {
      email: undefined,
      entity_type: 'Proprietorship',
      cin: undefined,
      authorized_signatory_name: 'Phoned-in Owner',
      profile: { bank_name: null, bank_account_no: '123456789012', bank_ifsc: 'HDFC0001234' },
    }))
    await waitFor(() => expect(api.submitKyc).toHaveBeenCalledWith('org-1'))

    // update (saveKyc) must run before submitKyc, since submitKyc needs the saved details.
    const updateOrder = api.update.mock.invocationCallOrder[0]
    const submitOrder = api.submitKyc.mock.invocationCallOrder[0]
    expect(updateOrder).toBeLessThan(submitOrder)

    expect(await screen.findByText('Submitted for review')).toBeTruthy()
    expect(screen.getByText(/applicant@example.test/)).toBeTruthy()
  })

  it('shows the missing-fields error from submit clearly, without losing the entered details', async () => {
    show()
    fillStep1()
    await waitFor(() => expect(field('Entity type')).toBeTruthy())
    fillStep2Fields()
    await uploadAllDocs()

    api.submitKyc.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Upload the following before submitting: Cancelled cheque' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    expect(await screen.findByText('Upload the following before submitting: Cancelled cheque')).toBeTruthy()
    // Still on the KYC step with everything the staff member entered - nothing was lost.
    expect((field('Authorized signatory name') as HTMLInputElement).value).toBe('Phoned-in Owner')
    expect(screen.queryByText('Submitted for review')).toBeNull()
  })
})

describe('RegisterCompanyModal resuming an existing company', () => {
  it('opens directly at step 2, pre-filled from the org, and never calls create-on-behalf', () => {
    show(vi.fn(), RESUME_ORG)

    expect(screen.getByText('Finish registering Unfinished Carriers')).toBeTruthy()
    expect(screen.queryByLabelText('Applicant email', { selector: 'input,select,textarea' })).toBeNull()

    expect((field('Company email') as HTMLInputElement).value).toBe('unfinished@example.test')
    expect((field('Entity type') as HTMLSelectElement).value).toBe('Proprietorship')
    expect((field('Authorized signatory name') as HTMLInputElement).value).toBe('Existing Owner')
    expect((field('Bank account number') as HTMLInputElement).value).toBe('999888777666')
    expect((field('IFSC code') as HTMLInputElement).value).toBe('ICIC0005678')
    expect((field('Bank name') as HTMLInputElement).value).toBe('Existing Bank')

    // The one document the org already has shows as uploaded (View/Remove); the rest still need uploading.
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
    expect(document.querySelectorAll('input[type=file]').length).toBe(REQUIRED_DOC_KEYS.length - 1)

    expect(api.createOnBehalf).not.toHaveBeenCalled()
  })

  it('saves, uploads the remaining documents and submits for review, same as a fresh registration', async () => {
    const onRegistered = vi.fn()
    show(onRegistered, RESUME_ORG)

    const remainingKeys = REQUIRED_DOC_KEYS.filter(k => k !== 'gstRegistration')
    const inputs = document.querySelectorAll('input[type=file]')
    expect(inputs.length).toBe(remainingKeys.length)
    for (let i = 0; i < inputs.length; i++) {
      const key = remainingKeys[i]
      uploadAdminOrgKycDocument.mockResolvedValueOnce(`org-2/${key}_1.pdf`)
      const file = new File(['x'], `${key}.pdf`, { type: 'application/pdf' })
      fireEvent.change(inputs[i], { target: { files: [file] } })
      await waitFor(() => expect(uploadAdminOrgKycDocument).toHaveBeenCalledWith('org-2', key, file))
    }

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('org-2', {
      email: 'unfinished@example.test',
      entity_type: 'Proprietorship',
      cin: undefined,
      authorized_signatory_name: 'Existing Owner',
      profile: { bank_name: 'Existing Bank', bank_account_no: '999888777666', bank_ifsc: 'ICIC0005678' },
    }))
    await waitFor(() => expect(api.submitKyc).toHaveBeenCalledWith('org-2'))

    expect(await screen.findByText('Submitted for review')).toBeTruthy()
    // No applicant was freshly invited in this flow, so there is nothing to tell staff about an invite.
    expect(screen.queryByText(/invite to set a password/)).toBeNull()
    expect(onRegistered).toHaveBeenCalled()
  })
})
