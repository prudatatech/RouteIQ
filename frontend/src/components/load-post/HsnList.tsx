import type { HsnHit } from '@/types/load'
import { rateText } from './logic'

export const FIRST_HITS = 6

/**
 * The suggestion list under the search box. It scrolls inside itself (`maxHeight`), marks the active option for
 * keyboard users and tells how many matches there are. Options are picked with a tap or Enter; the box keeps focus.
 */
export default function HsnList({ id, hits, active, status, maxHeight, showAll, onShowAll, onPick, onHover }: {
  id: string
  hits: HsnHit[]
  active: number
  status: 'searching' | 'failed' | 'empty' | 'ready'
  maxHeight: number
  showAll: boolean
  onShowAll: () => void
  onPick: (hit: HsnHit) => void
  onHover: (index: number) => void
}) {
  const shown = showAll ? hits : hits.slice(0, FIRST_HITS)
  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-control border border-border bg-surface shadow-raised">
      <ul id={id} role="listbox" aria-label="HSN suggestions" className="overflow-y-auto overscroll-contain" style={{ maxHeight }}>
        {status === 'searching' && <li role="presentation" className="px-3 py-2 text-sm text-muted">Searching…</li>}
        {status === 'failed' && <li role="presentation" className="px-3 py-2 text-sm text-danger">We could not search just now. Enter the HSN code instead.</li>}
        {status === 'empty' && <li role="presentation" className="px-3 py-2 text-sm text-muted">No match found.</li>}
        {shown.map((hit, i) => (
          <li
            key={hit.hsn_code}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPick(hit)}
            onMouseEnter={() => onHover(i)}
            className={`flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 ${i === active ? 'bg-surface-subtle' : ''}`}
          >
            <span className="shrink-0 font-mono text-sm font-medium text-text">{hit.hsn_code}</span>
            <span className="min-w-0 flex-1 break-words text-sm text-muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{hit.description}</span>
            <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">{rateText(hit.gst_rates)}</span>
          </li>
        ))}
      </ul>
      {hits.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-subtle px-3 py-1.5 text-xs text-muted">
          <span>{`${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`}</span>
          {!showAll && hits.length > FIRST_HITS && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={onShowAll} className="font-medium text-brand hover:underline">Show all {hits.length}</button>
          )}
        </div>
      )}
    </div>
  )
}
