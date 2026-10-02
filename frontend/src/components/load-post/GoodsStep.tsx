import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Alert, Button, Card } from '@/components/ui'
import type { ProductRow } from '@/types/load'
import ProductCard from './ProductCard'
import { ewayLocal, inr, itemTotals, kgText, MAX_ITEMS, EWAY_THRESHOLD_INR } from './logic'
import type { StepErrors } from './validate'

/** The live totals under the product list: weight, value, and one line on whether an e-Way Bill is needed. */
export function ProductTotals({ items }: { items: ProductRow[] }) {
  const totals = itemTotals(items)
  const eway = ewayLocal(items)
  const reason = eway.hazmat && eway.declared_value <= EWAY_THRESHOLD_INR ? 'hazardous goods' : `value above ${inr(EWAY_THRESHOLD_INR)}`
  return (
    <Card padded className="!p-4" aria-label="Totals">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-muted">Total weight</dt><dd className="text-lg font-semibold tabular text-text" data-testid="total-weight">{kgText(totals.weight_kg)}</dd></div>
        <div><dt className="text-xs text-muted">Total declared value</dt><dd className="text-lg font-semibold tabular text-text" data-testid="total-value">{inr(totals.declared_value)}</dd></div>
      </dl>
      <p className={eway.required ? 'mt-2 text-sm font-medium text-warning' : 'mt-2 text-sm text-muted'} aria-live="polite" data-testid="eway-required">
        {eway.required ? `e-Way Bill needed (${reason})` : `No e-Way Bill needed (value up to ${inr(EWAY_THRESHOLD_INR)})`}
      </p>
    </Card>
  )
}

/** Step 2, Goods: one card per product (search with HSN and GST, quantity, weight, value, handling), then the totals. */
export default function GoodsStep({ items, onChangeRow, onAdd, onRemove, errors, notes, bulkHint }: {
  items: ProductRow[]
  onChangeRow: (index: number, patch: Partial<ProductRow>) => void
  onAdd: () => void
  onRemove: (index: number) => void
  errors: StepErrors
  /** The server's suggestions for this step (HSN, rate, value, permit). */
  notes?: ReactNode
  /** The server's bulk-template recommendation, when it came. Falls back to the plain hint at 3 or more products. */
  bulkHint?: string | null
}) {
  return (
    <div className="space-y-4">
      {items.map((row, i) => (
        <ProductCard key={row.key} row={row} index={i} errors={errors} onChange={p => onChangeRow(i, p)} onRemove={i > 0 ? () => onRemove(i) : undefined} />
      ))}
      {errors.items && <p className="text-sm text-danger" role="alert">{errors.items}</p>}
      <Button variant="secondary" icon={<Plus size={16} />} onClick={onAdd} disabled={items.length >= MAX_ITEMS}>Add another product</Button>
      <ProductTotals items={items} />
      {notes}
      {(items.length >= 3 || bulkHint) && (
        <Alert tone="info">{bulkHint ?? 'You can download a template to fill in bulk and upload. It saves time for repeat loads.'}</Alert>
      )}
    </div>
  )
}
