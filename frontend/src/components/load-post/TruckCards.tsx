import type { ReactNode } from 'react'
import { Alert, Card, Select, Skeleton } from '@/components/ui'
import type { LoadDraft, LoadType, VehicleClass, VehicleMode } from '@/types/load'
import { hasPerishable, localLoadType, TEMP_RANGES } from './logic'
import type { StepErrors } from './validate'
import { capacityText } from './helpers'
import Radio from './Radio'
import Segmented from './Segmented'

/** What the vehicle can carry against the load, in words. The capacity is worked out, never typed. */
export function CapacityNote({ vehicle, capacity, weightKg }: { vehicle?: VehicleClass; capacity: number | null; weightKg: number }) {
  const loadT = Math.round(weightKg / 10) / 100
  const max = vehicle?.max_t ?? null
  if (weightKg <= 0 || (!vehicle && capacity === null)) return null
  return (
    <div className="space-y-2" data-testid="capacity-note">
      <p className="text-sm text-muted">
        {vehicle && max !== null ? `Fits up to ${max} t, your load is ${loadT} t.` : `Your load is ${loadT} t${capacity !== null ? `; a truck of about ${capacity} t is suggested` : ''}.`}
      </p>
      {max !== null && loadT > max && (
        <Alert tone="warning">Your load ({loadT} t) is heavier than {vehicle?.name} carries ({max} t). Choose a larger vehicle or split the load.</Alert>
      )}
    </div>
  )
}

const vehicleLine = (v: VehicleClass) => `${v.name} · ${capacityText(v)}`

/** Load type (a compact choice), the vehicle (the suggestion, or one picked from a list), the derived capacity and the temperature. */
export default function TruckCards({ draft, onChange, errors, vehicles, vehiclesLoading, suggestedType, suggestedVehicleKey, assistLoading, weightKg, capacity, notes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  vehicles: VehicleClass[]
  vehiclesLoading?: boolean
  suggestedType: LoadType | undefined
  /** assist.suggested.vehicle_class: the vehicle sent when "Recommend for my goods" is on. */
  suggestedVehicleKey?: string | null
  assistLoading?: boolean
  weightKg: number
  capacity: number | null
  notes?: ReactNode
}) {
  const recommended = suggestedType ?? localLoadType(weightKg)
  const ptl = draft.load_type === 'ptl'
  const vehicle = vehicles.find(v => v.key === draft.vehicle_class)
  const suggested = suggestedVehicleKey ? vehicles.find(v => v.key === suggestedVehicleKey) : undefined
  const manual = draft.vehicle_mode === 'manual'
  const setMode = (mode: VehicleMode) => onChange(mode === 'manual' ? { vehicle_mode: mode, transport_touched: true } : { vehicle_mode: mode })

  const suggestionText = suggested
    ? vehicleLine(suggested)
    : suggestedVehicleKey
      ? suggestedVehicleKey.replace(/_/g, ' ')
      : assistLoading ? 'Working out the right vehicle…' : weightKg > 0 ? 'No vehicle to suggest yet' : 'Add the weight of your goods first'
  const options = [
    ...(ptl ? [{ value: '', label: 'No preference (the logistic company decides)' }] : []),
    ...vehicles.map(v => ({ value: v.key, label: vehicleLine(v) })),
  ]

  return (
    <>
      {notes && <Card padded className="space-y-4 !p-4">{notes}</Card>}

      <Card padded className="space-y-3 !p-4">
        <Segmented
          name="vehicle_mode" legend="Vehicle type" required={!ptl} value={draft.vehicle_mode} columns="sm:grid-cols-2"
          onChange={setMode}
          options={[
            { value: 'recommend', label: 'Recommend for my goods', hint: <span data-testid="vehicle-suggestion">{suggestionText}</span> },
            { value: 'manual', label: 'Choose myself', hint: 'Pick from the list of vehicle types.' },
          ]}
        />
        {ptl && !manual && <p className="text-xs text-muted">For a part load the logistic company picks the truck that fits.</p>}
        {manual && (vehiclesLoading ? (
          <Skeleton className="h-control w-full" />
        ) : (
          <Select
            label="Vehicle" hideLabel name="vehicle_class" value={draft.vehicle_class} placeholder={ptl ? undefined : 'Select a vehicle type'}
            onChange={e => onChange({ vehicle_class: e.target.value, transport_touched: true })}
            options={options} error={errors.vehicle_class}
          />
        ))}
        {!manual && errors.vehicle_class && <p className="text-xs text-danger" role="alert">{errors.vehicle_class}</p>}
        <CapacityNote vehicle={vehicle} capacity={capacity} weightKg={weightKg} />
      </Card>

      {hasPerishable(draft.items) && (
        <Card padded className="space-y-2 !p-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">Temperature <span className="text-danger" aria-hidden="true">*</span></legend>
            <p className="mb-2 text-xs text-muted">Some of your goods need a controlled temperature.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(TEMP_RANGES) as (keyof typeof TEMP_RANGES)[]).map(k => (
                <Radio key={k} name="temp_choice" value={k} checked={draft.temp_choice === k} onChange={() => onChange({ temp_choice: k })}>
                  <span className="font-medium text-text">{TEMP_RANGES[k].label}</span>
                </Radio>
              ))}
            </div>
            {errors.temp_choice && <p className="mt-1 text-xs text-danger" role="alert">{errors.temp_choice}</p>}
          </fieldset>
        </Card>
      )}
    </>
  )
}
