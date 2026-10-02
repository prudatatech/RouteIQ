import { Pencil, X } from 'lucide-react'
import { Button, Card, IconButton } from '@/components/ui'
import type { ProductRow } from '@/types/load'
import { inr, kgText, toNum } from './logic'

/** A finished product as one line: "2. Basmati rice · HSN 1006 · 5% · 20 bags · 1,000 kg · ₹40,000", with Edit and Remove. */
export default function ProductSummaryRow({ row, index, onEdit, onRemove }: {
  row: ProductRow
  index: number
  onEdit: () => void
  onRemove?: () => void
}) {
  const n = index + 1
  const parts = [
    row.product_name.trim(), `HSN ${row.hsn_code}`, row.gst_rate === null ? null : `${row.gst_rate}%`,
    `${row.quantity} ${row.unit}`, kgText(toNum(row.weight_kg)), toNum(row.declared_value) > 0 ? inr(toNum(row.declared_value)) : null,
  ].filter(Boolean)
  return (
    <Card className="flex scroll-mt-24 items-center gap-2 !px-3 !py-2" role="group" aria-label={`Product ${n}`}>
      <p className="min-w-0 flex-1 break-words text-sm text-text" data-testid={`product-summary-${index}`}>
        <span className="font-semibold">{n}.</span> {parts.join(' · ')}
      </p>
      <Button variant="ghost" size="sm" icon={<Pencil size={14} />} onClick={onEdit} aria-label={`Edit product ${n}`}>Edit</Button>
      {onRemove && <IconButton label={`Remove product ${n}`} icon={<X size={16} />} onClick={onRemove} />}
    </Card>
  )
}
