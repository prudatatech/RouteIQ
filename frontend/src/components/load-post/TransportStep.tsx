import type { ReactNode } from 'react'
import type { AssistResult, LoadDraft, VehicleClass } from '@/types/load'
import { itemTotals } from './logic'
import type { StepErrors } from './validate'
import TruckCards from './TruckCards'
import { HandlingCard, PricingCard, VisibilityCard } from './PricingCards'

/** Step 3, Truck and price: load type, vehicle, the derived capacity, temperature, handling, pricing and who sees the load. */
export default function TransportStep({ draft, onChange, errors, vehicles, vehiclesLoading, assist, truckNotes, priceNotes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  vehicles: VehicleClass[]
  vehiclesLoading?: boolean
  assist: AssistResult | null
  truckNotes?: ReactNode
  priceNotes?: ReactNode
}) {
  const weightKg = itemTotals(draft.items).weight_kg
  const capacity = draft.capacity_t === '' ? null : Number(draft.capacity_t)
  return (
    <div className="space-y-4">
      <TruckCards
        draft={draft} onChange={onChange} errors={errors} vehicles={vehicles} vehiclesLoading={vehiclesLoading}
        suggestedType={assist?.suggested.load_type} weightKg={weightKg} capacity={capacity} notes={truckNotes}
      />
      <HandlingCard draft={draft} onChange={onChange} />
      <PricingCard draft={draft} onChange={onChange} errors={errors} assist={assist} notes={priceNotes} />
      <VisibilityCard draft={draft} onChange={onChange} errors={errors} />
    </div>
  )
}
