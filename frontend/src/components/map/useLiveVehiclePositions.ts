import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'
import type { LatLng } from './types'

interface VehicleRow {
  id: string
  latitude: number | null
  longitude: number | null
  status: string | null
}

/** Safety net for missed realtime events. */
const POLL_INTERVAL_MS = 5000

/**
 * Latest GPS position of every vehicle, by vehicle id.
 * Driver app GPS -> Supabase `vehicles` table -> realtime here, with a 5 s poll
 * as a fallback. When a vehicle's status changes, the ['vehicles'] query is
 * refreshed so lists and badges update too (not on every GPS ping).
 */
export function useLiveVehiclePositions(): Record<string, LatLng> {
  const queryClient = useQueryClient()
  const [positions, setPositions] = useState<Record<string, LatLng>>({})
  const statuses = useRef<Record<string, string>>({})
  const channelId = useId()

  useEffect(() => {
    let cancelled = false

    const apply = (rows: Partial<VehicleRow>[]) => {
      setPositions((prev) => {
        let next = prev
        for (const row of rows) {
          if (!row.id || row.latitude == null || row.longitude == null) continue
          const lat = Number(row.latitude)
          const lng = Number(row.longitude)
          const old = prev[row.id]
          if (old && old.lat === lat && old.lng === lng) continue
          if (next === prev) next = { ...prev }
          next[row.id] = { lat, lng }
        }
        return next
      })
    }

    /** Remembers statuses; returns true when a known vehicle changed status. */
    const statusChanged = (row: Partial<VehicleRow>) => {
      if (!row.id || !row.status) return false
      const before = statuses.current[row.id]
      statuses.current[row.id] = row.status
      return before !== undefined && before !== row.status
    }

    const channel = supabase
      .channel(`map-vehicles-${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicles' },
        (payload: RealtimePostgresChangesPayload<VehicleRow>) => {
          const row = payload.new as Partial<VehicleRow>
          const changed = statusChanged(row)
          if (payload.eventType !== 'UPDATE' || changed) {
            queryClient.invalidateQueries({ queryKey: ['vehicles'] })
          }
          apply([row])
        },
      )
      .subscribe()

    const poll = async () => {
      const { data, error } = await supabase.from('vehicles').select('id, latitude, longitude, status')
      if (cancelled || error || !data) return
      const rows = data as VehicleRow[]
      rows.forEach(statusChanged)
      apply(rows)
    }
    poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [queryClient, channelId])

  return positions
}
