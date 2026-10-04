// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const calls = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn() }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: (s: { userId: string }) => unknown) => selector({ userId: 'u1' }) }))
vi.mock('@/store/effectiveRole', () => ({ useEffectiveRole: () => ({ role: 'vendor' }) }))
vi.mock('@/hooks/useRealtimeRefresh', () => ({ useRealtimeRefresh: vi.fn() }))
vi.mock('@/services/api', () => ({ messagesAPI: { unread: vi.fn() } }))
vi.mock('@/services/supabase', () => ({
  supabase: {
    from: () => {
      let head = false
      const chain = {
        select: (_columns: string, options?: { head?: boolean }) => { head = !!options?.head; return chain },
        eq: () => chain, order: () => chain, limit: () => chain,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(head ? calls.count() : calls.list()).then(resolve, reject),
      }
      return chain
    },
    removeChannel: vi.fn(),
  },
  openChannel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel },
}))
import { NotificationsBell } from './NotificationsBell'

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('notification loading', () => {
  it('loads the badge without fetching bodies until the panel opens', async () => {
    calls.count.mockReturnValue({ count: 2, error: null })
    calls.list.mockReturnValue({ data: [{ id: 'n1', title: 'Load accepted', body: 'Your load was accepted', type: 'vendor_request', is_read: false, data: null, created_at: new Date().toISOString() }], error: null })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
    render(<QueryClientProvider client={client}><MemoryRouter><NotificationsBell /></MemoryRouter></QueryClientProvider>)
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    expect(calls.list).not.toHaveBeenCalled()
    fireEvent.click(bell)
    await screen.findByText('Load accepted')
    expect(calls.list).toHaveBeenCalledTimes(1)
    fireEvent.click(bell)
    fireEvent.click(bell)
    await waitFor(() => expect(screen.getByText('Load accepted')).toBeTruthy())
    expect(calls.list).toHaveBeenCalledTimes(1)
    client.clear()
  })
})
