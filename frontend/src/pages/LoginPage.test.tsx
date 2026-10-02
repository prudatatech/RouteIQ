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
  authAPI: { vendorSendOtp: mocks.vendorSendOtp, vendorVerifyOtp: mocks.vendorVerifyOtp },
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
      <Route path="/login" element={<><LoginPage audience="staff" /><Probe /></>} />
      <Route path="/vendor/login" element={<><LoginPage audience="vendor" /><Probe /></>} />
      <Route path="/3pl/login" element={<><LoginPage audience="tpl" /><Probe /></>} />
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

const rejected = (text: RegExp) => async () => {
  expect(await screen.findByText(text)).toBeTruthy()
  expect(mocks.signOut).toHaveBeenCalled()
  expect(useAuthStore.getState().token).toBeNull()
  expect(useAuthStore.getState().session).toBeNull()
}

describe('the three sign-in pages', () => {
  it('have their own titles', async () => {
    at('/login')
    expect(await screen.findByRole('heading', { name: 'Sign in to MargixIndia' })).toBeTruthy()
    cleanup(); at('/vendor/login')
    expect(await screen.findByRole('heading', { name: 'Vendor sign in' })).toBeTruthy()
    cleanup(); at('/3pl/login')
    expect(await screen.findByRole('heading', { name: '3PL partner sign in' })).toBeTruthy()
  })

  it('show no tabs and link to the other two pages', async () => {
    at('/login')
    await screen.findByRole('heading', { name: 'Sign in to MargixIndia' })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('link', { name: 'Vendor sign in' }).getAttribute('href')).toBe('/vendor/login')
    expect(screen.getByRole('link', { name: '3PL partner sign in' }).getAttribute('href')).toBe('/3pl/login')
    expect(screen.getByRole('link', { name: 'Register your logistic company' }).getAttribute('href')).toBe('/login?register=company')
  })

  it('offer sign-up and a mobile code to vendors, and apply and track links to 3PL partners', async () => {
    at('/vendor/login')
    expect(await screen.findByRole('button', { name: 'New here? Create a vendor account' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in with a mobile code' })).toBeTruthy()
    cleanup(); at('/3pl/login')
    expect((await screen.findByRole('link', { name: 'Apply to join' })).getAttribute('href')).toBe('/3pl/onboard')
    expect(screen.getByRole('link', { name: 'Track your application' }).getAttribute('href')).toBe('/3pl/onboard/track')
    expect(screen.queryByRole('button', { name: /create a vendor account/i })).toBeNull()
  })
})

describe('the staff sign-in', () => {
  it('accepts staff and goes to Today', async () => {
    at('/login')
    await submitPassword(staff)
    await waitFor(() => expect(where()).toBe('/today'))
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('rejects a vendor, signs out, and names the vendor sign-in', async () => {
    at('/login')
    await submitPassword(vendor)
    await rejected(/This is the staff sign-in\. Your account is a vendor account, so use the/)()
    expect(screen.getAllByRole('link', { name: 'vendor sign-in' })[0].getAttribute('href')).toBe('/vendor/login')
    expect(where()).toBe('/login')
  })

  it('rejects a 3PL partner and names the 3PL sign-in', async () => {
    at('/login')
    await submitPassword(tpl)
    await rejected(/Your account is a 3PL partner account/)()
    expect(screen.getAllByRole('link', { name: '3PL partner sign-in' })[0].getAttribute('href')).toBe('/3pl/login')
  })

  it('does not follow a next that belongs to the vendor area', async () => {
    at('/login?next=%2Fvendor%2Floads')
    await submitPassword(staff)
    await waitFor(() => expect(where()).toBe('/today'))
  })

  it('follows a next inside the staff area', async () => {
    at('/login?next=%2Fshipments%3Ftab%3Dopen')
    await submitPassword(staff)
    await waitFor(() => expect(where()).toBe('/shipments?tab=open'))
  })

  it('treats a member of a logistic company as staff', async () => {
    at('/login')
    const m: Membership = { org: { id: 'o1', kind: 'logistic_company', name: 'Acme', status: 'active' }, role: 'owner' }
    await submitPassword({ role: 'vendor', hasVendorProfile: false, tplPartnerId: null }, [m])
    await waitFor(() => expect(where()).toBe('/today'))
  })
})

describe('the vendor sign-in', () => {
  it('accepts a vendor and goes to My loads, or back to next inside the vendor area', async () => {
    at('/vendor/login')
    await submitPassword(vendor)
    await waitFor(() => expect(where()).toBe('/vendor/loads'))
    cleanup()
    useAuthStore.getState().clearAuth()
    at('/vendor/login?next=%2Fvendor%2Fclaims')
    await submitPassword(vendor)
    await waitFor(() => expect(where()).toBe('/vendor/claims'))
  })

  it('ignores a next outside the vendor area', async () => {
    at('/vendor/login?next=%2Ftoday')
    await submitPassword(vendor)
    await waitFor(() => expect(where()).toBe('/vendor/loads'))
  })

  it('rejects company staff with the message from the brief', async () => {
    at('/vendor/login')
    await submitPassword(staff)
    await rejected(/This is the vendor sign-in\. Your account is a company staff account, so use the/)()
    expect(screen.getByRole('link', { name: 'staff sign-in' }).getAttribute('href')).toBe('/login')
  })

  it('rejects a 3PL partner', async () => {
    at('/vendor/login')
    await submitPassword(tpl)
    await rejected(/Your account is a 3PL partner account/)()
  })

  it('checks the mobile code sign-in too, and signs out company staff', async () => {
    mocks.vendorSendOtp.mockResolvedValue({ ok: true })
    mocks.vendorVerifyOtp.mockResolvedValue({ session: { access_token: 'AT', refresh_token: 'RT' } })
    mocks.loadAccount.mockResolvedValue(staff)
    mocks.mine.mockResolvedValue([])
    at('/vendor/login')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with a mobile code' }))
    fireEvent.change(await screen.findByLabelText(/Mobile number/), { target: { value: '9820012345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    fireEvent.change(await screen.findByLabelText(/6-digit code/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))
    await rejected(/This is the vendor sign-in\. Your account is a company staff account/)()
    expect(mocks.setSession).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' })
  })

  it('accepts a vendor who signs in with a mobile code', async () => {
    mocks.vendorSendOtp.mockResolvedValue({ ok: true })
    mocks.vendorVerifyOtp.mockResolvedValue({ session: { access_token: 'AT', refresh_token: 'RT' } })
    mocks.loadAccount.mockResolvedValue(vendor)
    mocks.mine.mockResolvedValue([])
    at('/vendor/login')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with a mobile code' }))
    fireEvent.change(await screen.findByLabelText(/Mobile number/), { target: { value: '9820012345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    fireEvent.change(await screen.findByLabelText(/6-digit code/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))
    await waitFor(() => expect(where()).toBe('/vendor/loads'))
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('sends the sign-up confirmation and the reset link back to the vendor page', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null })
    at('/vendor/login?next=%2Fvendor%2Frequest%3Fresume%3D1')
    fireEvent.click(await screen.findByRole('button', { name: 'New here? Create a vendor account' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret-pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalled())
    const redirect = mocks.signUp.mock.calls[0][0].options.emailRedirectTo as string
    expect(redirect).toContain('/vendor/login?next=')
    expect(redirect).not.toContain('/login?as=')

    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalled())
    expect(mocks.resetPasswordForEmail.mock.calls[0][1].redirectTo).toContain('/vendor/login?reset=1')
  })
})

describe('the 3PL partner sign-in', () => {
  it('accepts a partner and opens their portal', async () => {
    at('/3pl/login')
    await submitPassword(tpl)
    await waitFor(() => expect(where()).toBe('/3pl-portal/p1'))
  })

  it('accepts a partner known only by an active 3PL organisation if it has a partner id', async () => {
    at('/3pl/login?next=%2F3pl-portal%2Fp1%2Fearnings')
    await submitPassword(tpl)
    await waitFor(() => expect(where()).toBe('/3pl-portal/p1/earnings'))
  })

  it('rejects staff and vendors', async () => {
    at('/3pl/login')
    await submitPassword(staff)
    await rejected(/This is the 3PL partner sign-in\. Your account is a company staff account/)()
    cleanup(); mocks.signOut.mockClear()
    at('/3pl/login')
    await submitPassword(vendor)
    await rejected(/Your account is a vendor account/)()
  })

  it('sends the reset link back to the 3PL page', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null })
    at('/3pl/login')
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalled())
    expect(mocks.resetPasswordForEmail.mock.calls[0][1].redirectTo).toContain('/3pl/login?reset=1')
  })
})

describe('someone already signed in', () => {
  it('keeps their own session and is told, not signed out, when they open another kind of page', async () => {
    useAuthStore.setState({ token: 'AT', session: session as never, role: 'admin' })
    mocks.loadAccount.mockResolvedValue(staff)
    mocks.mine.mockResolvedValue([])
    at('/vendor/login')
    expect(await screen.findByText('You are signed in with a company staff account')).toBeTruthy()
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Open my area' })).toBeTruthy()
  })
})

describe('old links', () => {
  it('open the vendor page from /login?as=vendor or ?as=partner, keeping next and the other parameters', async () => {
    at('/login?as=vendor&next=%2Fvendor%2Fclaims&email=a%40b.co')
    expect(await screen.findByRole('heading', { name: 'Vendor sign in' })).toBeTruthy()
    expect(where()).toBe('/vendor/login?next=%2Fvendor%2Fclaims&email=a%40b.co')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('a@b.co')
    cleanup()
    at('/login?as=partner&reset=1')
    expect(where()).toBe('/vendor/login?reset=1')
  })

  it('open the 3PL page from /login?as=3pl', async () => {
    at('/login?as=3pl&next=%2F3pl-portal%2Fp1')
    expect(await screen.findByRole('heading', { name: '3PL partner sign in' })).toBeTruthy()
    expect(where()).toBe('/3pl/login?next=%2F3pl-portal%2Fp1')
  })
})
