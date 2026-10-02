import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button, Input, Textarea } from '@/components/ui'
import AddressPicker from '@/components/map/AddressPicker'
import type { ResolvedPlace } from '@/services/geocoding'
import type { LoadDraft } from '@/types/load'
import type { StepErrors } from './validate'
import { placeToFields } from './helpers'
import { useCitySuggestions, usePinState, type Side } from './useAddressLookups'

type Patch = (patch: Record<string, unknown>) => void

/**
 * One end of the trip's address. Before a place is picked: the search box and an "Enter the address manually" link.
 * After a pick (or when a saved draft has an address): one summary line and an Edit address button that opens the
 * editable fields. A problem with any address field opens the fields by itself.
 */
export default function AddressBlock({ side, draft, set, errors }: { side: Side; draft: LoadDraft; set: Patch; errors: StepErrors }) {
  // A restored draft keeps the chosen place's address and coordinates; show it in the picker straight away.
  const [place, setPlace] = useState<ResolvedPlace | null>(() => {
    const lat = draft[`${side}_lat`]
    const lng = draft[`${side}_lng`]
    const address = draft[`${side}_address`]
    return typeof lat === 'number' && typeof lng === 'number' && address ? { address, lat, lng } : null
  })
  const [editing, setEditing] = useState(false)
  const onChange = set as (patch: Partial<LoadDraft>) => void
  usePinState(side, draft[`${side}_pincode`], draft[`${side}_state_code`], onChange)
  const cities = useCitySuggestions(draft[`${side}_city`])
  const listId = `${side}-city-suggestions`

  const address = draft[`${side}_address`]
  const hasError = !!(errors[`${side}_address`] || errors[`${side}_city`] || errors[`${side}_pincode`] || errors[`${side}_lat`])
  const fieldsOpen = editing || hasError
  const summary = !!address.trim() && !fieldsOpen

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
    setEditing(false)
  }

  if (summary) {
    const line = [draft[`${side}_city`], draft[`${side}_pincode`], draft[`${side}_state_name`]].filter(Boolean).join(' · ')
    return (
      <div className="flex items-start gap-2 rounded-control border border-border bg-surface-subtle p-3" data-testid={`${side}-address-summary`}>
        <MapPin size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm text-text">{address}</p>
          {line && <p className="text-xs text-muted">{line}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit address</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AddressPicker
        label={`Search the ${side} address`}
        value={place}
        onChange={pick}
        kind={side === 'pickup' ? 'pickup' : 'drop'}
        showMap={false}
        allowCurrentLocation={side === 'pickup'}
        recentPlacesKey={`load-${side}`}
        error={errors[`${side}_lat`]}
        hint={fieldsOpen ? 'Pick a result to fill the address below, then correct it if needed.' : 'Indian addresses only. Pick a result to fill in the address.'}
      />
      {!fieldsOpen && (
        <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-brand hover:underline">Enter the address manually</button>
      )}
      {fieldsOpen && (
        <>
          <Textarea
            label="Address line" required rows={2}
            value={address} onChange={e => set({ [`${side}_address`]: e.target.value })}
            error={errors[`${side}_address`]} hint="Building, street and a landmark."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
            <Input
              label="City" required list={listId} value={draft[`${side}_city`]} onChange={e => set({ [`${side}_city`]: e.target.value })}
              error={errors[`${side}_city`]} autoComplete="address-level2" className="col-span-2 sm:col-span-1 md:col-span-2 lg:col-span-1"
            />
            <Input
              label="Pin code" required inputMode="numeric" maxLength={6}
              value={draft[`${side}_pincode`]} onChange={e => set({ [`${side}_pincode`]: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              error={errors[`${side}_pincode`]} autoComplete="postal-code"
            />
            <Input label="State" value={draft[`${side}_state_name`]} readOnly placeholder="From the pin code" />
          </div>
          {address.trim() && !hasError && <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Done</Button>}
        </>
      )}
      <datalist id={listId}>{cities.map(c => <option key={c} value={c} />)}</datalist>
    </div>
  )
}
