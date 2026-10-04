// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Membership } from '@/utils/orgs'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  setSession: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  loadAccount: vi.fn(),
  mine: vi.fn(),
  vendorSendOtp: vi.fn(),
  vendorVerifyOtp: vi.fn(),
  vendorSendResetLink: vi.fn(),
}))

vi.mock('@/services/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
      getSession: mocks.getSession,
      setSession: mocks.setSession,
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: vi.fn(),
    },
  },
}))
vi.mock('@/services/account', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/account')>()),
  loadAccount: mocks.loadAccount,
}))
vi.mock('@/services/api', () => ({
  orgAPI: { mine: mocks.mine },
  authAPI: { vendorSendOtp: mocks.vendorSendOtp, vendorVerifyOtp: mocks.vendorVerifyOtp, vendorSendResetLink: mocks.vendorSendResetLink },
}))

import LoginPage from './LoginPage'
import { useAuthStore } from '@/store/authStore'
import { useOrgStore } from '@/store/orgStore'
import { memoryAuthStorage } from '@/test-utils/authStorage'

memoryAuthStorage()

const staff = { role: 'admin', hasVendorProfile: false, tplPartnerId: null }
const vendor = { role: 'vendor', hasVendorProfile: true, tplPartnerId: null }
const tpl = { role: 'vendor', hasVendorProfile: false, tplPartnerId: 'p1' }
const session = { access_token: 'AT', refresh_token: 'RT', user: { id: 'u1' } }

function Probe() {
  const l = useLocation()
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>
}

const at = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/login" element={<><LoginPage /><Probe /></>} />
      <Route path="*" element={<Probe />} />
    </Routes>
  </MemoryRouter>,
)

const where = () => screen.getByTestId('where').textContent

async function submitPassword(account: object, memberships: Membership[] = []) {
  mocks.loadAccount.mockResolvedValue(account)
  mocks.mine.mockResolvedValue(memberships)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.co' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset())
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.signInWithPassword.mockResolvedValue({ data: { session }, error: null })
  mocks.getSession.mockResolvedValue({ data: { session } })
  mocks.setSession.mockResolvedValue({ error: null })
  useAuthStore.getState().clearAuth()
  useAuthStore.setState({ authInitialized: true })
  useOrgStore.getState().reset()
})
afterEach(() => cleanup())

const platformOrg: Membership = { org: { id: 'pl', kind: 'platform', name: 'MargixIndia', status: 'active' }, role: 'owner' }
const companyOrg: Membership = { org: { id: 'co', kind: 'logistic_company', name: 'MargixIndia Logistics', status: 'active' }, role: 'owner' }

describe('the one sign-in page', () => {
  it('has a single title and offers every way in', async () => {
    at('/login')
    expect(await screen.findByRole('heading', { name: 'Sign in to MargixIndia' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /vendor sign in|3PL partner sign in|staff sign in/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in with a mobile code' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New here? Create a vendor account' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Register your logistic company' }).getAttribute('href')).toBe('/login?register=company')
    expect(screen.getByRole('link', { name: 'Apply to join' }).getAttribute('href')).toBe('/3pl/onboard')
    expect(screen.getByRole('link', { name: 'Track your application' }).getAttribute('href')).toBe('/3pl/onboard/track')
  })
})

describe('after signing in, each account goes to its own area', () => {
  it('sends company staff to Today', async () => {
    at('/login')
    await submitPassword(staff, [companyOrg])
    await waitFor(() => expect(where()).toBe('/today'))
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('sends the platform owner to the platform console, even when they also sit in a company', async () => {
    at('/login')
    await submitPassword({ role: 'superadmin', hasVendorProfile: false, tplPartnerId: null }, [companyOrg, platformOrg])
    await waitFor(() => expect(where()).toBe('/platform/organisations'))
    expect(useOrgStore.getState().activeOrgId).toBe('pl')
  })

  it('sends a vendor to My loads, or back to next inside the vendor area', async () => {
    at('/login')
    await submitPassword(vendor)
    await waitFor(() => expect(where()).toBe('/vendor/loads'))
    cleanup()
    useAuthStore.getState().clearAuth()
    at('/login?next=%2Fvendor%2Fclaims')
    await submitPassword(vendor)
    await waitFor(() => expect(where()).toBe('/vendor/claims'))
  })

  it('sends a 3PL partner to their portal, or back to next inside it', async () => {
    at('/login')
    await submitPassword(tpl)
    await waitFor(() => expect(where()).toBe('/3pl-portal/p1'))
    cleanup()
    useAuthStore.getState().clearAuth()
    at('/login?next=%2F3pl-portal%2Fp1%2Fearnings')
    await submitPassword(tpl)
    await waitFor(() => expect(where()).toBe('/3pl-portal/p1/earnings'))
  })

  it('ignores a next that belongs to another kind of account', async () => {
    at('/login?next=%2Fvendor%2Floads')
    await submitPassword(staff, [companyOrg])
    await waitFor(() => expect(where()).toBe('/today'))
    cleanup()
    useAuthStore.getState().clearAuth()
    at('/login?next=%2Ftoday')
    await submitPassword(vendor)
    await waitFor(() => expect(where()).toBe('/vendor/loads'))
  })

  it('follows a next inside the staff area', async () => {
    at('/login?next=%2Fshipments%3Ftab%3Dopen')
    await submitPassword(staff, [companyOrg])
    await waitFor(() => expect(where()).toBe('/shipments?tab=open'))
  })

  it('treats a member of a logistic company as staff', async () => {
    at('/login')
    await submitPassword({ role: 'vendor', hasVendorProfile: false, tplPartnerId: null }, [companyOrg])
    await waitFor(() => expect(where()).toBe('/today'))
  })

  it('signs out an account with no area in the web app', async () => {
    at('/login')
    await submitPassword({ role: null, hasVendorProfile: false, tplPartnerId: null })
    expect(await screen.findByText(/does not have access to MargixIndia on the web/)).toBeTruthy()
    expect(mocks.signOut).toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('routes a mobile-code sign-in the same way', async () => {
    mocks.vendorSendOtp.mockResolvedValue({ ok: true })
    mocks.vendorVerifyOtp.mockResolvedValue({ session: { access_token: 'AT', refresh_token: 'RT' } })
    mocks.loadAccount.mockResolvedValue(vendor)
    mocks.mine.mockResolvedValue([])
    at('/login')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with a mobile code' }))
    fireEvent.change(await screen.findByLabelText(/Mobile number/), { target: { value: '9820012345' } })
    fireEvent.change(await screen.findByLabelText(/Email address/), { target: { value: 'vendor@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    fireEvent.change(await screen.findByLabelText(/6-digit code/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))
    await waitFor(() => expect(where()).toBe('/vendor/loads'))
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})

describe('sign-up and password reset', () => {
  it('send the confirmation and the reset link back to /login', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null })
    at('/login?next=%2Fvendor%2Frequest%3Fresume%3D1')
    fireEvent.click(await screen.findByRole('button', { name: 'New here? Create a vendor account' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret-pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalled())
    const redirect = mocks.signUp.mock.calls[0][0].options.emailRedirectTo as string
    expect(redirect).toContain('/login?next=')

    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(mocks.vendorSendResetLink).toHaveBeenCalled())
    expect(mocks.vendorSendResetLink.mock.calls[0][1]).toContain('/login?reset=1')
  })
})

describe('someone already signed in', () => {
  it('goes straight to their own area and is not signed out', async () => {
    useAuthStore.setState({ token: 'AT', session: session as never, role: 'vendor' })
    mocks.loadAccount.mockResolvedValue(vendor)
    mocks.mine.mockResolvedValue([])
    at('/login')
    await waitFor(() => expect(where()).toBe('/vendor/loads'))
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})
