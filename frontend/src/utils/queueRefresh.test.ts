import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { DISPATCH_KEYS, QUEUE_COUNT_KEYS, refreshAfterDispatchChange, refreshQueueCounts } from './queueRefresh'

afterEach(() => vi.useRealTimers())

describe('queue refresh', () => {
  it('names the shared counts and every list an assign, send, take-off or accept moves', () => {
    expect(QUEUE_COUNT_KEYS).toContainEqual(['ops-today'])
    for (const key of ['shipments', 'routes', 'vehicles', 'fleet-summary', 'customer-bookings', 'vendor-requests']) {
      expect(DISPATCH_KEYS).toContainEqual([key])
    }
  })

  it('reads the counts now and again after the delay', () => {
    vi.useFakeTimers()
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    refreshQueueCounts(qc, 1000)
    const counts = () => spy.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(['ops-today'])).length
    expect(counts()).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(counts()).toBe(2)
  })

  it('refreshes the dispatch lists once and the counts twice', () => {
    vi.useFakeTimers()
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    refreshAfterDispatchChange(qc, 500)
    vi.advanceTimersByTime(500)
    const keys = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
    expect(keys.filter(k => k === JSON.stringify(['routes']))).toHaveLength(1)
    expect(keys.filter(k => k === JSON.stringify(['ops-today']))).toHaveLength(2)
  })
})
