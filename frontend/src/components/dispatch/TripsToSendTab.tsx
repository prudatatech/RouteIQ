import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Play } from 'lucide-react'
import { Button, DataTable, StatusPill, buttonClasses, type Column } from '@/components/ui'
import { getRouteDistance, getRouteDuration, type RouteLike } from '@/utils/routeHelpers'
import { canDispatchRoute, useRouteStatusActions } from '@/hooks/useRouteStatusActions'
import { formatKm, formatMinutes, formatRelative, tripNumber } from '@/utils/display'
import { TRIP_SOURCE_LABEL, tripSource } from './logic'
import { EWAY_BILL_WARNING } from '@/config/compliance'

interface TripStop {
  id: string
  sequence: number
  delivery_points?: { name?: string | null; address?: string | null; latitude?: number | null; longitude?: number | null } | null
  /** The shipment (or lot) this stop delivers. */
  shipment?: { id: string; tracking_id?: string | null } | null
}

/** A trip as GET /routes returns it: the vehicle and its stops come with it. */
export interface TripRow extends RouteLike {
  id: string
  status: string
  is_manifest?: boolean
  depot_id?: string | null
  plan?: { source?: string } | null
  created_at?: string | null
  vehicle_id?: string | null
  vehicles?: { plate_number?: string | null; vehicle_model?: string | null; driver_name?: string | null; driver_id?: string | null; latitude?: number | null; longitude?: number | null } | null
  route_stops?: TripStop[] | null
}

const stopName = (s: TripStop) => s.delivery_points?.name || s.delivery_points?.address || 'Stop'

/** Where a trip goes, in order: first stop, then the last, with the count in between. */
function StopsSummary({ stops }: { stops: TripStop[] }) {
  if (stops.length === 0) return <span className="text-muted">No stops</span>
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return (
    <div className="min-w-0 max-w-64">
      <div className="text-text">{stops.length.toLocaleString('en-IN')} {stops.length === 1 ? 'stop' : 'stops'}</div>
      <div className="flex min-w-0 items-center gap-1 text-xs text-muted">
        <span className="truncate">{stopName(first)}</span>
        {stops.length > 1 && (
          <>
            <ArrowRight size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{stopName(last)}</span>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Trips waiting to be sent: planned by the optimizer or the route planner, pending, and not yet
 * with the driver. Sending one puts the vehicle on route and tells the driver, with a link to it.
 */
export default function TripsToSendTab({ rows, loading, error, onRetry, ewayMissing }: {
  rows: TripRow[]
  /** Trip id to the shipments on it that are over the e-way bill value with no number; a warning only. */
  ewayMissing?: Map<string, string[]>
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const { dispatch, isPending } = useRouteStatusActions()

  const columns: Column<TripRow>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: t => (
        <div className="whitespace-nowrap">
          <div className="font-mono font-medium text-text">{t.vehicles?.plate_number || (t.vehicle_id ? 'Vehicle not found' : 'Unassigned')}</div>
          {t.vehicles?.vehicle_model && <div className="text-xs text-muted">{t.vehicles.vehicle_model}</div>}
        </div>
      ),
    },
    {
      key: 'driver',
      header: 'Driver',
      cell: t => t.vehicles?.driver_name
        ? <span className="whitespace-nowrap text-text">{t.vehicles.driver_name}</span>
        : <StatusPill tone="warning" dot={false}>No driver</StatusPill>,
    },
    {
      key: 'stops',
      header: 'Stops',
      cell: t => (
        <div className="space-y-1">
          <StopsSummary stops={t.route_stops ?? []} />
          {ewayMissing?.has(t.id) && (
            <StatusPill tone="warning" dot={false}>{EWAY_BILL_WARNING}</StatusPill>
          )}
          {ewayMissing?.has(t.id) && <div className="text-xs text-muted">{ewayMissing.get(t.id)!.join(', ')}</div>}
        </div>
      ),
    },
    {
      key: 'distance',
      header: 'Distance and time',
      hideBelow: 'md',
      cell: t => {
        const km = getRouteDistance(t)
        if (km <= 0) return <span className="text-muted">—</span>
        return <span className="whitespace-nowrap tabular">{formatKm(km)} · {formatMinutes(getRouteDuration(t, km))}</span>
      },
    },
    {
      key: 'source',
      header: 'Planned by',
      hideBelow: 'lg',
      cell: t => (
        <div className="whitespace-nowrap">
          <div className="text-text">{TRIP_SOURCE_LABEL[tripSource(t)]}</div>
          {t.created_at && <div className="text-xs text-muted">{formatRelative(t.created_at)}</div>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: t => (
        // Keep button clicks and key presses from opening the row
        <div className="flex flex-wrap justify-end gap-2" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <Link to={`/routes/${t.id}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>Open trip</Link>
          {canDispatchRoute(t) && (
            <Button size="sm" icon={<Play size={14} />} disabled={isPending} onClick={() => dispatch(t)} aria-label={`Send trip ${t.vehicles?.plate_number ?? tripNumber(t.id)} to the driver`}>
              Send to driver
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <DataTable
      caption="Trips waiting to be sent to the driver"
      columns={columns}
      rows={rows}
      rowKey={t => t.id}
      loading={loading}
      error={error ? 'We could not load trips. Check your connection and try again.' : undefined}
      onRetry={onRetry}
      onRowClick={t => navigate(`/routes/${t.id}`)}
      empty={{ title: 'No trips waiting', description: 'Trips from the optimizer and the trip planner wait here until you send them to the driver.' }}
    />
  )
}
