// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TodayResponse } from '@/services/api'

const api = vi.hoisted(() => ({
  today: vi.fn(),
  vehiclesList: vi.fn(),
  fleetAlerts: vi.fn(),
  fleetAlertSettings: vi.fn(),
  insights: vi.fn(),
  peopleAttention: vi.fn(),
}))
vi.mock('@/services/api', () => ({
  opsAPI: { today: api.today },
  vehiclesAPI: { list: api.vehiclesList },
  fleetAPI: { alerts: api.fleetAlerts, alertSettings: api.fleetAlertSettings },
  analyticsAPI: { insights: api.insights },
  peopleAPI: { attention: api.peopleAttention },
}))

const supabaseState = vi.hoisted(() => ({ result: Promise.resolve({ data: [], error: null }) as Promise<unknown> }))
vi.mock('@/services/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: () => supabaseState.result,
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

const role = vi.hoisted(() => ({ role: 'admin' }))
vi.mock('@/store/effectiveRole', () => ({ useEffectiveRole: () => ({ role: role.role }) }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: (s: { userId: string }) => unknown) => selector({ userId: 'user-1' }) }))
vi.mock('@/store/draftStore', () => ({ useDraftStore: (selector: (s: { openModal: () => void }) => unknown) => selector({ openModal: vi.fn() }) }))
vi.mock('@/hooks/usePendingOrgCount', () => ({ usePendingOrgCount: () => null }))
vi.mock('@/hooks/useRealtimeRefresh', () => ({ useRealtimeRefresh: () => {} }))
vi.mock('@/components/map/LiveMap', () => ({ default: () => <div data-testid="live-map-marker" /> }))
vi.mock('@/components/today/DirectLoadAllocation', () => ({ default: () => <div data-testid="direct-load-marker" /> }))

import TodayPage from './TodayPage'

function todayFixture(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    scope: 'all',
    generated_at: '2026-10-17T00:00:00Z',
    queues: {
      sos: { count: 0 },
      problems: { count: 0, overdue: 0 },
      requests: { count: 0, bookings: 0, vendor_loads: 0 },
      needs_vehicle: { count: 0, shipments: 0, vendor_loads: 0 },
      trips_to_send: { count: 0 },
      vehicle_requests: { count: 0 },
      documents: { count: 0 },
      driver_actions: { count: 0 },
    },
    live: { active_trips: 0, vehicles_on_road: 0, on_time_rate_pct: null },
    ...overrides,
  }
}

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/today']}>
        <TodayPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A promise that only settles when the test calls one of the returned functions. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  Object.values(api).forEach(m => m.mockReset())
  api.today.mockResolvedValue(todayFixture())
  api.vehiclesList.mockResolvedValue([])
  api.fleetAlerts.mockResolvedValue([])
  api.fleetAlertSettings.mockResolvedValue({})
  api.insights.mockResolvedValue([])
  api.peopleAttention.mockResolvedValue({ expired_licences: [], expiring_licences: [], missing_required: [] })
  supabaseState.result = Promise.resolve({ data: [], error: null })
  role.role = 'admin'
})
afterEach(cleanup)

describe('TodayPage layout', () => {
  it('puts fleet-attention content before the Direct Load Allocation widget, matching the "most urgent first" subtitle', async () => {
    show()
    await screen.findByTestId('direct-load-marker')
    const fleetHeading = screen.getByRole('heading', { name: 'Fleet needs attention' })
    const marker = screen.getByTestId('direct-load-marker')
    // DOCUMENT_POSITION_FOLLOWING (4) means `marker` comes after `fleetHeading` in the DOM.
    expect(fleetHeading.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('TodayPage "Fleet needs attention" loading and error states', () => {
  it('shows a loading skeleton, not the empty state, while vehicles/fleet alarms/insights are pending', async () => {
    const pending = deferred<unknown[]>()
    api.vehiclesList.mockReturnValue(pending.promise)

    show()
    const heading = await screen.findByRole('heading', { name: 'Fleet needs attention' })
    const card = heading.closest<HTMLElement>('.rounded-card')!
    expect(within(card).queryByText('All clear')).toBeNull()
    expect(card.querySelector('[aria-busy="true"]')).not.toBeNull()

    pending.resolve([])
    await waitFor(() => expect(within(card).getByText('All clear')).toBeTruthy())
  })

  it('shows a real error state with retry when the fleet alarms query rejects, not the empty state', async () => {
    api.fleetAlerts.mockRejectedValue(new Error('network down'))

    show()
    await screen.findByText('We could not load fleet health')
    expect(screen.queryByText('No fleet issues need attention right now.')).toBeNull()

    api.fleetAlerts.mockResolvedValue([])
    screen.getByRole('button', { name: 'Try again' }).click()
    await waitFor(() => expect(api.fleetAlerts).toHaveBeenCalledTimes(2))
  })
})

describe('TodayPage "People need attention" loading and error states', () => {
  it('shows a loading skeleton while people-attention is pending, for a role that is allowed to see it', async () => {
    const pending = deferred<unknown>()
    api.peopleAttention.mockReturnValue(pending.promise)
    role.role = 'manager'

    show()
    await screen.findByRole('heading', { name: 'Fleet needs attention' })
    const heading = await screen.findByRole('heading', { name: 'People need attention' })
    const card = heading.closest<HTMLElement>('.rounded-card')!
    expect(card.querySelector('[aria-busy="true"]')).not.toBeNull()

    pending.resolve({ expired_licences: [], expiring_licences: [], missing_required: [] })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'People need attention' })).toBeNull())
  })

  it('shows a real error state with retry when people-attention rejects', async () => {
    role.role = 'manager'
    api.peopleAttention.mockRejectedValue(new Error('network down'))

    show()
    await screen.findByText('We could not load people needing attention')

    api.peopleAttention.mockResolvedValue({ expired_licences: [], expiring_licences: [], missing_required: [] })
    screen.getByRole('button', { name: 'Try again' }).click()
    await waitFor(() => expect(api.peopleAttention).toHaveBeenCalledTimes(2))
  })
})

describe('TodayPage driver-actions queue card loading and error states', () => {
  it('shows a loading skeleton, then a real error state with retry, instead of nothing', async () => {
    api.today.mockResolvedValue(todayFixture({ queues: { ...todayFixture().queues, driver_actions: { count: 1 } } }))
    const pending = deferred<{ data: unknown[]; error: null }>()
    supabaseState.result = pending.promise

    show()
    const queueHeading = await screen.findByRole('heading', { name: /Driver actions refused or stops flagged/ })
    const card = queueHeading.closest('li')!
    expect(card.querySelector('[aria-busy="true"]')).not.toBeNull()

    pending.reject(new Error('network down'))
    await waitFor(() => expect(within(card).getByText('We could not load these notifications')).toBeTruthy())

    supabaseState.result = Promise.resolve({ data: [], error: null })
    within(card).getByRole('button', { name: 'Try again' }).click()
    await waitFor(() => expect(within(card).queryByText('We could not load these notifications')).toBeNull())
  })
})
