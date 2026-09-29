import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { vehiclesAPI } from '@/services/api'
import type { DriverLicenceStatus } from './types'

/**
 * `driver_licence_status` per vehicle id, from the vehicles API. For screens that read vehicles
 * some other way and would otherwise have no licence field to show.
 */
export function useVehicleLicences(enabled = true) {
  const list = useQuery({
    queryKey: ['vehicles', 'licences'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }) as Promise<{ id: string; driver_licence_status?: DriverLicenceStatus }[]>,
    enabled,
    staleTime: 60_000,
  })
  return useMemo(() => {
    const map = new Map<string, DriverLicenceStatus>()
    for (const v of list.data ?? []) map.set(v.id, v.driver_licence_status)
    return map
  }, [list.data])
}
