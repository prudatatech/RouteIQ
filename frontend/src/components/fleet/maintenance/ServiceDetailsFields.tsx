import { ChevronRight } from 'lucide-react'
import { Input, Textarea } from '@/components/ui'
import { AttachmentPicker } from './AttachmentPicker'
import { ItemsTable } from './ItemsTable'
import { lineTotal } from './items'
import { detailsTotal, type ServiceDetails } from './serviceDetails'

let itemSeq = 0

const summaryClasses = 'flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-text [&::-webkit-details-marker]:hidden'

export function ServiceDetailsFields({ vehicleId, value, onChange }: {
  vehicleId: string
  value: ServiceDetails
  onChange: (next: ServiceDetails) => void
}) {
  const set = (patch: Partial<ServiceDetails>) => onChange({ ...value, ...patch })
  const derived = value.items.length > 0 || value.labour.trim() !== ''
  const total = detailsTotal(value)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Total cost"
          type="number"
          inputMode="decimal"
          min={0}
          leading="₹"
          value={derived ? (total ?? '') : value.cost}
          onChange={e => set({ cost: e.target.value })}
          disabled={derived}
          hint={derived ? 'Parts and labour added up' : 'Optional. It is added to expenses as maintenance.'}
        />
        <Input label="Workshop" value={value.workshop} onChange={e => set({ workshop: e.target.value })} maxLength={120} hint="Optional, name or place" />
      </div>

      <details className="group rounded-control border border-border px-3 py-2" open={value.items.length > 0}>
        <summary className={summaryClasses}>
          <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open:rotate-90" />
          Parts and repairs
          {value.items.length > 0 && <span className="font-normal text-muted">({value.items.length})</span>}
        </summary>
        <div className="mt-2">
          <ItemsTable
            rows={value.items.map(i => ({ ...i, total: lineTotal(i) }))}
            onAdd={item => set({ items: [...value.items, { ...item, key: `new-${++itemSeq}` }] })}
            onRemove={key => set({ items: value.items.filter(i => i.key !== key) })}
          />
        </div>
      </details>

      <AttachmentPicker vehicleId={vehicleId} value={value.attachments} onChange={attachments => set({ attachments })} />

      <details className="group">
        <summary className={summaryClasses}>
          <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open:rotate-90" />
          More details
        </summary>
        <div className="mt-3 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Labour cost" type="number" inputMode="decimal" min={0} leading="₹" value={value.labour} onChange={e => set({ labour: e.target.value })} hint="Added to the parts total" />
            <Input label="Invoice number" value={value.invoice} onChange={e => set({ invoice: e.target.value })} maxLength={60} />
          </div>
          <Textarea label="Note" value={value.note} onChange={e => set({ note: e.target.value })} maxLength={500} />
        </div>
      </details>
    </div>
  )
}
