import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { useEffectiveRole } from '@/store/effectiveRole'

/**
 * How many 3PL applications wait for approval; only asked for as superadmin (the only role that
 * decides them), else null. Shares one query cache (`tpl-pending-partners`) with the sidebar badge,
 * so opening the review page and seeing the badge never shows two different numbers for the same count.
 */
export function usePendingPartnersCount(): number | null {
  const isSuperadmin = useEffectiveRole().role === 'superadmin'
  const q = useQuery({
    queryKey: ['tpl-pending-partners'],
    queryFn: async () => {
      const { count, error } = await supabase.from('tpl_partners').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      if (error) throw error
      return count ?? 0
    },
    enabled: isSuperadmin,
    refetchInterval: 60_000,
  })
  return isSuperadmin ? q.data ?? null : null
}
