import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRight, Check, Truck, X } from 'lucide-react'
import * as turf from '@turf/turf'
import clsx from 'clsx'
import { supabase } from '@/services/supabase'
import { vendorAPI } from '@/services/api'
import {
  Alert, BulkActionBar, Button, DataTable, DetailList, Drawer, EmptyState, ErrorState, Page, PageHeader, Select, SearchInput,
  Skeleton, StatusPill, Tabs, TabPanel, useConfirm, useRowSelection, useTabParam, type Column,
} from '@/components/ui'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { errorMessage, formatDateTime, formatKg, formatRelative, formatRupees } from '@/utils/display'

/**
 * A vehicle can be assigned to a request only if it is within this straight-line
 * distance of the pickup, so it can reach the vendor quickly.
 */
const ASSIGN_RADIUS_KM = 50
/** How many recent requests the page loads. */
const REQUEST_LIMIT = 500
/** Vehicle statuses that can take a new load. */
const ASSIGNABLE_VEHICLE_STATUSES = ['available', 'on_route', 'idle', 'offline']

interface CargoDetails {
  category?: string
  name?: string
  noOfPackages?: number
  packagingType?: string
  declaredValue?: string | number
  specialHandling?: string
  remarks?: string
}

interface VendorRequest {
  id: string
  vendor_id: string
  pickup_location: string
  pickup_lat: number
  pickup_lng: number
  drop_location: string
  drop_lat: number
  drop_lng: number
  required_capacity_kg: number
  status: string
  created_at: string
  updated_at: string | null
  assigned_vehicle_id: string | null
  rejection_reason: string | null
  metadata: {
    consignee?: { name?: string; contact?: string; email?: string }
    cargo?: CargoDetails
  } | null
  vendor: { company_name: string | null; city: string | null } | null
}

interface Vehicle {
  id: string
  plate_number: string
  vehicle_type: string | null
  available_capacity_kg: number | null
  status: string
  latitude: number | null
  longitude: number | null
}

const TAB_IDS = ['open', 'assigned', 'completed', 'rejected', 'all'] as const
type TabId = typeof TAB_IDS[number]

const tabStatuses: Record<Exclude<TabId, 'all'>, string[]> = {
  open: ['pending', 'approved'],
  assigned: ['assigned'],
  completed: ['completed', 'fulfilled'],
  rejected: ['rejected', 'cancelled'],
}

const statusLabels: Record<string, string> = {
  pending: 'New',
  approved: 'Approved',
  assigned: 'Vehicle assigned',
  fulfilled: 'Completed',
}

const shortPlace = (place: string | null | undefined) => (place ?? '').split(',')[0].trim() || '—'
const vendorName = (r: VendorRequest) => r.vendor?.company_name || 'Unnamed vendor'

async function loadRequests(): Promise<VendorRequest[]> {
  const { data, error } = await supabase
    .from('vendor_shipment_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(REQUEST_LIMIT)
  if (error) throw error
  const rows = data ?? []
  const vendorIds = [...new Set(rows.map(r => r.vendor_id).filter(Boolean))]
  const vendors = new Map<string, VendorRequest['vendor']>()
  if (vendorIds.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from('vendor_profiles').select('id, company_name, city').in('id', vendorIds)
    if (pErr) throw pErr
    for (const p of profiles ?? []) vendors.set(p.id, { company_name: p.company_name, city: p.city })
  }
  return rows.map(r => ({ ...r, vendor: vendors.get(r.vendor_id) ?? null })) as VendorRequest[]
}

async function loadVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, vehicle_type, available_capacity_kg, status, latitude, longitude')
    .order('plate_number')
  if (error) throw error
  return (data ?? []) as Vehicle[]
}

/** Vehicles with enough free space within ASSIGN_RADIUS_KM of the pickup, nearest first. */
function eligibleVehicles(request: VendorRequest, vehicles: Vehicle[]) {
  const pickup = request.pickup_lat != null && request.pickup_lng != null
    ? turf.point([request.pickup_lng, request.pickup_lat])
    : null
  const withSpace = vehicles.filter(v =>
    ASSIGNABLE_VEHICLE_STATUSES.includes(v.status) && Number(v.available_capacity_kg ?? 0) >= Number(request.required_capacity_kg))
  const eligible = pickup
    ? withSpace
      .filter(v => v.latitude != null && v.longitude != null)
      .map(v => ({ vehicle: v, distanceKm: turf.distance(turf.point([v.longitude!, v.latitude!]), pickup, { units: 'kilometers' }) }))
      .filter(v => v.distanceKm <= ASSIGN_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm)
    : []
  return { eligible, withSpaceCount: withSpace.length }
}

/** A request can be approved, rejected or (re)assigned in bulk while it's still open. */
const isBulkSelectable = (r: VendorRequest) => r.status === 'pending' || r.status === 'approved'

export default function VendorRequestsPage() {
  const queryClient = useQueryClient()
  const { prompt } = useConfirm()
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'open')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkVehicleId, setBulkVehicleId] = useState('')

  const requests = useQuery({ queryKey: ['vendor-requests'], queryFn: loadRequests })
  useRealtimeRefresh('vendor_requests_page', ['vendor_shipment_requests'], [['vendor-requests']])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vendor-requests'] })

  const approve = useMutation({
    mutationFn: (id: string) => vendorAPI.approveRequest(id),
    onSuccess: () => toast.success('Request approved. Assign a vehicle when one is ready.'),
    onError: err => toast.error(errorMessage(err, 'We could not approve this request. Try again.')),
    onSettled: refresh,
  })

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => vendorAPI.rejectRequest(id, reason),
    onSuccess: () => { toast.success('Request rejected. The vendor has been told.'); setSelectedId(null) },
    onError: err => toast.error(errorMessage(err, 'We could not reject this request. Try again.')),
    onSettled: refresh,
  })

  const all = useMemo(() => requests.data ?? [], [requests.data])
  const counts = useMemo(() => {
    const c: Record<TabId, number> = { open: 0, assigned: 0, completed: 0, rejected: 0, all: all.length }
    for (const r of all) {
      const t = (Object.keys(tabStatuses) as Exclude<TabId, 'all'>[]).find(k => tabStatuses[k].includes(r.status))
      if (t) c[t]++
    }
    return c
  }, [all])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(r => {
      if (tab !== 'all' && !tabStatuses[tab].includes(r.status)) return false
      if (!q) return true
      return [vendorName(r), r.pickup_location, r.drop_location].some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [all, tab, search])

  const selected = all.find(r => r.id === selectedId) ?? null

  const selection = useRowSelection(rows, r => r.id)
  const vehiclesForBulk = useQuery({
    queryKey: ['assignable-vehicles'],
    queryFn: loadVehicles,
    enabled: tab === 'open' && selection.count > 0,
  })
  const bulkAssignTargets = useMemo(() => selection.selectedRows.filter(isBulkSelectable), [selection.selectedRows])
  const bulkVehicleCandidates = useMemo(() => {
    if (!vehiclesForBulk.data || bulkAssignTargets.length === 0) return []
    const combinedKg = bulkAssignTargets.reduce((sum, r) => sum + Number(r.required_capacity_kg || 0), 0)
    return vehiclesForBulk.data.filter(v => {
      if (!ASSIGNABLE_VEHICLE_STATUSES.includes(v.status)) return false
      if (Number(v.available_capacity_kg ?? 0) < combinedKg) return false
      if (v.latitude == null || v.longitude == null) return false
      const vehiclePoint = turf.point([v.longitude, v.latitude])
      return bulkAssignTargets.every(r => {
        if (r.pickup_lat == null || r.pickup_lng == null) return false
        return turf.distance(vehiclePoint, turf.point([r.pickup_lng, r.pickup_lat]), { units: 'kilometers' }) <= ASSIGN_RADIUS_KM
      })
    })
  }, [vehiclesForBulk.data, bulkAssignTargets])

  useEffect(() => { setBulkVehicleId('') }, [bulkAssignTargets.length])

  /** Runs `action` for each item in sequence (reusing the single-item endpoints),
   * so a failure on one item doesn't stop the rest — errors are summarised at the end. */
  async function runBulk<T>(items: T[], action: (item: T) => Promise<void>, labelFor: (item: T) => string) {
    setBulkBusy(true)
    let ok = 0
    const failures: string[] = []
    for (const item of items) {
      try {
        await action(item)
        ok++
      } catch (err) {
        failures.push(`${labelFor(item)}: ${errorMessage(err, 'failed')}`)
      }
    }
    setBulkBusy(false)
    return { ok, failures }
  }

  const reportBulk = (verb: string, ok: number, failures: string[]) => {
    if (failures.length === 0) toast.success(`${verb} ${ok} ${ok === 1 ? 'request' : 'requests'}.`)
    else toast.error(`${verb} ${ok}, ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`)
  }

  const bulkApprove = async () => {
    const targets = selection.selectedRows.filter(r => r.status === 'pending')
    if (targets.length === 0) { toast.error('Only new requests can be approved.'); return }
    const { ok, failures } = await runBulk(targets, r => vendorAPI.approveRequest(r.id), vendorName)
    selection.clear()
    refresh()
    reportBulk('Approved', ok, failures)
  }

  const bulkReject = async () => {
    const targets = selection.selectedRows.filter(isBulkSelectable)
    if (targets.length === 0) return
    const reason = await prompt({
      title: `Reject ${targets.length} ${targets.length === 1 ? 'request' : 'requests'}?`,
      message: 'The same reason is sent to every vendor whose request is rejected.',
      inputLabel: 'Reason',
      placeholder: 'Why are these requests being rejected?',
      confirmLabel: 'Reject requests',
      tone: 'danger',
      required: true,
    })
    if (!reason) return
    const { ok, failures } = await runBulk(targets, r => vendorAPI.rejectRequest(r.id, reason), vendorName)
    selection.clear()
    refresh()
    reportBulk('Rejected', ok, failures)
  }

  const bulkAssign = async () => {
    if (!bulkVehicleId || bulkAssignTargets.length === 0) return
    const { ok, failures } = await runBulk(bulkAssignTargets, r => vendorAPI.assignVehicle(r.id, { vehicle_id: bulkVehicleId }), vendorName)
    setBulkVehicleId('')
    selection.clear()
    queryClient.invalidateQueries({ queryKey: ['assignable-vehicles'] })
    refresh()
    reportBulk('Assigned', ok, failures)
  }

  const askReject = async (r: VendorRequest) => {
    const reason = await prompt({
      title: 'Reject this request?',
      message: `${vendorName(r)}’s request from ${shortPlace(r.pickup_location)} to ${shortPlace(r.drop_location)} will be rejected and the vendor notified.`,
      inputLabel: 'Reason',
      placeholder: 'Why is this request being rejected?',
      confirmLabel: 'Reject request',
      tone: 'danger',
      required: true,
    })
    if (reason) reject.mutate({ id: r.id, reason })
  }

  const columns: Column<VendorRequest>[] = [
    {
      key: 'vendor', header: 'Vendor',
      cell: r => <span className="font-medium">{vendorName(r)}</span>,
      sortValue: r => vendorName(r),
    },
    {
      key: 'route', header: 'Route',
      cell: r => (
        <span className="inline-flex max-w-xs items-center gap-1.5">
          <span className="truncate" title={r.pickup_location}>{shortPlace(r.pickup_location)}</span>
          <ArrowRight size={14} aria-label="to" className="shrink-0 text-muted" />
          <span className="truncate" title={r.drop_location}>{shortPlace(r.drop_location)}</span>
        </span>
      ),
    },
    {
      key: 'weight', header: 'Weight', align: 'right',
      cell: r => <span className="tabular">{formatKg(r.required_capacity_kg)}</span>,
      sortValue: r => Number(r.required_capacity_kg),
    },
    {
      key: 'posted', header: 'Posted', hideBelow: 'lg',
      cell: r => <span title={formatDateTime(r.created_at)}>{formatRelative(r.created_at)}</span>,
      sortValue: r => new Date(r.created_at).getTime(),
    },
    {
      key: 'status', header: 'Status',
      cell: r => <StatusPill status={r.status}>{statusLabels[r.status]}</StatusPill>,
      sortValue: r => r.status,
    },
  ]

  const tabs = [
    { id: 'open' as const, label: 'Needs a vehicle', count: counts.open },
    { id: 'assigned' as const, label: 'Assigned', count: counts.assigned },
    { id: 'completed' as const, label: 'Completed', count: counts.completed },
    { id: 'rejected' as const, label: 'Rejected', count: counts.rejected },
    { id: 'all' as const, label: 'All', count: counts.all },
  ]

  const emptyTitle: Record<TabId, string> = {
    open: 'No requests waiting',
    assigned: 'No requests with a vehicle',
    completed: 'No completed requests',
    rejected: 'No rejected requests',
    all: 'No vendor requests yet',
  }

  return (
    <Page>
      <PageHeader title="Vendor requests" description="Loads posted by vendors that need a vehicle. New requests appear here as they come in.">
        <div className="space-y-4">
          <Tabs label="Filter requests by status" tabs={requests.isLoading ? tabs.map(t => ({ ...t, count: undefined })) : tabs} value={tab} onChange={setTab} />
          <SearchInput value={search} onChange={setSearch} label="Search requests" placeholder="Search by vendor or place" className="max-w-sm" />
        </div>
      </PageHeader>

      <TabPanel id={tab}>
        <DataTable
          caption="Vendor shipment requests"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          loading={requests.isLoading}
          error={requests.error ? 'We could not load vendor requests. Check your connection and try again.' : undefined}
          onRetry={() => requests.refetch()}
          onRowClick={r => setSelectedId(r.id)}
          selectedKey={selectedId}
          initialSort={{ key: 'posted', direction: 'desc' }}
          empty={{
            title: search ? 'No requests match your search' : emptyTitle[tab],
            description: search ? 'Try a different vendor or place name.' : 'Vendors post loads from their portal.',
            action: search ? <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> : undefined,
          }}
          selection={{
            selectedKeys: selection.selectedKeys,
            onToggleRow: key => selection.toggleRow(key),
            onToggleAll: (pageRows, checked) => selection.toggleAll(pageRows, checked),
            isRowSelectable: isBulkSelectable,
          }}
        />

        <div className="mt-3">
          <BulkActionBar count={selection.count} onClear={selection.clear}>
            <Button size="sm" variant="secondary" disabled={bulkBusy} loading={bulkBusy} onClick={bulkApprove}>Approve selected</Button>
            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={bulkReject}>Reject selected (one reason)</Button>
            {bulkAssignTargets.length > 0 && (
              bulkVehicleCandidates.length > 0 ? (
                <>
                  <Select
                    label="Vehicle for all selected"
                    hideLabel
                    placeholder="Choose a vehicle"
                    className="w-44"
                    value={bulkVehicleId}
                    onChange={e => setBulkVehicleId(e.target.value)}
                    options={bulkVehicleCandidates.map(v => ({ value: v.id, label: v.plate_number }))}
                  />
                  <Button size="sm" disabled={!bulkVehicleId || bulkBusy} loading={bulkBusy} onClick={bulkAssign}>Assign vehicle</Button>
                </>
              ) : (
                <span className="text-xs text-muted">No single vehicle can take all selected loads — assign them one at a time.</span>
              )
            )}
          </BulkActionBar>
        </div>
      </TabPanel>

      <RequestDrawer
        request={selected}
        onClose={() => setSelectedId(null)}
        approving={approve.isPending && approve.variables === selected?.id}
        rejecting={reject.isPending && reject.variables?.id === selected?.id}
        onApprove={r => approve.mutate(r.id)}
        onReject={askReject}
        onAssigned={() => { setSelectedId(null); refresh() }}
      />
    </Page>
  )
}

function RequestDrawer({ request, onClose, approving, rejecting, onApprove, onReject, onAssigned }: {
  request: VendorRequest | null
  onClose: () => void
  approving: boolean
  rejecting: boolean
  onApprove: (r: VendorRequest) => void
  onReject: (r: VendorRequest) => void
  onAssigned: () => void
}) {
  const [vehicleId, setVehicleId] = useState('')
  const canAssign = !!request && (request.status === 'pending' || request.status === 'approved')

  useEffect(() => { setVehicleId('') }, [request?.id])

  const vehicles = useQuery({ queryKey: ['assignable-vehicles'], queryFn: loadVehicles, enabled: canAssign || !!request?.assigned_vehicle_id })
  const { eligible, withSpaceCount } = useMemo(
    () => (request && vehicles.data ? eligibleVehicles(request, vehicles.data) : { eligible: [], withSpaceCount: 0 }),
    [request, vehicles.data],
  )
  const assignedPlate = request?.assigned_vehicle_id
    ? vehicles.data?.find(v => v.id === request.assigned_vehicle_id)?.plate_number
    : undefined

  const queryClient = useQueryClient()
  const assign = useMutation({
    mutationFn: ({ id, vehicle }: { id: string; vehicle: string }) => vendorAPI.assignVehicle(id, { vehicle_id: vehicle }),
    onSuccess: () => {
      toast.success('Vehicle assigned. The load was added to its cargo manifest.')
      queryClient.invalidateQueries({ queryKey: ['assignable-vehicles'] })
      onAssigned()
    },
    onError: err => toast.error(errorMessage(err, 'We could not assign the vehicle. Try again.')),
  })

  const busy = approving || rejecting || assign.isPending
  const cargo = request?.metadata?.cargo
  const consignee = request?.metadata?.consignee
  const declared = cargo?.declaredValue !== undefined && cargo.declaredValue !== '' && Number.isFinite(Number(cargo.declaredValue))
    ? formatRupees(cargo.declaredValue)
    : cargo?.declaredValue || undefined

  return (
    <Drawer
      open={!!request}
      onClose={onClose}
      title={request ? vendorName(request) : 'Request'}
      description={request ? `${shortPlace(request.pickup_location)} to ${shortPlace(request.drop_location)}` : undefined}
      footer={canAssign && request ? (
        <>
          <Button variant="secondary" icon={<X size={16} />} disabled={busy} loading={rejecting} onClick={() => onReject(request)}>Reject</Button>
          {request.status === 'pending' && (
            <Button variant="secondary" icon={<Check size={16} />} disabled={busy} loading={approving} onClick={() => onApprove(request)}>Approve, assign later</Button>
          )}
          <Button
            icon={<Truck size={16} />}
            disabled={!vehicleId || busy}
            loading={assign.isPending}
            onClick={() => assign.mutate({ id: request.id, vehicle: vehicleId })}
          >
            Assign vehicle
          </Button>
        </>
      ) : undefined}
    >
      {request && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={request.status}>{statusLabels[request.status]}</StatusPill>
            <span className="text-sm text-muted">Posted {formatRelative(request.created_at)}</span>
          </div>

          {request.status === 'rejected' && request.rejection_reason && (
            <Alert tone="danger" title="Rejected">{request.rejection_reason}</Alert>
          )}

          <DetailList
            items={[
              { label: 'Pickup', value: request.pickup_location },
              { label: 'Drop-off', value: request.drop_location },
              { label: 'Weight', value: <span className="tabular">{formatKg(request.required_capacity_kg)}</span> },
              { label: 'Vendor city', value: request.vendor?.city ?? 'Not given' },
              ...(cargo?.name || cargo?.category ? [{ label: 'Goods', value: [cargo.name, cargo.category].filter(Boolean).join(' · ') }] : []),
              ...(cargo?.noOfPackages ? [{ label: 'Packages', value: `${Number(cargo.noOfPackages).toLocaleString('en-IN')}${cargo.packagingType ? ` · ${cargo.packagingType}` : ''}` }] : []),
              ...(declared ? [{ label: 'Declared value', value: declared }] : []),
              ...(cargo?.specialHandling ? [{ label: 'Special handling', value: cargo.specialHandling }] : []),
              ...(consignee?.name ? [{ label: 'Receiver', value: [consignee.name, consignee.contact].filter(Boolean).join(' · ') }] : []),
              ...(cargo?.remarks ? [{ label: 'Notes', value: cargo.remarks }] : []),
              { label: 'Posted', value: formatDateTime(request.created_at) },
              ...(request.assigned_vehicle_id ? [{ label: 'Vehicle', value: <span className="font-mono">{assignedPlate ?? 'Assigned'}</span> }] : []),
            ]}
          />

          {canAssign && (
            <section aria-labelledby="assign-heading" className="space-y-3">
              <div>
                <h3 id="assign-heading" className="text-base font-semibold text-text">Choose a vehicle</h3>
                <p className="mt-0.5 text-sm text-muted">
                  Vehicles with at least {formatKg(request.required_capacity_kg)} free, within {ASSIGN_RADIUS_KM} km of the pickup
                  (straight-line distance from their last known position). Nearest first.
                </p>
              </div>

              {vehicles.isLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : vehicles.error ? (
                <ErrorState compact description="We could not load vehicles." onRetry={() => vehicles.refetch()} />
              ) : eligible.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Truck size={22} />}
                  title={`No vehicle within ${ASSIGN_RADIUS_KM} km has enough space`}
                  description={withSpaceCount > 0
                    ? `${withSpaceCount.toLocaleString('en-IN')} ${withSpaceCount === 1 ? 'vehicle has' : 'vehicles have'} enough space but ${withSpaceCount === 1 ? 'is' : 'are'} farther away or ${withSpaceCount === 1 ? 'has' : 'have'} no known position.`
                    : 'No vehicle has enough free space right now.'}
                />
              ) : (
                <fieldset>
                  <legend className="sr-only">Vehicle</legend>
                  <div className="space-y-2">
                    {eligible.map(({ vehicle, distanceKm }) => (
                      <label
                        key={vehicle.id}
                        className={clsx(
                          'flex cursor-pointer items-center gap-3 rounded-control border px-3 py-3 transition-colors focus-within:ring-2 focus-within:ring-brand/30',
                          vehicleId === vehicle.id ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-subtle',
                        )}
                      >
                        <input
                          type="radio"
                          name="vehicle"
                          value={vehicle.id}
                          checked={vehicleId === vehicle.id}
                          onChange={() => setVehicleId(vehicle.id)}
                          className="h-4 w-4 shrink-0 accent-brand"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-sm font-medium text-text">{vehicle.plate_number}</span>
                          <span className="block text-xs text-muted">
                            {[vehicle.vehicle_type, `${distanceKm.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km from pickup`].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm tabular text-text">{formatKg(vehicle.available_capacity_kg)} free</span>
                          <StatusPill status={vehicle.status} />
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {vehicleId && (
                <Alert tone="info">Assigning adds this load to the vehicle’s cargo manifest and notifies the driver and the vendor.</Alert>
              )}
            </section>
          )}
        </div>
      )}
    </Drawer>
  )
}
