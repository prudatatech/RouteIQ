/**
 * What blocks or waits behind the current trip (an open SOS, documents that block dispatch, the
 * trips waiting), from GET /telemetry/driver-ping/my-status. When it cannot be reached nothing is
 * assumed: no blocker is shown and no trips are listed.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export const DRIVER_STATUS_KEY = ['driverStatus'];

export function useDriverStatus(enabled = true) {
  const query = useQuery({
    queryKey: DRIVER_STATUS_KEY,
    queryFn: () => api.getMyStatus(),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  return {
    openSos: query.data?.open_sos ?? null,
    dispatchIssues: query.data?.dispatch_blocked ?? [],
    upcoming: query.data?.upcoming ?? [],
    refetch: query.refetch,
  };
}
