import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { peopleAPI } from '@/services/api'
import type { DuplicateMatch } from './types'

/** Waits until the value has stopped changing, so the check does not run on every key. */
function useSettled(value: string, ms = 500) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

/**
 * Looks for someone who already has this phone or document number, while the user types.
 * Returns the matches (other than `ignoreId`) so a form can also block saving on them.
 */
export function useDuplicates(
  query: { phone?: string; doc_type?: string; doc_number?: string },
  ready: boolean,
  ignoreId?: string,
) {
  const key = JSON.stringify(query)
  const settled = useSettled(key)
  const result = useQuery({
    queryKey: ['people', 'duplicates', settled],
    queryFn: () => peopleAPI.duplicates(JSON.parse(settled)),
    enabled: ready && settled === key,
    staleTime: 30_000,
  })
  const matches: DuplicateMatch[] = ready && settled === key ? (result.data ?? []).filter(m => m.id !== ignoreId) : []
  return { matches, checking: ready && (settled !== key || result.isFetching) }
}
