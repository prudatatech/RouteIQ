import clsx from 'clsx'
import { EmptyState } from '@/components/ui'
import { formatDateTime } from '@/utils/display'
import type { TimelineEntry } from '@/types/loadDocuments'

/** Everything that happened on the load, oldest first: status changes, documents, delivery, settlement. */
export function LoadTimeline({ items }: { items: TimelineEntry[] }) {
  if (items.length === 0) return <EmptyState compact title="Nothing has happened yet" />
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <ol className="space-y-0" aria-label="Load timeline">
      {sorted.map((item, i) => (
        <li key={`${item.at}-${i}`} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-brand-fill bg-surface" aria-hidden="true" />
            {i < sorted.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
          </div>
          <div className={clsx('min-w-0 flex-1', i < sorted.length - 1 && 'pb-4')}>
            <p className="text-sm font-medium text-text">{item.title}</p>
            <p className="text-xs text-muted">{formatDateTime(item.at)}{item.by ? ` · ${item.by}` : ''}</p>
            {item.detail && <p className="mt-0.5 text-xs text-muted">{item.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}
