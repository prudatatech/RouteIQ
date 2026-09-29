import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Truck, Clock, Plus, AlertCircle, WifiOff, Package, Activity, ChevronRight, Inbox, Route as RouteIcon } from 'lucide-react'
import { dashboardAPI, vehiclesAPI, shipmentsAPI, analyticsAPI, vendorAPI } from '@/services/api'
import { Page, PageHeader, Button, Card, CardHeader, Stat, DataTable, StatusPill, EmptyState, type Column } from '@/components/ui'
import LiveMap from '@/components/map/LiveMap'
import { supabase } from '@/services/supabase'
import { useDraftStore } from '@/store/draftStore'
import { ACTIVE_SHIPMENT_STATUSES, destinationOf, isActiveShipmentStatus } from '@/components/shipments/format'
import type { ShipmentRow } from '@/components/shipments/types'
import { isDraftVehicle } from '@/utils/vehicles'

interface VehicleRow {
  id: string
  plate_number: string
  status: string
  last_sync?: string | null
}

interface SosAlertRow {
  id: string
  vehicle_id?: string | null
  alert_type?: string | null
  description?: string | null
  status?: string | null
  created_at: string
}

/** One entry of GET /analytics/insights; only the fields the dashboard reads. */
interface Insight {
  id: string
  type: string
  title: string
  insight: string
  vehicle_id?: string | null
}

interface AttentionItem {
  id: string
  kind: 'incident' | 'offline' | 'delay' | 'idle'
  title: string
  subtitle: string
  time: string
  actions: { label: string; onClick: () => void }[]
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const token = useAuthStore(state => state.token)
  const openModal = useDraftStore(s => s.openModal)

  useEffect(() => {
    if (!token) navigate('/login')
  }, [token, navigate])

  const [searchParams] = useSearchParams()
  const selectedVehicleId = searchParams.get('vehicle')

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['kpis'],
    queryFn: dashboardAPI.kpis,
    refetchInterval: 30_000,
  })

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<VehicleRow[]>({
    queryKey: ['vehicles', 'live'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }) as Promise<VehicleRow[]>,
    refetchInterval: 5_000,
  })

  // Exact counts from the server, so the number stays right when there are more shipments
  // than the list below carries.
  const { data: shipmentCounts, isLoading: countsLoading } = useQuery({
    queryKey: ['shipments', 'counts'],
    queryFn: dashboardAPI.shipmentCounts,
    refetchInterval: 30_000,
  })

  // The list below shows the latest shipments only. "Active" there uses the same rule
  // the Shipments tabs use (isActiveShipmentStatus).
  const { data: shipments = [], isLoading: shipmentsLoading, error: shipmentsError, refetch: refetchShipments } = useQuery<ShipmentRow[]>({
    queryKey: ['shipments', 'dashboard'],
    queryFn: () => shipmentsAPI.list({ limit: 200 }) as Promise<ShipmentRow[]>,
    refetchInterval: 30_000,
  })

  const { data: sosAlerts = [] } = useQuery<SosAlertRow[]>({
    queryKey: ['sos-alerts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sos_alerts')
        .select('*')
        .neq('status', 'resolved')
        .order('created_at', { ascending: false })
        .limit(50)
      return data || []
    },
    refetchInterval: 15_000,
  })

  const { data: insights = [] } = useQuery<Insight[]>({
    queryKey: ['insights'],
    queryFn: () => analyticsAPI.insights() as Promise<Insight[]>,
    refetchInterval: 60_000,
  })

  // Same source as the sidebar badge.
  const { data: pendingVendorRequests, isLoading: vendorRequestsLoading } = useQuery<unknown[]>({
    queryKey: ['vendor-requests', 'pending-count'],
    queryFn: async () => {
      const data = await vendorAPI.pendingRequests()
      return Array.isArray(data) ? data : []
    },
    refetchInterval: 60_000,
  })

  const activeVehicles = vehicles.filter(v => !isDraftVehicle(v))
  const offlineVehicles = activeVehicles.filter(v => v.status === 'offline')
  const activeShipments = shipments.filter(s => isActiveShipmentStatus(s.status))
  const activeShipmentCount = shipmentCounts
    ? ACTIVE_SHIPMENT_STATUSES.reduce((sum, status) => sum + (shipmentCounts.counts[status] ?? 0), 0)
    : null
  // No fabricated fallback: on_time_rate_pct is null when there is no route data for today.
  const onTimeRate = typeof kpis?.on_time_rate_pct === 'number' ? kpis.on_time_rate_pct.toFixed(0) : null
  const openAlerts = sosAlerts.filter(a => a.status !== 'resolved')

  const delayInsights = insights.filter(i => i.type === 'delay_risk')
  const idleInsights = insights.filter(i => i.type === 'idle_vehicle')
  const rerouteCount = insights.filter(i => i.type === 'reroute_suggestion').length

  // Needs attention: the same list backs both the count badge and the rows below.
  const attentionItems: AttentionItem[] = [
    ...openAlerts.map(alert => {
      const v = vehicles.find(veh => veh.id === alert.vehicle_id)
      return {
        id: `sos-${alert.id}`,
        kind: 'incident' as const,
        title: alert.alert_type === 'accident' ? 'Serious accident' : 'Emergency alert',
        subtitle: `${v?.plate_number || 'Unknown vehicle'} · ${alert.description || 'Reported'}`,
        time: timeAgo(alert.created_at),
        actions: [{ label: 'Review incident', onClick: () => navigate('/emergency') }],
      }
    }),
    ...offlineVehicles.map(v => ({
      id: `offline-${v.id}`,
      kind: 'offline' as const,
      title: 'Vehicle offline',
      subtitle: v.plate_number,
      time: v.last_sync ? timeAgo(v.last_sync) : '',
      actions: [
        { label: 'View vehicle', onClick: () => navigate(`/fleet?open=${v.id}`) },
        { label: 'Show on map', onClick: () => navigate(`/live-map?vehicle=${v.id}`) },
      ],
    })),
    ...delayInsights.map(i => ({
      id: `insight-${i.id}`,
      kind: 'delay' as const,
      title: i.title,
      subtitle: i.insight,
      time: '',
      actions: i.vehicle_id
        ? [{ label: 'Show on map', onClick: () => navigate(`/live-map?vehicle=${i.vehicle_id}`) }]
        : [],
    })),
    ...idleInsights.map(i => ({
      id: `insight-${i.id}`,
      kind: 'idle' as const,
      title: i.title,
      subtitle: i.insight,
      time: '',
      actions: i.vehicle_id
        ? [{ label: 'View vehicle', onClick: () => navigate(`/fleet?open=${i.vehicle_id}`) }]
        : [],
    })),
  ]

  const columns: Column<ShipmentRow>[] = [
    { key: 'tracking_id', header: 'Tracking ID', cell: s => <span className="font-mono text-xs">{s.tracking_id}</span> },
    { key: 'status', header: 'Status', cell: s => <StatusPill status={s.status} /> },
    {
      key: 'route',
      header: 'Route',
      hideOnMobile: true,
      cell: s => {
        const dest = destinationOf(s)
        return <span>{s.origin_name || s.origin_address || 'Origin pending'} → {dest?.name || dest?.address || 'Destination pending'}</span>
      },
    },
    { key: 'driver', header: 'Driver', hideOnMobile: true, hideBelow: 'lg', cell: s => s.driver_name || 'Unassigned' },
    {
      key: 'created',
      header: 'Created',
      sortValue: s => s.created_at ? new Date(s.created_at).getTime() : 0,
      cell: s => s.created_at ? new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—',
    },
  ]

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        description="Today's operations at a glance."
        actions={<Button icon={<Plus size={16} />} onClick={openModal}>Create shipment</Button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active shipments" value={activeShipmentCount ?? '–'} loading={countsLoading} icon={<Package size={18} />} />
        <Stat
          label="Tracked vehicles"
          value={activeVehicles.length}
          hint={`${activeVehicles.length - offlineVehicles.length} reporting · ${offlineVehicles.length} offline`}
          loading={vehiclesLoading}
          icon={<Truck size={18} />}
        />
        <Stat
          label="Open incidents"
          value={openAlerts.length}
          hint={openAlerts.length > 0 ? 'Needs a response' : 'All clear'}
          tone={openAlerts.length > 0 ? 'danger' : 'success'}
          icon={openAlerts.length > 0 ? <AlertCircle size={18} /> : <Activity size={18} />}
        />
        <Stat
          label="On-time delivery"
          value={onTimeRate !== null ? `${onTimeRate}%` : '—'}
          hint="Today"
          loading={kpisLoading}
          icon={<Clock size={18} />}
        />
      </div>

      <Card padded className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden="true"><Inbox size={18} /></span>
          <div>
            <p className="text-sm font-medium text-text">
              Pending vendor requests{vendorRequestsLoading ? '' : ` (${(pendingVendorRequests?.length ?? 0).toLocaleString('en-IN')})`}
            </p>
            <p className="text-xs text-muted">Loads vendors want you to approve and assign a vehicle to.</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" icon={<ChevronRight size={16} />} onClick={() => navigate('/vendor-requests')}>Open vendor requests</Button>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Card className="flex flex-col overflow-hidden">
          <CardHeader title="Live fleet" description="Vehicles reporting position now." />
          <LiveMap
            vehicles={activeVehicles}
            selectedVehicleId={selectedVehicleId}
            className="h-[420px]"
          />
        </Card>

        <Card className="flex flex-col overflow-hidden">
          <CardHeader
            title="Needs attention"
            actions={attentionItems.length > 0 && <StatusPill tone="danger" dot={false}>{attentionItems.length}</StatusPill>}
          />
          <div className="max-h-[420px] flex-1 overflow-y-auto divide-y divide-border">
            {attentionItems.length === 0 ? (
              <EmptyState compact icon={<Activity size={22} />} title="All clear" description="No issues need attention right now." />
            ) : (
              attentionItems.map(item => (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.kind === 'delay' || item.kind === 'idle' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger'}`}
                    aria-hidden="true"
                  >
                    {item.kind === 'incident' ? <AlertCircle size={16} /> : item.kind === 'offline' ? <WifiOff size={16} /> : item.kind === 'delay' ? <Clock size={16} /> : <Truck size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{item.subtitle}</p>
                    {item.time && <p className="mt-0.5 text-xs text-disabled">{item.time}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    {item.actions.map(a => (
                      <Button key={a.label} variant="ghost" size="sm" onClick={a.onClick}>{a.label}</Button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          {rerouteCount > 0 && (
            <div className="border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" icon={<RouteIcon size={16} />} onClick={() => navigate('/optimize')}>
                {rerouteCount.toLocaleString('en-IN')} reroute {rerouteCount === 1 ? 'suggestion' : 'suggestions'}: open route optimization
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Active shipments"
          description="Shipments that haven't been delivered yet."
          actions={<Button variant="ghost" size="sm" icon={<ChevronRight size={16} />} onClick={() => navigate('/shipments')}>View all</Button>}
        />
        <div className="p-4 pt-0 sm:p-6 sm:pt-0">
          <DataTable
            caption="Active shipments"
            columns={columns}
            rows={activeShipments}
            rowKey={s => s.id}
            loading={shipmentsLoading}
            error={shipmentsError ? 'We could not load shipments.' : undefined}
            onRetry={() => refetchShipments()}
            empty={{ title: 'No active shipments', description: 'Every shipment has been delivered or cancelled.', action: <Button onClick={openModal}>Create shipment</Button> }}
            onRowClick={s => navigate('/shipments?tracking=' + s.tracking_id)}
            pageSize={10}
          />
        </div>
      </Card>
    </Page>
  )
}
