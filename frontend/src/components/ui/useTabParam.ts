import { useCallback } from 'react'
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
