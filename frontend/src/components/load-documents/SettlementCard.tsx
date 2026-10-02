import { useState } from 'react'
import { Check, Lock, Plus } from 'lucide-react'
import { Alert, Button, Card, CardBody, CardHeader, Input, StatusPill } from '@/components/ui'
import { formatDate, formatRupees } from '@/utils/display'
import type { LoadDocument, Settlement } from '@/types/loadDocuments'
import { canCloseTrip, closeBlockedReason, type PanelRole } from './model'

const TERMS: Record<string, string> = { paid: 'Paid', to_pay: 'To pay', to_be_billed: 'To be billed' }

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={strong ? 'text-sm font-semibold text-text' : 'text-sm text-muted'}>{label}</dt>
      <dd className={strong ? 'tabular text-base font-semibold text-text' : 'tabular text-sm text-text'}>{value}</dd>
    </div>
  )
}

function AmountForm({ addLabel, withReason, busy, onAdd }: {
  addLabel: string
  withReason?: boolean
  busy: boolean
  onAdd: (label: string, amount: number, reason: string) => Promise<unknown> | void
}) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!label.trim()) return setError('Say what it is for.')
    if (!(Number(amount) > 0)) return setError('Enter an amount in rupees.')
    if (withReason && !reason.trim()) return setError('Give a reason.')
    setError(null)
    await onAdd(label.trim(), Number(amount), reason.trim())
    setLabel(''); setAmount(''); setReason('')
  }
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
      <Input label="For" value={label} onChange={e => setLabel(e.target.value)} placeholder={withReason ? 'Late delivery' : 'Detention at pickup'} />
      <Input label="Amount" type="number" inputMode="decimal" min="0" value={amount} onChange={e => setAmount(e.target.value)} leading="₹" />
      {withReason && <Input className="sm:col-span-2" label="Reason" value={reason} onChange={e => setReason(e.target.value)} />}
      <Button size="md" variant="secondary" icon={<Plus size={14} />} loading={busy} onClick={submit}>{addLabel}</Button>
      {error && <p role="alert" className="text-xs text-danger sm:col-span-3">{error}</p>}
    </div>
  )
}

/** Agreed freight, advance, extra charges, deductions and what is left to pay; closing the trip. */
export function SettlementCard({ role, settlement, docs, busy, onOpen, onAddExtra, onApprove, onAddDeduction, onClose }: {
  role: PanelRole
  settlement: Settlement | null
  docs: LoadDocument[]
  busy: boolean
  onOpen: () => void
  onAddExtra: (label: string, amount: number) => Promise<unknown> | void
  onApprove: (idx: number) => void
  onAddDeduction: (label: string, amount: number, reason: string) => Promise<unknown> | void
  onClose: () => void
}) {
  const carrier = canCloseTrip(role)
  if (!settlement) {
    return (
      <Card>
        <CardHeader title="Settlement" description="Freight, advance, extra charges and the balance to pay." />
        <CardBody>
          {carrier
            ? <Button loading={busy} onClick={onOpen}>Open settlement</Button>
            : <p className="text-sm text-muted">The logistic company has not opened the settlement yet.</p>}
        </CardBody>
      </Card>
    )
  }
  const closed = settlement.status === 'closed'
    const blocked = closeBlockedReason(settlement, docs)
  return (
    <Card>
      <CardHeader
        title="Settlement"
        description={settlement.payment_terms ? `Payment terms: ${TERMS[settlement.payment_terms] ?? settlement.payment_terms}` : undefined}
        actions={<StatusPill tone={closed ? 'neutral' : 'info'}>{closed ? 'Closed' : 'Open'}</StatusPill>}
      />
      <CardBody className="space-y-4">
        <dl className="divide-y divide-border">
          <Row label="Agreed freight" value={formatRupees(settlement.agreed_freight)} />
          <Row label="Advance paid" value={`− ${formatRupees(settlement.advance_paid)}`} />
        </dl>

        <div>
          <h4 className="text-sm font-semibold text-text">Extra charges</h4>
          {settlement.extra_charges.length === 0 ? <p className="mt-1 text-sm text-muted">None.</p> : (
            <ul className="mt-1 divide-y divide-border">
              {settlement.extra_charges.map(c => (
                <li key={c.idx} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-text">{c.label}</p>
                    <p className="text-xs text-muted">{c.approved ? `Approved ${formatDate(c.approved_at)}` : 'Waiting for approval, not in the balance yet'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular text-sm text-text">{formatRupees(c.amount)}</span>
                    {!c.approved && carrier && !closed && (
                      <Button size="sm" variant="secondary" icon={<Check size={14} />} disabled={busy} onClick={() => onApprove(c.idx)}>Approve</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {carrier && !closed && <AmountForm addLabel="Add charge" busy={busy} onAdd={(l, a) => onAddExtra(l, a)} />}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-text">Deductions</h4>
          {settlement.deductions.length === 0 ? <p className="mt-1 text-sm text-muted">None.</p> : (
            <ul className="mt-1 divide-y divide-border">
              {settlement.deductions.map(d => (
                <li key={d.idx} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-text">{d.label}</p>
                    <p className="text-xs text-muted">{d.reason}</p>
                  </div>
                  <span className="tabular text-sm text-text">− {formatRupees(d.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {carrier && !closed && <AmountForm addLabel="Add deduction" withReason busy={busy} onAdd={onAddDeduction} />}
        </div>

        <dl className="border-t border-border pt-2">
          <Row strong label="Balance to pay" value={formatRupees(settlement.balance)} />
        </dl>
        <p className="text-xs text-muted">
          Freight, plus approved extra charges, minus deductions and the advance.
          {settlement.pending_extras_total > 0 && ` ${formatRupees(settlement.pending_extras_total)} of extra charges still waits for approval.`}
        </p>

        {closed ? (
          <Alert tone="success" title="Trip closed">{settlement.closed_at ? `Closed on ${formatDate(settlement.closed_at)}.` : 'Closed.'}</Alert>
        ) : carrier && (
          <div className="space-y-2">
            <Button icon={<Lock size={14} />} disabled={!!blocked || busy} loading={busy && !blocked} onClick={onClose}>Close trip</Button>
            {blocked && <p className="text-xs text-muted" role="status">{blocked}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
