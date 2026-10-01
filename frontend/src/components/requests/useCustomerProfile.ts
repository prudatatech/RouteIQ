import { useQuery } from '@tanstack/react-query'
import { bookingsAPI } from '@/services/api'
import type { CustomerProfile } from '@/utils/customerProfile'

export const profileKey = (customerId: string) => ['customer-profile', customerId] as const

export function useCustomerProfile(customerId: string | null | undefined) {
  return useQuery<CustomerProfile>({
    queryKey: profileKey(customerId ?? ''),
    queryFn: () => bookingsAPI.customerProfile(customerId as string),
    enabled: !!customerId,
    staleTime: 30_000,
  })
}
