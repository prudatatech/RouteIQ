import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { routesAPI } from '@/services/api'
import { TripEtaCard } from './TripEta'
import { remainingStops, type TripStopRow } from './tripStops'
import { useLiveEta } from './useLiveEta'
import type { LatLng } from './types'

interface RouteRow {
  id: string
  status: string
  vehicle_id?: string | null
  route_stops?: TripStopRow[] | null
}

/**
 * Live ETA card for one vehicle on an active route (live map, selected-vehicle panel). Reads the
 * vehicle's route the same way the map does, so both share one request. Nothing is shown for a
 * vehicle without an active route.
 */
export default function VehicleTripEta({ vehicleId, position }: { vehicleId: string; position: LatLng | null }) {
  const { data: route } = useQuery({
    // Same key and query as the live map's route line, so the two share one cached answer
    queryKey: ['routes', vehicleId],
    queryFn: () => routesAPI.list({ vehicle_id: vehicleId }) as Promise<RouteRow[]>,
    refetchInterval: 30_000,
    select: (routes: RouteRow[]) => routes.find((r) => r.status === 'active' && r.vehicle_id === vehicleId) ?? null,
  })
  const stops = useMemo(() => remainingStops(route?.route_stops), [route])
  const eta = useLiveEta({ origin: position, stops, enabled: !!route })
  if (!route || stops.length === 0) return null
  return (
    <TripEtaCard
      eta={eta.data}
      loading={eta.isLoading}
      error={!position ? 'The vehicle has no GPS position yet.' : eta.isError ? 'We could not work out the ETA. It will try again shortly.' : eta.isSuccess ? 'No driving route was found to the next stops.' : null}
    />
  )
}
