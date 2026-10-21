// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'
import { FixDetails } from './TplTrackApplicationPage'

const tplAPI = vi.hoisted(() => ({
  updateApplication: vi.fn(),
}))

const bankAPI = vi.hoisted(() => ({
  ifsc: vi.fn().mockResolvedValue({
    bank: 'HDFC Bank',
    branch: 'Kalyan Nagar',
    city: 'Bengaluru',
    state: 'Karnataka',
  }),
}))

vi.mock('@/services/api', () => ({ tplAPI, bankAPI }))
vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('FixDetails in TplTrackApplicationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  const sampleApplication = {
    id: 'app-uuid-1',
    company_name: 'Mahalaxmi Transport',
    status: 'flagged',
    contact_name: 'Ramesh Patel',
    pan_number: 'AAPFU0939F',
    gstin: '27AAPFU0939F1ZV',
    entity_type: 'Partnership',
    authorized_signatory_name: 'Ramesh Patel',
    bank_account_no: '123456789012',
    bank_ifsc: 'HDFC0001234',
  }

  it('shows inline error and toasts when company name is cleared before saving', async () => {
    render(
      <FixDetails
        applicationId="app-uuid-1"
        pan="AAPFU0939F"
        full={sampleApplication}
        onSaved={vi.fn()}
      />
    )

    const companyInput = screen.getByLabelText(/Company name/i)
    fireEvent.change(companyInput, { target: { value: '   ' } })

    const saveButton = screen.getByRole('button', { name: /Save updated details/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Company name is required.')
      expect(tplAPI.updateApplication).not.toHaveBeenCalled()
    })
  })

  it('auto-derives PAN from GSTIN when PAN is empty', async () => {
    render(
      <FixDetails
        applicationId="app-uuid-1"
        pan="AAPFU0939F"
        full={{ ...sampleApplication, pan_number: '', gstin: '' }}
        onSaved={vi.fn()}
      />
    )

    const panInput = screen.getByLabelText(/^PAN$/i) as HTMLInputElement
    const gstInput = screen.getByLabelText(/GSTIN/i) as HTMLInputElement

    expect(panInput.value).toBe('')

    fireEvent.change(gstInput, { target: { value: '27AAPFU0939F1ZV' } })

    expect(panInput.value).toBe('AAPFU0939F')
  })

  it('submits updated details correctly when valid', async () => {
    tplAPI.updateApplication.mockResolvedValueOnce({ success: true })
    const onSaved = vi.fn()

    render(
      <FixDetails
        applicationId="app-uuid-1"
        pan="AAPFU0939F"
        full={sampleApplication}
        onSaved={onSaved}
      />
    )

    const saveButton = screen.getByRole('button', { name: /Save updated details/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(tplAPI.updateApplication).toHaveBeenCalledWith('app-uuid-1', expect.objectContaining({
        verify_pan: 'AAPFU0939F',
        companyName: 'Mahalaxmi Transport',
        contactName: 'Ramesh Patel',
        entityType: 'Partnership',
        authorizedSignatoryName: 'Ramesh Patel',
      }))
      expect(toast.success).toHaveBeenCalledWith('Details saved')
      expect(onSaved).toHaveBeenCalled()
    })
  })
})
