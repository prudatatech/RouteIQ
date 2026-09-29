import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { vehiclesAPI } from '@/services/api'
import { supabase, openChannel } from '@/services/supabase'
import type { SosCounts } from '@/utils/sos'

/**
 * How many times each vehicle has raised an SOS (all time, last 30 days, still open). Vehicles
 * that never did are absent from the map. Follows the table in realtime, so an alert raised,
 * acknowledged, resolved or cancelled from the driver app moves the numbers at once.
 */
export function useSosCounts() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'sos-counts'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'sos-history'] })
    }
    const channel = openChannel('fleet_sos_counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  return useQuery<Record<string, SosCounts>>({
    queryKey: ['vehicles', 'sos-counts'],
    queryFn: () => vehiclesAPI.sosCounts(),
    refetchInterval: 60_000,
  })
}
