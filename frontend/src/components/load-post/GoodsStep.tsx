import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Alert, Button, Card } from '@/components/ui'
import type { ProductRow } from '@/types/load'
import ProductCard from './ProductCard'
import ProductSummaryRow from './ProductSummaryRow'
import { productComplete } from './helpers'
import { scrollElementIntoView } from './useScrollIntoView'
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

const ROW_ERROR = /^(product_name|hsn_code|gst_rate|quantity|weight_kg)_(\d+)$/

/**
 * Step 2, Goods: one card per product (search with HSN and GST, quantity, weight, value, handling), then the totals.
 * Only the product being edited is open; a finished one folds into a one-line summary. A product that is not finished
 * yet, or has an error, stays open.
 */
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
  const root = useRef<HTMLDivElement>(null)
  const [chosen, setChosen] = useState<string | null>(() => (items.find(r => !productComplete(r)) ?? items[0]).key)
  const [seenCount, setSeenCount] = useState(items.length)
  const wantFocus = useRef(false)
  // A new row becomes the one being edited.
  if (items.length !== seenCount) {
    setSeenCount(items.length)
    if (items.length > seenCount) setChosen(items[items.length - 1].key)
  }
  const activeKey = items.some(r => r.key === chosen) ? chosen : (items.find(r => !productComplete(r)) ?? items[0]).key
  const rowsWithErrors = new Set(Object.keys(errors).map(k => ROW_ERROR.exec(k)?.[2]).filter((n): n is string => n !== undefined).map(Number))

  const add = () => { wantFocus.current = true; onAdd() }
  useEffect(() => {
    if (!wantFocus.current || !root.current) return
    wantFocus.current = false
    const box = root.current.querySelector<HTMLInputElement>(`input[name="product_name_${items.length - 1}"]`)
    if (!box) return
    box.focus({ preventScroll: true })
    const card = box.closest<HTMLElement>('[role="group"]')
    if (card) scrollElementIntoView(card)
  }, [items.length])

  return (
    <div className="space-y-3" ref={root}>
      {items.map((row, i) => (
        productComplete(row) && row.key !== activeKey && !rowsWithErrors.has(i)
          ? <ProductSummaryRow key={row.key} row={row} index={i} onEdit={() => setChosen(row.key)} onRemove={i > 0 ? () => onRemove(i) : undefined} />
          : <ProductCard key={row.key} row={row} index={i} errors={errors} onActivate={() => setChosen(row.key)} onChange={p => onChangeRow(i, p)} onRemove={i > 0 ? () => onRemove(i) : undefined} />
      ))}
      {errors.items && <p className="text-sm text-danger" role="alert">{errors.items}</p>}
      <Button variant="secondary" icon={<Plus size={16} />} onClick={add} disabled={items.length >= MAX_ITEMS}>Add another product</Button>
      <ProductTotals items={items} />
      {notes}
      {(items.length >= 3 || bulkHint) && (
        <Alert tone="info">{bulkHint ?? 'You can download a template to fill in bulk and upload. It saves time for repeat loads.'}</Alert>
      )}
    </div>
  )
}
