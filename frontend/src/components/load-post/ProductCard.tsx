import { X } from 'lucide-react'
import { Card, Checkbox, IconButton, Input, Select } from '@/components/ui'
import type { ProductHandling, ProductRow } from '@/types/load'
import HsnSearch from './HsnSearch'
import { UNITS } from './logic'
import type { StepErrors } from './validate'

const HANDLING: { id: ProductHandling; label: string }[] = [
  { id: 'fragile', label: 'Fragile' },
  { id: 'temperature_controlled', label: 'Temperature-controlled' },
  { id: 'hazmat', label: 'Hazardous (hazmat)' },
]

const num = (v: string) => v.replace(/[^\d.]/g, '')

/** One product: the search that fills HSN and GST, then quantity, unit, weight, declared value and its own handling. */
export default function ProductCard({ row, index, onChange, onRemove, errors }: {
  row: ProductRow
  index: number
  onChange: (patch: Partial<ProductRow>) => void
  onRemove?: () => void
  errors: StepErrors
}) {
  const i = index
  const weightFromQty = row.unit === 'kg' || row.unit === 'tonnes'
  return (
    <Card padded className="space-y-4 !p-4" role="group" aria-label={`Product ${i + 1}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Product {i + 1}</h3>
        {onRemove && <IconButton label={`Remove product ${i + 1}`} icon={<X size={16} />} onClick={onRemove} />}
      </div>
      <HsnSearch
        row={row} index={i} label={i === 0 ? 'Describe your goods' : `Product ${i + 1} name`} onChange={onChange}
        errors={{ name: errors[`product_name_${i}`], hsn: errors[`hsn_code_${i}`], rate: errors[`gst_rate_${i}`] }}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input
          label="Quantity" required inputMode="decimal" value={row.quantity}
          onChange={e => onChange({ quantity: num(e.target.value) })}
          error={errors[`quantity_${i}`]} name={`quantity_${i}`}
        />
        <Select label="Unit" value={row.unit} onChange={e => onChange({ unit: e.target.value })} options={UNITS.map(u => ({ value: u, label: u }))} />
        <Input
          label="Weight (kg)" required inputMode="decimal" value={row.weight_kg}
          onChange={e => onChange({ weight_kg: num(e.target.value) })}
          error={errors[`weight_kg_${i}`]} name={`weight_kg_${i}`}
          hint={weightFromQty ? 'Filled from the quantity. You can change it.' : undefined}
        />
        <Input
          label="Declared value (₹)" inputMode="decimal" value={row.declared_value}
          onChange={e => onChange({ declared_value: num(e.target.value) })}
          hint="Optional, but it gives a better quote and e-Way Bill." name={`declared_value_${i}`}
        />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-text">Handling for this product</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {HANDLING.map(h => (
            <Checkbox
              key={h.id} label={h.label} checked={row.handling.includes(h.id)}
              onChange={e => onChange({ handling: e.target.checked ? [...row.handling, h.id] : row.handling.filter(x => x !== h.id) })}
            />
          ))}
        </div>
      </fieldset>
    </Card>
  )
}
