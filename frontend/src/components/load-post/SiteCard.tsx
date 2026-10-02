import { useState, type ReactNode } from 'react'
import { Card, Checkbox, Input, Select, Textarea } from '@/components/ui'
import AddressPicker from '@/components/map/AddressPicker'
import type { ResolvedPlace } from '@/services/geocoding'
import type { LoadDraft } from '@/types/load'
import { isWeekend, todayIso } from './logic'
import type { StepErrors } from './validate'
import { placeToFields } from './helpers'
import { useCitySuggestions, usePinState, type Side } from './useAddressLookups'

const SLOTS = [
  { value: 'morning', label: 'Morning (6am–12pm)' },
  { value: 'afternoon', label: 'Afternoon (12pm–6pm)' },
  { value: 'evening', label: 'Evening (6pm–10pm)' },
]

/**
 * One end of the trip: one search box that fills a small editable address block (address line, city, pin code, state
 * from the pin code), then the date, the person to call and what the site needs.
 */
export default function SiteCard({ side, draft, onChange, errors, notes }: {
  side: Side
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  notes?: ReactNode
}) {
  // A restored draft keeps the chosen place's address and coordinates; show it in the picker straight away.
  const [place, setPlace] = useState<ResolvedPlace | null>(() => {
    const lat = draft[`${side}_lat`]
    const lng = draft[`${side}_lng`]
    const address = draft[`${side}_address`]
    return typeof lat === 'number' && typeof lng === 'number' && address ? { address, lat, lng } : null
  })
  const pickup = side === 'pickup'
  const title = pickup ? 'Pickup' : 'Delivery'
  usePinState(side, draft[`${side}_pincode`], draft[`${side}_state_code`], onChange)
  const cities = useCitySuggestions(draft[`${side}_city`])
  const listId = `${side}-city-suggestions`
  const set = (patch: Record<string, unknown>) => onChange(patch as Partial<LoadDraft>)

  const pick = (p: ResolvedPlace | null) => {
    setPlace(p)
    if (!p) { set({ [`${side}_lat`]: null, [`${side}_lng`]: null }); return }
    const f = placeToFields(p)
    set({
      [`${side}_lat`]: p.lat,
      [`${side}_lng`]: p.lng,
      [`${side}_address`]: f.address,
      ...(f.city ? { [`${side}_city`]: f.city } : {}),
      ...(f.pincode ? { [`${side}_pincode`]: f.pincode } : {}),
    })
  }

  return (
    <Card padded className="space-y-4 !p-4" role="group" aria-label={title}>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <AddressPicker
        label={`Search the ${side} address`}
        value={place}
        onChange={pick}
        kind={pickup ? 'pickup' : 'drop'}
        showMap={false}
        allowCurrentLocation={pickup}
        recentPlacesKey={`load-${side}`}
        error={errors[`${side}_lat`]}
        hint="Indian addresses only. Pick a result to fill the address below, then correct it if needed."
      />
      <Textarea
        label="Address line" required rows={2}
        value={draft[`${side}_address`]} onChange={e => set({ [`${side}_address`]: e.target.value })}
        error={errors[`${side}_address`]} hint="Building, street and a landmark."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="City" required list={listId} value={draft[`${side}_city`]} onChange={e => set({ [`${side}_city`]: e.target.value })} error={errors[`${side}_city`]} autoComplete="address-level2" />
        <Input
          label="Pin code" required inputMode="numeric" maxLength={6}
          value={draft[`${side}_pincode`]} onChange={e => set({ [`${side}_pincode`]: e.target.value.replace(/\D/g, '').slice(0, 6) })}
          error={errors[`${side}_pincode`]} autoComplete="postal-code"
        />
        <Input label="State" value={draft[`${side}_state_name`]} readOnly placeholder="From the pin code" />
      </div>
      <datalist id={listId}>{cities.map(c => <option key={c} value={c} />)}</datalist>

      <div className="grid gap-3 sm:grid-cols-2">
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
            error={errors.delivery_date} hint="Optional. Helps the logistic company plan the trip."
          />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={pickup ? 'Contact name' : 'Receiver name'} required
          value={draft[`${side}_contact_name`]} onChange={e => set({ [`${side}_contact_name`]: e.target.value })}
          error={errors[`${side}_contact_name`]} hint={pickup ? 'The person at the loading point.' : 'The consignee who signs for the goods.'}
          autoComplete="off"
        />
        <Input
          label={pickup ? 'Contact mobile' : 'Receiver mobile'} required type="tel" inputMode="tel"
          value={draft[`${side}_contact_phone`]} onChange={e => set({ [`${side}_contact_phone`]: e.target.value })}
          error={errors[`${side}_contact_phone`]} hint={pickup ? 'Shown to the driver for coordination.' : 'The driver calls this number before delivery.'}
          autoComplete="off"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-text">{pickup ? 'At the loading point' : 'At the delivery point'}</legend>
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
      </fieldset>
      {notes}
    </Card>
  )
}
