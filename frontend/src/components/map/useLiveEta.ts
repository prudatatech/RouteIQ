import { useRef } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { directionsAvailable, fetchDrivingRoute, fetchFreeFlowSeconds } from './directions'
import { buildLiveEta, type LiveEta } from './liveEta'
import type { LatLng } from './types'

/** A stop still to visit. */
export interface EtaStop {
  position: LatLng
  /** routes' planned arrival at this stop, when set at dispatch. */
  plannedArrivalAt?: string | null
}

/** The estimate is worked out again this often while the panel is open. */
const REFRESH_MS = 2 * 60_000

/** ~1 km cell of a position: a vehicle has to leave it before the estimate is asked for again ahead of schedule. */
const cell = (p: LatLng) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`

/**
 * Live ETA of a vehicle through its remaining stops: Mapbox driving-traffic from where the vehicle
 * is now, against the same drive with no traffic, and against the route's planned arrival.
 *
 * Mapbox is asked at most once every two minutes per vehicle (and stop list), however often the
 * GPS position changes; the answer is then also cached in directions.ts. Null data means no token,
 * no position, no stops or no route: callers show nothing rather than a guess.
 */
export function useLiveEta({ origin, stops, enabled = true }: { origin: LatLng | null; stops: EtaStop[]; enabled?: boolean }) {
  const originRef = useRef(origin)
  originRef.current = origin
  const stopsKey = stops.map((s) => `${s.position.lat.toFixed(5)},${s.position.lng.toFixed(5)}`).join(';')
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const active = enabled && directionsAvailable && origin !== null && stops.length > 0

  return useQuery<LiveEta | null>({
    // The key holds the ~1 km cell, not the exact position, so a moving vehicle does not refetch on every ping.
    queryKey: ['live-eta', origin ? cell(origin) : null, stopsKey],
    enabled: active,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
    retry: 1,
    queryFn: async ({ signal }) => {
      const from = originRef.current
      const remaining = stopsRef.current
      if (!from || remaining.length === 0) return null
      const waypoints = [from, ...remaining.map((s) => s.position)]
      const [route, freeFlow] = await Promise.all([
        fetchDrivingRoute(waypoints, signal),
        // The free-flow time is only context: without it the ETA is still shown
        fetchFreeFlowSeconds(waypoints, signal).catch(() => null),
      ])
      if (!route) return null
      return buildLiveEta(route, freeFlow, remaining[remaining.length - 1].plannedArrivalAt)
    },
  })
}
