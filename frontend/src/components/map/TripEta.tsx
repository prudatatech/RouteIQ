import { Clock, Gauge, Route as RouteIcon } from 'lucide-react'
import clsx from 'clsx'
import { Skeleton } from '@/components/ui'
import { formatKm, formatMinutes, formatTime } from '@/utils/display'
import { directionsAvailable } from './directions'
import { describeVsPlan, planStatus, trafficDelayText, type LiveEta } from './liveEta'

const PLAN_TONE = { late: 'text-danger', on_time: 'text-success', early: 'text-success' } as const

/** One line for a small route summary: "Arrives in 1 h 5 min · traffic +12 min · 42.1 km to go". */
export function TripEtaLine({ eta }: { eta: LiveEta }) {
  return (
    <p className="mt-1 text-xs text-muted">
      Arrives in <span className="font-medium text-text">{formatMinutes(eta.etaSeconds / 60)}</span>
      {eta.trafficDelaySeconds > 0 && <> · <span className="font-medium text-danger">traffic +{formatMinutes(eta.trafficDelaySeconds / 60)}</span></>}
      {' · '}
      <span className="tabular">{formatKm(eta.remainingMeters / 1000)}</span> to go
    </p>
  )
}

/**
 * Remaining distance, the arrival time with live traffic, how much of that is traffic, and how it
 * compares with the plan. Every number comes from Mapbox driving-traffic and the route's own planned
 * arrival; what is not known is left out.
 */
export function TripEtaCard({ eta, loading, error, className }: {
  eta: LiveEta | null | undefined
  loading?: boolean
  /** The estimate could not be worked out (no position, no stops, or Mapbox did not answer). */
  error?: string | null
  className?: string
}) {
  return (
    <section aria-label="Live ETA" className={clsx('rounded-control border border-border bg-surface p-3', className)}>
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted">
        <Clock size={13} aria-hidden="true" /> Live ETA with traffic
      </h3>
      {!directionsAvailable ? (
        <p className="mt-2 text-sm text-muted">Live traffic ETA needs the Mapbox directions token, which is not set up.</p>
      ) : eta ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold leading-none text-text">{formatMinutes(eta.etaSeconds / 60)}</p>
              <p className="mt-1 text-xs text-muted">Arrives about {formatTime(eta.arrivalAt)}</p>
            </div>
            <div className="text-right">
              <p className="tabular text-sm font-medium text-text">{formatKm(eta.remainingMeters / 1000)}</p>
              <p className="text-xs text-muted">to go</p>
            </div>
          </div>
          <ul className="space-y-1 text-sm">
            {trafficDelayText(eta) && (
              <li className="flex items-center gap-2">
                <Gauge size={14} className="shrink-0 text-muted" aria-hidden="true" />
                <span className={eta.trafficDelaySeconds > 0 ? 'text-danger' : 'text-success'}>{trafficDelayText(eta)}</span>
                {eta.freeFlowSeconds !== null && <span className="text-xs text-muted">(free flow {formatMinutes(eta.freeFlowSeconds / 60)})</span>}
              </li>
            )}
            {eta.slowMeters !== null && eta.slowMeters >= 500 && (
              <li className="flex items-center gap-2 text-muted">
                <RouteIcon size={14} className="shrink-0" aria-hidden="true" />
                <span><span className="tabular text-text">{formatKm(eta.slowMeters / 1000)}</span> slow or queuing on the way</span>
              </li>
            )}
            {eta.minutesVsPlan !== null && (
              <li className="flex items-center gap-2">
                <Clock size={14} className="shrink-0 text-muted" aria-hidden="true" />
                <span className={PLAN_TONE[planStatus(eta.minutesVsPlan)]}>{describeVsPlan(eta.minutesVsPlan)}</span>
                {eta.plannedArrivalAt && <span className="text-xs text-muted">(planned {formatTime(eta.plannedArrivalAt)})</span>}
              </li>
            )}
          </ul>
        </div>
      ) : loading ? (
        <Skeleton className="mt-2 h-16 w-full" />
      ) : (
        <p className="mt-2 text-sm text-muted">{error ?? 'No estimate yet.'}</p>
      )}
    </section>
  )
}
