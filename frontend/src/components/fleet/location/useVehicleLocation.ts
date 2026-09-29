import { useQuery } from '@tanstack/react-query'
import { fleetAPI, gpsAPI } from '@/services/api'
import { reversePlace } from '@/services/geocoding'
import { hasPosition, type VehicleActivity, type VehicleLocation, type VehicleTrack } from './format'

/** How often the position, activity and trail are refreshed while a panel is open. */
const REFRESH_MS = 15_000

export const locationKeys = {
  location: (id: string) => ['vehicle-location', id] as const,
  activity: (id: string) => ['vehicle-activity', id] as const,
  track: (id: string, hours: number) => ['vehicle-track', id, hours] as const,
  place: (lat: number, lng: number) => ['place-name', lat.toFixed(3), lng.toFixed(3)] as const,
  shares: (id: string) => ['vehicle-share-links', id] as const,
}

export function useVehicleLocation(vehicleId: string | null | undefined) {
  return useQuery<VehicleLocation>({
    queryKey: locationKeys.location(vehicleId ?? ''),
    queryFn: () => fleetAPI.vehicleLocation(vehicleId!) as Promise<VehicleLocation>,
    enabled: !!vehicleId,
    refetchInterval: REFRESH_MS,
  })
}

export function useVehicleActivity(vehicleId: string | null | undefined) {
  return useQuery<VehicleActivity>({
    queryKey: locationKeys.activity(vehicleId ?? ''),
    queryFn: () => fleetAPI.vehicleActivity(vehicleId!) as Promise<VehicleActivity>,
    enabled: !!vehicleId,
    refetchInterval: REFRESH_MS,
  })
}

/** The driven path of the last `hours` hours from the GPS history. */
export function useVehicleTrack(vehicleId: string | null | undefined, hours: number, enabled = true) {
  return useQuery<VehicleTrack>({
    queryKey: locationKeys.track(vehicleId ?? '', hours),
    queryFn: () => gpsAPI.track(vehicleId!, { from: new Date(Date.now() - hours * 3_600_000).toISOString(), limit: 1000 }) as Promise<VehicleTrack>,
    enabled: !!vehicleId && enabled,
    refetchInterval: REFRESH_MS * 2,
  })
}

/**
 * The address nearest to a position, looked up once per ~100 m square.
 * `stored` (a place name kept on the vehicle) wins when there is one.
 */
export function usePlaceName(lat: number | null | undefined, lng: number | null | undefined, stored?: string | null) {
  const real = hasPosition(lat, lng) && !stored
  const query = useQuery<string | null>({
    queryKey: locationKeys.place(real ? lat! : 0, real ? lng! : 0),
    queryFn: async () => (await reversePlace(lat!, lng!))?.address ?? null,
    enabled: real,
    staleTime: 10 * 60_000,
    retry: false,
  })
  return { name: stored || query.data || null, loading: real && query.isLoading }
}
