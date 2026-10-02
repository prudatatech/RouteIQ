import type { ReactNode } from 'react'
import { Alert, Card, Checkbox, Input } from '@/components/ui'
import type { AssistResult, LoadDraft, SpecialHandling } from '@/types/load'
import { derivedHandling, inr } from './logic'
import type { StepErrors } from './validate'
import CompanyPicker from './CompanyPicker'
import Radio from './Radio'

const LOAD_LEVEL: { id: SpecialHandling; label: string }[] = [
  { id: 'do_not_stack', label: 'Do not stack' },
  { id: 'this_side_up', label: 'This side up' },
  { id: 'odc', label: 'Over-dimensional cargo (ODC)' },
]
const DERIVED_TEXT = { fragile: 'Fragile', hazmat: 'Hazardous (hazmat)' }

/** Handling for the whole load. Fragile and hazardous come from the products and are shown here read-only. */
export function HandlingCard({ draft, onChange }: { draft: LoadDraft; onChange: (patch: Partial<LoadDraft>) => void }) {
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

/** One choice of how to price the load: get quotes (the default), or book at the vendor's own price. */
export function PricingCard({ draft, onChange, errors, assist, notes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  assist: AssistResult | null
  /** The below-estimate warning, when the server sent one. */
  notes?: ReactNode
}) {
  const est = assist?.estimate
  const range = est ? `${inr(est.low)} to ${inr(est.high)}` : null
  const money = (v: string) => v.replace(/[^\d.]/g, '')
  return (
    <Card padded className="space-y-3 !p-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">How do you want to price this?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Radio name="pricing" value="quotes" checked={draft.quote_requested} onChange={() => onChange({ quote_requested: true })}>
            <span className="font-medium text-text">Get quotes from companies</span>
            <span className="block text-muted">Logistic companies on this lane send you their prices, usually within 2 hours. You choose.</span>
          </Radio>
          <Radio name="pricing" value="direct" checked={!draft.quote_requested} onChange={() => onChange({ quote_requested: false })}>
            <span className="font-medium text-text">Book at my price</span>
            <span className="block text-muted">You name the price. A logistic company can accept it straight away.</span>
          </Radio>
        </div>
      </fieldset>
      {est && (
        <Alert tone="info" title={range ?? undefined}>
          Estimated freight for this load ({Math.round(est.distance_km).toLocaleString('en-IN')} km). {est.label}
        </Alert>
      )}
      {draft.quote_requested ? (
        <Input
          label="Your target budget (₹)" inputMode="decimal" value={draft.budget_inr} name="budget_inr"
          onChange={e => onChange({ budget_inr: money(e.target.value) })}
          hint={range ? `Optional. Companies see it as your target. Market estimate: ${range}.` : 'Optional. Companies see it as your target.'}
        />
      ) : (
        <Input
          label="Your price (₹)" required inputMode="decimal" value={draft.budget_inr} name="budget_inr"
          onChange={e => onChange({ budget_inr: money(e.target.value) })} error={errors.budget_inr}
          hint={range ? `The freight you will pay. Market estimate: ${range}.` : 'The freight you will pay.'}
        />
      )}
      {notes}
    </Card>
  )
}

/** Who can see the load: every company on the lane, or up to ten the vendor picks. */
export function VisibilityCard({ draft, onChange, errors }: { draft: LoadDraft; onChange: (patch: Partial<LoadDraft>) => void; errors: StepErrors }) {
  return (
    <Card padded className="space-y-3 !p-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Who can see this load?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Radio name="routing" value="open" checked={draft.routing !== 'chosen'} onChange={() => onChange({ routing: 'open' })}>
            <span className="font-medium text-text">All companies on this lane</span>
            <span className="block text-muted">Every logistic company that runs between these cities can see your load.</span>
          </Radio>
          <Radio name="routing" value="chosen" checked={draft.routing === 'chosen'} onChange={() => onChange({ routing: 'chosen' })}>
            <span className="font-medium text-text">Only companies I choose</span>
            <span className="block text-muted">Pick up to 10. Only they see your load.</span>
          </Radio>
        </div>
        {draft.routing === 'chosen' && (
          <div className="mt-3">
            <CompanyPicker pickupCity={draft.pickup_city} deliveryCity={draft.delivery_city} selected={draft.company_ids} onChange={ids => onChange({ company_ids: ids })} />
          </div>
        )}
        {errors.company_ids && <p className="mt-1 text-xs text-danger" role="alert">{errors.company_ids}</p>}
      </fieldset>
    </Card>
  )
}
