import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase, openChannel } from '@/services/supabase'

/**
 * Refetches the given queries whenever a row in one of `tables` changes
 * (Supabase realtime). Bursts of changes are batched into one refetch.
 * `channel` names the subscription; each mount gets its own channel.
 */
export function useRealtimeRefresh(channel: string, tables: string[], queryKeys: QueryKey[]) {
  const queryClient = useQueryClient()
  const keysRef = useRef(queryKeys)
  keysRef.current = queryKeys
  const tableList = tables.join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        keysRef.current.forEach(queryKey => queryClient.invalidateQueries({ queryKey }))
      }, 300)
    }
    const sub = openChannel(channel)
    tableList.split(',').forEach(table => {
      sub.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
    })
    sub.subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(sub)
    }
  }, [channel, tableList, queryClient])
}
