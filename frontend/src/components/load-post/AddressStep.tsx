import { useEffect, useState, type ReactNode } from 'react'
import { publicAPI } from '@/services/api'
import { Alert, Card, Checkbox, Input, Select, Textarea } from '@/components/ui'
import AddressPicker from '@/components/map/AddressPicker'
import type { ResolvedPlace } from '@/services/geocoding'
import type { LoadDraft } from '@/types/load'
import { isWeekend, taxBasisLocal, todayIso, type StepErrors } from './logic'

type Side = 'pickup' | 'delivery'

const SLOTS = [
  { value: 'morning', label: 'Morning (6am–12pm)' },
  { value: 'afternoon', label: 'Afternoon (12pm–6pm)' },
  { value: 'evening', label: 'Evening (6pm–10pm)' },
]

/** The city, pin code and full address a chosen place gives. Anything the geocoder lacks is left as typed. */
export function placeToFields(place: ResolvedPlace): { city?: string; pincode?: string; address: string } {
  const pin = place.parts?.pincode?.replace(/\D/g, '')
  const city = place.parts?.city || place.parts?.district || place.address.split(',')[0]?.trim()
  return { address: place.address, city: city || undefined, pincode: pin && pin.length === 6 ? pin : undefined }
}

/** Looks the state up when a 6-digit pin code is entered, and clears it when the pin code changes. */
function usePinState(side: Side, pin: string, stateCode: string, onChange: (patch: Partial<LoadDraft>) => void) {
  useEffect(() => {
    if (!/^\d{6}$/.test(pin)) {
      if (stateCode) onChange({ [`${side}_state_code`]: '', [`${side}_state_name`]: '' } as Partial<LoadDraft>)
      return
    }
    let live = true
    publicAPI.pincode(pin)
      .then(info => {
        if (!live) return
        onChange({ [`${side}_state_code`]: info?.state_code ?? '', [`${side}_state_name`]: info?.state_name ?? '' } as Partial<LoadDraft>)
      })
      .catch(() => { /* the form still works; the server finds the state on submit */ })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])
}

function Section({ side, draft, onChange, errors, notes }: {
  side: Side
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  notes?: ReactNode
}) {
  const [place, setPlace] = useState<ResolvedPlace | null>(null)
  const title = side === 'pickup' ? 'Pickup' : 'Delivery'
  const state = draft[`${side}_state_name`]
  usePinState(side, draft[`${side}_pincode`], draft[`${side}_state_code`], onChange)

  const pick = (p: ResolvedPlace | null) => {
    setPlace(p)
    if (!p) { onChange({ [`${side}_lat`]: null, [`${side}_lng`]: null } as Partial<LoadDraft>); return }
    const f = placeToFields(p)
    onChange({
      [`${side}_lat`]: p.lat,
      [`${side}_lng`]: p.lng,
      [`${side}_address`]: f.address,
      ...(f.city ? { [`${side}_city`]: f.city } : {}),
      ...(f.pincode ? { [`${side}_pincode`]: f.pincode } : {}),
    } as Partial<LoadDraft>)
  }

  return (
    <Card padded className="space-y-4 !p-4" role="group" aria-label={title}>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <AddressPicker
        label={`Search the ${side} address`}
        value={place}
        onChange={pick}
        kind={side === 'pickup' ? 'pickup' : 'drop'}
        showMap={false}
        allowCurrentLocation={side === 'pickup'}
        recentPlacesKey={`load-${side}`}
        error={errors[`${side}_lat`]}
        hint="Indian addresses only. Pick a result to fill the city, address and pin code."
      />
      <Input label={`${title} city`} required value={draft[`${side}_city`]} onChange={e => onChange({ [`${side}_city`]: e.target.value } as Partial<LoadDraft>)} error={errors[`${side}_city`]} autoComplete="address-level2" />
      <Textarea
        label={`${title} full address`} required rows={3}
        value={draft[`${side}_address`]} onChange={e => onChange({ [`${side}_address`]: e.target.value } as Partial<LoadDraft>)}
        error={errors[`${side}_address`]} hint="Include a landmark and the pin code."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={`${title} pin code`} required inputMode="numeric" maxLength={6}
          value={draft[`${side}_pincode`]} onChange={e => onChange({ [`${side}_pincode`]: e.target.value.replace(/\D/g, '').slice(0, 6) } as Partial<LoadDraft>)}
          error={errors[`${side}_pincode`]} autoComplete="postal-code"
        />
        <Input label="State" value={state} readOnly placeholder="Filled from the pin code" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {side === 'pickup' ? (
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
            error={errors.delivery_date} hint="Optional. Helps the carrier plan the trip."
          />
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={`${title} contact name`} required={side === 'pickup'}
          value={draft[`${side}_contact_name`]} onChange={e => onChange({ [`${side}_contact_name`]: e.target.value } as Partial<LoadDraft>)}
          error={errors[`${side}_contact_name`]} hint={side === 'pickup' ? 'The person at the loading point.' : undefined}
          autoComplete="off"
        />
        <Input
          label={`${title} contact number`} required={side === 'pickup'} type="tel" inputMode="tel"
          value={draft[`${side}_contact_phone`]} onChange={e => onChange({ [`${side}_contact_phone`]: e.target.value } as Partial<LoadDraft>)}
          error={errors[`${side}_contact_phone`]} hint={side === 'pickup' ? 'Shown to the driver for coordination.' : undefined}
          autoComplete="off"
        />
      </div>
      {notes}
    </Card>
  )
}

/** Step 3: where the goods are collected and delivered, when, and who to call. */
export default function AddressStep({ draft, onChange, errors, pickupNotes, deliveryNotes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  pickupNotes?: ReactNode
  deliveryNotes?: ReactNode
}) {
  const basis = taxBasisLocal(draft)
  return (
    <div className="space-y-4">
      <Section side="pickup" draft={draft} onChange={onChange} errors={errors} notes={pickupNotes} />
      <Section side="delivery" draft={draft} onChange={onChange} errors={errors} notes={deliveryNotes} />
      {basis !== 'unknown' && (
        <Alert tone="info" title={basis === 'inter' ? 'Interstate (IGST)' : 'Within state (CGST + SGST)'}>
          {basis === 'inter'
            ? `${draft.pickup_state_name} to ${draft.delivery_state_name}: IGST applies on the goods.`
            : `Both addresses are in ${draft.pickup_state_name}: CGST and SGST apply, half each.`}
        </Alert>
      )}
      <Card padded className="space-y-4 !p-4">
        <h3 className="text-base font-semibold text-text">Site details</h3>
        <Checkbox
          label="Loading dock available"
          description="A dock lets us send a higher-bed truck."
          checked={draft.loading_dock}
          onChange={e => onChange({ loading_dock: e.target.checked })}
        />
        <Input
          label="Access restrictions" value={draft.access_restrictions}
          onChange={e => onChange({ access_restrictions: e.target.value })}
          hint="For example: no vehicles above 12 T, basement loading only."
        />
      </Card>
    </div>
  )
}
