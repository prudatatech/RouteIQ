import { Card, Checkbox } from '@/components/ui'
import type { LoadDraft, SpecialHandling } from '@/types/load'
import { derivedHandling } from './logic'

const LOAD_LEVEL: { id: SpecialHandling; label: string }[] = [
  { id: 'do_not_stack', label: 'Do not stack' },
  { id: 'this_side_up', label: 'This side up' },
  { id: 'odc', label: 'Over-dimensional cargo (ODC)' },
]
const DERIVED_TEXT = { fragile: 'Fragile', hazmat: 'Hazardous (hazmat)' }

/** Handling for the whole load. Fragile and hazardous come from the products and are shown here read-only. */
export default function HandlingCard({ draft, onChange }: { draft: LoadDraft; onChange: (patch: Partial<LoadDraft>) => void }) {
  const derived = derivedHandling(draft.items)
  return (
    <Card padded className="space-y-3 !p-4">
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-text">Handling for the whole load</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {LOAD_LEVEL.map(s => (
            <Checkbox
              key={s.id} label={s.label} checked={draft.special_handling.includes(s.id)}
              onChange={e => onChange({ special_handling: e.target.checked ? [...draft.special_handling, s.id] : draft.special_handling.filter(x => x !== s.id) })}
            />
          ))}
        </div>
      </fieldset>
      {derived.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="derived-handling">
          From your goods:
          {derived.map(h => <span key={h} className="rounded-full bg-surface-subtle px-2 py-0.5 font-medium text-text">{DERIVED_TEXT[h]}</span>)}
          Change these on the product.
        </p>
      )}
    </Card>
  )
}
