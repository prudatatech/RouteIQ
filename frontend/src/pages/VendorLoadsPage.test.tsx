// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { VendorLoad } from '@/components/vendor/loads'

const api = vi.hoisted(() => ({
  loads: vi.fn(), myPostedLoads: vi.fn(), invoices: vi.fn(),
}))
vi.mock('@/services/api', () => ({ vendorAPI: api }))

const vendorContext = vi.hoisted(() => vi.fn())
vi.mock('@/components/vendor/vendorContext', () => ({ useVendorContext: vendorContext }))

const channel = vi.hoisted(() => ({ on: vi.fn(), subscribe: vi.fn() }))
channel.on.mockReturnValue(channel)
channel.subscribe.mockReturnValue(channel)
vi.mock('@/services/supabase', () => ({
  supabase: { removeChannel: vi.fn(), auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }), onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }) } },
  openChannel: vi.fn(() => channel),
}))

import VendorLoadsPage from './VendorLoadsPage'

const load = (over: Partial<VendorLoad> = {}): VendorLoad => ({
  id: 'load-1', kind: 'posted', code: 'MI-1001', request_id: 'r1', manifest_id: null, shipment_id: null, bid_id: null,
  stage: 'waiting', status: 'pending', outcome: null, pickup: 'Pune', drop: 'Nashik', weight_kg: 500, pieces: 10,
  price: null, price_source: null, truck: null, tracking_id: null, with_partner: false, rejection_reason: null,
  created_at: '2026-10-10T00:00:00.000Z', delivered_at: null, invoice: null, problems: [],
  ...over,
})

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><VendorLoadsPage /></MemoryRouter>
  </QueryClientProvider>,
)

afterEach(() => cleanup())

describe('VendorLoadsPage search', () => {
  it('shows the search box even with just a couple of loads, matching Fleet and Trips pages', async () => {
    vendorContext.mockReturnValue({
      vendorProfile: { id: 'v1', company_name: 'Acme', city: 'Pune', company_logo: null, kycStatus: 'approved', kycRejectionReason: null, hasLocation: true },
      profileLoading: false, isSignedIn: true, isVendor: true, refreshProfile: vi.fn(),
    })
    api.loads.mockResolvedValue([load(), load({ id: 'load-2', code: 'MI-1002' })])
    api.myPostedLoads.mockResolvedValue({ items: [] })
    api.invoices.mockResolvedValue([])

    show()

    expect(await screen.findByText('MI-1001')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search by code, place or truck')).toBeTruthy()
  })
})
