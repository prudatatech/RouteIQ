import { useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { IconButton, controlClasses } from '@/components/ui'
import { formatRupees } from '@/utils/display'
import { lineTotal, type DraftItem } from './items'

export interface ItemRow extends DraftItem {
  key: string
  total: number
}

const cell = `${controlClasses} h-9 border-border-strong !px-2`

/**
 * Parts replaced and repairs done: a compact table (item, qty, unit cost, total) with a quick-add
 * row under it. Type an item, press Enter, and it is added. Used while logging a service, and on
 * saved records where adding or removing an item updates the record's cost.
 */
export function ItemsTable({ rows, onAdd, onRemove, readOnly = false, busy = false }: {
  rows: ItemRow[]
  onAdd: (item: DraftItem) => void | Promise<void>
  onRemove: (key: string) => void
  readOnly?: boolean
  busy?: boolean
}) {
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<DraftItem['kind']>('part')
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState('')
  const [error, setError] = useState('')
  const descriptionRef = useRef<HTMLInputElement>(null)

  const quantity = Number(qty)
  const unitCost = unit.trim() === '' ? 0 : Number(unit)
  const draftTotal = Number.isFinite(quantity) && Number.isFinite(unitCost) ? lineTotal({ quantity, unit_cost: unitCost }) : 0

  const submit = async () => {
    if (!description.trim()) { setError('Enter the part or repair.'); return }
    if (!Number.isFinite(quantity) || quantity <= 0) { setError('Quantity must be more than 0.'); return }
    if (!Number.isFinite(unitCost) || unitCost < 0) { setError('Enter the cost of one, in rupees.'); return }
    setError('')
    await onAdd({ description: description.trim(), kind, quantity, unit_cost: unitCost })
    setDescription('')
    setQty('1')
    setUnit('')
    descriptionRef.current?.focus()
  }
  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void submit() }
  }
  const sum = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-control border border-border">
        <table className="w-full min-w-[26rem] text-sm">
          <thead className="bg-surface-subtle text-left text-xs font-medium text-muted">
            <tr>
              <th scope="col" className="px-2 py-1.5">Item</th>
              <th scope="col" className="w-16 px-2 py-1.5 text-right">Qty</th>
              <th scope="col" className="w-24 px-2 py-1.5 text-right">Unit cost</th>
              <th scope="col" className="w-24 px-2 py-1.5 text-right">Total</th>
              {!readOnly && <th scope="col" className="w-10 px-1 py-1.5"><span className="sr-only">Remove</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.key}>
                <td className="max-w-[14rem] break-words px-2 py-1.5 text-text">
                  {r.description}
                  {r.kind === 'repair' && <span className="ml-1.5 rounded bg-neutral-soft px-1.5 py-0.5 text-xs text-muted">Repair</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular text-text">{r.quantity}</td>
                <td className="px-2 py-1.5 text-right tabular text-text">{formatRupees(r.unit_cost)}</td>
                <td className="px-2 py-1.5 text-right tabular font-medium text-text">{formatRupees(r.total)}</td>
                {!readOnly && (
                  <td className="px-1 py-1 text-right">
                    <IconButton label={`Remove ${r.description}`} size="sm" icon={<Trash2 size={16} />} disabled={busy} onClick={() => onRemove(r.key)} />
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={readOnly ? 4 : 5} className="px-2 py-2 text-muted">No parts or repairs added.</td></tr>
            )}
            {!readOnly && (
              <tr className="bg-surface-subtle/50">
                <td className="px-2 py-1.5">
                  <div className="flex gap-1.5">
                    <select
                      aria-label="Part or repair"
                      value={kind}
                      onChange={e => setKind(e.target.value as DraftItem['kind'])}
                      className={`${controlClasses} h-9 !w-auto border-border-strong !px-1.5`}
                    >
                      <option value="part">Part</option>
                      <option value="repair">Repair</option>
                    </select>
                    <input
                      ref={descriptionRef}
                      aria-label="Item"
                      className={cell}
                      placeholder="e.g. Brake pads"
                      maxLength={120}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      onKeyDown={onEnter}
                    />
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <input aria-label="Quantity" className={`${cell} text-right`} type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={e => setQty(e.target.value)} onKeyDown={onEnter} />
                </td>
                <td className="px-2 py-1.5">
                  <input aria-label="Unit cost" className={`${cell} text-right`} type="number" inputMode="decimal" min={0} step="any" placeholder="₹" value={unit} onChange={e => setUnit(e.target.value)} onKeyDown={onEnter} />
                </td>
                <td className="px-2 py-1.5 text-right tabular text-muted">{draftTotal > 0 ? formatRupees(draftTotal) : '—'}</td>
                <td className="px-1 py-1 text-right">
                  <IconButton label="Add item" size="sm" variant="secondary" icon={<Plus size={16} />} disabled={busy} onClick={() => void submit()} />
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={3} className="px-2 py-1.5 text-right text-xs text-muted">Parts and repairs</td>
                <td className="px-2 py-1.5 text-right tabular font-semibold text-text">{formatRupees(sum)}</td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  )
}
