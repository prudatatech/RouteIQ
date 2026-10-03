import { Pencil, X } from 'lucide-react'
import { Button, Card, IconButton } from '@/components/ui'
import type { ProductRow } from '@/types/load'
import type { ProductNote } from './helpers'
import { inr, kgText, toNum } from './logic'

/** A finished product as one line: "2. Basmati rice · HSN 1006 · 5% · 20 bags · 1,000 kg · ₹40,000", with Edit and Remove. */
export default function ProductSummaryRow({ row, index, onEdit, onRemove, notes = [] }: {
  row: ProductRow
  index: number
  onEdit: () => void
  onRemove?: () => void
  notes?: ProductNote[]
}) {
  const n = index + 1
  const parts = [
    row.product_name.trim(), `HSN ${row.hsn_code}`, row.gst_rate === null ? null : `${row.gst_rate}%`,
    `${row.quantity} ${row.unit}`, kgText(toNum(row.weight_kg)), toNum(row.declared_value) > 0 ? inr(toNum(row.declared_value)) : null,
  ].filter(Boolean)
  return (
    <Card className="scroll-mt-24 !px-3 !py-2" role="group" aria-label={`Product ${n}`}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 break-words text-sm text-text" data-testid={`product-summary-${index}`}>
          <span className="font-semibold">{n}.</span> {parts.join(' · ')}
        </p>
        <Button variant="ghost" size="sm" icon={<Pencil size={14} />} onClick={onEdit} aria-label={`Edit product ${n}`}>Edit</Button>
        {onRemove && <IconButton label={`Remove product ${n}`} icon={<X size={16} />} onClick={onRemove} />}
      </div>
      {notes.map(note => <p key={note.key} className="mt-1 text-xs text-muted" data-testid={`product-note-${index}`}>{note.message}</p>)}
    </Card>
  )
}
