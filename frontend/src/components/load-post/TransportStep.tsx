import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Container, Droplets, Package, Snowflake, Truck } from 'lucide-react'
import { Alert, Card, Checkbox, Input, Skeleton } from '@/components/ui'
import type { AssistResult, LoadDraft, LoadType, SpecialHandling, VehicleClass } from '@/types/load'
import { hasPerishable, inr, itemTotals, localLoadType, TEMP_RANGES, type StepErrors } from './logic'
import { capacityText } from './helpers'
import CompanyPicker from './CompanyPicker'

const SPECIAL: { id: SpecialHandling; label: string }[] = [
  { id: 'fragile', label: 'Fragile' },
  { id: 'do_not_stack', label: 'Do not stack' },
  { id: 'this_side_up', label: 'This side up' },
  { id: 'hazmat', label: 'Hazardous (hazmat)' },
  { id: 'odc', label: 'Over-dimensional cargo (ODC)' },
]


function VehicleIcon({ v }: { v: VehicleClass }) {
  const Icon = v.is_reefer ? Snowflake : v.is_tanker ? Droplets : v.is_open ? Package : v.key.includes('container') ? Container : Truck
  return <Icon size={22} aria-hidden="true" />
}

function Radio({ name, checked, onChange, children, className, ...rest }: {
  name: string
  checked: boolean
  onChange: () => void
  children: ReactNode
  className?: string
  value?: string
}) {
  return (
    <label className={clsx(
      'flex cursor-pointer items-start gap-3 rounded-control border p-3 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
      checked ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface hover:bg-surface-subtle', className,
    )}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-brand" {...rest} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  )
}

/** Step 4: full or part load, vehicle, capacity, temperature, handling, budget and help at the sites. */
export default function TransportStep({ draft, onChange, errors, vehicles, vehiclesLoading, assist, notes }: {
  draft: LoadDraft
  onChange: (patch: Partial<LoadDraft>) => void
  errors: StepErrors
  vehicles: VehicleClass[]
  vehiclesLoading?: boolean
  assist: AssistResult | null
  notes?: ReactNode
}) {
  const weight = itemTotals(draft.items).weight_kg
  const suggestedType: LoadType = assist?.suggested.load_type ?? localLoadType(weight)
  const perishable = hasPerishable(draft.items)
  const touch = (patch: Partial<LoadDraft>) => onChange({ ...patch, transport_touched: true })
  const suggestedCapacity = assist?.suggested.capacity_t

  return (
    <div className="space-y-4">
      <Card padded className="space-y-4 !p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Load type <span className="text-danger" aria-hidden="true">*</span></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['ftl', 'ptl'] as const).map(t => (
              <Radio key={t} name="load_type" checked={draft.load_type === t} onChange={() => touch({ load_type: t })} value={t}>
                <span className="font-medium text-text">{t === 'ftl' ? 'Full truck load (FTL)' : 'Part truck load (PTL)'}</span>
                {suggestedType === t && weight > 0 && <span className="ml-2 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Recommended</span>}
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
          <legend className="mb-2 text-sm font-medium text-text">Vehicle type <span className="text-danger" aria-hidden="true">*</span></legend>
          {vehiclesLoading ? (
            <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
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
        <Input
          label="Required capacity (tonnes)" required inputMode="decimal" value={draft.capacity_t} trailing="t"
          onChange={e => touch({ capacity_t: e.target.value.replace(/[^\d.]/g, '') })}
          error={errors.capacity_t}
          hint={suggestedCapacity ? `Suggested from your total weight: ${suggestedCapacity} t. You can change it.` : 'Suggested from your total weight. You can change it.'}
        />
      </Card>

      {perishable && (
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

      <Card padded className="space-y-4 !p-4">
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-text">Special handling</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SPECIAL.map(s => (
              <Checkbox
                key={s.id} label={s.label} checked={draft.special_handling.includes(s.id)}
                onChange={e => onChange({ special_handling: e.target.checked ? [...draft.special_handling, s.id] : draft.special_handling.filter(x => x !== s.id) })}
              />
            ))}
          </div>
        </fieldset>
      </Card>

      <Card padded className="space-y-3 !p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Who should quote?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Radio name="routing" value="open" checked={draft.routing !== 'chosen'} onChange={() => onChange({ routing: 'open' })}>
              <span className="font-medium text-text">Open to all companies serving this lane</span>
              <span className="block text-muted">Every company that runs between these cities can see your load.</span>
            </Radio>
            <Radio name="routing" value="chosen" checked={draft.routing === 'chosen'} onChange={() => onChange({ routing: 'chosen' })}>
              <span className="font-medium text-text">Choose companies</span>
              <span className="block text-muted">Only the companies you pick (up to 10) see your load.</span>
            </Radio>
          </div>
          {draft.routing === 'chosen' && (
            <div className="mt-3">
              <CompanyPicker
                pickupCity={draft.pickup_city} deliveryCity={draft.delivery_city}
                selected={draft.company_ids} onChange={ids => onChange({ company_ids: ids })}
              />
            </div>
          )}
          {errors.company_ids && <p className="mt-1 text-xs text-danger" role="alert">{errors.company_ids}</p>}
        </fieldset>
      </Card>

      <Card padded className="space-y-4 !p-4">
        {assist?.estimate && (
          <Alert tone="info" title={`${inr(assist.estimate.low)} – ${inr(assist.estimate.high)}`}>
            Estimated freight for this load ({Math.round(assist.estimate.distance_km).toLocaleString('en-IN')} km). {assist.estimate.label}
          </Alert>
        )}
        <Input
          label="Freight budget (₹)" inputMode="decimal" value={draft.budget_inr}
          onChange={e => onChange({ budget_inr: e.target.value.replace(/[^\d.]/g, '') })}
          hint="Optional. We compare it with the market estimate."
        />
        <Checkbox
          label="Request quotation"
          description="Logistic companies serving these cities quote you within 2 hours."
          checked={draft.quote_requested} onChange={e => onChange({ quote_requested: e.target.checked })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox
            label="Loading help needed" description="Labour at pickup. A surcharge may apply."
            checked={draft.loading_help} onChange={e => onChange({ loading_help: e.target.checked })}
          />
          <Checkbox
            label="Unloading help needed" description="Labour at delivery."
            checked={draft.unloading_help} onChange={e => onChange({ unloading_help: e.target.checked })}
          />
        </div>
      </Card>
    </div>
  )
}
