import type { ReactNode } from 'react'
import { Container, Droplets, Package, Snowflake, Truck } from 'lucide-react'
import { Alert, Card, Skeleton } from '@/components/ui'
import type { LoadDraft, LoadType, VehicleClass } from '@/types/load'
import { hasPerishable, localLoadType, TEMP_RANGES } from './logic'
import type { StepErrors } from './validate'
import { capacityText } from './helpers'
import Radio from './Radio'

function VehicleIcon({ v }: { v: VehicleClass }) {
  const Icon = v.is_reefer ? Snowflake : v.is_tanker ? Droplets : v.is_open ? Package : v.key.includes('container') ? Container : Truck
  return <Icon size={22} aria-hidden="true" />
}

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

/** Load type, vehicle (needed for a full load only), the derived capacity and the temperature. */
export default function TruckCards({ draft, onChange, errors, vehicles, vehiclesLoading, suggestedType, weightKg, capacity, notes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  vehicles: VehicleClass[]
  vehiclesLoading?: boolean
  suggestedType: LoadType | undefined
  weightKg: number
  capacity: number | null
  notes?: ReactNode
}) {
  const touch = (patch: Partial<LoadDraft>) => onChange({ ...patch, transport_touched: true })
  const recommended = suggestedType ?? localLoadType(weightKg)
  const ptl = draft.load_type === 'ptl'
  const vehicle = vehicles.find(v => v.key === draft.vehicle_class)
  return (
    <>
      <Card padded className="space-y-4 !p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Load type <span className="text-danger" aria-hidden="true">*</span></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['ftl', 'ptl'] as const).map(t => (
              <Radio key={t} name="load_type" checked={draft.load_type === t} onChange={() => touch({ load_type: t })} value={t}>
                <span className="font-medium text-text">{t === 'ftl' ? 'Full truck load (FTL)' : 'Part truck load (PTL)'}</span>
                {recommended === t && weightKg > 0 && <span className="ml-2 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Recommended</span>}
                <span className="block text-muted">{t === 'ftl' ? 'The whole truck is yours.' : 'You share the truck with other goods.'}</span>
              </Radio>
            ))}
          </div>
          {errors.load_type && <p className="mt-1 text-xs text-danger" role="alert">{errors.load_type}</p>}
        </fieldset>
        {notes}
      </Card>

      <Card padded className="space-y-3 !p-4">
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-text">
            Vehicle type {!ptl && <span className="text-danger" aria-hidden="true">*</span>}
          </legend>
          {ptl && <p className="mb-2 text-xs text-muted">For a part load the logistic company picks the truck that fits. You can still ask for a vehicle type.</p>}
          {vehiclesLoading ? (
            <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {ptl && (
                <Radio name="vehicle_class" value="" checked={draft.vehicle_class === ''} onChange={() => touch({ vehicle_class: '' })}>
                  <span className="font-medium text-text">No preference</span>
                  <span className="block text-muted">Let the logistic company decide.</span>
                </Radio>
              )}
              {vehicles.map(v => (
                <Radio key={v.key} name="vehicle_class" value={v.key} checked={draft.vehicle_class === v.key} onChange={() => touch({ vehicle_class: v.key })}>
                  <span className="flex items-center gap-2 font-medium text-text"><VehicleIcon v={v} /> {v.name}</span>
                  <span className="block text-muted">{capacityText(v)}{v.best_for ? ` · ${v.best_for}` : ''}</span>
                  {v.notes && <span className="block text-xs text-muted">{v.notes}</span>}
                </Radio>
              ))}
            </div>
          )}
          {errors.vehicle_class && <p className="mt-1 text-xs text-danger" role="alert">{errors.vehicle_class}</p>}
        </fieldset>
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
