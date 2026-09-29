import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, MapPinned, MapPin, Phone, ShieldAlert, Truck, User } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { telemetryAPI } from '@/services/api'
import toast from 'react-hot-toast'
import {
  Page, PageHeader, Button, StatusPill, EmptyState, Skeleton, useConfirm, buttonClasses,
} from '@/components/ui'
import { MapView, type MapPoint } from '@/components/map'
import { sosTypeLabel } from '@/utils/sos'

interface SosAlert {
  id: string
  driver_id: string | null
  vehicle_id: string | null
  alert_type: string
  description: string | null
  latitude: number | null
  longitude: number | null
  status: string
  created_at: string
  driver?: { full_name: string; phone: string } | null
  vehicle?: { plate_number: string } | null
}

async function attachDetails(alert: SosAlert): Promise<SosAlert> {
  let driver: SosAlert['driver'] = null
  let vehicle: SosAlert['vehicle'] = null
  if (alert.driver_id) {
    const { data } = await supabase.from('users').select('full_name, phone').eq('id', alert.driver_id).maybeSingle()
    if (data) driver = data
  }
  if (alert.vehicle_id) {
    const { data } = await supabase.from('vehicles').select('plate_number').eq('id', alert.vehicle_id).maybeSingle()
    if (data) vehicle = data
  }
  return { ...alert, driver, vehicle }
}

export default function EmergencyPage() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: alerts = [], isLoading, error, refetch } = useQuery<SosAlert[]>({
    queryKey: ['sos-alerts', 'emergency-page'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('sos_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      if (err) throw err
      return Promise.all((data ?? []).map(attachDetails))
    },
  })

  useEffect(() => {
    const channel = supabase
      .channel('emergency_page_listener')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts' }, async payload => {
        const enhanced = await attachDetails(payload.new as SosAlert)
        queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev => [enhanced, ...(prev ?? [])])
        toast.error('New emergency alert')
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_alerts' }, payload => {
        queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev =>
          prev?.map(a => a.id === payload.new.id ? { ...a, ...payload.new } : a))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  // Live position of the selected alert's vehicle.
  const [livePosition, setLivePosition] = useState<{ lat: number; lng: number } | null>(null)
  const selected = alerts.find(a => a.id === selectedId) ?? null
  useEffect(() => {
    setLivePosition(null)
    if (!selected?.vehicle_id) return
    const channel = supabase
      .channel('emergency-live-gps')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vehicles', filter: `id=eq.${selected.vehicle_id}` }, payload => {
        const row = payload.new as { latitude?: number; longitude?: number }
        if (row.latitude != null && row.longitude != null) setLivePosition({ lat: row.latitude, lng: row.longitude })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selected?.vehicle_id])

  useEffect(() => {
    if (!selectedId && alerts.length > 0) setSelectedId(alerts[0].id)
  }, [alerts, selectedId])

  const acknowledge = async (alert: SosAlert) => {
    try {
      await telemetryAPI.acknowledgeSos(alert.id)
      queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev =>
        prev?.map(a => a.id === alert.id ? { ...a, status: 'acknowledged' } : a))
      toast.success('Alert acknowledged')
    } catch (err) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(message || 'Failed to acknowledge the alert')
    }
  }

  const resolve = async (alert: SosAlert) => {
    const ok = await confirm({
      title: 'Resolve this alert?',
      message: `Mark the ${sosTypeLabel(alert.alert_type)} alert for ${alert.vehicle?.plate_number ?? 'this vehicle'} as resolved.`,
      confirmLabel: 'Resolve',
    })
    if (!ok) return
    try {
      await telemetryAPI.resolveSos(alert.id)
      queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev =>
        prev?.map(a => a.id === alert.id ? { ...a, status: 'resolved' } : a))
      toast.success('Alert resolved')
    } catch (err) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(message || 'Failed to resolve the alert')
    }
  }

  const activeAlerts = alerts.filter(a => a.status !== 'resolved')
  const points: MapPoint[] = activeAlerts.flatMap(a => {
    const isSelected = a.id === selectedId
    const lat = isSelected && livePosition ? livePosition.lat : a.latitude
    const lng = isSelected && livePosition ? livePosition.lng : a.longitude
    if (lat == null || lng == null) return []
    return [{
      id: a.id,
      kind: 'incident' as const,
      position: { lat, lng },
      label: `${sosTypeLabel(a.alert_type)}: ${a.vehicle?.plate_number ?? 'Unknown vehicle'}`,
      active: true,
    }]
  })

  return (
    <Page>
      <PageHeader
        title="Emergencies"
        description={`${activeAlerts.length} active ${activeAlerts.length === 1 ? 'alert' : 'alerts'}.`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        <div className="rounded-card border border-border bg-surface">
          <div className="max-h-[70vh] divide-y divide-border overflow-y-auto">
            {isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
            ) : error ? (
              <div className="p-4">
                <EmptyState compact icon={<AlertTriangle size={22} />} title="We could not load alerts" action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>} />
              </div>
            ) : alerts.length === 0 ? (
              <EmptyState compact icon={<ShieldAlert size={22} />} title="No emergency alerts" description="SOS alerts from drivers will appear here." />
            ) : (
              alerts.map(alert => {
                const isActive = alert.status !== 'resolved'
                const isSelected = alert.id === selectedId
                return (
                  <div
                    key={alert.id}
                    className={'px-4 py-3 transition-colors ' + (isSelected ? 'bg-brand-soft' : 'hover:bg-surface-subtle')}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(alert.id)}
                      aria-pressed={isSelected}
                      className="block w-full rounded-control text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text">
                          {isActive ? <AlertTriangle size={14} className="text-danger" aria-hidden="true" /> : <CheckCircle size={14} className="text-success" aria-hidden="true" />}
                          {sosTypeLabel(alert.alert_type)}
                        </span>
                        <StatusPill status={alert.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted">{new Date(alert.created_at).toLocaleString('en-IN')}</p>
                      <div className="mt-2 space-y-0.5 text-sm text-text">
                        <p className="inline-flex items-center gap-1.5"><User size={13} className="text-muted" aria-hidden="true" />{alert.driver?.full_name || 'Unknown driver'}</p>
                        <p className="inline-flex items-center gap-1.5"><Truck size={13} className="text-muted" aria-hidden="true" />{alert.vehicle?.plate_number || 'Unknown vehicle'}</p>
                      </div>
                      {alert.description && <p className="mt-2 truncate text-xs italic text-muted">"{alert.description}"</p>}
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {alert.driver?.phone && (
                        <a
                          href={`tel:${alert.driver.phone}`}
                          onClick={e => e.stopPropagation()}
                          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        >
                          <Phone size={14} aria-hidden="true" /> Call driver
                        </a>
                      )}
                      {alert.vehicle_id && (
                        <Link
                          to={`/live-map?vehicle=${alert.vehicle_id}`}
                          onClick={e => e.stopPropagation()}
                          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        >
                          <MapPinned size={14} aria-hidden="true" /> Open on live map
                        </Link>
                      )}
                      {isActive && alert.status === 'active' && (
                        <Button size="sm" variant="secondary" onClick={() => acknowledge(alert)}>Acknowledge</Button>
                      )}
                      {isActive && (
                        <Button size="sm" variant="secondary" onClick={() => resolve(alert)}>Resolve</Button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="relative h-[70vh] overflow-hidden rounded-card border border-border">
          <MapView
            mode="incident"
            points={points}
            selectedId={selectedId}
            onSelect={setSelectedId}
            ariaLabel="Map of active emergency alerts"
          >
            {selected && (
              <div className="absolute left-3 top-3 z-10 max-w-xs rounded-control border border-border bg-surface p-3 shadow-raised">
                <p className="text-sm font-medium text-text">{sosTypeLabel(selected.alert_type)}</p>
                <p className="mt-0.5 text-xs text-muted">{new Date(selected.created_at).toLocaleString('en-IN')}</p>
                <div className="mt-2 space-y-1 text-sm text-text">
                  <p className="inline-flex items-center gap-1.5"><User size={13} className="text-muted" aria-hidden="true" />{selected.driver?.full_name || 'Unknown'}</p>
                  {selected.driver?.phone && (
                    <p className="inline-flex items-center gap-1.5">
                      <Phone size={13} className="text-muted" aria-hidden="true" />
                      <a href={`tel:${selected.driver.phone}`} className="text-brand hover:underline">{selected.driver.phone}</a>
                    </p>
                  )}
                  <p className="inline-flex items-center gap-1.5"><Truck size={13} className="text-muted" aria-hidden="true" />{selected.vehicle?.plate_number || 'Unknown'}</p>
                  {selected.latitude != null && selected.longitude != null && (
                    <p className="inline-flex items-center gap-1.5 font-mono text-xs"><MapPin size={13} className="text-muted" aria-hidden="true" />{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</p>
                  )}
                </div>
              </div>
            )}
          </MapView>
        </div>
      </div>
    </Page>
  )
}
