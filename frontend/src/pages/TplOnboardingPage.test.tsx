// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  checkPartner: vi.fn(),
  checkAvailability: vi.fn(),
  onboard: vi.fn(),
  byUser: vi.fn(),
}))
vi.mock('@/services/api', () => ({
  tplAPI: api,
  publicAPI: { vehicleClasses: vi.fn().mockResolvedValue([]) },
}))

const SESSION = { user: { id: 'u1', email: 'owner@acme.in', user_metadata: {} }, access_token: 't' }
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}))
vi.mock('@/services/supabase', () => ({ supabase: { auth } }))
vi.mock('@/services/account', () => ({ loadAccount: vi.fn().mockResolvedValue({ role: 'vendor', hasVendorProfile: false }) }))

import TplOnboardingPage from './TplOnboardingPage'

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/3pl/onboard']}>
      <TplOnboardingPage />
    </MemoryRouter>
  </QueryClientProvider>,
)

beforeEach(() => {
  Object.values(api).forEach(m => m.mockReset())
  auth.getSession.mockReset().mockResolvedValue({ data: { session: SESSION } })
  auth.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  api.checkPartner.mockResolvedValue(null)
  api.checkAvailability.mockResolvedValue({ taken: false })
})
afterEach(cleanup)

const fillStep0 = async () => {
  await screen.findByLabelText(/Company name/)
  fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: 'Acme Logistics' } })
  fireEvent.change(screen.getByLabelText(/Contact person/), { target: { value: 'Priya Rao' } })
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'priya@acme.in' } })
  fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '9800000000' } })
  fireEvent.change(screen.getByLabelText(/Operating from/), { target: { value: 'Mumbai, MH' } })
}

describe('TplOnboardingPage duplicate email/phone', () => {
  it('flags a duplicate email right at the field, on blur, before the user tries to submit', async () => {
    api.checkAvailability.mockImplementation((field: string) =>
      Promise.resolve({ taken: field === 'email' }))
    show()
    await fillStep0()
    fireEvent.blur(screen.getByLabelText(/^Email/))
    expect(await screen.findByText(/already exists/i)).toBeTruthy()
    expect(api.checkAvailability).toHaveBeenCalledWith('email', 'priya@acme.in')
  })

  it('flags a duplicate mobile number right at the field, on blur', async () => {
    api.checkAvailability.mockImplementation((field: string) =>
      Promise.resolve({ taken: field === 'phone' }))
    show()
    await fillStep0()
    fireEvent.blur(screen.getByLabelText(/Mobile number/))
    expect(await screen.findByText(/mobile number already exists/i)).toBeTruthy()
    expect(api.checkAvailability).toHaveBeenCalledWith('phone', '9800000000')
  })

  it('blocks moving to the next step while either is a known duplicate', async () => {
    api.checkAvailability.mockResolvedValue({ taken: true })
    show()
    await fillStep0()
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    await waitFor(() => expect(screen.getAllByText(/already exists/i).length).toBeGreaterThan(0))
    // Still on step 1 ("Contact Details"), not advanced to step 2's heading
    expect(screen.getByRole('heading', { name: 'Contact Details' })).toBeTruthy()
  })

  it('does not block on a clean email and phone', async () => {
    show()
    await fillStep0()
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    await waitFor(() => expect(api.checkAvailability).toHaveBeenCalledWith('email', 'priya@acme.in'))
    expect(screen.queryByText(/already exists/i)).toBeNull()
  })

  it('clears a shown duplicate error as soon as the applicant edits the field again', async () => {
    api.checkAvailability.mockResolvedValue({ taken: true })
    show()
    await fillStep0()
    fireEvent.blur(screen.getByLabelText(/^Email/))
    await screen.findByText(/already exists/i)
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'priya2@acme.in' } })
    expect(screen.queryByText(/already exists/i)).toBeNull()
  })
})

describe('TplOnboardingPage onboarding modes', () => {
  it('defaults to Quick Onboard mode and allows toggling to Complete Self-Onboarding', async () => {
    show()
    expect(await screen.findByText('Quick Onboard (2 mins)')).toBeTruthy()
    expect(screen.getByText('Complete Self-Onboarding')).toBeTruthy()

    // Default has 3 steps (Contact, Fleet, Review)
    expect(screen.queryByText('Business & Identity')).toBeNull()

    // Toggle to Complete Self-Onboarding
    fireEvent.click(screen.getByText('Complete Self-Onboarding'))
    expect(screen.getByText('Business & Identity')).toBeTruthy()
    expect(screen.getByText('KYC Documents')).toBeTruthy()
  })
})
