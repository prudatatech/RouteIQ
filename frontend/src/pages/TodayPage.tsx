import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, AlertCircle, Clock, FileWarning, Plus, Route as RouteIcon, ShieldAlert, Truck, WifiOff,
} from 'lucide-react'
import clsx from 'clsx'
import { analyticsAPI, fleetAPI, opsAPI, peopleAPI, vehiclesAPI } from '@/services/api'
import {
  Button, buttonClasses, Card, CardHeader, EmptyState, ErrorState, Page, PageHeader, SectionHeader, Skeleton, Stat, StatusPill, humanize,
} from '@/components/ui'
import { notificationPath } from '@/components/ui/notificationTargets'
import LiveMap from '@/components/map/LiveMap'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useDraftStore } from '@/store/draftStore'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { buildQueues, splitQueues, type Queue, type QueueTone } from '@/components/today/queues'
import { DRIVER_ACTION_NOTIFICATION_TYPES } from '@/components/today/driverActions'
import { isDraftVehicle, isFleetVehicle, isVehicleLive, lastSeenAt } from '@/utils/vehicles'
import { useLiveMinutes } from '@/components/fleet/vehicleStatus'
import type { FleetAlert } from '@/components/fleet/health'
import { usePendingOrgCount } from '@/hooks/usePendingOrgCount'
import { formatDate, formatRelative } from '@/utils/display'

interface VehicleRow {
  id: string
  plate_number: string
  status: string
  last_sync?: string | null
  last_heartbeat?: string | null
}

/** One entry of GET /analytics/insights; only the fields this page reads. */
interface Insight {
  id: string
  type: string
  title: string
  insight: string
  vehicle_id?: string | null
}

interface AttentionItem {
  id: string
  kind: 'alarm' | 'offline' | 'delay' | 'idle' | 'licence-expired' | 'licence-expiring' | 'documents'
  title: string
  subtitle: string
  time: string
  actions: { label: string; onClick: () => void }[]
}

interface DriverActionRow {
  id: string
  title: string
  body: string
  type: string
  data: Record<string, unknown> | null
  created_at: string
}

/** One row of a "needs attention" list. */
function AttentionRow({ item }: { item: AttentionItem }) {
  return (
        <div className="flex items-start gap-3 px-4 py-3">
          <span
            className={clsx(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              ['delay', 'idle', 'licence-expiring', 'documents'].includes(item.kind) ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger',
            )}
            aria-hidden="true"
          >
            {item.kind === 'licence-expired' || item.kind === 'licence-expiring' || item.kind === 'documents'
              ? <FileWarning size={16} />
              : item.kind === 'alarm' ? <AlertCircle size={16} />
              : item.kind === 'offline' ? <WifiOff size={16} />
              : item.kind === 'delay' ? <Clock size={16} /> : <Truck size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">{item.title}</p>
            <p className="mt-0.5 break-words text-xs text-muted">{item.subtitle}</p>
            {item.time && <p className="mt-0.5 text-xs text-muted">{item.time}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end">
            {item.actions.map(a => (
              <Button key={a.label} variant="ghost" size="sm" onClick={a.onClick}>{a.label}</Button>
            ))}
          </div>
        </div>
  )
}

/** One "Needs attention" row for all open fleet alarms: the count, the kinds, and a link to Fleet > Alerts. */
function alarmItem(alarms: FleetAlert[], open: () => void): AttentionItem {
  const byType = new Map<string, number>()
  for (const a of alarms) byType.set(a.type, (byType.get(a.type) ?? 0) + 1)
  const kinds = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => `${humanize(type)} ${n}`).join(' · ')
  const newest = alarms.reduce((latest, a) => (a.created_at > latest ? a.created_at : latest), alarms[0].created_at)
  return {
    id: 'fleet-alarms',
    kind: 'alarm',
    title: `${alarms.length.toLocaleString('en-IN')} open fleet ${alarms.length === 1 ? 'alert' : 'alerts'}`,
    subtitle: kinds,
    time: formatRelative(newest),
    actions: [{ label: 'View alerts', onClick: open }],
  }
}

const toneStyles: Record<QueueTone, { count: string; ring: string; icon: string }> = {
  danger: { count: 'text-danger', ring: 'border-danger/40', icon: 'bg-danger-soft text-danger' },
  warning: { count: 'text-warning', ring: 'border-border', icon: 'bg-warning-soft text-warning' },
  info: { count: 'text-text', ring: 'border-border', icon: 'bg-info-soft text-info' },
}

/** One work queue: what is waiting, and the one button that opens exactly that list. */
function QueueCard({ queue, actions }: { queue: Queue; actions?: React.ReactNode }) {
  const tone = toneStyles[queue.tone]
  return (
    <li className={clsx('flex flex-col gap-3 rounded-card border bg-surface p-4 sm:p-5', tone.ring)}>
      <div className="flex items-start gap-3">
        <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone.icon)} aria-hidden="true">
          {queue.tone === 'danger' ? <ShieldAlert size={18} /> : queue.tone === 'warning' ? <AlertCircle size={18} /> : <Activity size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text">{queue.title}</h3>
          <p className="mt-0.5 text-xs text-muted">{queue.hint}</p>
        </div>
        <p className={clsx('shrink-0 text-3xl font-semibold leading-none tabular', tone.count)}>{queue.count.toLocaleString('en-IN')}</p>
      </div>
      {actions}
      <Link to={queue.to} className={buttonClasses({ variant: queue.tone === 'danger' ? 'danger' : 'secondary', size: 'md', fullWidth: true })}>
        {queue.cta}
      </Link>
    </li>
  )
}

export default function TodayPage() {
  const navigate = useNavigate()
  const openModal = useDraftStore(s => s.openModal)
  const userId = useAuthStore(s => s.userId)
  const role = useAuthStore(s => s.role)
  const [searchParams] = useSearchParams()
  const selectedVehicleId = searchParams.get('vehicle')

  // One request for every queue count; the menu badges read the same query.
  const pendingOrgs = usePendingOrgCount()
  const today = useQuery({ queryKey: ['ops-today'], queryFn: opsAPI.today, refetchInterval: 30_000 })
  useRealtimeRefresh('today_page', ['sos_alerts', 'cargo_exceptions', 'customer_bookings', 'vendor_shipment_requests', 'shipments', 'routes', 'vehicles', 'user_documents', 'capacity_bids', 'invoices', 'invoice_payment_reports'], [['ops-today']])

  // The driver actions queue is the caller's own unread notifications, so the items can be opened from here.
  const driverActions = useQuery<DriverActionRow[]>({
    queryKey: ['today-driver-actions', userId],
    enabled: !!userId && (today.data?.queues.driver_actions.count ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, type, data, created_at')
        .eq('user_id', userId!)
        .eq('is_read', false)
        .in('type', [...DRIVER_ACTION_NOTIFICATION_TYPES])
        .order('created_at', { ascending: false })
        .limit(3)
      if (error) throw error
      return (data ?? []) as DriverActionRow[]
    },
  })

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<VehicleRow[]>({
    queryKey: ['vehicles', 'live'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }) as Promise<VehicleRow[]>,
    refetchInterval: 5_000,
  })

  // Open fleet alarms (tamper, overspeed, low fuel, GPS lost, ...), the same list as Fleet > Alerts.
  const { data: fleetAlarms = [] } = useQuery<FleetAlert[]>({
    queryKey: ['fleet-alerts', 'active'],
    queryFn: () => fleetAPI.alerts('active') as Promise<FleetAlert[]>,
    refetchInterval: 30_000,
  })

  const { data: insights = [] } = useQuery<Insight[]>({
    queryKey: ['insights'],
    queryFn: () => analyticsAPI.insights() as Promise<Insight[]>,
    refetchInterval: 60_000,
  })

  // Driver licences and required documents. Optional: the list simply has no rows if the call fails.
  const { data: peopleAttention } = useQuery({
    queryKey: ['people', 'attention'],
    queryFn: peopleAPI.attention,
    enabled: role === 'admin' || role === 'superadmin' || role === 'manager',
    refetchInterval: 5 * 60_000,
    retry: false,
  })

  const liveMinutes = useLiveMinutes()
  const activeVehicles = vehicles.filter(isFleetVehicle)
  const offlineVehicles = activeVehicles.filter(v => v.status === 'offline')
  // Live uses the same rule as Fleet and the live map: the newer of heartbeat and sync within the limit.
  const liveVehicleCount = activeVehicles.filter(v => isVehicleLive(v, liveMinutes)).length
  const draftVehicleIds = new Set(vehicles.filter(isDraftVehicle).map(v => v.id))
  const openFleetAlarms = fleetAlarms.filter(a => !a.is_test && a.status !== 'resolved')

  const delayInsights = insights.filter(i => i.type === 'delay_risk')
  // Placeholder vehicles (a driver's first-login stub, a saved draft) are not fleet assets, so they are never "idle".
  const idleInsights = insights.filter(i => i.type === 'idle_vehicle' && !(i.vehicle_id && draftVehicleIds.has(i.vehicle_id)))
  const rerouteCount = insights.filter(i => i.type === 'reroute_suggestion').length

  // Needs attention: fleet health, not the work queues above.
  const attentionItems: AttentionItem[] = [
    ...(openFleetAlarms.length > 0 ? [alarmItem(openFleetAlarms, () => navigate('/fleet?tab=alerts'))] : []),
    ...offlineVehicles.map(v => ({
      id: `offline-${v.id}`,
      kind: 'offline' as const,
      title: 'Vehicle offline',
      subtitle: v.plate_number,
      time: lastSeenAt(v) ? `Last seen ${formatRelative(lastSeenAt(v)!)}` : 'Never reported',
      actions: [
        { label: 'View vehicle', onClick: () => navigate(`/fleet/${v.id}`) },
        { label: 'Show on map', onClick: () => navigate(`/live-map?vehicle=${v.id}`) },
      ],
    })),
    ...delayInsights.map(i => ({
      id: `insight-${i.id}`,
      kind: 'delay' as const,
      title: i.title,
      subtitle: i.insight,
      time: '',
      actions: i.vehicle_id ? [{ label: 'Show on map', onClick: () => navigate(`/live-map?vehicle=${i.vehicle_id}`) }] : [],
    })),
    ...idleInsights.map(i => ({
      id: `insight-${i.id}`,
      kind: 'idle' as const,
      title: i.title,
      subtitle: i.insight,
      time: '',
      actions: i.vehicle_id ? [{ label: 'View vehicle', onClick: () => navigate(`/fleet/${i.vehicle_id}`) }] : [],
    })),
    ...(peopleAttention?.expired_licences ?? []).map(p => ({
      id: `licence-expired-${p.user_id}`,
      kind: 'licence-expired' as const,
      title: 'Driver licence expired',
      subtitle: `${p.full_name ?? 'Unnamed driver'}${p.expires_on ? ` · expired ${formatDate(p.expires_on)}` : ''}`,
      time: '',
      actions: [{ label: 'Open profile', onClick: () => navigate(`/admin/users/${p.user_id}?tab=documents`) }],
    })),
    ...(peopleAttention?.expiring_licences ?? []).map(p => ({
      id: `licence-expiring-${p.user_id}`,
      kind: 'licence-expiring' as const,
      title: 'Driver licence expiring',
      subtitle: `${p.full_name ?? 'Unnamed driver'}${p.expires_on ? ` · expires ${formatDate(p.expires_on)}` : ''}`,
      time: '',
      actions: [{ label: 'Open profile', onClick: () => navigate(`/admin/users/${p.user_id}?tab=documents`) }],
    })),
  ]
  const missingDocs = peopleAttention?.missing_required ?? []
  if (missingDocs.length > 0) {
    const names = missingDocs.slice(0, 3).map(p => p.full_name ?? 'Unnamed').join(', ')
    attentionItems.push({
      id: 'people-missing-documents',
      kind: 'documents',
      title: `${missingDocs.length.toLocaleString('en-IN')} ${missingDocs.length === 1 ? 'person is' : 'people are'} missing required documents`,
      subtitle: missingDocs.length > 3 ? `${names} and ${missingDocs.length - 3} more` : names,
      time: '',
      actions: [{ label: 'Review documents', onClick: () => navigate(missingDocs.length === 1 ? `/admin/users/${missingDocs[0].user_id}?tab=documents` : '/admin/users?tab=attention') }],
    })
  }

  // Documents belong to people, not to the fleet: they get their own card
  const PEOPLE_KINDS: AttentionItem['kind'][] = ['licence-expired', 'licence-expiring', 'documents']
  const fleetItems = attentionItems.filter(i => !PEOPLE_KINDS.includes(i.kind))
  const peopleItems = attentionItems.filter(i => PEOPLE_KINDS.includes(i.kind))

  const queues = today.data ? splitQueues(buildQueues(today.data)) : null
  const live = today.data?.live

  return (
    <Page>
      <PageHeader
        title="Today"
        description="What needs you now, most urgent first."
        actions={<Button icon={<Plus size={16} />} onClick={openModal}>Create shipment</Button>}
      />

      {pendingOrgs !== null && pendingOrgs > 0 && (
        <Card padded className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text">Companies waiting for approval</h2>
            <p className="mt-0.5 text-xs text-muted">New logistics companies cannot start until you approve them.</p>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-3xl font-semibold leading-none text-warning tabular">{pendingOrgs.toLocaleString('en-IN')}</p>
            <Link to="/platform/organisations" className={buttonClasses({ variant: 'secondary' })}>Review companies</Link>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Active trips" value={live?.active_trips ?? '–'} loading={today.isLoading} icon={<RouteIcon size={18} />} />
        <Stat
          label="Vehicles on the road"
          value={live?.vehicles_on_road ?? '–'}
          hint={vehiclesLoading ? undefined : `${activeVehicles.length.toLocaleString('en-IN')} tracked, ${liveVehicleCount.toLocaleString('en-IN')} sending a position now`}
          loading={today.isLoading}
          icon={<Truck size={18} />}
        />
        <Stat
          label="On-time rate"
          value={typeof live?.on_time_rate_pct === 'number' ? `${Math.round(live.on_time_rate_pct)}%` : '—'}
          hint={typeof live?.on_time_rate_pct === 'number' ? 'Trips completed today' : 'No trips started today'}
          loading={today.isLoading}
          icon={<Clock size={18} />}
        />
      </div>

      {today.isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-40 rounded-card" />)}
        </div>
      )}
      {today.error && <ErrorState title="We could not load your work queues" description="Check your connection and try again." onRetry={() => today.refetch()} />}

      {queues && queues.waiting.length === 0 && (
        <Card padded>
          <EmptyState compact icon={<Activity size={22} />} title="All clear" description="Nothing is waiting on you right now." />
        </Card>
      )}

      {queues && queues.waiting.length > 0 && (
        <section aria-label="Work queues" className="space-y-3">
          <SectionHeader title="Waiting on you" description="Each button opens exactly the items counted." />
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {queues.waiting.map(queue => (
              <QueueCard
                key={queue.id}
                queue={queue}
                actions={queue.id === 'driverActions' && (driverActions.data?.length ?? 0) > 0 ? (
                  <ul className="divide-y divide-border rounded-control border border-border">
                    {driverActions.data!.map(n => {
                      const path = notificationPath({ type: n.type, data: n.data }, 'staff')
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            disabled={!path}
                            onClick={() => path && navigate(path)}
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-subtle disabled:cursor-default disabled:hover:bg-transparent"
                          >
                            <span className="w-full truncate text-sm font-medium text-text">{n.title}</span>
                            <span className="line-clamp-2 text-xs text-muted">{n.body}</span>
                            <span className="text-xs text-muted">{formatRelative(n.created_at)}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : undefined}
              />
            ))}
          </ul>
        </section>
      )}

      {queues && queues.waiting.length > 0 && queues.clear.length > 0 && (
        <p className="text-sm text-muted">
          Nothing else waiting: {queues.clear.map((q, i) => (
            <span key={q.id}>{i > 0 && ', '}<Link to={q.to} className="text-brand hover:underline">{q.title}</Link></span>
          ))}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Card className="flex flex-col overflow-hidden">
          <CardHeader
            title="Live fleet"
            description="Vehicles reporting position now."
            actions={<Link to="/live-map" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>Open live map</Link>}
          />
          <LiveMap vehicles={activeVehicles} selectedVehicleId={selectedVehicleId} className="h-[420px]" />
        </Card>

        <Card className="flex flex-col overflow-hidden">
          <CardHeader
            title="Fleet needs attention"
            actions={fleetItems.length > 0 && <StatusPill tone="danger" dot={false}>{fleetItems.length}</StatusPill>}
          />
          <div className="max-h-[420px] flex-1 divide-y divide-border overflow-y-auto">
            {fleetItems.length === 0 ? (
              <EmptyState compact icon={<Activity size={22} />} title="All clear" description="No fleet issues need attention right now." />
            ) : (
              fleetItems.map(item => <AttentionRow key={item.id} item={item} />)
            )}
          </div>
          {rerouteCount > 0 && (
            <div className="border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" icon={<RouteIcon size={16} />} onClick={() => navigate('/optimize')}>
                {rerouteCount.toLocaleString('en-IN')} reroute {rerouteCount === 1 ? 'suggestion' : 'suggestions'}: open Optimize
              </Button>
            </div>
          )}
        </Card>
      </div>

      {peopleItems.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="People need attention" actions={<StatusPill tone="warning" dot={false}>{peopleItems.length}</StatusPill>} />
          <div className="divide-y divide-border">
            {peopleItems.map(item => <AttentionRow key={item.id} item={item} />)}
          </div>
        </Card>
      )}
    </Page>
  )
}
