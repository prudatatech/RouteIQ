// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Membership } from '@/utils/orgs'

vi.mock('@/services/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }))

import PrivateRoute from './PrivateRoute'
import { useAuthStore } from '@/store/authStore'
import { useOrgStore } from '@/store/orgStore'
import { memoryAuthStorage } from '@/test-utils/authStorage'

memoryAuthStorage()

function Probe() {
  const l = useLocation()
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>
}

const area = (name: string) => <div>{name}</div>

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/vendor/loads" element={<PrivateRoute allowedRoles={['vendor']} kinds={['vendor']}>{area('vendor loads')}</PrivateRoute>} />
        <Route path="/3pl-portal/:id/*" element={<PrivateRoute allowedRoles={['vendor']} kinds={['tpl']}>{area('partner portal')}</PrivateRoute>} />
        <Route path="/today" element={<PrivateRoute allowedRoles={['admin']}>{area('today')}</PrivateRoute>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
}

function signIn(role: string, opts: { tplPartnerId?: string; memberships?: Membership[] } = {}) {
  useAuthStore.setState({ token: 't', role, tplPartnerId: opts.tplPartnerId ?? null, authInitialized: true })
  useOrgStore.getState().setMemberships(opts.memberships ?? [])
}

beforeEach(() => {
  useAuthStore.getState().clearAuth()
  useAuthStore.setState({ authInitialized: true })
  useOrgStore.getState().reset()
})
afterEach(() => cleanup())

describe('PrivateRoute sign-in redirects', () => {
  it('sends a visitor of /vendor pages to the sign-in, keeping next', () => {
    at('/vendor/loads')
    expect(screen.getByTestId('where').textContent).toBe('/login?next=%2Fvendor%2Floads')
  })

  it('sends a visitor of the 3PL portal to the sign-in, keeping next', () => {
    at('/3pl-portal/p1/orders?tab=open')
    expect(screen.getByTestId('where').textContent).toBe('/login?next=%2F3pl-portal%2Fp1%2Forders%3Ftab%3Dopen')
  })

  it('sends a visitor of any other page to the sign-in', () => {
    at('/today')
    expect(screen.getByTestId('where').textContent).toBe('/login?next=%2Ftoday')
  })
})

describe('PrivateRoute areas', () => {
  it('opens the vendor pages for a vendor', () => {
    signIn('vendor')
    at('/vendor/loads')
    expect(screen.getByText('vendor loads')).toBeTruthy()
  })

  it('blocks a 3PL account from /vendor/loads and sends it to its own portal', () => {
    signIn('vendor', { tplPartnerId: 'p1' })
    at('/vendor/loads')
    expect(screen.queryByText('vendor loads')).toBeNull()
    expect(screen.getByText('partner portal')).toBeTruthy()
  })

  it('blocks a vendor from the 3PL portal and sends it to its own home', () => {
    signIn('vendor')
    at('/3pl-portal/p1')
    expect(screen.queryByText('partner portal')).toBeNull()
    expect(screen.getByText('vendor loads')).toBeTruthy()
  })

  it('opens the portal for a 3PL account', () => {
    signIn('vendor', { tplPartnerId: 'p1' })
    at('/3pl-portal/p1/orders')
    expect(screen.getByText('partner portal')).toBeTruthy()
  })

  it('blocks staff from both areas and sends them to Today', () => {
    signIn('admin')
    at('/vendor/loads')
    expect(screen.getByText('today')).toBeTruthy()
    cleanup()
    at('/3pl-portal/p1')
    expect(screen.getByText('today')).toBeTruthy()
  })

  it('blocks a company owner whose account role is vendor from the vendor pages', () => {
    const m: Membership = { org: { id: 'o1', kind: 'logistic_company', name: 'Acme', status: 'active' }, role: 'owner', app_role: 'admin' }
    signIn('vendor', { memberships: [m] })
    at('/vendor/loads')
    expect(screen.queryByText('vendor loads')).toBeNull()
  })

  it('leaves routes without kinds as they were', () => {
    signIn('admin')
    at('/today')
    expect(screen.getByText('today')).toBeTruthy()
  })
})
