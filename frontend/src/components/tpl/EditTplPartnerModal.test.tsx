// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'
import { EditTplPartnerModal } from './EditTplPartnerModal'

const tplAPI = vi.hoisted(() => ({
  updateApplication: vi.fn(),
}))

const bankAPI = vi.hoisted(() => ({
  ifsc: vi.fn().mockResolvedValue({
    bank: 'HDFC Bank',
    branch: 'Bandra',
    city: 'Mumbai',
    state: 'Maharashtra',
    neft: true,
    rtgs: true,
    imps: true,
    upi: true,
  }),
}))

vi.mock('@/services/api', () => ({ tplAPI, bankAPI }))
vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('EditTplPartnerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  const defaultPartner = {
    id: 'partner-uuid-1',
    company_name: 'Fast Logistics',
    contact_name: null,
    phone: null,
    custom_id: 'fast_logistics',
    pan_number: null,
    gstin: null,
    bank_account_no: null,
    bank_ifsc: null,
  }

  it('allows saving KYC details in partner portal without requiring hidden contactName', async () => {
    tplAPI.updateApplication.mockResolvedValueOnce({ warnings: [] })
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(
      <EditTplPartnerModal
        open
        onClose={onClose}
        partner={defaultPartner}
        onSaved={onSaved}
        isPartnerPortal
      />
    )

    // Fill PAN on Legal & Tax tab
    const panInput = screen.getByLabelText(/Company PAN/i)
    fireEvent.change(panInput, { target: { value: 'ABCDE1234F' } })

    // Switch to Bank & Payout tab
    const bankTab = screen.getByRole('button', { name: /Bank & Payout/i })
    fireEvent.click(bankTab)

    // Fill Bank Account Number
    const accountInput = screen.getByLabelText(/Bank Account Number/i)
    fireEvent.change(accountInput, { target: { value: '12345678901' } })

    // Save
    const saveButton = screen.getByRole('button', { name: /Save Details/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(tplAPI.updateApplication).toHaveBeenCalledWith('partner-uuid-1', expect.objectContaining({
        pan: 'ABCDE1234F',
        bankAccount: '12345678901',
      }))
      expect(toast.success).toHaveBeenCalledWith('KYC details submitted')
      expect(onSaved).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('switches to tab with error and shows specific error toast when save is attempted', async () => {
    render(
      <EditTplPartnerModal
        open
        onClose={vi.fn()}
        partner={defaultPartner}
        onSaved={vi.fn()}
        isPartnerPortal
      />
    )

    // Enter invalid PAN on Legal & Tax tab
    const panInput = screen.getByLabelText(/Company PAN/i)
    fireEvent.change(panInput, { target: { value: 'INVALID' } })

    // Switch to Bank & Payout tab
    const bankTab = screen.getByRole('button', { name: /Bank & Payout/i })
    fireEvent.click(bankTab)

    // Now on Bank tab, click Save
    const saveButton = screen.getByRole('button', { name: /Save Details/i })
    fireEvent.click(saveButton)

    // Should automatically switch back to Legal & Tax tab and show error toast
    expect(toast.error).toHaveBeenCalledWith('PAN looks incorrect (e.g. ABCDE1234F)')
    expect(screen.getByLabelText(/Company PAN/i)).toBeTruthy()
    expect(screen.getByText('PAN looks incorrect (e.g. ABCDE1234F)')).toBeTruthy()
  })

  it('auto-fills PAN from GSTIN when PAN is empty', () => {
    render(
      <EditTplPartnerModal
        open
        onClose={vi.fn()}
        partner={defaultPartner}
        onSaved={vi.fn()}
        isPartnerPortal
      />
    )

    const gstInput = screen.getByLabelText(/GSTIN/i)
    fireEvent.change(gstInput, { target: { value: '27ABCDE1234F1Z5' } })

    const panInput = screen.getByLabelText(/Company PAN/i) as HTMLInputElement
    expect(panInput.value).toBe('ABCDE1234F')
  })
})
