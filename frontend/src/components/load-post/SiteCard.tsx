import type { ReactNode } from 'react'
import { Card, Input, Select } from '@/components/ui'
import type { LoadDraft } from '@/types/load'
import { isWeekend, todayIso } from './logic'
import type { StepErrors } from './validate'
import type { Side } from './useAddressLookups'
import AddressBlock from './AddressBlock'

const SLOTS = [
  { value: 'morning', label: 'Morning, 6am–12pm' },
  { value: 'afternoon', label: 'Afternoon, 12–6pm' },
  { value: 'evening', label: 'Evening, 6–10pm' },
]

/**
 * One end of the trip: the address (one search box, then a one-line summary), the pickup date and slot, and the person
 * to call. There are no site details and no delivery date: the logistic company works those out.
 */
export default function SiteCard({ side, draft, onChange, errors, notes }: {
  side: Side
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  notes?: ReactNode
}) {
  const pickup = side === 'pickup'
  const title = pickup ? 'Pickup' : 'Delivery'
  const set = (patch: Record<string, unknown>) => onChange(patch as Partial<LoadDraft>)

  return (
    <Card padded className="scroll-mt-24 space-y-3 !p-4" role="group" aria-label={title}>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <AddressBlock side={side} draft={draft} set={set} errors={errors} />

      {pickup && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Pickup date" required type="date" min={todayIso()}
            value={draft.pickup_date} onChange={e => onChange({ pickup_date: e.target.value })}
            error={errors.pickup_date}
            hint={draft.pickup_date && isWeekend(draft.pickup_date) ? 'Weekends have limited availability.' : undefined}
          />
          <Select
            label="Pickup time slot" value={draft.pickup_slot} placeholder="Any time"
            onChange={e => onChange({ pickup_slot: e.target.value as LoadDraft['pickup_slot'] })} options={SLOTS}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
        <Input
          label={pickup ? 'Contact name' : 'Receiver name'} required
          value={draft[`${side}_contact_name`]} onChange={e => set({ [`${side}_contact_name`]: e.target.value })}
          error={errors[`${side}_contact_name`]} autoComplete="off"
        />
        <Input
          label={pickup ? 'Contact mobile' : 'Receiver mobile'} required type="tel" inputMode="tel"
          value={draft[`${side}_contact_phone`]} onChange={e => set({ [`${side}_contact_phone`]: e.target.value })}
          error={errors[`${side}_contact_phone`]} autoComplete="off"
        />
      </div>

      {notes}
    </Card>
  )
}
