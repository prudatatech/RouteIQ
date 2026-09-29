import { useQuery } from '@tanstack/react-query'
import { api, fleetAPI } from '@/services/api'
import { DEFAULT_LIVE_MINUTES, type VehicleStatusTarget } from '@/utils/vehicles'

/** Staff change a vehicle's status on purpose (POST /vehicles/:id/status). */
export const setVehicleStatus = (vehicleId: string, status: VehicleStatusTarget) =>
  api.post(`/vehicles/${vehicleId}/status`, { status }).then(r => r.data)

/** "Return to service" puts a vehicle held in maintenance back to available. */
export const returnVehicleToService = (vehicleId: string) => setVehicleStatus(vehicleId, 'available')

/**
 * The live limit in minutes: the GPS-lost limit from the alarm settings, the same one the
 * server uses for the heartbeat monitor and the GPS-lost alarm.
 */
export function useLiveMinutes(): number {
  const settings = useQuery<{ values?: { gps_lost_minutes?: number } }>({
    queryKey: ['fleet-alert-settings'],
    queryFn: () => fleetAPI.alertSettings(),
    staleTime: 5 * 60_000,
  })
  return settings.data?.values?.gps_lost_minutes ?? DEFAULT_LIVE_MINUTES
}
