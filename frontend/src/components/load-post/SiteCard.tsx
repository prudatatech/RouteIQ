import type { ReactNode } from 'react'
import { Card, Checkbox, Input, Select } from '@/components/ui'
import type { LoadDraft } from '@/types/load'
import { isWeekend, todayIso } from './logic'
import type { StepErrors } from './validate'
import type { Side } from './useAddressLookups'
import AddressBlock from './AddressBlock'
import SiteDetails from './SiteDetails'

const SLOTS = [
  { value: 'morning', label: 'Morning, 6am–12pm' },
  { value: 'afternoon', label: 'Afternoon, 12–6pm' },
  { value: 'evening', label: 'Evening, 6–10pm' },
]

/**
 * One end of the trip: the address (one search box, then a one-line summary), the date, the person to call, and the
 * optional site details. Each part is as short as it can be; nothing the form asks for is dropped.
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
  const hasSiteValue = pickup ? draft.loading_dock || !!draft.access_restrictions.trim() || draft.loading_help : draft.unloading_help

  return (
    <Card padded className="scroll-mt-24 space-y-3 !p-4" role="group" aria-label={title}>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <AddressBlock side={side} draft={draft} set={set} errors={errors} />

      <div className="grid grid-cols-2 gap-3">
        {pickup ? (
          <>
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
          </>
        ) : (
          <Input
            label="Preferred delivery date" type="date" min={draft.pickup_date || todayIso()}
            value={draft.delivery_date} onChange={e => onChange({ delivery_date: e.target.value })}
            error={errors.delivery_date} hint="Optional" className="col-span-2 sm:col-span-1"
          />
        )}
      </div>

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

      <SiteDetails id={`${side}-site-details`} hasValue={hasSiteValue}>
        {pickup ? (
          <>
            <Checkbox label="Loading dock available" description="A dock lets us send a higher-bed truck." checked={draft.loading_dock} onChange={e => onChange({ loading_dock: e.target.checked })} />
            <Input
              label="Access restrictions" value={draft.access_restrictions} onChange={e => onChange({ access_restrictions: e.target.value })}
              hint="For example: no vehicles above 12 T, basement loading only."
            />
            <Checkbox label="Need loading help (labour)" description="Labour at pickup. A surcharge may apply." checked={draft.loading_help} onChange={e => onChange({ loading_help: e.target.checked })} />
          </>
        ) : (
          <Checkbox label="Need unloading help (labour)" description="Labour at delivery. A surcharge may apply." checked={draft.unloading_help} onChange={e => onChange({ unloading_help: e.target.checked })} />
        )}
      </SiteDetails>
      {notes}
    </Card>
  )
}
