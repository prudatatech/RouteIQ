import type { ReactNode } from 'react'
import type { AssistResult, LoadDraft, VehicleClass } from '@/types/load'
import { itemTotals } from './logic'
import type { StepErrors } from './validate'
import TruckCards from './TruckCards'
import HandlingCard from './HandlingCard'
import FreightCard from './FreightCard'

/** Step 3, Truck and price: load type, vehicle, the derived capacity, temperature, whole-load handling, and the recommended freight. */
export default function TransportStep({ draft, onChange, errors, vehicles, vehiclesLoading, assist, assistLoading, truckNotes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  vehicles: VehicleClass[]
  vehiclesLoading?: boolean
  assist: AssistResult | null
  assistLoading?: boolean
  truckNotes?: ReactNode
}) {
  const weightKg = itemTotals(draft.items).weight_kg
  const capacity = draft.capacity_t === '' ? null : Number(draft.capacity_t)
  return (
    <div className="space-y-4">
      <TruckCards
        draft={draft} onChange={onChange} errors={errors} vehicles={vehicles} vehiclesLoading={vehiclesLoading}
        suggestedType={assist?.suggested.load_type} suggestedVehicleKey={assist?.suggested.vehicle_class} assistLoading={assistLoading}
        weightKg={weightKg} capacity={capacity} notes={truckNotes}
      />
      <HandlingCard draft={draft} onChange={onChange} />
      <FreightCard assist={assist} loading={assistLoading} />
    </div>
  )
}
