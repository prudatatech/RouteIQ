import { useQuery } from '@tanstack/react-query'
import { fleetAPI } from '@/services/api'
import { fleetKeys, type VehicleHealth } from './health'

/** Health score and breakdown for every vehicle, refreshed each minute. */
export function useFleetHealth() {
  return useQuery<VehicleHealth[]>({
    queryKey: fleetKeys.health,
    queryFn: () => fleetAPI.health() as Promise<VehicleHealth[]>,
    refetchInterval: 60_000,
  })
}
