import { useQuery } from '@tanstack/react-query'
import { trafficAPI } from '@/services/pricing'
import { TOKEN_RENEW_MARGIN_S } from './trafficFlow'

/**
 * The tile token. The map cannot send the login header when it loads tiles, so the backend
 * signs a short-lived token that is only good for the traffic tiles. It is renewed before it ends.
 */
export function useTrafficTileToken(enabled: boolean) {
  return useQuery({
    queryKey: ['traffic-tile-token'],
    queryFn: () => trafficAPI.tileToken(),
    enabled,
    retry: 1,
    staleTime: 10 * 60_000,
    refetchInterval: (query) => Math.max(60, (query.state.data?.expires_in ?? 1800) - TOKEN_RENEW_MARGIN_S) * 1000,
  })
}
