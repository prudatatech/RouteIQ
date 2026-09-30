import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import {
  Button, Checkbox, DataTable, SearchInput, Select, Stat, StatusPill, buttonClasses, statusToLabel, useUrlState, type Column,
} from '@/components/ui'
import { MapView, type MapPoint } from '@/components/map'
import { formatRelative } from '@/utils/display'
import {
  EXCEPTION_STATUSES, EXCEPTION_TYPES, OPEN_EXCEPTION_FILTER, SEVERITIES, cargoKeys, exceptionsAPI, type CargoException, type ExceptionFilters,
} from '@/services/cargo'
import { ConsignmentLink, SeverityPill, SlaBadge } from './CargoBits'
import { useNow } from './useNow'
import {
  EXCEPTION_TYPE_LABELS, SEVERITY_LABELS, compareBySla, consignmentCode, exceptionTypeLabel, isOpenException, positionOf, slaState,
} from './logic'

/** "active" is every open state, sent to the API as one comma-separated status filter. */
const ACTIVE = 'active'

function casePosition(e: CargoException) {
  if (e.lat != null && e.lng != null && !(e.lat === 0 && e.lng === 0)) return { lat: e.lat, lng: e.lng }
  return positionOf(e.vehicle)
}

/** The exception queue: open cases ordered by deadline, with filters and a map. */
export default function ExceptionsTab() {
  const navigate = useNavigate()
  const now = useNow(30_000)
  const [status, setStatus] = useUrlState('status', { fallback: ACTIVE })
  const [type, setType] = useUrlState('type')
  const [severity, setSeverity] = useUrlState('severity')
  const [overdue, setOverdue] = useUrlState('overdue')
  const [vehicleId, setVehicleId] = useUrlState('vehicle')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filters: ExceptionFilters = {
    status: status === ACTIVE ? OPEN_EXCEPTION_FILTER : status === 'all' ? undefined : status,
    type: type || undefined,
    severity: severity || undefined,
    vehicle_id: vehicleId || undefined,
    overdue: overdue === '1' || undefined,
  }
  const query = useQuery({
    queryKey: cargoKeys.exceptions(filters),
    queryFn: () => exceptionsAPI.list(filters),
    refetchInterval: 30_000,
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (query.data ?? [])
      .filter(e => (status === ACTIVE ? isOpenException(e.status) : true))
      // The server filters overdue too; this keeps the list right between refreshes as deadlines pass
      .filter(e => overdue !== '1' || slaState(e.sla_due_at, e.status, now).state === 'overdue')
      .filter(e => !q || [e.code, e.vehicle?.plate_number, e.owner?.full_name, e.description, ...e.items.map(consignmentCode)]
        .some(v => v?.toLowerCase().includes(q)))
      .sort(compareBySla)
  }, [query.data, status, overdue, search, now])

  const open = rows.filter(e => isOpenException(e.status))
  const overdueCount = open.filter(e => slaState(e.sla_due_at, e.status, now).state === 'overdue').length
  const criticalCount = open.filter(e => e.severity === 'critical').length
  const unowned = open.filter(e => !e.owner_id).length
  const vehiclePlate = vehicleId ? query.data?.find(e => e.vehicle_id === vehicleId)?.vehicle?.plate_number : null

  const points: MapPoint[] = open.flatMap(e => {
    const position = casePosition(e)
    if (!position) return []
    const late = slaState(e.sla_due_at, e.status, now).state === 'overdue'
    return [{
      id: e.id,
      kind: 'incident' as const,
      position,
      label: `${e.code}: ${exceptionTypeLabel(e.type)}${e.vehicle?.plate_number ? `, ${e.vehicle.plate_number}` : ''}${late ? ', overdue' : ''}`,
      active: late,
    }]
  })
  const selected = rows.find(e => e.id === selectedId) ?? null

  const columns: Column<CargoException>[] = [
    {
      key: 'case',
      header: 'Case',
      sortValue: e => e.created_at,
      cell: e => (
        <div className="whitespace-nowrap">
          <Link to={`/cargo/exceptions/${e.id}`} onClick={ev => ev.stopPropagation()} className="font-mono font-medium text-text hover:underline">{e.code}</Link>
          <div className="text-xs text-muted">{formatRelative(e.created_at, now)}</div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortValue: e => SEVERITIES.indexOf(e.severity),
      cell: e => (
        <div className="flex flex-col items-end gap-1 md:items-start">
          <span className="text-sm">{exceptionTypeLabel(e.type)}</span>
          <SeverityPill severity={e.severity} />
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortValue: e => e.status, cell: e => <StatusPill status={e.status} kind="case" /> },
    {
      key: 'sla',
      header: 'Deadline',
      sortValue: e => (isOpenException(e.status) && e.sla_due_at ? new Date(e.sla_due_at).getTime() : Number.MAX_SAFE_INTEGER),
      cell: e => <SlaBadge dueAt={e.sla_due_at} status={e.status} now={now} />,
    },
    {
      key: 'goods',
      header: 'Consignments',
      hideBelow: 'lg',
      cell: e => e.items.length === 0 ? <span className="text-muted">None</span> : (
        <div className="flex flex-col items-end gap-0.5 md:items-start">
          {e.items.slice(0, 2).map(i => (
            <span key={i.id} className="whitespace-nowrap text-sm">
              <ConsignmentLink c={i} />
              {i.pieces_affected != null && <span className="text-muted"> · {i.pieces_affected.toLocaleString('en-IN')} pcs</span>}
            </span>
          ))}
          {e.items.length > 2 && <span className="text-xs text-muted">+{(e.items.length - 2).toLocaleString('en-IN')} more</span>}
        </div>
      ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      hideBelow: 'xl',
      sortValue: e => e.vehicle?.plate_number,
      cell: e => (e.vehicle ? <span className="font-mono">{e.vehicle.plate_number}</span> : <span className="text-muted">—</span>),
    },
    {
      key: 'owner',
      header: 'Owner',
      sortValue: e => e.owner?.full_name ?? '',
      cell: e => (e.owner_id ? (e.owner?.full_name ?? 'Assigned') : <span className="text-warning">Unassigned</span>),
    },
  ]

  const hasFilters = !!(type || severity || overdue || vehicleId || search || status !== ACTIVE)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open cases" value={open.length.toLocaleString('en-IN')} loading={query.isLoading} />
        <Stat label="Overdue" value={overdueCount.toLocaleString('en-IN')} tone={overdueCount > 0 ? 'danger' : 'default'} loading={query.isLoading} />
        <Stat label="Critical" value={criticalCount.toLocaleString('en-IN')} tone={criticalCount > 0 ? 'warning' : 'default'} loading={query.isLoading} />
        <Stat label="Without an owner" value={unowned.toLocaleString('en-IN')} tone={unowned > 0 ? 'warning' : 'default'} loading={query.isLoading} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SearchInput value={search} onChange={setSearch} label="Search cases" placeholder="Case, RTX-, CM-, plate, owner" className="sm:col-span-2 lg:col-span-1" />
        <Select
          label="Status"
          hideLabel
          value={status}
          onChange={e => setStatus(e.target.value)}
          options={[{ value: ACTIVE, label: 'Open cases' }, { value: 'all', label: 'All statuses' }, ...EXCEPTION_STATUSES.map(s => ({ value: s, label: statusToLabel(s, 'case') }))]}
        />
        <Select
          label="Type"
          hideLabel
          value={type}
          onChange={e => setType(e.target.value)}
          options={[{ value: '', label: 'All types' }, ...EXCEPTION_TYPES.map(t => ({ value: t, label: EXCEPTION_TYPE_LABELS[t] }))]}
        />
        <Select
          label="Severity"
          hideLabel
          value={severity}
          onChange={e => setSeverity(e.target.value)}
          options={[{ value: '', label: 'All severities' }, ...SEVERITIES.map(s => ({ value: s, label: SEVERITY_LABELS[s] }))]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Checkbox label="Overdue only" checked={overdue === '1'} onChange={e => setOverdue(e.target.checked ? '1' : '')} />
        {vehicleId && (
          <span className="inline-flex items-center gap-1 rounded-full bg-neutral-soft py-0.5 pl-3 pr-1 text-sm text-text">
            Vehicle {vehiclePlate ?? 'selected'}
            <button type="button" onClick={() => setVehicleId('')} aria-label="Clear the vehicle filter" className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-surface">
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        )}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setType(''); setSeverity(''); setOverdue(''); setVehicleId(''); setSearch(''); setStatus(ACTIVE) }}>
            Clear filters
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <DataTable
          caption="Cargo exception cases"
          columns={columns}
          rows={rows}
          rowKey={e => e.id}
          loading={query.isLoading}
          error={query.isError ? 'We could not load the cases.' : undefined}
          onRetry={() => query.refetch()}
          onRowClick={e => navigate(`/cargo/exceptions/${e.id}`)}
          selectedKey={selectedId}
          rowClassName={e => (slaState(e.sla_due_at, e.status, now).state === 'overdue' ? 'bg-danger-soft/60 shadow-[inset_3px_0_0_var(--color-danger)]' : undefined)}
          pageSize={25}
          empty={hasFilters
            ? { title: 'No cases match these filters', description: 'Clear the filters to see every open case.' }
            : { icon: <ShieldCheck size={22} />, title: 'No open cases', description: 'Accidents, breakdowns, damage, shortages and failed deliveries open a case here automatically.' }}
        />
        <div className="relative h-80 overflow-hidden rounded-card border border-border 2xl:sticky 2xl:top-4 2xl:h-[560px]">
          <MapView mode="incident" points={points} selectedId={selectedId} onSelect={setSelectedId} ariaLabel="Map of open cargo cases">
            {selected && (
              <div className="absolute left-3 right-14 top-3 z-10 max-w-xs rounded-control border border-border bg-surface p-3 shadow-raised">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-sm font-medium text-text">{selected.code}</p>
                  <SeverityPill severity={selected.severity} />
                </div>
                <p className="mt-0.5 text-sm text-text">{exceptionTypeLabel(selected.type)}{selected.vehicle ? ` · ${selected.vehicle.plate_number}` : ''}</p>
                <SlaBadge className="mt-2" dueAt={selected.sla_due_at} status={selected.status} now={now} />
                <Link to={`/cargo/exceptions/${selected.id}`} className={clsx(buttonClasses({ variant: 'secondary', size: 'sm' }), 'mt-3 w-full')}>Open case</Link>
              </div>
            )}
          </MapView>
          {!query.isLoading && points.length === 0 && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm text-muted shadow-raised">
              <AlertTriangle size={14} aria-hidden="true" /> No open case has a location to show.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
