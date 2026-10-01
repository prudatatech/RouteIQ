import clsx from 'clsx'
import { statusToLabel } from './status'

export interface TimelineEvent {
  status: string
  /** ISO timestamp. */
  at: string
  /** Who made the change, already formatted (e.g. "Ramesh Kumar · driver"). Staff view only. */
  actorLabel?: string | null
  note?: string | null
  /** Words for the status when the usual ones for it would mislead. */
  label?: string
}

/**
 * A vertical status timeline: one dot per event, oldest first, connected by a line.
 * Shared by the staff shipment drawer (full detail) and the public tracker
 * (status + time only — pass events with no `actorLabel`/`note`).
 */
export function Timeline({ events, formatAt, className }: {
  events: TimelineEvent[]
  /** Formats `at` for display, e.g. `formatDateTime`. */
  formatAt: (value: string) => string | null
  className?: string
}) {
  if (events.length === 0) return null

  return (
    <ol className={clsx('space-y-0', className)} aria-label="Status history">
      {events.map((event, i) => {
        const isLast = i === events.length - 1
        return (
          <li key={`${event.status}-${event.at}-${i}`} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-brand-fill bg-surface" aria-hidden="true" />
              {!isLast && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
            </div>
            <div className={clsx('min-w-0 flex-1', !isLast && 'pb-4')}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-text">{event.label ?? statusToLabel(event.status)}</span>
                <span className="text-xs text-muted">{formatAt(event.at) ?? '—'}</span>
              </div>
              {(event.actorLabel || event.note) && (
                <p className="mt-0.5 text-xs text-muted">
                  {[event.actorLabel, event.note].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
