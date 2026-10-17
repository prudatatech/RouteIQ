// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfirmProvider } from '@/components/ui'
import type { TplOffer, TplOrder } from '@/services/api'
import type { Grouped } from '@/types/network'

const api = vi.hoisted(() => ({
  myOffers: vi.fn(),
  myOrders: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  updateOrder: vi.fn(),
}))
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, tplNetworkAPI: api, tplPortalAPI: { vehicles: vi.fn().mockResolvedValue([]), drivers: vi.fn().mockResolvedValue([]) } }
})

const channel = vi.hoisted(() => ({ on: vi.fn(), subscribe: vi.fn() }))
channel.on.mockReturnValue(channel)
channel.subscribe.mockReturnValue(channel)
vi.mock('@/services/supabase', () => ({
  supabase: { auth: {}, removeChannel: vi.fn() },
  openChannel: vi.fn(() => channel),
}))

import { TplOrdersTab } from './TplOrdersTab'

function offer(over: Partial<TplOffer> = {}): TplOffer {
  return {
    id: 'o1', partner_id: 'p1', partner_name: null, source_type: 'request', request_id: 'r1', shipment_id: null,
    corridor_name: 'Delhi-Mumbai', company_name: 'Acme', pickup_location: 'Delhi, India', drop_location: 'Mumbai, India',
    weight_kg: 500, proposed_price: 1000, status: 'offered', pickup_eta: null, decline_reason: null,
    offered_at: '2026-10-15T00:00:00Z', responded_at: null, ...over,
  }
}

function order(over: Partial<TplOrder> = {}): TplOrder {
  return {
    id: 'ord1', offer_id: 'o0', partner_id: 'p1', partner_name: null, company_name: 'Acme', source_type: 'request',
    request_id: 'r0', shipment_id: null, pickup_location: 'Delhi, India', drop_location: 'Mumbai, India', weight_kg: 500,
    agreed_amount: 1200, status: 'accepted', pickup_eta: null, due_by: null, accepted_at: '2026-10-14T00:00:00Z',
    picked_up_at: null, delivered_at: null, pod_note: null, paid_at: null, paid_reference: null, rating: null,
    rating_note: null, ...over,
  }
}

function grouped<T>(items: T[]): Grouped<T> {
  return { items, companies: [] }
}

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfirmProvider>
      <MemoryRouter>
        <TplOrdersTab partnerId="p1" canAccept />
      </MemoryRouter>
    </ConfirmProvider>
  </QueryClientProvider>,
)

beforeEach(() => { Object.values(api).forEach(m => m.mockReset()) })
afterEach(cleanup)

describe('TplOrdersTab error isolation', () => {
  it('shows the orders when only the offers query fails', async () => {
    api.myOffers.mockRejectedValue(new Error('network down'))
    api.myOrders.mockResolvedValue(grouped([order()]))

    show()

    await screen.findByText('We could not load your offers. Check your connection and try again.')
    expect(await screen.findByText('₹1,200')).toBeTruthy()
    expect(screen.queryByText('We could not load your orders. Check your connection and try again.')).toBeNull()
  })

  it('shows the offers when only the orders query fails', async () => {
    api.myOffers.mockResolvedValue(grouped([offer()]))
    api.myOrders.mockRejectedValue(new Error('network down'))

    show()

    await screen.findByText('We could not load your orders. Check your connection and try again.')
    expect(await screen.findByText('₹1,000')).toBeTruthy()
    expect(screen.queryByText('We could not load your offers. Check your connection and try again.')).toBeNull()
  })
})
