import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Clock, Gauge, Route as RouteIcon } from 'lucide-react'
import { analyticsAPI, telemetryAPI, telemetryWS, vehiclesAPI } from '@/services/api'
import { EmptyState, ErrorState, Select, Skeleton, Stat, StatusPill, buttonClasses } from '@/components/ui'
import { formatTimeAgo } from '@/utils/timeFormat'
import { ChartCard, SimpleLineChart } from './charts'
import { formatNumber, formatTime } from './format'

interface VehicleOption {
  id: string
  plate_number: string
  status: string | null
}

interface Mission {
  vehicle_id: string
  route_id: string
  status: string
  progress_pct: number
  remaining_stops: number
}

interface TelemetryRow {
  timestamp: string
  speed_kmph: number | null
}

interface SpeedPoint {
  at: number
  time: string
  speed: number
}

/** A vehicle counts as live while its last ping is this recent. */
const LIVE_WINDOW_MS = 2 * 60_000
const MAX_POINTS = 150

const statusRank = (s: string | null) => (s === 'on_route' ? 0 : s === 'available' || s === 'idle' ? 1 : 2)

/**
 * Speed history and trip progress for one vehicle. New pings arrive over the
 * telemetry WebSocket and are added to the chart as they come in.
 */
export default function LiveTelemetryTab({ vehicleId, onVehicleChange }: {
  /** Selected vehicle; when omitted the tab keeps its own selection. */
  vehicleId?: string | null
  onVehicleChange?: (id: string) => void
}) {
  const vehicles = useQuery<VehicleOption[]>({
    queryKey: ['vehicles', 'analytics-list'],
    queryFn: () => vehiclesAPI.list({ limit: 200 }),
  })
  const missions = useQuery<Mission[]>({
    queryKey: ['analytics', 'active-missions'],
    queryFn: () => analyticsAPI.activeMissions(),
    refetchInterval: 30_000,
  })

  const options = useMemo(() => [...(vehicles.data ?? [])]
    .filter(v => v.status !== 'archived')
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.plate_number.localeCompare(b.plate_number)), [vehicles.data])

  const [ownSelection, setOwnSelection] = useState<string | null>(null)
  const requested = vehicleId ?? ownSelection
  const selectedId = requested && options.some(v => v.id === requested) ? requested : options[0]?.id ?? null
  const selected = options.find(v => v.id === selectedId) ?? null
  const mission = (missions.data ?? []).find(m => m.vehicle_id === selectedId) ?? null

  const select = (id: string) => {
    setOwnSelection(id)
    onVehicleChange?.(id)
  }

  const history = useQuery<TelemetryRow[]>({
    queryKey: ['analytics', 'telemetry-history', selectedId],
    queryFn: () => telemetryAPI.history(selectedId!, MAX_POINTS),
    enabled: !!selectedId,
    refetchInterval: 60_000,
  })

  // Pings pushed over the WebSocket since the page opened, per vehicle.
  const [live, setLive] = useState<Record<string, SpeedPoint[]>>({})
  useEffect(() => {
    const feed = telemetryWS.connect((msg: { type?: string; data?: Record<string, unknown> }) => {
      if (msg?.type !== 'TELEMETRY_UPDATE' || !msg.data) return
      const id = msg.data.vehicle_id
      const speed = Number(msg.data.speed ?? msg.data.speed_kmph)
      if (typeof id !== 'string' || !Number.isFinite(speed)) return
      const at = msg.data.timestamp ? new Date(String(msg.data.timestamp)).getTime() : Date.now()
      setLive(prev => ({
        ...prev,
        [id]: [...(prev[id] ?? []), { at, time: formatTime(at), speed: Math.round(speed) }].slice(-MAX_POINTS),
      }))
    })
    return () => feed.close()
  }, [])

  const points = useMemo<SpeedPoint[]>(() => {
    const past = (history.data ?? [])
      .filter(t => t.timestamp && t.speed_kmph != null)
      .map(t => {
        const at = new Date(t.timestamp).getTime()
        return { at, time: formatTime(at), speed: Math.round(t.speed_kmph ?? 0) }
      })
    const latestPast = past.reduce((m, p) => Math.max(m, p.at), 0)
    const fresh = (selectedId ? live[selectedId] ?? [] : []).filter(p => p.at > latestPast)
    return [...past, ...fresh].sort((a, b) => a.at - b.at).slice(-MAX_POINTS)
  }, [history.data, live, selectedId])

  // Re-render once a minute so "last update" and the live pill stay truthful.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const last = points[points.length - 1]
  const isLive = !!last && now - last.at < LIVE_WINDOW_MS

  if (vehicles.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full max-w-xs" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }
  if (vehicles.isError) {
    return <ErrorState title="We could not load vehicles" description="Check your connection and try again." onRetry={() => vehicles.refetch()} />
  }
  if (options.length === 0) {
    return (
      <EmptyState
        title="No vehicles yet"
        description="Add a vehicle in Fleet to see its speed and trip progress here."
        action={<Link to="/fleet" className={buttonClasses({ variant: 'secondary' })}>Go to Fleet</Link>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Select
          label="Vehicle"
          value={selectedId ?? ''}
          onChange={e => select(e.target.value)}
          options={options.map(v => ({ value: v.id, label: `${v.plate_number}${v.status ? ` · ${v.status.replace(/_/g, ' ')}` : ''}` }))}
          className="sm:w-80"
        />
        <div className="flex items-center gap-2" aria-live="polite">
          {selected && <StatusPill status={selected.status} />}
          {isLive
            ? <StatusPill tone="success">Live</StatusPill>
            : <StatusPill tone="neutral" dot={false}>{last ? 'No recent pings' : 'No pings yet'}</StatusPill>}
        </div>
      </div>

      <section aria-label="Current state" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Speed"
          icon={<Gauge size={18} />}
          loading={history.isLoading}
          value={last ? `${formatNumber(last.speed)} km/h` : '—'}
          hint={last ? (isLive ? 'Latest ping' : 'At the last ping') : 'This vehicle has not sent a ping'}
        />
        <Stat
          label="Last update"
          icon={<Clock size={18} />}
          loading={history.isLoading}
          value={last ? formatTimeAgo(new Date(last.at), now) : '—'}
          hint={last ? new Date(last.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : undefined}
        />
        <Stat
          label="Trip progress"
          icon={<RouteIcon size={18} />}
          loading={missions.isLoading}
          value={mission ? `${Math.round(mission.progress_pct)}%` : '—'}
          hint={mission
            ? `${formatNumber(mission.remaining_stops)} stop${mission.remaining_stops === 1 ? '' : 's'} left`
            : missions.isError ? 'We could not load active routes' : 'Not on an active route'}
        />
      </section>

      <ChartCard
        title="Speed (km/h)"
        description={`Last ${formatNumber(points.length)} pings from ${selected?.plate_number ?? 'this vehicle'}`}
        loading={history.isLoading}
        error={history.isError}
        onRetry={() => history.refetch()}
        empty={points.length === 0}
        emptyTitle="No pings from this vehicle yet"
        emptyDescription="Speed shows here once the driver app or GPS device starts sending locations."
        height="h-72"
      >
        <SimpleLineChart
          data={points}
          categoryKey="time"
          series={{ key: 'speed', label: 'Speed' }}
          formatValue={n => `${formatNumber(n)} km/h`}
          label={`Speed of ${selected?.plate_number ?? 'the vehicle'} over its last ${points.length} pings.`}
        />
      </ChartCard>
    </div>
  )
}
