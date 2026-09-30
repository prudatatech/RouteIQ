import clsx from 'clsx'
import { Equal } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import type { DraftDrop } from '@/store/draftStore'
import { evenSplit } from '@/components/cargo/lots'
import { formatKg, formatRupees } from '@/utils/display'
import { declaredValueOf, draftDropsBalance, dropError } from './validation'
import type { StepProps } from './stepProps'

const n = (x: number) => x.toLocaleString('en-IN')

/**
 * The pieces split of a multi-drop booking: pieces per drop with a live balance against the
 * total, an even-split helper, and weight and value that follow pieces unless typed for a drop.
 */
export default function DropsSplit({ data, update, errors }: StepProps) {
  const drops = data.drops ?? []
  const total = Number(data.total_items) || 0
  const weight = Number(data.total_weight_kg) || 0
  const value = declaredValueOf(data)
  const balance = draftDropsBalance(data)
  const setDrop = (id: string, patch: Partial<DraftDrop>) => update({ drops: drops.map(d => (d.id === id ? { ...d, ...patch } : d)) })
  const spreadEvenly = () => {
    const parts = evenSplit(total, drops.length)
    update({ drops: drops.map((d, i) => ({ ...d, pieces: String(parts[i] ?? 0) })) })
  }
  const followAll = () => update({ drops: drops.map(d => ({ ...d, weight_kg: '', declared_value: '' })) })
  const anyTyped = balance.rows.some(r => r.weightTyped || r.valueTyped)

  if (drops.length < 2) {
    return <p className="text-sm text-muted">Add at least two drops on the Trip step to split the pieces between them.</p>
  }

  const left = balance.left
  return (
    <fieldset className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-sm font-medium text-text">Pieces per drop</legend>
        <div className="flex flex-wrap gap-2">
          {anyTyped && <Button size="sm" variant="ghost" onClick={followAll}>Weights and values by pieces</Button>}
          <Button size="sm" variant="secondary" icon={<Equal size={14} />} onClick={spreadEvenly} disabled={total < drops.length}>Split evenly</Button>
        </div>
      </div>
      <p className="text-xs text-muted">Weight and value follow the pieces. Type one for a drop to set it; the rest is shared by pieces.</p>

      <ol className="space-y-3">
        {drops.map((d, i) => {
          const figures = balance.rows[i]
          return (
            <li key={d.id} className="space-y-3 rounded-control border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">Drop {i + 1}{d.consignee_name ? `: ${d.consignee_name}` : ''}</p>
                <p className="truncate text-xs text-muted">{d.address || 'No address yet'}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Input
                  label="Pieces"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  required
                  value={d.pieces}
                  onChange={e => setDrop(d.id, { pieces: e.target.value })}
                  error={dropError(errors, d.id, 'pieces')}
                />
                <Input
                  label="Weight"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  trailing="kg"
                  value={d.weight_kg}
                  placeholder={figures ? String(figures.weight_kg) : undefined}
                  onChange={e => setDrop(d.id, { weight_kg: e.target.value })}
                  error={dropError(errors, d.id, 'weight_kg')}
                  hint={figures && !figures.weightTyped ? 'By pieces' : 'Typed'}
                />
                <Input
                  label="Value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  leading="₹"
                  value={d.declared_value}
                  placeholder={figures?.declared_value != null ? String(figures.declared_value) : undefined}
                  onChange={e => setDrop(d.id, { declared_value: e.target.value })}
                  error={dropError(errors, d.id, 'declared_value')}
                  hint={value == null && !d.declared_value ? 'Optional' : figures && !figures.valueTyped ? 'By pieces' : 'Typed'}
                  className="col-span-2 sm:col-span-1"
                />
              </div>
            </li>
          )
        })}
      </ol>

      <div
        aria-live="polite"
        className={clsx(
          'rounded-control border px-4 py-3 text-sm',
          balance.balanced ? 'border-border bg-surface-subtle' : 'border-warning bg-warning-soft',
        )}
      >
        <dl className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted">Pieces</dt>
            <dd className="tabular text-text">{n(balance.allocated)} of {n(total)}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted">Weight</dt>
            <dd className="tabular text-text">{formatKg(balance.rows.reduce((a, r) => a + r.weight_kg, 0))} of {formatKg(weight)}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted">Value</dt>
            <dd className="tabular text-text">{value != null ? `${formatRupees(balance.rows.reduce((a, r) => a + (r.declared_value ?? 0), 0))} of ${formatRupees(value)}` : 'Not declared'}</dd>
          </div>
        </dl>
        <p className={clsx('mt-2', balance.balanced ? 'text-success' : 'text-warning')}>
          {balance.balanced
            ? `Balanced: ${n(drops.length)} lots, every piece has a drop.`
            : left > 0 ? `${n(left)} ${left === 1 ? 'piece' : 'pieces'} left to give to a drop.` : left < 0 ? `${n(-left)} too many: take them off a drop.` : balance.problems[0]}
        </p>
        {errors.drops_split && !balance.balanced && <p className="mt-1 text-xs text-danger" role="alert">{errors.drops_split}</p>}
      </div>
    </fieldset>
  )
}
