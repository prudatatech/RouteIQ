// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RegistryRow } from '@/components/admin/vendor-review/types'

const api = vi.hoisted(() => ({ registryAll: vi.fn() }))
vi.mock('@/services/api', () => ({ vendorAPI: api }))
vi.mock('@/services/supabase', () => ({ supabase: {} }))
vi.mock('@/hooks/useRealtimeRefresh', () => ({ useRealtimeRefresh: () => undefined }))
vi.mock('@/store/effectiveRole', () => ({ useEffectiveRole: () => ({ role: 'admin' }) }))

import KycReviewPage from './KycReviewPage'

const row = (id: string, name: string, kyc_status: RegistryRow['kyc_status'], over: Partial<RegistryRow> = {}): RegistryRow => ({
  id, name, email: `${id}@x.in`, phone: null, created_at: '2026-09-01T00:00:00Z', kyc_status, org_status: 'active', gstin: null, city: 'Pune',
  updated_at: '2026-09-02T00:00:00Z', kyc_reviewed_at: null, open_requests: 0, ...over,
})

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}</div>
}

const show = (url = '/admin/kyc') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/kyc" element={<KycReviewPage />} />
        <Route path="/admin/kyc/:vendorId" element={<Where />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)

beforeEach(() => {
  api.registryAll.mockReset()
  api.registryAll.mockResolvedValue({
    total: 4,
    items: [
      row('a1', 'Alpha Freight', 'submitted'),
      row('b2', 'Beta Cargo', 'pending'),
      row('c3', 'Gamma Movers', 'info_requested', { open_requests: 1 }),
      row('d4', 'Delta Lines', 'approved'),
    ],
  })
})
afterEach(() => cleanup())

describe('KycReviewPage', () => {
  it('lists vendors by tab, including those who never submitted, and opens the detail page on click', async () => {
    show()
    expect((await screen.findAllByText('Alpha Freight')).length).toBeGreaterThan(0)
    expect(screen.queryAllByText('Beta Cargo')).toHaveLength(0)
    fireEvent.click(screen.getByRole('tab', { name: /Not submitted/ }))
    expect((await screen.findAllByText('Beta Cargo')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: /More details asked/ }))
    expect((await screen.findAllByText('Gamma Movers')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 open request').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('Gamma Movers')[0])
    expect(screen.getByTestId('where').textContent).toBe('/admin/kyc/c3')
  })

  it('searches across all vendors', async () => {
    show('/admin/kyc?tab=all')
    expect((await screen.findAllByText('Delta Lines')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Search vendors'), { target: { value: 'beta' } })
    expect((await screen.findAllByText('Beta Cargo')).length).toBeGreaterThan(0)
  })

  it('redirects the old ?open= link to the detail page', async () => {
    show('/admin/kyc?open=zz9')
    expect((await screen.findByTestId('where')).textContent).toBe('/admin/kyc/zz9')
  })
})
