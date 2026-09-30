import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArchiveRestore, BarChart2, MapPin, Pencil, Phone, ShieldAlert, Truck, Wrench } from 'lucide-react'
import { vehiclesAPI } from '@/services/api'
import { supabase, openChannel } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  Alert, Button, Card, CardBody, CardHeader, DetailList, EmptyState, ErrorState, Page, PageHeader, Skeleton, StatusPill, TabPanel, Tabs,
  buttonClasses, humanize, useConfirm, useTabParam, type TabItem,
} from '@/components/ui'
import { formatDateTime, formatKg, formatRelative } from '@/utils/display'
import { expiryStatus } from '@/utils/documentExpiry'
import { canReturnToService, isDraftVehicle, isVehicleLive, lastSeenAt } from '@/utils/vehicles'
import VehicleWizardModal from '@/components/fleet/VehicleWizardModal'
import RaiseSosModal from '@/components/fleet/RaiseSosModal'
import { VehiclePhotoCard } from '@/components/fleet/photos/VehiclePhotoCard'
import { MoveToMaintenanceModal } from '@/components/fleet/maintenance/MoveToMaintenanceModal'
import { ReturnToServiceModal } from '@/components/fleet/maintenance/ReturnToServiceModal'
import LoadBar from '@/components/fleet/LoadBar'
import { OnBoardCard } from '@/components/cargo/OnBoardList'
import CargoChips from '@/components/fleet/CargoChips'
import SosCountBadge from '@/components/fleet/SosCountBadge'
import VehicleSosTab from '@/components/fleet/VehicleSosTab'
import VehicleDocumentsTab from '@/components/fleet/VehicleDocumentsTab'
import { vehicleDocuments } from '@/components/fleet/documents'
import VehicleLoadsTab from '@/components/fleet/VehicleLoadsTab'
import { useSosCounts } from '@/components/fleet/useSosCounts'
import { useFleetHealth } from '@/components/fleet/useFleetHealth'
import { apiErrorMessage, bandLabel, bandTone, formatOdometer, type HealthBand } from '@/components/fleet/health'
import { setVehicleStatus, useLiveMinutes } from '@/components/fleet/vehicleStatus'
import { containerSize, type Vehicle } from '@/components/fleet/types'
import { FuelTabSlot, LocationTabSlot, MaintenanceTabSlot } from './tabSlots'

/**
 * The tabs of the vehicle page. Location, Maintenance and Fuel are slots (see ./tabSlots.tsx) that
 * hold their feature's component; Overview, Documents, Loads and SOS are filled here from the
 * vehicle's own data.
 */
const TAB_IDS = ['overview', 'location', 'maintenance', 'fuel', 'documents', 'loads', 'sos'] as const
type TabId = (typeof TAB_IDS)[number]

export default function VehicleDetailPage() {
  const { vehicleId = '' } = useParams<{ vehicleId: string }>()
  const role = useAuthStore(s => s.role)
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const liveMinutes = useLiveMinutes()
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'overview')
  const [editing, setEditing] = useState(false)
  const [sosOpen, setSosOpen] = useState(false)
  const [maintenanceMode, setMaintenanceMode] = useState<'move' | 'return' | null>(null)

  // Re-render every 30 s so "last seen" and the live pill stay true.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const query = useQuery<Vehicle>({
    queryKey: ['vehicles', 'detail', vehicleId],
    queryFn: () => vehiclesAPI.get(vehicleId) as Promise<Vehicle>,
    enabled: !!vehicleId,
    refetchInterval: 15_000,
    retry: (count, err) => (err as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
  })

  // The vehicle row changes as the driver's app and the GPS report in; follow it.
  useEffect(() => {
    if (!vehicleId) return
    const channel = openChannel('vehicle_detail_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles', filter: `id=eq.${vehicleId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['vehicles', 'detail', vehicleId] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [vehicleId, queryClient])

  const sosCounts = useSosCounts()
  const health = useFleetHealth()
  const vehicle = query.data ?? null
  const counts = vehicle ? sosCounts.data?.[vehicle.id] : undefined
  const healthRow = vehicle ? health.data?.find(h => h.vehicle_id === vehicle.id) : undefined

  const changed = () => {
    queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
  }
  const statusMutation = useMutation({
    mutationFn: ({ status }: { status: 'available' | 'idle' | 'maintenance' }) => setVehicleStatus(vehicleId, status),
    onSuccess: (_d, { status }) => { changed(); toast.success(status === 'maintenance' ? 'Vehicle moved to maintenance' : 'Vehicle is back in service') },
    onError: err => toast.error(apiErrorMessage(err, 'We could not change the vehicle status.')),
  })

  // Move to maintenance / Return to service open their own forms (reason, return date, workshop, parts, cost)
  const handleReturnToService = () => setMaintenanceMode('return')
  const handleMaintenance = () => setMaintenanceMode('move')
  const handleUnarchive = async (v: Vehicle) => {
    const ok = await confirm({
      title: `Restore ${v.plate_number}?`,
      message: v.review_decision === 'rejected' ? 'The vehicle is approved and returns to the fleet as available.' : 'The vehicle returns to the fleet as idle.',
      confirmLabel: 'Restore vehicle',
    })
    if (ok) statusMutation.mutate({ status: 'idle' })
  }

  const attention = useMemo(() => (vehicle ? vehicleDocuments(vehicle).filter(d => expiryStatus(d.expiry)).length : 0), [vehicle])

  if (query.isLoading) {
    return (
      <Page>
        <PageHeader title={<Skeleton className="h-8 w-48" />} back={{ to: '/fleet', label: 'Back to fleet' }} />
        <Skeleton className="h-64 w-full" />
      </Page>
    )
  }
  if (!vehicle) {
    const notFound = (query.error as { response?: { status?: number } } | null)?.response?.status === 404
    return (
      <Page>
        <PageHeader title="Vehicle" back={{ to: '/fleet', label: 'Back to fleet' }} />
        {notFound || !query.isError ? (
          <EmptyState
            icon={<Truck size={22} />}
            title="We could not find this vehicle"
            description="It may have been deleted. Go back to the fleet to pick another one."
            action={<Link to="/fleet" className={buttonClasses({ variant: 'secondary' })}>Back to fleet</Link>}
          />
        ) : (
          <ErrorState title="We could not load this vehicle" description="Check your connection and try again." onRetry={() => query.refetch()} />
        )}
      </Page>
    )
  }

  const ping = lastSeenAt(vehicle)
  const isLive = isVehicleLive(vehicle, liveMinutes, now)
  const isStaffAction = role !== 'driver'
  const draft = isDraftVehicle(vehicle)
  const size = containerSize(vehicle)

  const tabs: TabItem<TabId>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'location', label: 'Location' },
    { id: 'maintenance', label: 'Maintenance' },
    { id: 'fuel', label: 'Fuel' },
    { id: 'documents', label: 'Documents', count: attention > 0 ? attention : undefined },
    { id: 'loads', label: 'Loads' },
    { id: 'sos', label: 'SOS', count: counts && counts.open > 0 ? counts.open : undefined },
  ]

  return (
    <Page>
      <PageHeader
        back={{ to: '/fleet', label: 'Back to fleet' }}
        title={<span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-3"><span className="min-w-0 break-all font-mono">{vehicle.plate_number}</span><StatusPill status={vehicle.status} /></span>}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{vehicle.vehicle_model || humanize(vehicle.vehicle_type)}</span>
            <span aria-hidden="true">·</span>
            <span>{vehicle.driver_name ? `Driver ${vehicle.driver_name}` : 'No driver assigned'}</span>
            {vehicle.driver_phone && (
              <a href={`tel:${vehicle.driver_phone}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Phone size={14} aria-hidden="true" /> {vehicle.driver_phone}</a>
            )}
            <span aria-hidden="true">·</span>
            {isLive ? <StatusPill tone="success">Live</StatusPill> : <span>{ping ? `Last seen ${formatRelative(ping, now)}` : 'No GPS data'}</span>}
          </span>
        }
        actions={(
          <>
            <Link to={`/live-map?vehicle=${vehicle.id}`} className={buttonClasses({ variant: 'secondary' })}><MapPin size={16} aria-hidden="true" /> Live map</Link>
            <Link to={`/analytics?vehicle=${vehicle.id}`} className={buttonClasses({ variant: 'secondary' })}><BarChart2 size={16} aria-hidden="true" /> Analytics</Link>
            {isStaffAction && (
              <>
                {!draft && vehicle.status !== 'archived' && (
                  <Button variant="danger" icon={<ShieldAlert size={16} />} onClick={() => setSosOpen(true)}>Raise SOS</Button>
                )}
                {canReturnToService(vehicle) && (
                  <Button icon={<Wrench size={16} />} onClick={handleReturnToService}>Return to service</Button>
                )}
                {!draft && ['available', 'idle', 'offline', 'on_route'].includes(vehicle.status) && (
                  <Button variant="secondary" icon={<Wrench size={16} />} onClick={handleMaintenance}>Move to maintenance</Button>
                )}
                {vehicle.status === 'archived' && !draft && (
                  <Button variant="secondary" icon={<ArchiveRestore size={16} />} onClick={() => handleUnarchive(vehicle)}>Restore vehicle</Button>
                )}
                <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Edit</Button>
              </>
            )}
          </>
        )}
      >
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Vehicle sections" />
      </PageHeader>

      <TabPanel id={tab}>
        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-3">
            {vehicle.status === 'archived' && vehicle.rejection_reason && (
              <Alert tone="danger" title="Rejected" className="lg:col-span-3">{vehicle.rejection_reason}</Alert>
            )}
            <Card className="lg:col-span-2">
              <CardHeader title="Load" description="What the vehicle carries against its capacity" />
              <CardBody className="space-y-4">
                <LoadBar vehicle={vehicle} />
                <DetailList
                  columns={3}
                  items={[
                    { label: 'Type', value: humanize(vehicle.vehicle_type) },
                    { label: 'Model', value: vehicle.vehicle_model || 'Not recorded' },
                    { label: 'Capacity', value: vehicle.capacity_kg ? formatKg(vehicle.capacity_kg) : 'Not recorded' },
                    { label: 'Container size', value: size ?? 'Not recorded' },
                    { label: 'Cargo types', value: <CargoChips types={vehicle.cargo_types} max={8} empty="Any cargo" /> },
                    {
                      label: 'Bidding window',
                      value: vehicle.bidding_window_open
                        ? `Open${vehicle.bidding_window_closes_at ? `, closes ${formatDateTime(vehicle.bidding_window_closes_at)}` : ''}`
                        : 'Closed',
                    },
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Emergencies" description="SOS raised from this vehicle" />
              <CardBody className="space-y-3">
                <SosCountBadge counts={counts} loading={sosCounts.isLoading} />
                <Button variant="secondary" size="sm" onClick={() => setTab('sos')}>See SOS history</Button>
              </CardBody>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Condition" description="Location, fuel and service detail are on their own tabs" />
              <CardBody>
                <DetailList
                  columns={3}
                  items={[
                    { label: 'Odometer', value: formatOdometer(vehicle.odometer_km) },
                    {
                      label: 'Health',
                      value: healthRow
                        ? (healthRow.score == null
                          ? 'Not enough data'
                          : <span className="inline-flex flex-wrap items-center gap-2"><span className="font-semibold tabular">{healthRow.score}</span><StatusPill tone={bandTone[healthRow.band as HealthBand]}>{bandLabel[healthRow.band as HealthBand]}</StatusPill></span>)
                        : (health.isLoading ? '…' : '—'),
                    },
                    { label: 'GPS device', value: vehicle.spark_id || 'Not linked' },
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Documents needing attention" />
              <CardBody>
                {attention === 0 ? (
                  <p className="text-sm text-muted">Nothing is expired or expiring within 30 days.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {vehicleDocuments(vehicle).flatMap(d => {
                        const s = expiryStatus(d.expiry)
                        return s ? [<StatusPill key={d.key} tone={s.tone} dot={false}>{d.name.replace(/ \(.*\)/, '')}: {s.label}</StatusPill>] : []
                      })}
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setTab('documents')}>Open documents</Button>
                  </div>
                )}
              </CardBody>
            </Card>
            <OnBoardCard vehicleId={vehicle.id} className="lg:col-span-3" />
            <div className="lg:col-span-3"><VehiclePhotoCard key={`photos-${vehicle.id}`} vehicleId={vehicle.id} /></div>
          </div>
        )}

        {/* SLOT: Location (./tabSlots.tsx) */}
        {tab === 'location' && <LocationTabSlot vehicle={vehicle} isLive={isLive} now={now} />}
        {/* SLOT: Maintenance (./tabSlots.tsx) */}
        {tab === 'maintenance' && <MaintenanceTabSlot vehicle={vehicle} isLive={isLive} now={now} />}
        {/* SLOT: Fuel (./tabSlots.tsx) */}
        {tab === 'fuel' && <FuelTabSlot vehicle={vehicle} isLive={isLive} now={now} />}

        {tab === 'documents' && <VehicleDocumentsTab vehicle={vehicle} />}
        {tab === 'loads' && <VehicleLoadsTab vehicle={vehicle} />}
        {tab === 'sos' && (
          <VehicleSosTab
            vehicleId={vehicle.id}
            plate={vehicle.plate_number}
            canAct={isStaffAction}
            onRaise={!draft && vehicle.status !== 'archived' ? () => setSosOpen(true) : undefined}
          />
        )}
      </TabPanel>

      {isStaffAction && (
        <VehicleWizardModal
          isOpen={editing}
          onClose={() => { setEditing(false); queryClient.invalidateQueries({ queryKey: ['vehicles'] }) }}
          initialData={editing ? vehicle : null}
        />
      )}
      <RaiseSosModal key={vehicle.id} vehicleId={vehicle.id} plate={vehicle.plate_number} open={sosOpen} onClose={() => setSosOpen(false)} />
      {maintenanceMode === 'move' && (
        <MoveToMaintenanceModal open vehicleId={vehicle.id} plate={vehicle.plate_number} onClose={() => { setMaintenanceMode(null); changed() }} />
      )}
      {maintenanceMode === 'return' && (
        <ReturnToServiceModal open vehicleId={vehicle.id} plate={vehicle.plate_number} onClose={() => { setMaintenanceMode(null); changed() }} />
      )}
    </Page>
  )
}
