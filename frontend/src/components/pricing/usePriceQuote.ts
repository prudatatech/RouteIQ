import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { publicAPI } from '@/services/api'
import { pricingAPI, type QuoteRequest, type QuoteResponse } from '@/services/pricing'

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
 * With `guest`, the public price check is used (no sign-in).
 */
export function usePriceQuote(input: QuoteRequest | null, opts: { guest?: boolean } = {}) {
  const guest = !!opts.guest
  const key = input ? JSON.stringify(input) : null
  const settled = useDebounced(key, 600)
  return useQuery<QuoteResponse>({
    queryKey: ['price-quote', guest ? 'guest' : 'account', settled],
    queryFn: () => {
      const body = JSON.parse(settled as string) as QuoteRequest
      if (!guest) return pricingAPI.quote(body)
      const { source: _source, ...rest } = body
      return publicAPI.quote(rest)
    },
    enabled: !!settled && settled === key,
    staleTime: 60_000,
    retry: false,
  })
}
