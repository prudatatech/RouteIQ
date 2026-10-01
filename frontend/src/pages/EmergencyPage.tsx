import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, ExternalLink, MapPinned, MapPin, MoreHorizontal, Phone, ShieldAlert, Truck, User, Wrench } from 'lucide-react'
import { supabase, openChannel } from '@/services/supabase'
import { telemetryAPI } from '@/services/api'
import { formatDateTime, formatKg, formatPieces } from '@/utils/display'
import toast from 'react-hot-toast'
import {
  Page, PageHeader, Button, StatusPill, EmptyState, ErrorState, Skeleton, Card, CardHeader, useConfirm, buttonClasses,
} from '@/components/ui'
import { OPEN_EXCEPTION_FILTER, cargoKeys, exceptionsAPI } from '@/services/cargo'
import { OnBoardList } from '@/components/cargo/OnBoardList'
import { onBoardTotals, useOnBoard } from '@/components/cargo/useOnBoard'
import { SlaBadge } from '@/components/cargo/CargoBits'
import { useNow } from '@/components/cargo/useNow'
import { exceptionTypeLabel, holdCaseFor } from '@/components/cargo/logic'
import { MapView, type MapPoint } from '@/components/map'
import { canOfferReturnToService, isOpenSos, sosHeadline, sosNextStep, sosSeverityLabel, sosStatusLabel, sosStatusTone, sosTypeLabel, type SosStatus } from '@/utils/sos'
import { returnVehicleToService } from '@/components/fleet/vehicleStatus'
import { apiErrorMessage } from '@/components/fleet/health'
import { canReturnToService } from '@/utils/vehicles'
import { MoveToMaintenanceModal } from '@/components/fleet/maintenance/MoveToMaintenanceModal'
import { ReturnToServiceModal } from '@/components/fleet/maintenance/ReturnToServiceModal'
import { useOpenMaintenanceJobs } from '@/components/fleet/maintenance/useOpenMaintenanceJobs'

interface SosAlert {
  id: string
  driver_id: string | null
  vehicle_id: string | null
  alert_type: string
  description: string | null
  severity?: 'serious' | 'minor' | null
  latitude: number | null
  longitude: number | null
  status: string
  created_at: string
  driver?: { full_name: string; phone: string } | null
  vehicle?: { plate_number: string; status: string | null } | null
}

async function attachDetails(alert: SosAlert): Promise<SosAlert> {
  let driver: SosAlert['driver'] = null
  let vehicle: SosAlert['vehicle'] = null
  if (alert.driver_id) {
    const { data } = await supabase.from('users').select('full_name, phone').eq('id', alert.driver_id).maybeSingle()
    if (data) driver = data
  }
  if (alert.vehicle_id) {
    const { data } = await supabase.from('vehicles').select('plate_number, status').eq('id', alert.vehicle_id).maybeSingle()
    if (data) vehicle = data
  }
  return { ...alert, driver, vehicle }
}


/** What the SOS vehicle is carrying, the case opened for it, and the way into planning the goods. Nothing when it is empty. */
function SosCargoCard({ alert }: { alert: SosAlert }) {
  const vehicleId = alert.vehicle_id
  const now = useNow()
  const onBoard = useOnBoard(vehicleId, { refetchInterval: 60_000 })
  const items = onBoard.data?.items ?? []
  const filters = { vehicle_id: vehicleId ?? '', status: OPEN_EXCEPTION_FILTER }
  const cases = useQuery({
    queryKey: cargoKeys.exceptions(filters),
    queryFn: () => exceptionsAPI.list(filters),
    enabled: !!vehicleId && items.length > 0,
    refetchInterval: 60_000,
  })
  if (!vehicleId) return null
  const plate = alert.vehicle?.plate_number ?? 'vehicle'
  if (onBoard.isLoading) return <Skeleton className="h-20 w-full" />
  if (onBoard.isError) {
    return <ErrorState compact title="We could not load the cargo on board" onRetry={() => onBoard.refetch()} />
  }
  if (items.length === 0) return null
  const totals = onBoardTotals(items)
  // The vehicle's hold case: the one naming this alert, else the case the SOS joined (one per vehicle)
  const linked = holdCaseFor(cases.data ?? [], { sosAlertId: alert.id })
  return (
    <Card>
      <CardHeader
        title={`Cargo on ${plate}`}
        description={`${totals.consignments.toLocaleString('en-IN')} ${totals.consignments === 1 ? 'shipment' : 'shipments'}, ${formatPieces(totals.pieces)}, ${formatKg(totals.weightKg)}`}
        actions={(
          <Link
            to={linked ? `/cargo/exceptions/${linked.id}?action=transship` : `/cargo?vehicle=${vehicleId}`}
            className={buttonClasses({ variant: 'primary', size: 'sm' })}
          >
            Plan the cargo
          </Link>
        )}
      />
      <div className="px-4 sm:px-6">
        {cases.isLoading ? (
          <Skeleton className="my-3 h-5 w-48" />
        ) : cases.isError ? (
          <p className="py-3 text-sm text-danger" role="alert">We could not load the cargo case for this SOS.</p>
        ) : linked ? (
          <p className="flex flex-wrap items-center gap-2 py-3 text-sm">
            <Link to={`/cargo/exceptions/${linked.id}`} className="font-medium text-brand hover:underline">{linked.code} · {exceptionTypeLabel(linked.type)}</Link>
            <SlaBadge dueAt={linked.sla_due_at} status={linked.status} now={now} />
          </p>
        ) : (
          <p className="py-3 text-sm text-muted">No cargo case is open for this vehicle yet.</p>
        )}
        <OnBoardList items={items} className="border-t border-border" />
      </div>
    </Card>
  )
}

export default function EmergencyPage() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A breakdown or accident can become a maintenance job; a vehicle with a job returns through its job
  const [maintenanceAlert, setMaintenanceAlert] = useState<SosAlert | null>(null)
  const [returningAlert, setReturningAlert] = useState<SosAlert | null>(null)
  const openJobs = useOpenMaintenanceJobs()
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('open')

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
    // Open alerts first, so an old unresolved one is never pushed off the list by resolved ones.
    select: rows => [...rows].sort((a, b) => Number(!isOpenSos(a.status)) - Number(!isOpenSos(b.status))),
  })

  useEffect(() => {
    const channel = openChannel('emergency_page_listener')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts' }, async payload => {
        const enhanced = await attachDetails(payload.new as SosAlert)
        queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev => [enhanced, ...(prev ?? [])])
        toast.error('New SOS')
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_alerts' }, payload => {
        // A driver cancelling from the app closes the alert here at once, with a note saying why.
        const before = queryClient.getQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'])?.find(a => a.id === payload.new.id)
        if (before && isOpenSos(before.status) && payload.new.status === 'cancelled') {
          toast(`${before.vehicle?.plate_number ?? 'A driver'} cancelled their SOS`)
        }
        queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev =>
          prev?.map(a => a.id === payload.new.id ? { ...a, ...payload.new } : a))
        queryClient.invalidateQueries({ queryKey: ['vehicles', 'sos-counts'] })
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
    const channel = openChannel('emergency-live-gps')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vehicles', filter: `id=eq.${selected.vehicle_id}` }, payload => {
        const row = payload.new as { latitude?: number; longitude?: number }
        if (row.latitude != null && row.longitude != null) setLivePosition({ lat: row.latitude, lng: row.longitude })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selected?.vehicle_id])

  // Opened from a link elsewhere (a notification, the dashboard): ?open=<id> selects that alert,
  // fetching it first when it is older than the 50 listed, then the param is dropped from the URL.
  useEffect(() => {
    if (!openId || isLoading) return
    let cancelled = false
    const finish = () => setSearchParams(params => { params.delete('open'); return params }, { replace: true })
    if (alerts.some(a => a.id === openId)) {
      setSelectedId(openId)
      finish()
      return
    }
    supabase.from('sos_alerts').select('*').eq('id', openId).maybeSingle().then(async ({ data }) => {
      if (cancelled) return
      if (data) {
        const enhanced = await attachDetails(data as SosAlert)
        queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev => [...(prev ?? []), enhanced])
        setSelectedId(openId)
      } else {
        toast.error('That SOS could not be found')
      }
      finish()
    })
    return () => { cancelled = true }
  }, [openId, isLoading, alerts, queryClient, setSearchParams])

  useEffect(() => {
    if (!selectedId && !openId && alerts.length > 0) setSelectedId(alerts[0].id)
  }, [alerts, selectedId, openId])

  /** Shows the alert's new status at once, and refreshes the lists and per-vehicle counts. */
  const applyStatus = (alert: SosAlert, status: SosStatus) => {
    queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev =>
      prev?.map(a => a.id === alert.id ? { ...a, status } : a))
    queryClient.invalidateQueries({ queryKey: ['sos-alerts'] })
    queryClient.invalidateQueries({ queryKey: ['vehicles', 'sos-counts'] })
    queryClient.invalidateQueries({ queryKey: ['vehicles', 'sos-history', alert.vehicle_id] })
  }

  /** The server says what went wrong (usually that someone else already closed it); reload so the list shows the truth. */
  const failed = (err: unknown, fallback: string) => {
    toast.error(apiErrorMessage(err, fallback))
    queryClient.invalidateQueries({ queryKey: ['sos-alerts'] })
  }

  const acknowledge = async (alert: SosAlert) => {
    try {
      await telemetryAPI.acknowledgeSos(alert.id)
      applyStatus(alert, 'acknowledged')
      toast.success('SOS acknowledged')
    } catch (err) {
      failed(err, 'We could not acknowledge this SOS. Try again.')
    }
  }

  const cancel = async (alert: SosAlert) => {
    const ok = await confirm({
      title: 'Close this SOS as a false alarm?',
      message: `The ${sosTypeLabel(alert.alert_type)} SOS for ${alert.vehicle?.plate_number ?? 'this vehicle'} is closed as cancelled. It stays in the vehicle's SOS history.`,
      confirmLabel: 'Close as false alarm',
      cancelLabel: 'Keep it open',
    })
    if (!ok) return
    try {
      await telemetryAPI.cancelSos(alert.id)
      applyStatus(alert, 'cancelled')
      toast.success('SOS closed as a false alarm')
    } catch (err) {
      failed(err, 'We could not close this SOS. Try again.')
    }
  }

  const resolve = async (alert: SosAlert) => {
    const ok = await confirm({
      title: 'Resolve this SOS?',
      message: `Mark the ${sosTypeLabel(alert.alert_type)} SOS for ${alert.vehicle?.plate_number ?? 'this vehicle'} as resolved.`,
      confirmLabel: 'Resolve SOS',
    })
    if (!ok) return
    try {
      await telemetryAPI.resolveSos(alert.id)
      applyStatus(alert, 'resolved')
      toast.success('SOS resolved')
    } catch (err) {
      failed(err, 'We could not resolve this SOS. Try again.')
      return
    }
    // A serious accident or breakdown put the vehicle in maintenance; resolving does not bring it back.
    if (alert.vehicle_id && canReturnToService({ status: alert.vehicle?.status })) await returnToService(alert, true)
  }

  const setVehicleStatusLocal = (vehicleId: string, status: string) =>
    queryClient.setQueryData<SosAlert[]>(['sos-alerts', 'emergency-page'], prev =>
      prev?.map(a => a.vehicle_id === vehicleId && a.vehicle ? { ...a, vehicle: { ...a.vehicle, status } } : a))

  /** Puts the alert's vehicle back in service. `ask` shows the question first (right after resolving). */
  const returnToService = async (alert: SosAlert, ask = false) => {
    if (!alert.vehicle_id) return
    if (openJobs.has(alert.vehicle_id)) { setReturningAlert(alert); return }
    const plate = alert.vehicle?.plate_number ?? 'this vehicle'
    if (ask) {
      const ok = await confirm({
        title: `Return ${plate} to service?`,
        message: `${plate} was taken out of service after this emergency. Return it once it is safe to dispatch again, or leave it in maintenance.`,
        confirmLabel: 'Return to service',
        cancelLabel: 'Keep in maintenance',
      })
      if (!ok) return
    }
    try {
      await returnVehicleToService(alert.vehicle_id)
      setVehicleStatusLocal(alert.vehicle_id, 'available')
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(`${plate} is back in service`)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to return the vehicle to service'))
    }
  }

  const activeAlerts = alerts.filter(a => isOpenSos(a.status))
  // Open alerts are always pinned. A resolved alert gets a muted pin only while it is selected.
  const pinned = alerts.filter(a => isOpenSos(a.status) || a.id === selectedId)
  const points: MapPoint[] = pinned.flatMap(a => {
    const isSelected = a.id === selectedId
    const isResolved = !isOpenSos(a.status)
    const lat = isSelected && livePosition ? livePosition.lat : a.latitude
    const lng = isSelected && livePosition ? livePosition.lng : a.longitude
    if (lat == null || lng == null) return []
    return [{
      id: a.id,
      kind: 'incident' as const,
      position: { lat, lng },
      label: `${sosHeadline(a)}: ${a.vehicle?.plate_number ?? 'Unknown vehicle'}`,
      active: !isResolved,
      muted: isResolved,
    }]
  })

  return (
    <Page>
      <PageHeader
        title="SOS alerts"
        description={isLoading ? 'Driver SOS calls and where they are.' : activeAlerts.length === 0 ? 'No active SOS.' : `${activeAlerts.length.toLocaleString('en-IN')} active ${activeAlerts.length === 1 ? 'SOS' : 'SOS calls'}`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        <div className="rounded-card border border-border bg-surface">
          <div className="max-h-[70vh] divide-y divide-border overflow-y-auto">
            {isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
            ) : error ? (
              <div className="p-4">
                <ErrorState compact title="We could not load SOS calls" onRetry={() => refetch()} />
              </div>
            ) : alerts.length === 0 ? (
              <EmptyState compact icon={<ShieldAlert size={22} />} title="No SOS yet" description="SOS calls from drivers and staff will appear here." />
            ) : (
              alerts.map(alert => {
                const isActive = isOpenSos(alert.status)
                const isSelected = alert.id === selectedId
                const step = sosNextStep(alert.status)
                const canMaintain = isActive && !!alert.vehicle_id && ['breakdown', 'accident'].includes(alert.alert_type) && !openJobs.has(alert.vehicle_id)
                  && alert.vehicle?.status !== 'archived'
                const hasMore = !!alert.vehicle_id || (alert.latitude != null && alert.longitude != null) || isActive
                return (
                  <div
                    key={alert.id}
                    className={'px-4 py-3 transition-colors ' + (isSelected ? 'bg-brand-soft' : 'hover:bg-surface-subtle')}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(alert.id)}
                      aria-pressed={isSelected}
                      className="block w-full rounded-control text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text">
                          {isActive ? <AlertTriangle size={14} className={alert.status === 'acknowledged' ? 'text-warning' : 'text-danger'} aria-hidden="true" /> : <CheckCircle size={14} className="text-success" aria-hidden="true" />}
                          {sosTypeLabel(alert.alert_type)}
                        </span>
                        <StatusPill tone={sosStatusTone(alert.status)}>{sosStatusLabel(alert.status)}</StatusPill>
                      </div>
                      <p className="mt-1 text-xs text-muted">{formatDateTime(alert.created_at)}</p>
                      <div className="mt-2 space-y-0.5 text-sm text-text">
                        <p className="flex items-center gap-1.5"><User size={14} className="shrink-0 text-muted" aria-hidden="true" /><span className="min-w-0 truncate">{alert.driver?.full_name || 'Unknown driver'}</span></p>
                        <p className="flex items-center gap-1.5"><Truck size={14} className="shrink-0 text-muted" aria-hidden="true" /><span className="min-w-0 truncate">{alert.vehicle?.plate_number || 'Unknown vehicle'}</span></p>
                      </div>
                      {sosSeverityLabel(alert.severity) && (
                        <p className={'mt-2 text-xs font-medium ' + (alert.severity === 'serious' ? 'text-danger' : 'text-muted')}>{sosSeverityLabel(alert.severity)}</p>
                      )}
                      {canReturnToService({ status: alert.vehicle?.status }) && (
                        <p className="mt-2"><StatusPill tone="warning" dot={false}>Vehicle in maintenance</StatusPill></p>
                      )}
                      {alert.description && <p className="mt-2 truncate text-xs italic text-muted">"{alert.description}"</p>}
                    </button>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {/* One main step per state: acknowledge, then resolve. Everything else is a quieter link or in More. */}
                      {step === 'acknowledge' && <Button size="sm" onClick={() => acknowledge(alert)}>Acknowledge</Button>}
                      {step === 'resolve' && <Button size="sm" onClick={() => resolve(alert)}>Resolve</Button>}
                      {alert.driver?.phone && (
                        <a
                          href={`tel:${alert.driver.phone}`}
                          aria-label={`Call ${alert.driver.full_name || 'driver'}`}
                          onClick={e => e.stopPropagation()}
                          className={buttonClasses({ variant: step ? 'secondary' : 'ghost', size: 'sm' })}
                        >
                          <Phone size={14} aria-hidden="true" /> Call driver
                        </a>
                      )}
                      {canOfferReturnToService(alert.status, canReturnToService({ status: alert.vehicle?.status })) && alert.vehicle_id && (
                        <Button size="sm" variant="secondary" icon={<Wrench size={14} />} onClick={() => returnToService(alert, true)}>Return to service</Button>
                      )}
                      {hasMore && (
                        <details className="relative" onClick={e => e.stopPropagation()}>
                          <summary className={buttonClasses({ variant: 'ghost', size: 'sm' }) + ' cursor-pointer list-none'}>
                            <MoreHorizontal size={14} aria-hidden="true" /> More
                          </summary>
                          <div className="absolute left-0 z-20 mt-1 flex min-w-48 flex-col gap-1 rounded-control border border-border bg-surface p-1 shadow-raised">
                            {alert.vehicle_id && (
                              <Link to={`/live-map?vehicle=${alert.vehicle_id}`} className={buttonClasses({ variant: 'ghost', size: 'sm' }) + ' justify-start'}>
                                <MapPinned size={14} aria-hidden="true" /> Live map
                              </Link>
                            )}
                            {alert.latitude != null && alert.longitude != null && (
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${alert.latitude},${alert.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open in Google Maps"
                                className={buttonClasses({ variant: 'ghost', size: 'sm' }) + ' justify-start'}
                              >
                                <ExternalLink size={14} aria-hidden="true" /> Google Maps
                              </a>
                            )}
                            {isActive && alert.status === 'active' && (
                              <Button size="sm" variant="ghost" className="justify-start" onClick={() => resolve(alert)}>Resolve</Button>
                            )}
                            {isActive && (
                              <Button size="sm" variant="ghost" className="justify-start" onClick={() => cancel(alert)}>False alarm</Button>
                            )}
                            {canMaintain && (
                              <Button size="sm" variant="ghost" className="justify-start" icon={<Wrench size={14} />} onClick={() => setMaintenanceAlert(alert)}>Create maintenance job</Button>
                            )}
                          </div>
                        </details>
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
              <div className="absolute left-3 right-16 top-3 z-10 max-w-xs rounded-control border border-border bg-surface p-3 shadow-raised">
                <p className="text-sm font-medium text-text">{sosTypeLabel(selected.alert_type)}</p>
                <p className="mt-0.5 text-xs text-muted">{formatDateTime(selected.created_at)}</p>
                {sosSeverityLabel(selected.severity) && (
                  <p className={'mt-1 text-xs font-medium ' + (selected.severity === 'serious' ? 'text-danger' : 'text-muted')}>{sosSeverityLabel(selected.severity)}</p>
                )}
                <div className="mt-2 space-y-1 text-sm text-text">
                  <p className="flex items-center gap-1.5"><User size={14} className="shrink-0 text-muted" aria-hidden="true" /><span className="min-w-0 truncate">{selected.driver?.full_name || 'Unknown'}</span></p>
                  {selected.driver?.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone size={14} className="shrink-0 text-muted" aria-hidden="true" />
                      <a href={`tel:${selected.driver.phone}`} className="text-brand hover:underline">{selected.driver.phone}</a>
                    </p>
                  )}
                  <p className="flex items-center gap-1.5"><Truck size={14} className="shrink-0 text-muted" aria-hidden="true" /><span className="min-w-0 truncate">{selected.vehicle?.plate_number || 'Unknown'}</span></p>
                  {selected.latitude != null && selected.longitude != null && (
                    <p className="flex items-center gap-1.5 font-mono text-xs"><MapPin size={14} className="shrink-0 text-muted" aria-hidden="true" />{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</p>
                  )}
                </div>
              </div>
            )}
          </MapView>
        </div>
      </div>
      {selected?.vehicle_id && <SosCargoCard key={selected.id} alert={selected} />}
      {maintenanceAlert?.vehicle_id && (
        <MoveToMaintenanceModal
          open
          vehicleId={maintenanceAlert.vehicle_id}
          plate={maintenanceAlert.vehicle?.plate_number ?? 'this vehicle'}
          sos={{ id: maintenanceAlert.id, alert_type: maintenanceAlert.alert_type, description: maintenanceAlert.description }}
          onClose={() => setMaintenanceAlert(null)}
        />
      )}
      {returningAlert?.vehicle_id && (
        <ReturnToServiceModal
          open
          vehicleId={returningAlert.vehicle_id}
          plate={returningAlert.vehicle?.plate_number ?? 'this vehicle'}
          onClose={() => setReturningAlert(null)}
        />
      )}
    </Page>
  )
}
