import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { IconButton, Input, PlaceSearch } from '@/components/ui'
import type { DraftDrop } from '@/store/draftStore'
import type { ResolvedPlace } from '@/services/geocoding'
import { dropError, type FieldErrors } from './validation'

const nameOf = (place: ResolvedPlace) => place.address.split(', ')[0] || place.address

const newDrop = (place?: ResolvedPlace): DraftDrop => ({
  id: `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  name: place ? nameOf(place) : '',
  address: place?.address ?? '',
  lat: place?.lat ?? 0,
  lng: place?.lng ?? 0,
  consignee_name: '',
  consignee_phone: '',
  consignee_gstin: '',
  pieces: '',
  weight_kg: '',
  declared_value: '',
})

/**
 * The drops of a multi-drop booking, each with its address and consignee. The pieces split is on
 * the Cargo step. Each drop becomes a lot (RTX-…-A, -B …) with its own POD and invoice.
 */
export default function DropsEditor({ drops, onChange, errors, recentPlacesKey }: {
  drops: DraftDrop[]
  onChange: (drops: DraftDrop[]) => void
  errors: FieldErrors
  recentPlacesKey?: string
}) {
  // Remounts the add-drop search after each pick so it starts empty again
  const [addKey, setAddKey] = useState(0)
  const update = (id: string, patch: Partial<DraftDrop>) => onChange(drops.map(d => (d.id === id ? { ...d, ...patch } : d)))

  return (
    <div className="space-y-3">
      <ol className="space-y-3" aria-label="Drops">
        {drops.map((d, i) => (
          <li key={d.id} className="space-y-3 rounded-control border border-border p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-text">Drop {i + 1}</h3>
              <IconButton size="sm" label={`Remove drop ${i + 1}`} icon={<Trash2 size={16} />} onClick={() => onChange(drops.filter(x => x.id !== d.id))} />
            </div>
            <PlaceSearch
              label="Address"
              required
              value={d.lat && d.lng ? { address: d.address, lat: d.lat, lng: d.lng } : null}
              onChange={place => update(d.id, place
                ? { name: nameOf(place), address: place.address, lat: place.lat, lng: place.lng }
                : { name: '', address: '', lat: 0, lng: 0 })}
              error={dropError(errors, d.id, 'place')}
              recentPlacesKey={recentPlacesKey}
              placeholder="Where this drop is delivered"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Consignee"
                required
                value={d.consignee_name}
                onChange={e => update(d.id, { consignee_name: e.target.value })}
                error={dropError(errors, d.id, 'consignee_name')}
                maxLength={200}
                autoComplete="organization"
              />
              <Input
                label="Phone"
                required
                type="tel"
                inputMode="tel"
                value={d.consignee_phone}
                onChange={e => update(d.id, { consignee_phone: e.target.value })}
                error={dropError(errors, d.id, 'consignee_phone')}
                maxLength={16}
              />
              <Input
                label="GSTIN"
                value={d.consignee_gstin}
                onChange={e => update(d.id, { consignee_gstin: e.target.value })}
                error={dropError(errors, d.id, 'consignee_gstin')}
                hint="Optional"
                maxLength={15}
                inputClassName="font-mono uppercase"
              />
            </div>
          </li>
        ))}
      </ol>
      <PlaceSearch
        key={addKey}
        label={drops.length === 0 ? 'First drop' : 'Add a drop'}
        hint="Search for the address; you add the consignee after."
        placeholder="Add a drop"
        value={null}
        error={errors.drops}
        recentPlacesKey={recentPlacesKey}
        onChange={place => {
          if (!place) return
          onChange([...drops, newDrop(place)])
          setAddKey(k => k + 1)
        }}
      />
    </div>
  )
}
