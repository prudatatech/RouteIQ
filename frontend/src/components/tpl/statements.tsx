import { useState } from 'react'
import toast from 'react-hot-toast'
import { Download } from 'lucide-react'
import { Button, StatusPill } from '@/components/ui'
import { errorMessage } from '@/utils/display'
import { formatPaise } from './statementFormat'
import type { NetStatement, StatementStatus } from '@/types/network'

const STATUS_LABEL: Record<StatementStatus, string> = { draft: 'Draft', issued: 'Issued', paid: 'Paid' }
const STATUS_TONE: Record<StatementStatus, 'neutral' | 'warning' | 'success'> = { draft: 'neutral', issued: 'warning', paid: 'success' }

export function StatementStatusPill({ status }: { status: StatementStatus }) {
  return <StatusPill tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</StatusPill>
}

/** Orders total, each deduction, and the balance as the server worked it out. Display only: nothing is recomputed here. */
export function StatementSummary({ statement }: { statement: NetStatement }) {
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-muted">Delivered orders</dt>
        <dd className="tabular text-text">{formatPaise(statement.orders_total_paise)}</dd>
      </div>
      {statement.deductions.map((d, i) => (
        <div key={`${d.label}-${i}`} className="flex justify-between gap-4">
          <dt className="min-w-0 text-muted">Less: {d.label}{d.reason ? <span className="block text-xs">{d.reason}</span> : null}</dt>
          <dd className="tabular shrink-0 text-text">−{formatPaise(d.amount_paise)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-border pt-1.5 font-semibold">
        <dt className="text-text">Balance to pay</dt>
        <dd className="tabular text-text">{formatPaise(statement.balance_paise)}</dd>
      </div>
    </dl>
  )
}

/** Fetches the statement PDF with the sign-in header and opens it in a new tab. */
export function StatementPdfButton({ fetchPdf }: { fetchPdf: () => Promise<Blob> }) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    try {
      const url = URL.createObjectURL(await fetchPdf())
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      toast.error(errorMessage(err, 'We could not open the PDF. Try again.'))
    } finally {
      setBusy(false)
    }
  }
  return <Button size="sm" variant="secondary" icon={<Download size={14} />} loading={busy} onClick={open}>PDF</Button>
}
