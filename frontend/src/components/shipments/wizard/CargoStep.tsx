import clsx from 'clsx'
import { Input, Select } from '@/components/ui'
import { PRIORITIES } from '../format'
import { CARGO_TYPES, chargeableKg, finalDropOf, volumetricKg } from './payload'
import DropsSplit from './DropsSplit'
import type { StepProps } from './stepProps'
import { PriceSuggestion } from '@/components/pricing/PriceSuggestion'
import { usePriceQuote } from '@/components/pricing/usePriceQuote'
import { formatKg } from '@/utils/display'

const priorityOptions = PRIORITIES.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))
const toNumber = (value: string) => (value === '' ? 0 : Number(value))

export default function CargoStep({ data, update, errors }: StepProps) {
  const weight = chargeableKg(data)
  const final = finalDropOf(data)
  const quote = usePriceQuote(data.origin_lat && data.origin_lng && final && weight > 0
    ? {
      pickup: { lat: data.origin_lat, lng: data.origin_lng, label: data.origin_name || null },
      drop: { lat: final.lat, lng: final.lng, label: final.name || null },
      weight_kg: weight,
      source: 'api',
    }
    : null)

  const numberField = (key: 'length_cm' | 'width_cm' | 'height_cm', label: string) => (
    <Input
      label={label}
      type="number"
      inputMode="decimal"
      min={0}
      required
      trailing="cm"
      value={data[key] || ''}
      error={errors[key]}
      onChange={e => update({ [key]: toNumber(e.target.value) })}
    />
  )

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Cargo type</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {CARGO_TYPES.map(type => {
            const selected = data.cargo_type === type.id
            return (
              <label
                key={type.id}
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors',
                  selected ? 'border-brand bg-brand-soft' : 'border-border-strong hover:bg-surface-subtle',
                )}
              >
                <input
                  type="radio"
                  name="cargo_type"
                  value={type.id}
                  checked={selected}
                  onChange={() => update({ cargo_type: type.id })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                />
                <span className="text-sm">
                  <span className="block font-medium text-text">{type.name}</span>
                  <span className="block text-muted">{type.description}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Pieces"
          type="number"
          inputMode="numeric"
          min={1}
          required
          value={data.total_items || ''}
          error={errors.total_items}
          onChange={e => update({ total_items: toNumber(e.target.value) })}
        />
        <Input
          label="Total weight"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.1"
          required
          trailing="kg"
          value={data.total_weight_kg || ''}
          error={errors.total_weight_kg}
          onChange={e => update({ total_weight_kg: toNumber(e.target.value) })}
        />
        <Select label="Priority" value={data.priority} onChange={e => update({ priority: e.target.value })} options={priorityOptions} />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Size of one package</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {numberField('length_cm', 'Length')}
          {numberField('width_cm', 'Width')}
          {numberField('height_cm', 'Height')}
        </div>
      </fieldset>

      <Input
        className="sm:max-w-xs"
        label="Declared value (₹)"
        type="number"
        inputMode="decimal"
        min={0}
        step="1"
        leading="₹"
        value={data.declared_value ?? ''}
        error={errors.declared_value}
        hint={data.multi_drop ? 'Optional. Shared across the drops by pieces unless you set a drop’s value below.' : 'Optional. The value of the goods, for the e-way bill and claims.'}
        onChange={e => update({ declared_value: e.target.value })}
      />

      {data.multi_drop && <DropsSplit data={data} update={update} errors={errors} />}

      <Input
        className="sm:max-w-xs"
        label="Price (₹)"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        leading="₹"
        value={data.freight_charge ?? ''}
        error={errors.freight_charge}
        hint="Optional. What the customer is charged, before GST. It is used for the invoice when no vendor bid is accepted."
        onChange={e => update({ freight_charge: e.target.value })}
      />
      <PriceSuggestion
        query={quote}
        idle="Choose the pickup, destination and weight to see a suggested price."
        useLabel="Use suggested price"
        onUse={q => update({ freight_charge: String(Math.round(q.suggested)) })}
      />

      <div className="rounded-control border border-border bg-surface-subtle px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted">Chargeable weight</span>
          <span className="font-medium tabular text-text">{formatKg(chargeableKg(data))}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          The larger of the actual weight ({formatKg(Number(data.total_weight_kg) || 0)}) and the volumetric weight
          ({formatKg(volumetricKg(data) || 0)}, length × width × height ÷ 5,000).
        </p>
      </div>
    </div>
  )
}
