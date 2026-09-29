import clsx from 'clsx'
import { Input, Select } from '@/components/ui'
import { PRIORITIES, formatKg } from '../format'
import { CARGO_TYPES, chargeableKg, volumetricKg } from './payload'
import type { StepProps } from './stepProps'

const priorityOptions = PRIORITIES.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))
const toNumber = (value: string) => (value === '' ? 0 : Number(value))

export default function CargoStep({ data, update, errors }: StepProps) {
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
          label="Items"
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
