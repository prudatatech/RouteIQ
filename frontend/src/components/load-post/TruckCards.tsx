import { useState, type ReactNode } from 'react'
import { Alert, Card, Select, Skeleton } from '@/components/ui'
import type { LoadDraft, VehicleClass, VehicleMode } from '@/types/load'
import { hasPerishable, inr, TEMP_RANGES } from './logic'
import type { StepErrors } from './validate'
import { capacityText } from './helpers'
import Radio from './Radio'
import Segmented from './Segmented'
import type { QuoteOk } from '@/services/pricing'

type MarketBenchmark = QuoteOk['market_benchmark']

interface MarketVehicleOption {
  vid?: number
  name: string
  bodyType: string
  tyre: number
  lengthFt: number
  actualPriceInr: number
  discountedPriceInr: number
  discountPct: number
  capacityTon: number
  remark?: string | null
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

const vehicleLine = (v: VehicleClass) => `${v.name} · ${capacityText(v)}`

/** Load type (a compact choice), the vehicle (the suggestion, or one picked from a list), the derived capacity and the temperature. */
export default function TruckCards({ draft, onChange, errors, vehicles, vehiclesLoading, suggestedVehicleKey, assistLoading, weightKg, capacity, notes, marketBenchmark }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  vehicles: VehicleClass[]
  vehiclesLoading?: boolean
  /** assist.suggested.vehicle_class: the vehicle sent when "Recommend for my goods" is on. */
  suggestedVehicleKey?: string | null
  assistLoading?: boolean
  weightKg: number
  capacity: number | null
  notes?: ReactNode
  marketBenchmark?: MarketBenchmark
}) {
  const ptl = draft.load_type === 'ptl'
  const vehicle = vehicles.find(v => v.key === draft.vehicle_class)
  const suggested = suggestedVehicleKey ? vehicles.find(v => v.key === suggestedVehicleKey) : undefined
  const manual = draft.vehicle_mode === 'manual'
  const setMode = (mode: VehicleMode) => onChange(mode === 'manual' ? { vehicle_mode: mode, transport_touched: true } : { vehicle_mode: mode })

  const [activeBodyTab, setActiveBodyTab] = useState<'ALL' | 'OPEN' | 'CONTAINER' | 'TRAILER'>('ALL')

  const suggestionText = suggested
    ? vehicleLine(suggested)
    : suggestedVehicleKey
      ? suggestedVehicleKey.replace(/_/g, ' ')
      : assistLoading ? 'Working out the right vehicle…' : weightKg > 0 ? 'No vehicle to suggest yet' : 'Add the weight of your goods first'

  const vehicleOptions: MarketVehicleOption[] = marketBenchmark?.ftl?.vehicleOptions ?? []
  const visibleOptions = vehicleOptions.filter((opt) => {
    if (activeBodyTab === 'ALL') return true
    const b = (opt.bodyType || '').toUpperCase()
    return b === activeBodyTab
  })
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

      {/* Live Market Trucks (FTL) */}
      {vehicleOptions.length > 0 && (
        <Card padded className="space-y-3 !p-4 border-success/30 bg-surface">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <div>
              <h3 className="text-sm font-semibold text-text flex items-center gap-2">
                <span>Live Market Trucks</span>
                <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success border border-success/20">
                  ⚡ Live Rates
                </span>
              </h3>
              <p className="text-xs text-muted">
                Real-time carrier rates for this lane. Select a truck to book at verified market price.
              </p>
            </div>
            {/* Trust Guarantee Strip */}
            <div className="hidden lg:flex items-center gap-3 text-xs text-success font-medium">
              <span>✓ Verified Fleet</span>
              <span>✓ ₹10L Transit Insurance</span>
              <span>✓ Live GPS Included</span>
            </div>
          </div>

          {/* Body Type Filter Tabs */}
          <div className="flex items-center gap-1.5 border-b border-border/60 pb-2 overflow-x-auto text-xs">
            {[
              { id: 'ALL', label: 'All Trucks', count: vehicleOptions.length },
              { id: 'OPEN', label: 'Open Body', count: vehicleOptions.filter((v) => (v.bodyType || '').toUpperCase() === 'OPEN').length },
              { id: 'CONTAINER', label: 'Container', count: vehicleOptions.filter((v) => (v.bodyType || '').toUpperCase() === 'CONTAINER').length },
              { id: 'TRAILER', label: 'Trailer', count: vehicleOptions.filter((v) => (v.bodyType || '').toUpperCase() === 'TRAILER').length },
            ].filter(tab => tab.id === 'ALL' || tab.count > 0).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveBodyTab(tab.id as 'ALL' | 'OPEN' | 'CONTAINER' | 'TRAILER')}
                className={`rounded-full px-3 py-1 font-medium transition-all ${
                  activeBodyTab === tab.id
                    ? 'bg-success text-white shadow-raised'
                    : 'bg-surface-subtle text-muted hover:bg-surface hover:text-text border border-border/80'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 pt-1">
            {visibleOptions.map((opt) => {
              const isSelected = draft.vehicle_class === opt.name || draft.budget_inr === opt.discountedPriceInr
              return (
                <div
                  key={opt.vid || opt.name}
                  onClick={() => onChange({
                    vehicle_class: opt.name,
                    capacity_t: String(opt.capacityTon),
                    budget_inr: opt.discountedPriceInr,
                    vehicle_mode: 'manual',
                    transport_touched: true
                  })}
                  className={`group relative cursor-pointer rounded-card border p-3.5 transition-all text-left ${
                    isSelected
                      ? 'border-success bg-success/10 ring-2 ring-success/30 shadow-raised'
                      : 'border-border bg-surface-subtle hover:border-success/50 hover:bg-surface'
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-text text-sm">{opt.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1 text-xs text-muted">
                        <span className="rounded bg-surface px-1.5 py-0.5 border border-border/80">
                          {opt.tyre} Tyre
                        </span>
                        <span className="rounded bg-surface px-1.5 py-0.5 border border-border/80">
                          {opt.lengthFt}ft
                        </span>
                        <span className="rounded bg-surface px-1.5 py-0.5 border border-border/80">
                          {opt.capacityTon} MT
                        </span>
                      </div>
                    </div>
                    {opt.discountPct > 0 && (
                      <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs font-semibold text-warning shrink-0">
                        {opt.discountPct}% Off
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-baseline justify-between border-t border-border/60 pt-2">
                    <div>
                      <span className="text-base font-semibold text-text tabular">
                        {inr(opt.discountedPriceInr)}
                      </span>
                      {opt.actualPriceInr > opt.discountedPriceInr && (
                        <span className="ml-1.5 text-xs text-muted line-through tabular">
                          {inr(opt.actualPriceInr)}
                        </span>
                      )}
                    </div>
                    <span className={`text-xs font-semibold ${isSelected ? 'text-success' : 'text-muted group-hover:text-text'}`}>
                      {isSelected ? '✓ Selected' : 'Select'}
                    </span>
                  </div>

                  {opt.remark && (
                    <p className="mt-1.5 text-xs text-warning">
                      ⚠️ {opt.remark}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* PTL Benchmark */}
      {marketBenchmark?.ptl && (
        <Card padded className="space-y-1.5 !p-4 border-success/30 bg-success/5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text flex items-center gap-2">
              <span>PTL Lane Rate</span>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success border border-success/20">
                Pro-rata
              </span>
            </h3>
            <span className="text-base font-semibold text-text tabular">
              ~₹{marketBenchmark.ptl.derivedRatePerKgInr}/kg
            </span>
          </div>
          <p className="text-xs text-muted">
            Estimated market freight: <strong className="text-text tabular">₹{marketBenchmark.ptl.estimatedMarketPriceInr.toLocaleString('en-IN')}</strong> for {weightKg} kg (derived from live {marketBenchmark.ptl.benchmarkTruck} capacity on this lane).
          </p>
        </Card>
      )}

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
