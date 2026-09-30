import { Clock, WifiOff } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { formatKm, formatMinutes, formatTime } from '@/utils/display'
import { formatDay } from '@/utils/display'
import { haversineKm, type PlanComparison, type Stoppage } from './replay'

/** Stoppages found in the GPS points. Choosing one moves the replay there. */
export function ReplayStoppages({ stoppages, minMinutes, onPick }: {
  stoppages: Stoppage[]
  minMinutes: number
  onPick: (stop: Stoppage) => void
}) {
  if (stoppages.length === 0) {
    return <EmptyState compact title={`No stops of ${minMinutes} minutes or more`} description="Try a shorter time to see brief halts." />
  }
  return (
    <ul className="divide-y divide-border rounded-control border border-border text-sm">
      {stoppages.map(s => (
        <li key={`${s.kind}-${s.startMs}`}>
          <button
            type="button"
            onClick={() => onPick(s)}
            className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <span className="inline-flex items-center gap-2 text-text">
              {s.kind === 'stopped'
                ? <Clock size={14} className="text-muted" aria-hidden />
                : <WifiOff size={14} className="text-warning" aria-hidden />}
              <span>
                <span className="text-muted">{formatDay(s.startMs)}, </span>
                {formatTime(s.startMs)} to {formatTime(s.endMs)}
              </span>
            </span>
            <span className="inline-flex items-center gap-3 text-xs text-muted">
              <span>
                {s.kind === 'stopped'
                  ? 'Stopped'
                  : `No signal, reappeared ${formatKm(haversineKm({ lat: s.lat, lng: s.lng }, { lat: s.toLat ?? s.lat, lng: s.toLng ?? s.lng }))} away`}
              </span>
              <span className="font-medium tabular text-text">{formatMinutes(s.minutes)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Planned distance against what was driven, and how far it strayed from the plan. */
export function ReplayPlanCompare({ comparison, basis, plannedMinutes, actualMinutes }: {
  comparison: PlanComparison
  /** What the planned line is made of. */
  basis: 'road' | 'straight'
  plannedMinutes: number | null
  actualMinutes: number
}) {
  const dev = comparison.deviationKm
  return (
    <div className="space-y-2 rounded-control border border-border px-3 py-3">
      <h3 className="text-sm font-medium text-text">Planned and actual</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">Planned distance</dt>
          <dd className="tabular text-text">{comparison.plannedKm != null ? formatKm(comparison.plannedKm) : 'Not recorded'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Driven</dt>
          <dd className="tabular text-text">{formatKm(comparison.actualKm)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Difference</dt>
          <dd className={`tabular font-medium ${dev == null ? 'text-muted' : dev > 1 ? 'text-warning' : 'text-text'}`}>
            {dev == null ? '—' : `${dev > 0 ? '+' : ''}${dev.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Planned time</dt>
          <dd className="tabular text-text">{plannedMinutes != null ? formatMinutes(plannedMinutes) : 'Not recorded'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Actual time</dt>
          <dd className="tabular text-text">{formatMinutes(actualMinutes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Furthest from the plan</dt>
          <dd className="tabular text-text">{formatKm(comparison.maxOffRouteKm)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        {Math.round(comparison.offRouteShare * 100)}% of the track was more than 500 m from the planned line.{' '}
        {basis === 'road'
          ? 'The planned line follows the roads between the stops.'
          : 'The planned line is drawn straight between the stops, so on winding roads some distance from it is normal.'}
      </p>
    </div>
  )
}
