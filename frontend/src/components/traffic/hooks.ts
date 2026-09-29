import { useQuery } from '@tanstack/react-query'
import { trafficAPI, weatherAPI } from '@/services/pricing'

/** Open traffic incidents that sit on one route's path. */
export function useRouteIncidents(routeId: string | undefined) {
  return useQuery({
    queryKey: ['traffic-incidents', routeId],
    queryFn: () => trafficAPI.incidents(routeId),
    enabled: !!routeId,
    refetchInterval: 60_000,
  })
}

/** Current weather at the middle of one route (cached on the server for 15 minutes). */
export function useRouteWeather(routeId: string | undefined) {
  return useQuery({
    queryKey: ['route-weather', routeId],
    queryFn: () => weatherAPI.route(routeId as string),
    enabled: !!routeId,
    staleTime: 5 * 60_000,
  })
}
