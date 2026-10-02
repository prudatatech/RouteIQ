import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FilePlus2, Plus, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, IconButton, Input, SectionHeader, Skeleton, useConfirm } from '@/components/ui'
import { networkAPI } from '@/services/api'
import { errorMessage } from '@/utils/display'
import type { NetStatement } from '@/types/network'
import type { DeductionRow as Row } from './networkHelpers'
import { StatementPdfButton, StatementStatusPill, StatementSummary } from './statements'
import { periodFromMonth, periodLabel, statementDates } from './statementFormat'
import { deductionsFromRows, toRows } from './networkHelpers'

function DeductionsEditor({ tplId, statement, onDone }: { tplId: string; statement: NetStatement; onDone: () => void }) {
  const [rows, setRows] = useState<Row[]>(toRows(statement.deductions))
  const [submitted, setSubmitted] = useState(false)
  const parsed = deductionsFromRows(rows)
  const save = useMutation({
    mutationFn: () => networkAPI.setDeductions(tplId, statement.id, parsed!),
    onSuccess: () => { toast.success('Deductions saved'); onDone() },
    onError: err => toast.error(errorMessage(err, 'We could not save the deductions. Try again.')),
  })
  const set = (i: number, patch: Partial<Row>) => setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-sm font-medium text-text">Deductions</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_8rem_1.5fr_auto]">
          <Input label="What for" value={r.label} onChange={e => set(i, { label: e.target.value })} placeholder="For example, damaged goods" />
          <Input label="Amount (₹)" type="number" min={0} value={r.amount} onChange={e => set(i, { amount: e.target.value })} />
          <Input label="Reason" value={r.reason} onChange={e => set(i, { reason: e.target.value })} />
          <IconButton label="Remove deduction" icon={<Trash2 size={16} />} onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} />
        </div>
      ))}
      {submitted && parsed === null && <p role="alert" className="text-xs text-danger">Each deduction needs what it is for, an amount above 0 and a reason.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setRows(prev => [...prev, { label: '', amount: '', reason: '' }])}>Add deduction</Button>
        <Button size="sm" loading={save.isPending} onClick={() => { setSubmitted(true); if (parsed) save.mutate() }}>Save deductions</Button>
      </div>
    </div>
  )
}

function StatementCard({ tplId, statement, onChanged }: { tplId: string; statement: NetStatement; onChanged: () => void }) {
  const { confirm, prompt } = useConfirm()
  const issue = useMutation({
    mutationFn: () => networkAPI.issueStatement(tplId, statement.id),
    onSuccess: () => { toast.success('Statement issued. The partner can see it now.'); onChanged() },
    onError: err => toast.error(errorMessage(err, 'We could not issue this statement. Try again.')),
  })
  const paid = useMutation({
    mutationFn: (reference: string) => networkAPI.markStatementPaid(tplId, statement.id, reference),
    onSuccess: () => { toast.success('Marked as paid'); onChanged() },
    onError: err => toast.error(errorMessage(err, 'We could not mark this paid. Try again.')),
  })

  const askIssue = async () => {
    const ok = await confirm({
      title: `Issue the ${periodLabel(statement.period)} statement?`,
      message: 'The partner can see it, and its deductions cannot be changed after this.',
      confirmLabel: 'Issue statement',
    })
    if (ok) issue.mutate()
  }
  const askPaid = async () => {
    const reference = await prompt({
      title: 'Mark as paid',
      message: `The balance of ${periodLabel(statement.period)} has been paid to the partner.`,
      inputLabel: 'Payment reference',
      placeholder: 'For example, the bank transfer number',
      confirmLabel: 'Mark paid',
      required: true,
    })
    if (reference) paid.mutate(reference)
  }

  return (
    <Card padded className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-text">{periodLabel(statement.period)}</p>
          <p className="text-xs text-muted">{statementDates(statement)}</p>
        </div>
        <StatementStatusPill status={statement.status} />
      </div>
      <StatementSummary statement={statement} />
      {statement.status === 'draft' && <DeductionsEditor key={statement.deductions.length + ':' + statement.balance_paise} tplId={tplId} statement={statement} onDone={onChanged} />}
      <div className="flex flex-wrap gap-2">
        {statement.status === 'draft' && <Button size="sm" loading={issue.isPending} onClick={askIssue}>Issue</Button>}
        {statement.status === 'issued' && <Button size="sm" loading={paid.isPending} onClick={askPaid}>Mark paid</Button>}
        <StatementPdfButton fetchPdf={() => networkAPI.statementPdf(tplId, statement.id)} />
      </div>
    </Card>
  )
}

/** One statement per month for a partner: build it from the month's delivered orders, take deductions, issue it, mark it paid. */
export default function StatementsPanel({ tplId }: { tplId: string }) {
  const queryClient = useQueryClient()
  const key = ['network-statements', tplId]
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
  const [month, setMonth] = useState(lastMonth)
  const statements = useQuery({ queryKey: key, queryFn: () => networkAPI.statements(tplId), retry: false })
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const build = useMutation({
    mutationFn: () => networkAPI.buildStatement(tplId, periodFromMonth(month)),
    onSuccess: () => { toast.success('Statement built from the delivered orders'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not build this statement. Try again.')),
  })

  return (
    <section className="space-y-3" aria-labelledby="statements-heading">
      <SectionHeader title={<span id="statements-heading">Statements</span>} description="What you pay this partner each month, from the orders they delivered." />
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Month" type="month" className="w-48" value={month} onChange={e => setMonth(e.target.value)} />
        <Button icon={<FilePlus2 size={16} />} disabled={!month} loading={build.isPending} onClick={() => build.mutate()}>Build statement</Button>
      </div>
      {statements.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : statements.error ? (
        <ErrorState compact description="We could not load the statements." onRetry={() => statements.refetch()} />
      ) : (statements.data ?? []).length === 0 ? (
        <EmptyState compact title="No statements yet" description="Pick a month and build one from the orders this partner delivered." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(statements.data ?? []).map(s => <StatementCard key={s.id} tplId={tplId} statement={s} onChanged={refresh} />)}
        </div>
      )}
    </section>
  )
}
