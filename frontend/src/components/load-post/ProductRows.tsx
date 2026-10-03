import { Plus, X } from 'lucide-react'
import { Alert, Button, Card, Checkbox, IconButton, Input, Select } from '@/components/ui'
import type { ProductHandling, ProductRow } from '@/types/load'
import HsnSearch from './HsnSearch'
import { EWAY_THRESHOLD_INR, ewayLocal, inr, itemTotals, kgText, MAX_ITEMS, UNITS } from './logic'
import type { StepErrors } from './validate'

const HANDLING: { id: ProductHandling; label: string }[] = [
  { id: 'fragile', label: 'Fragile' },
  { id: 'temperature_controlled', label: 'Temperature-controlled' },
  { id: 'hazmat', label: 'Hazardous (hazmat)' },
]

/** The live totals under the product list: weight, value and whether an e-Way Bill is needed. */
export function ProductTotals({ items }: { items: ProductRow[] }) {
  const totals = itemTotals(items)
  const eway = ewayLocal(items)
  return (
    <Card padded className="space-y-2 !p-4" aria-label="Totals">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><dt className="text-xs text-muted">Total weight</dt><dd className="text-lg font-semibold tabular text-text" data-testid="total-weight">{kgText(totals.weight_kg)}</dd></div>
        <div><dt className="text-xs text-muted">Total declared value</dt><dd className="text-lg font-semibold tabular text-text" data-testid="total-value">{inr(totals.declared_value)}</dd></div>
        <div><dt className="text-xs text-muted">e-Way Bill required</dt><dd className="text-lg font-semibold text-text" data-testid="eway-required">{eway.required ? 'Yes' : 'No'}</dd></div>
      </dl>
      <p className={eway.required ? 'text-sm font-medium text-warning' : 'text-sm text-muted'} aria-live="polite" data-testid="eway-counter">
        Current declared value: {inr(eway.declared_value)}
        {eway.declared_value > EWAY_THRESHOLD_INR && ' — e-Way Bill will be required'}
        {eway.hazmat && eway.declared_value <= EWAY_THRESHOLD_INR && ' — hazardous goods need an e-Way Bill at any value'}
      </p>
    </Card>
  )
}

/** Step 2: one row per product, with HSN, rate, quantity, weight, value and handling. */
export default function ProductRows({ items, onChangeRow, onAdd, onRemove, errors, bulkHint }: {
  items: ProductRow[]
  onChangeRow: (index: number, patch: Partial<ProductRow>) => void
  onAdd: () => void
  onRemove: (index: number) => void
  errors: StepErrors
  /** The server's bulk-template recommendation, when it came. Falls back to the plain hint at 3 or more products. */
  bulkHint?: string | null
}) {
  return (
    <div className="space-y-4">
      {items.map((row, i) => (
        <Card key={row.key} padded className="space-y-4 !p-4" role="group" aria-label={`Product ${i + 1}`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Product {i + 1}</h3>
            {i > 0 && (
              <IconButton label={`Remove product ${i + 1}`} icon={<X size={16} />} onClick={() => onRemove(i)} />
            )}
          </div>
          <HsnSearch
            row={row}
            index={i}
            label="Product name"
            onChange={patch => onChangeRow(i, patch)}
            errors={{ name: errors[`product_name_${i}`], hsn: errors[`hsn_code_${i}`], rate: errors[`gst_rate_${i}`] }}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input
              label="Quantity" required inputMode="decimal" value={row.quantity}
              onChange={e => onChangeRow(i, { quantity: e.target.value.replace(/[^\d.]/g, '') })}
              error={errors[`quantity_${i}`]} name={`quantity_${i}`}
            />
            <Select
              label="Unit" value={row.unit} onChange={e => onChangeRow(i, { unit: e.target.value })}
              options={UNITS.map(u => ({ value: u, label: u }))}
            />
            <Input
              label="Weight (kg)" required inputMode="decimal" value={row.weight_kg}
              onChange={e => onChangeRow(i, { weight_kg: e.target.value.replace(/[^\d.]/g, '') })}
              error={errors[`weight_kg_${i}`]} name={`weight_kg_${i}`}
            />
            <Input
              label="Declared value (₹)" inputMode="decimal" value={row.declared_value}
              onChange={e => onChangeRow(i, { declared_value: e.target.value.replace(/[^\d.]/g, '') })}
              hint="Optional, but it gives a better quote and e-Way Bill." name={`declared_value_${i}`}
            />
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-text">Special handling</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {HANDLING.map(h => (
                <Checkbox
                  key={h.id}
                  label={h.label}
                  checked={row.handling.includes(h.id)}
                  onChange={e => onChangeRow(i, { handling: e.target.checked ? [...row.handling, h.id] : row.handling.filter(x => x !== h.id) })}
                />
              ))}
            </div>
          </fieldset>
        </Card>
      ))}

      {errors.items && <p className="text-sm text-danger" role="alert">{errors.items}</p>}
      <Button variant="secondary" icon={<Plus size={16} />} onClick={onAdd} disabled={items.length >= MAX_ITEMS}>Add another product</Button>

      <ProductTotals items={items} />

      {(items.length >= 3 || bulkHint) && (
        <Alert tone="info">{bulkHint ?? 'You can download a template to fill in bulk and upload — saves time for repeat loads.'}</Alert>
      )}
    </div>
  )
}
