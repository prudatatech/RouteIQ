import { StatusPill, humanize } from '@/components/ui'

/** The cargo a vehicle is set up to carry, as chips. `max` limits how many show; the rest are counted. */
export default function CargoChips({ types, max = 3, empty }: { types?: string[] | null; max?: number; empty?: string }) {
  const list = (types ?? []).filter(Boolean)
  if (list.length === 0) return empty ? <span className="text-sm text-muted">{empty}</span> : null
  const shown = list.slice(0, max)
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map(t => <StatusPill key={t} tone="neutral" dot={false}>{humanize(t)}</StatusPill>)}
      {list.length > shown.length && (
        <span title={list.slice(max).map(humanize).join(', ')}>
          <StatusPill tone="neutral" dot={false}>+{list.length - shown.length}</StatusPill>
        </span>
      )}
    </span>
  )
}
