import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Keeps the selected tab in the URL (`?tab=bids`). */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T, key = 'tab'): [T, (id: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key) as T | null
  const value = raw && allowed.includes(raw) ? raw : fallback
  const set = useCallback((id: T) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      if (id === fallback) next.delete(key)
      else next.set(key, id)
      return next
    }, { replace: true })
  }, [setParams, fallback, key])
  return [value, set]
}

/**
 * A page that opens on a tab with nothing in it while the work waits in another tab looks empty.
 * Once the counts are known, and only when the address names no tab, move to the first tab in `order`
 * that has work. It acts once, so it never jumps while someone is using the page.
 */
export function useOpenOnWork<T extends string>(
  order: readonly T[],
  counts: Partial<Record<T, number | undefined>>,
  current: T,
  setTab: (id: T) => void,
  key = 'tab',
): void {
  const [params] = useSearchParams()
  const settled = useRef(false)
  const explicit = params.has(key)
  const currentCount = counts[current]
  const target = firstWithWork(order, counts)
  useEffect(() => {
    if (settled.current) return
    if (explicit) { settled.current = true; return }
    // Wait until the count of the tab we are on is known
    if (currentCount === undefined) return
    settled.current = true
    if (currentCount === 0 && target && target !== current) setTab(target)
  }, [explicit, currentCount, target, current, setTab])
}

/** The first of `order` whose count is above zero, or null when none is (or the counts are not known yet). */
export function firstWithWork<T extends string>(order: readonly T[], counts: Partial<Record<T, number | undefined>>): T | null {
  return order.find(id => (counts[id] ?? 0) > 0) ?? null
}
