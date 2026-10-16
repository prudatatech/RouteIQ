// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Membership } from '@/utils/orgs'

vi.mock('@/services/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }))

import { OrgGuard } from './OrgGuard'
import { useOrgStore } from '@/store/orgStore'

const m = (kind: Membership['org']['kind'], status = 'active'): Membership => ({ org: { id: `${kind}-1`, kind, name: `${kind}-1`, status }, role: 'owner' })

function Probe() {
  const l = useLocation()
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>
}

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="*" element={<OrgGuard><div>{url} content</div></OrgGuard>} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useOrgStore.getState().reset()
})
afterEach(() => cleanup())

describe('OrgGuard: company-operational pages vs the platform', () => {
  it('opens a company-operational page for a company', () => {
    useOrgStore.getState().setMemberships([m('logistic_company')])
    at('/today')
    expect(screen.getByText('/today content')).toBeTruthy()
  })
  it('shows the platform owner a message instead of a company-operational page, with no redirect loop', () => {
    useOrgStore.getState().setMemberships([m('platform')])
    at('/today')
    expect(screen.queryByText('/today content')).toBeNull()
    expect(screen.getByRole('heading', { name: /belongs to a logistic company/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /back to organisations/i }).getAttribute('href')).toBe('/platform/organisations')
  })
  it('still opens the platform owner’s own pages (Platform, People, Settings)', () => {
    useOrgStore.getState().setMemberships([m('platform')])
    for (const url of ['/platform/organisations', '/admin/users', '/admin/settings']) {
      cleanup()
      at(url)
      expect(screen.getByText(`${url} content`)).toBeTruthy()
    }
  })
  it('keeps the existing platform-only block for a company (unchanged behaviour)', () => {
    useOrgStore.getState().setMemberships([m('logistic_company')])
    at('/admin/kyc')
    expect(screen.queryByText('/admin/kyc content')).toBeNull()
    expect(screen.getByRole('heading', { name: /for the MargixIndia platform team/i })).toBeTruthy()
  })
})
