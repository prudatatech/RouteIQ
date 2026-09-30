import { useQuery } from '@tanstack/react-query'
import { financeAPI } from '@/services/api'
import type { DateRangeValue } from '@/components/ui'

/** A delivered shipment or vendor load with no invoice yet. */
export interface Unpriced {
  kind: 'shipment' | 'manifest'
  id: string
  label: string
  detail: string | null
  delivered_at: string
  /** True when a price is already on record, so the invoice can be issued as it is. */
  can_invoice: boolean
}

/** Deliveries with no invoice in the range. The Money page and its To price tab share this query. */
export function useUnpriced(range: DateRangeValue) {
  return useQuery<Unpriced[]>({
    queryKey: ['finance', 'unpriced', range.from, range.to],
    queryFn: () => financeAPI.unpriced({ from: range.from, to: range.to }) as Promise<Unpriced[]>,
  })
}
