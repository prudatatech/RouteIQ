import { useQuery } from '@tanstack/react-query'
import { vehiclesAPI } from '@/services/api'

export interface VehicleRow { id: string; plate_number: string; status?: string | null; available_capacity_kg?: number | null; vehicle_type?: string | null }

/** Vehicles in service, for a transfer, a hub departure or a lot sent to another vehicle. */
export function useOperatingVehicles(enabled = true) {
  return useQuery({
    queryKey: ['vehicles', 'transfer-targets'],
    queryFn: async () => ((await vehiclesAPI.list()) as VehicleRow[])
      .filter(v => ['available', 'idle', 'on_route'].includes(v.status ?? ''))
      .sort((a, b) => a.plate_number.localeCompare(b.plate_number)),
    enabled,
  })
}
