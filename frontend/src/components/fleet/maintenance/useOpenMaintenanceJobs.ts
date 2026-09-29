import { useQuery } from '@tanstack/react-query'
import { fleetAPI } from '@/services/api'
import { maintenanceKeys, type MaintenanceJob } from './types'

/** Every open maintenance job, by vehicle id. Refreshes each minute so a late return shows up. */
export function useOpenMaintenanceJobs() {
  const query = useQuery<MaintenanceJob[]>({
    queryKey: maintenanceKeys.openJobs,
    queryFn: () => fleetAPI.maintenanceJobs({ status: 'open' }) as Promise<MaintenanceJob[]>,
    refetchInterval: 60_000,
  })
  const byVehicle = new Map<string, MaintenanceJob>()
  for (const job of query.data ?? []) byVehicle.set(job.vehicle_id, job)
  return byVehicle
}
