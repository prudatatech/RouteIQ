import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsAPI } from '@/services/api'
import { Button, Card, CardHeader, DetailList, EmptyState, ErrorState, Skeleton, Stat, StatusPill } from '@/components/ui'
import { formatDate, formatDateTime } from '@/utils/display'
import { EMPLOYMENT_OPTIONS, statusLabel, type PersonDetail } from './types'

const NOT_SET = <span className="text-muted">Not set</span>
const val = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? NOT_SET : v)
const label = (v: string | null | undefined) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ') : NOT_SET)

export function OverviewTab({ detail, canEdit, onEdit, onChangePhone }: {
  detail: PersonDetail; canEdit: boolean; onEdit: () => void; onChangePhone: () => void
}) {
  const { user, profile: p, vehicle } = detail
  const isDriver = user.role === 'driver'
  const address = [p?.address_line, p?.city, p?.state, p?.pincode].filter(Boolean).join(', ')
  const partner = p?.employer_type === 'partner'

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Personal" actions={canEdit && <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>} />
        <div className="p-4 pt-0 sm:p-6 sm:pt-0">
          <DetailList columns={2} items={[
            { label: 'Full name', value: val(user.full_name) },
            { label: 'Date of birth', value: p?.date_of_birth ? formatDate(p.date_of_birth) : NOT_SET },
            { label: 'Gender', value: label(p?.gender) },
            { label: 'Blood group', value: val(p?.blood_group) },
          ]} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Contact" actions={canEdit && <Button variant="secondary" size="sm" onClick={onChangePhone}>Change phone</Button>} />
        <div className="p-4 pt-0 sm:p-6 sm:pt-0">
          <DetailList columns={2} items={[
            { label: 'Mobile', value: user.phone ? <a className="text-brand hover:underline" href={`tel:${user.phone}`}>{user.phone}</a> : NOT_SET },
            { label: 'Alternate mobile', value: val(p?.alternate_phone) },
            { label: 'Work email', value: val(user.email) },
            { label: 'Personal email', value: val(p?.personal_email) },
          ]} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Address" actions={canEdit && <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>} />
        <div className="p-4 pt-0 text-sm text-text sm:p-6 sm:pt-0">{address || NOT_SET}</div>
      </Card>

      <Card>
        <CardHeader title="Employment" actions={canEdit && <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>} />
        <div className="p-4 pt-0 sm:p-6 sm:pt-0">
          <DetailList columns={2} items={[
            { label: 'Employee code', value: p?.employee_code ? <span className="font-mono">{p.employee_code}</span> : NOT_SET },
            { label: 'Designation', value: val(p?.designation) },
            { label: 'Department', value: val(p?.department) },
            { label: 'Employment type', value: EMPLOYMENT_OPTIONS.find(o => o.value === p?.employment_type)?.label ?? NOT_SET },
            { label: 'Date of joining', value: p?.date_of_joining ? formatDate(p.date_of_joining) : NOT_SET },
            { label: 'Reports to', value: val(p?.reporting_manager_name) },
            { label: 'Base depot', value: val(p?.base_depot_name) },
            ...(isDriver ? [
              { label: 'Works for', value: partner ? (p?.employer_partner_name ?? 'A 3PL partner') : 'Our company' },
              { label: 'Current vehicle', value: vehicle ? <span className="font-mono">{vehicle.plate_number}</span> : <span className="text-muted">No vehicle</span> },
            ] : []),
          ]} />
          {(p?.leave_until || p?.suspended_until) && (
            <p className="mt-3 text-sm text-muted">
              {user.status === 'on_leave' && p?.leave_until && `On leave ${p.leave_from ? `from ${formatDate(p.leave_from)} ` : ''}until ${formatDate(p.leave_until)}.`}
              {user.status === 'suspended' && p?.suspended_until && `Suspended until ${formatDate(p.suspended_until)}, then active again automatically.`}
            </p>
          )}
        </div>
      </Card>

      {isDriver && <AssignmentHistory detail={detail} />}
      <Card className="xl:col-span-2">
        <CardHeader title="Record" />
        <div className="p-4 pt-0 sm:p-6 sm:pt-0">
          <DetailList columns={3} items={[
            { label: 'Status', value: statusLabel(user.status) },
            { label: 'Added', value: user.created_at ? formatDateTime(user.created_at) : NOT_SET },
            { label: 'Consent to keep documents', value: p?.consent_at ? `${formatDate(p.consent_at)}, ${label(p.consent_method)}` : <StatusPill tone="warning" dot={false}>Not recorded</StatusPill> },
          ]} />
        </div>
      </Card>
    </div>
  )
}

/** Which vehicles this driver has been assigned to, newest first. */
function AssignmentHistory({ detail }: { detail: PersonDetail }) {
  const rows = detail.vehicle_assignments ?? []
  return (
    <Card>
      <CardHeader title="Vehicle history" description="Trips on a reassigned or archived vehicle still count for this driver." />
      {rows.length === 0 ? (
        <EmptyState compact title="No vehicle assignments yet" />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map(a => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-6">
              <span className="font-mono text-sm text-text">{a.plate_number ?? 'Removed vehicle'}</span>
              <span className="text-xs text-muted">
                {formatDate(a.assigned_at)} to {a.unassigned_at ? formatDate(a.unassigned_at) : 'now'}{a.assigned_by_name ? ` · by ${a.assigned_by_name}` : ''}
              </span>
              {!a.unassigned_at && <StatusPill tone="success" dot={false}>Current</StatusPill>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

interface DriverRow {
  id: string
  deliveries: number
  timed_deliveries: number
  on_time_deliveries: number
  on_time_pct: number | null
  avg_rating: number | null
  rating_count: number
  total_distance_km: number
  completed_routes: number
}

/** Drivers: the existing per-vehicle performance figures for their current vehicle. */
export function PerformanceTab({ detail }: { detail: PersonDetail }) {
  const { vehicle } = detail
  const perf = useQuery<DriverRow[]>({
    queryKey: ['analytics', 'driver-performance'],
    queryFn: () => analyticsAPI.driverPerformance() as Promise<DriverRow[]>,
    enabled: !!vehicle,
  })
  if (!vehicle) {
    return (
      <Card><EmptyState title="No vehicle assigned" description="Performance is measured per vehicle, so it appears once this driver has one." /></Card>
    )
  }
  if (perf.isLoading) return <Skeleton className="h-28 w-full" />
  if (perf.isError) return <ErrorState title="We could not load performance" description="Check your connection and try again." onRetry={() => perf.refetch()} />
  const row = perf.data?.find(r => r.id === vehicle.id)
  if (!row) return <Card><EmptyState title="No performance data yet" description="It appears after the first completed trip." /></Card>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Deliveries" value={row.deliveries.toLocaleString('en-IN')} hint={`${row.completed_routes.toLocaleString('en-IN')} trips completed`} />
        <Stat label="On time" value={row.on_time_pct === null ? '—' : `${row.on_time_pct.toLocaleString('en-IN', { maximumFractionDigits: 0 })}%`}
          hint={row.timed_deliveries > 0 ? `${row.on_time_deliveries} of ${row.timed_deliveries} timed stops` : 'No timed stops yet'} />
        <Stat label="Rating" value={row.avg_rating === null ? 'Not rated' : row.avg_rating.toLocaleString('en-IN', { minimumFractionDigits: 1 })}
          hint={row.rating_count > 0 ? `${row.rating_count.toLocaleString('en-IN')} ratings` : undefined} />
        <Stat label="Distance" value={`${row.total_distance_km.toLocaleString('en-IN', { maximumFractionDigits: 0 })} km`} />
      </div>
      <p className="text-sm text-muted">
        Figures are for the current vehicle <span className="font-mono">{vehicle.plate_number}</span>. See <Link className="text-brand hover:underline" to="/analytics?tab=drivers">Analytics</Link> for every driver.
      </p>
    </div>
  )
}
