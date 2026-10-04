// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const read = vi.hoisted(() => vi.fn())
vi.mock('@/services/supabase', () => ({
  supabase: { from: () => ({ select: read }), removeChannel: vi.fn() },
  openChannel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel },
}))
import { useLiveVehiclePositions } from './useLiveVehiclePositions'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); read.mockReset() })
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>

describe('live position polling', () => {
  it('never starts another poll while a slow request is running', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    let finish!: (v: unknown) => void
    read.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const hook = renderHook(useLiveVehiclePositions, { wrapper })
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ data: [], error: null }) })
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(read).toHaveBeenCalledTimes(2)
    hook.unmount()
    await act(async () => { finish({ data: [], error: null }) })
  })

  it('pauses in hidden tabs and refreshes when the tab becomes visible', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    read.mockResolvedValue({ data: [], error: null })
    const hook = renderHook(useLiveVehiclePositions, { wrapper })
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(read).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(read).toHaveBeenCalledTimes(1)
    hook.unmount()
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(read).toHaveBeenCalledTimes(1)
  })
})
