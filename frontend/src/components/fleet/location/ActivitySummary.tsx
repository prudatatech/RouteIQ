import { Package, Route as RouteIcon } from 'lucide-react'
import { StatusPill } from '@/components/ui'
import { ACTIVITY_LABEL, ACTIVITY_TONE, activitySentence, jobText, loadText, type VehicleActivity } from './format'

/**
 * What the vehicle is doing: carrying a load (which route or manifest, from where to where,
 * how full), idle (since when, where) or offline. Shared by the fleet drawer and the live map panel.
 */
export default function ActivitySummary({ activity, now = Date.now() }: { activity: VehicleActivity; now?: number }) {
  const load = loadText(activity.load)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={ACTIVITY_TONE[activity.state]}>{ACTIVITY_LABEL[activity.state]}</StatusPill>
        <span className="text-sm text-text">{activitySentence(activity, now)}</span>
      </div>

      {activity.jobs.length > 0 && (
        <ul className="space-y-1.5" aria-label="Current work">
          {activity.jobs.map(job => (
            <li key={`${job.kind}-${job.id}`} className="flex items-start gap-2 text-sm text-text">
              {job.kind === 'route'
                ? <RouteIcon size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                : <Package size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />}
              <span className="min-w-0">
                {jobText(job)}
                {job.next_stop && job.stops_total ? <span className="block text-xs text-muted">Next stop: {job.next_stop}</span> : null}
                {job.tracking_ids.length > 0 && <span className="block text-xs text-muted">Shipments: {job.tracking_ids.join(', ')}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {load && (
        <div>
          <p className="text-sm text-text">{load}</p>
          {activity.load.percent_full != null && (
            <div
              role="progressbar"
              aria-label="How full the vehicle is"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(activity.load.percent_full, 100)}
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-soft"
            >
              <div className="h-full rounded-full bg-brand-fill" style={{ width: `${Math.min(activity.load.percent_full, 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
