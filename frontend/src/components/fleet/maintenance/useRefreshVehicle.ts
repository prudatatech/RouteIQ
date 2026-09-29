import { useQueryClient } from '@tanstack/react-query'
import { fleetKeys } from '../health'
import { maintenanceKeys } from './types'

/** Refreshes everything a new service record changes. */
export function useRefreshVehicle(vehicleId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-health', vehicleId] })
    queryClient.invalidateQueries({ queryKey: fleetKeys.log(vehicleId) })
    queryClient.invalidateQueries({ queryKey: maintenanceKeys.plans(vehicleId) })
    queryClient.invalidateQueries({ queryKey: maintenanceKeys.vehicle(vehicleId) })
    queryClient.invalidateQueries({ queryKey: maintenanceKeys.jobs(vehicleId) })
    queryClient.invalidateQueries({ queryKey: fleetKeys.health })
    queryClient.invalidateQueries({ queryKey: fleetKeys.serviceDue })
    queryClient.invalidateQueries({ queryKey: maintenanceKeys.openJobs })
    queryClient.invalidateQueries({ queryKey: ['vehicles'] })
  }
}
