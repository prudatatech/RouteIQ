import { useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import clsx from 'clsx'
import { Alert, Card, Checkbox, IconButton, Input, Select } from '@/components/ui'
import type { ProductHandling, ProductRow } from '@/types/load'
import type { ProductNote } from './helpers'
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
export default function ProductCard({ row, index, onChange, onRemove, onActivate, errors, notes = [] }: {
  row: ProductRow
  index: number
  onChange: (patch: Partial<ProductRow>) => void
  onRemove?: () => void
  /** Focus moved into this card: it is the one being edited, so it stays open. */
  onActivate?: () => void
  errors: StepErrors
  /** The server's notes about this product (several GST rates, an HSN suggestion), shown beside it. */
  notes?: ProductNote[]
}) {
  const i = index
  const qty = useRef<HTMLInputElement>(null)
  // Handling stays folded away until the person opens it, or a flag is set (by the search or earlier).
  const [handlingOpen, setHandlingOpen] = useState(false)
  if (row.handling.length > 0 && !handlingOpen) setHandlingOpen(true)
  const weightFromQty = row.unit === 'kg' || row.unit === 'tonnes'
  return (
    <Card padded className="scroll-mt-24 space-y-3 !p-4" role="group" aria-label={`Product ${i + 1}`} onFocus={onActivate}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Product {i + 1}</h3>
        {onRemove && <IconButton label={`Remove product ${i + 1}`} icon={<X size={16} />} onClick={onRemove} />}
      </div>
      <HsnSearch
        row={row} index={i} onPicked={() => qty.current?.focus()} label={i === 0 ? 'Describe your goods' : `Product ${i + 1} name`} onChange={onChange}
        errors={{ name: errors[`product_name_${i}`], hsn: errors[`hsn_code_${i}`], rate: errors[`gst_rate_${i}`] }}
      />
      {notes.length > 0 && (
        <div className="space-y-2" data-testid={`product-notes-${i}`}>
          {notes.map(n => <Alert key={n.key} tone={n.severity === 'warn' ? 'warning' : 'info'}>{n.message}</Alert>)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input
          ref={qty} label="Quantity" required inputMode="decimal" value={row.quantity}
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
          hint="Optional. Helps the quote." name={`declared_value_${i}`}
        />
      </div>
      <div>
        <button
          type="button" onClick={() => setHandlingOpen(o => !o)} aria-expanded={handlingOpen} aria-controls={`handling-${row.key}`}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
            row.handling.length > 0 ? 'border-brand bg-brand-soft text-brand' : 'border-border-strong text-muted hover:text-text',
          )}
        >
          <SlidersHorizontal size={12} aria-hidden="true" /> Handling{row.handling.length > 0 ? ` (${row.handling.length})` : ''}
        </button>
        {handlingOpen && (
          <fieldset id={`handling-${row.key}`} className="mt-2">
            <legend className="sr-only">Handling for this product</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {HANDLING.map(h => (
                <Checkbox
                  key={h.id} label={h.label} checked={row.handling.includes(h.id)}
                  onChange={e => onChange({ handling: e.target.checked ? [...row.handling, h.id] : row.handling.filter(x => x !== h.id) })}
                />
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Card>
  )
}
