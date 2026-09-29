import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface UseUrlStateOptions {
  /** Default value; when the local value equals this, the URL param is removed rather than set. */
  fallback?: string
  /** Debounce URL writes by this many ms (local state still updates immediately). 0 writes instantly. */
  debounceMs?: number
  /** Whether a write creates a new history entry ('push') or replaces the current one ('replace', the default). */
  history?: 'push' | 'replace'
}

/**
 * Keeps a single string value in the URL query string (`?key=value`), merging into the
 * existing `URLSearchParams` so other query params are never dropped.
 *
 * Returns `[value, setValue]`: `value` updates immediately (for a responsive input), while
 * the URL write can be debounced (for search boxes) or instant (for everything else).
 */
export function useUrlState(key: string, options: UseUrlStateOptions = {}): [string, (value: string) => void] {
  const { fallback = '', debounceMs = 0, history = 'replace' } = options
  const [params, setParams] = useSearchParams()
  const urlValue = params.get(key) ?? fallback
  const [local, setLocal] = useState(urlValue)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow external URL changes (back/forward, or another control writing the same key).
  useEffect(() => {
    setLocal(urlValue)
  }, [urlValue])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const writeToUrl = useCallback((value: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      if (!value || value === fallback) next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: history === 'replace' })
  }, [setParams, key, fallback, history])

  const setValue = useCallback((value: string) => {
    setLocal(value)
    if (timer.current) clearTimeout(timer.current)
    if (debounceMs > 0) {
      timer.current = setTimeout(() => writeToUrl(value), debounceMs)
    } else {
      writeToUrl(value)
    }
  }, [debounceMs, writeToUrl])

  return [local, setValue]
}

export type SortState = { key: string; direction: 'asc' | 'desc' } | null

/** `{key,direction}` <-> a single `key:direction` URL param value, for `DataTable`'s controlled sort. */
export function serializeSort(sort: SortState): string {
  return sort ? `${sort.key}:${sort.direction}` : ''
}

export function parseSort(value: string): SortState {
  const [key, direction] = value.split(':')
  if (!key || (direction !== 'asc' && direction !== 'desc')) return null
  return { key, direction }
}
