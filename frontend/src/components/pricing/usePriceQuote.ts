import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { pricingAPI, type QuoteRequest, type QuoteResponse } from '@/services/pricing'
import { useOrgStore } from '@/store/orgStore'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/**
 * The suggested price for a load. Pass `null` until the inputs are complete. Changes wait
 * a moment before asking again, so typing a weight does not ask for a price on every key.
 */
export function usePriceQuote(input: QuoteRequest | null) {
  const key = input ? JSON.stringify(input) : null
  const settled = useDebounced(key, 600)
  const orgId = useOrgStore(s => s.activeOrgId)
  const query = useQuery<QuoteResponse>({
    queryKey: ['price-quote', 'account', orgId, settled],
    queryFn: () => {
      const body = JSON.parse(settled as string) as QuoteRequest
      return pricingAPI.quote(body)
    },
    enabled: !!settled && settled === key,
    staleTime: 60_000,
    retry: false,
  })
  const waiting = !!key && settled !== key
  return { ...query, data: key && settled === key ? query.data : undefined, isLoading: waiting || query.isLoading, isFetching: waiting || query.isFetching }
}
