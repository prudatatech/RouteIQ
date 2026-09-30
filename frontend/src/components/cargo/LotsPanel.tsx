/**
 * The Lots panel of a shipment or vendor load (GET /cargo/lots/:ref): the master and a tree of its
 * lots with status, holder, pieces, drop, consignee and open cases, the rolled-up progress, and the
 * Split and Merge actions. On a lot it links back to the master.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { AlertTriangle, ArrowUpLeft, Combine, FileText, MapPin, Split, User } from 'lucide-react'
import { Alert, Button, ErrorState, Input, Skeleton, StatusPill, toneClasses, useConfirm } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { cargoKeys, lotsAPI, type CargoRef, type Lot, type LotTotals, type LotsView, type WhereIsIt } from '@/services/cargo'
import { consignmentHref } from './logic'
import { accountedPieces, canSplit, heldPieces, lotKey, lotPlace, mergeCheck, progressSegments, roundTo, type SplitAvailable } from './lots'
import SplitLotsModal from './SplitLotsModal'

const n = (x: number) => x.toLocaleString('en-IN')

const fill: Record<string, string> = {
  success: toneClasses.success.dot, info: toneClasses.info.dot, brand: toneClasses.brand.dot, neutral: toneClasses.neutral.dot, danger: toneClasses.danger.dot,
}

/** The backend's "60 of 100 delivered · 25 at Patna hub · 15 on HR55AB1234" with a stacked bar. Colour is never the only cue. */
export function LotsProgress({ totals, className }: { totals: LotTotals; className?: string }) {
  const segments = progressSegments(totals)
  const base = Math.max(totals.pieces_total ?? 0, segments.reduce((a, s) => a + s.value, 0), 1)
  return (
    <div className={clsx('space-y-2', className)}>
      <p className="text-sm text-text">{totals.progress_text || 'No pieces counted yet'}</p>
      {segments.length > 0 && (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-soft" aria-hidden="true">
          {segments.map(s => <span key={s.key} className={fill[s.tone] ?? fill.neutral} style={{ width: `${(s.value / base) * 100}%` }} />)}
        </div>
      )}
    </div>
  )
}

/** Weight, value and freight of the goods a split divides: the lot's own figures, or the consignment's, pro rata to the pieces held. */
function splitFigures(where: WhereIsIt, self: Lot | null, fallback: Omit<SplitAvailable, 'pieces'> | undefined): Omit<SplitAvailable, 'pieces'> {
  const base = self
    ? { weight_kg: self.weight_kg, declared_value: self.declared_value, freight: self.freight_share }
    : fallback ?? { weight_kg: null, declared_value: null, freight: null }
  const total = where.pieces.total ?? 0
  const held = heldPieces(where.pieces)
  const ratio = total > 0 && held < total ? held / total : 1
  const scale = (v: number | null, d: number) => (v == null ? null : roundTo(v * ratio, d))
  return { weight_kg: scale(base.weight_kg, 2), declared_value: scale(base.declared_value, 2), freight: scale(base.freight, 2), accounted: accountedPieces(where.pieces) }
}

export default function LotsPanel({ code, cargoRef, where, figures }: {
  code: string
  cargoRef: CargoRef
  where: WhereIsIt
  /** The consignment's weight, declared value and freight, when the caller has them (the shipment row). */
  figures?: Omit<SplitAvailable, 'pieces'>
}) {
  const [splitting, setSplitting] = useState(false)
  const lots = useQuery({ queryKey: cargoKeys.lots(code), queryFn: () => lotsAPI.get(code), retry: 1 })
  const splittable = canSplit(where)

  if (lots.isLoading) return <Skeleton className="h-24 w-full" />
  if (lots.isError) return <ErrorState compact title="We could not load the lots" onRetry={() => lots.refetch()} />

  const view = lots.data && lots.data.lots.length > 0 ? lots.data : null
  const selfKey = 'shipment_id' in cargoRef ? cargoRef.shipment_id : cargoRef.manifest_id
  const self = view?.lots.find(l => lotKey(l) === selfKey) ?? null
  const splitButton = splittable && (
    <Button size="sm" variant="secondary" icon={<Split size={14} />} onClick={() => setSplitting(true)}>Split</Button>
  )
  const modal = splitting && (
    <SplitLotsModal cargoRef={cargoRef} code={code} where={where} figures={splitFigures(where, self, figures)} onClose={() => setSplitting(false)} />
  )

  if (!view) {
    if (!splittable) return null
    return (
      <section className="space-y-2" aria-label="Lots">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">Lots</h3>
          {splitButton}
        </div>
        <p className="text-sm text-muted">Not split. Split it to send part of the goods to another drop, vehicle or hub, each part with its own code and POD.</p>
        {modal}
      </section>
    )
  }

  return (
    <section className="space-y-3" aria-label="Lots">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Lots</h3>
        {splitButton}
      </div>
      {self && view.master.tracking_id && (
        <Link
          to={consignmentHref(view.master) ?? '#'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <ArrowUpLeft size={14} aria-hidden="true" />
          Lot {self.label} of <span className="font-mono">{view.master.tracking_id}</span>
        </Link>
      )}
      <LotsTree view={view} currentKey={selfKey} />
      {modal}
    </section>
  )
}

/** The master and its lots as a tree, with merging. */
export function LotsTree({ view, currentKey }: { view: LotsView; currentKey?: string | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [merging, setMerging] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  // Merged or emptied lots are cancelled with nothing on them; the backend leaves them out of the totals
  const lots = view.lots.filter(l => l.status !== 'cancelled')
  const check = mergeCheck(lots, selected)
  // Merging needs two lots that are not settled; otherwise the action is not offered at all
  const unblocked = mergeCheck(lots, []).perLot
  const anyMergeable = lots.filter(l => !unblocked[lotKey(l)]).length >= 2

  const merge = useMutation({
    mutationFn: () => lotsAPI.merge(selected.map(k => {
      const l = lots.find(x => lotKey(x) === k)!
      return l.shipment_id ? { shipment_id: l.shipment_id } : { manifest_id: l.manifest_id! }
    })),
    onSuccess: merged => {
      queryClient.invalidateQueries({ queryKey: cargoKeys.all })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success(merged.tracking_id ? `Merged into ${merged.tracking_id}` : 'Lots merged')
      setMerging(false)
      setSelected([])
    },
    onError: err => toast.error(errorMessage(err, 'We could not merge the lots. Try again.')),
  })

  const toggle = (key: string) => setSelected(s => (s.includes(key) ? s.filter(k => k !== key) : [...s, key]))
  const doMerge = async () => {
    const labels = selected.map(k => lots.find(l => lotKey(l) === k)?.label).filter(Boolean).join(', ')
    const ok = await confirm({
      title: `Merge lots ${labels}?`,
      message: 'They become one lot with the pieces, weight, value and freight added up. Their custody history is kept.',
      confirmLabel: 'Merge lots',
    })
    if (ok) merge.mutate()
  }

  return (
    <div className="space-y-3 rounded-control border border-border p-3 sm:p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={consignmentHref(view.master) ?? '#'} className={clsx('font-mono text-sm font-medium hover:underline', currentKey && (view.master.shipment_id ?? view.master.manifest_id) === currentKey ? 'text-text' : 'text-brand')}>
            {view.master.tracking_id ?? 'Master'}
          </Link>
          <StatusPill status={view.master.status} kind="cargo" />
          <span className="text-xs text-muted">Master · {n(view.totals.lots)} lots</span>
        </div>
        <LotsProgress totals={view.totals} />
      </div>

      <ul className="space-y-0 border-l border-border pl-3" aria-label="Lots of this shipment">
        {lots.map(l => {
          const key = lotKey(l)
          const why = check.perLot[key]
          const disabled = merging && !!why && !selected.includes(key)
          return (
            <LotItem
              key={key || l.label}
              lot={l}
              current={key === currentKey}
              merging={merging}
              checked={selected.includes(key)}
              disabledReason={merging ? why : null}
              disabled={disabled}
              onToggle={() => toggle(key)}
              onOpen={() => { const href = consignmentHref(l); if (href) navigate(href) }}
            />
          )
        })}
      </ul>

      {anyMergeable && !merging && (
        <Button size="sm" variant="ghost" icon={<Combine size={14} />} onClick={() => setMerging(true)}>Merge lots</Button>
      )}
      {merging && (
        <div className="space-y-2">
          {check.reason && <Alert tone={selected.length >= 2 ? 'warning' : 'info'}>{check.reason}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setMerging(false); setSelected([]) }}>Cancel</Button>
            <Button size="sm" icon={<Combine size={14} />} disabled={!check.ok} loading={merge.isPending} onClick={doMerge}>
              {selected.length >= 2 ? `Merge ${n(selected.length)} lots` : 'Merge'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function LotItem({ lot, current, merging, checked, disabled, disabledReason, onToggle, onOpen }: {
  lot: Lot
  current: boolean
  merging: boolean
  checked: boolean
  disabled: boolean
  disabledReason: string | null
  onToggle: () => void
  onOpen: () => void
}) {
  const place = lotPlace(lot)
  const total = lot.pieces.total
  const cases = lot.open_exceptions
  const reasonId = `lot-why-${lotKey(lot)}`
  return (
    <li className="relative py-2 first:pt-0 last:pb-0">
      <span className="absolute -left-3 top-4 h-px w-2.5 bg-border" aria-hidden="true" />
      <div className="flex items-start gap-3">
        {merging && (
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border-strong accent-brand disabled:cursor-not-allowed"
            aria-label={`Choose lot ${lot.label ?? ''} to merge`}
            aria-describedby={disabledReason ? reasonId : undefined}
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {current ? (
              <span className="font-mono text-sm font-medium text-text">{lot.tracking_id}</span>
            ) : (
              <button type="button" onClick={onOpen} className="font-mono text-sm font-medium text-brand hover:underline">{lot.tracking_id ?? `Lot ${lot.label}`}</button>
            )}
            <StatusPill status={lot.status} kind="cargo" />
            {current && <span className="text-xs text-muted">(this one)</span>}
          </div>
          <p className="text-sm text-text">
            <span className="tabular">{total != null ? `${n(total)} ${total === 1 ? 'piece' : 'pieces'}` : 'Pieces not counted'}</span>
            <span className="text-muted"> · {lot.status === 'delivered' ? 'delivered' : place.text}</span>
            {lot.pieces.delivered > 0 && lot.status !== 'delivered' && <span className="text-muted"> · {n(lot.pieces.delivered)} delivered</span>}
          </p>
          {(lot.drop || lot.consignee) && (
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
              {lot.consignee?.name && <span className="inline-flex min-w-0 items-center gap-1"><User size={12} aria-hidden="true" /> <span className="break-words">{lot.consignee.name}</span></span>}
              {lot.drop && <span className="inline-flex min-w-0 items-center gap-1"><MapPin size={12} aria-hidden="true" /> <span className="break-words">{lot.drop.name || lot.drop.address}</span></span>}
            </p>
          )}
          <LotEway lot={lot} />
          {cases.length > 0 && (
            <p className="flex flex-wrap gap-x-3 text-xs">
              {cases.map(c => (
                <Link key={c.id} to={`/cargo/exceptions/${c.id}`} className="inline-flex items-center gap-1 font-medium text-danger hover:underline">
                  <AlertTriangle size={12} aria-hidden="true" /> {c.code}
                </Link>
              ))}
            </p>
          )}
          {disabledReason && <p id={reasonId} className="text-xs text-warning">Can’t merge: {disabledReason.charAt(0).toLowerCase()}{disabledReason.slice(1)}</p>}
        </div>
      </div>
    </li>
  )
}

/** A lot's own e-way bill reference (POST /cargo/lots/eway), and whether Part B is due after a transfer. */
function LotEway({ lot }: { lot: Lot }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(lot.eway_bill_ref ?? '')
  const [error, setError] = useState('')
  const ref: CargoRef | null = lot.shipment_id ? { shipment_id: lot.shipment_id } : lot.manifest_id ? { manifest_id: lot.manifest_id } : null
  const save = useMutation({
    mutationFn: () => lotsAPI.setEway(ref!, value.trim()),
    onSuccess: saved => {
      queryClient.invalidateQueries({ queryKey: cargoKeys.all })
      toast.success(`E-way bill ${saved.eway_bill_ref ?? ''} saved for lot ${lot.label ?? ''}`.replace(/\s+/g, ' '))
      setEditing(false)
    },
    onError: err => setError(errorMessage(err, 'We could not save the e-way bill. Try again.')),
  })
  if (!ref) return null
  const settled = ['delivered', 'returned', 'lost', 'cancelled'].includes(lot.status)

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-end gap-2 pt-1"
        onSubmit={e => {
          e.preventDefault()
          if (!value.trim()) { setError('Enter the e-way bill number.'); return }
          setError('')
          save.mutate()
        }}
      >
        <Input
          label={`E-way bill of lot ${lot.label ?? ''}`}
          value={value}
          onChange={e => setValue(e.target.value)}
          error={error}
          maxLength={60}
          inputClassName="font-mono"
          className="min-w-0 flex-1 sm:max-w-xs"
        />
        <Button size="sm" type="submit" loading={save.isPending}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(lot.eway_bill_ref ?? ''); setError('') }}>Cancel</Button>
      </form>
    )
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
      <FileText size={12} aria-hidden="true" />
      {lot.eway_bill_ref ? <span>E-way bill <span className="font-mono text-text">{lot.eway_bill_ref}</span></span> : <span>No e-way bill</span>}
      {lot.eway_part_b_required && <StatusPill tone="warning" dot={false}>Part B due</StatusPill>}
      {!settled && (
        <button type="button" onClick={() => setEditing(true)} className="font-medium text-brand hover:underline">
          {lot.eway_bill_ref ? 'Change' : 'Add'}
        </button>
      )}
    </p>
  )
}
