import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MessageSquareReply, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { financeAPI } from '@/services/api'
import { Button, DetailList, EmptyState, ErrorState, Modal, Select, StatusPill, Textarea, Input, type Tone } from '@/components/ui'
import { errorMessage, formatDate, formatDateTime, formatRupees } from '@/utils/display'
import {
  PAYMENT_METHODS, REPORT_STATUS_LABELS, recordedMethodFor, reportMethodLabel, sortReports, type InvoiceReport, type InvoiceReportStatus,
} from '@/utils/finance'

const TONE: Record<InvoiceReportStatus, Tone> = { open: 'warning', confirmed: 'success', rejected: 'danger', answered: 'info' }

/** What a change to a report touches: the invoice, the lists, the summary and Today's waiting list. */
function useRefreshAfterReport() {
  const queryClient = useQueryClient()
  return () => {
    for (const key of ['finance', 'ops-today', 'shipments']) queryClient.invalidateQueries({ queryKey: [key] })
  }
}

function ConfirmReportModal({ report, onClose, onDone }: { report: InvoiceReport | null; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  const needsMethod = !!report && recordedMethodFor(report.method) === null

  useEffect(() => { setMethod(''); setNote(''); setError(undefined) }, [report])

  const save = useMutation({
    mutationFn: () => financeAPI.confirmInvoiceReport(report!.id, {
      ...(needsMethod ? { method } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: onDone,
    onError: err => setError(errorMessage(err, 'We could not confirm this payment. Try again.')),
  })

  const submit = () => {
    if (needsMethod && !method) { setError('Choose how the money was paid'); return }
    setError(undefined)
    save.mutate()
  }

  return (
    <Modal
      open={!!report}
      onClose={onClose}
      title="Confirm this payment"
      description="Confirming marks the invoice as paid, with the customer's reference and date. The customer is told. Check that the money has arrived first."
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Confirm payment</Button>
        </>
      )}
    >
      {report && (
        <div className="space-y-4">
          <DetailList columns={2} items={[
            { label: 'Amount', value: <span className="tabular">{report.amount != null ? formatRupees(report.amount) : '—'}</span> },
            { label: 'Date paid', value: report.paid_on ? formatDate(report.paid_on) : '—' },
            { label: 'Method', value: reportMethodLabel(report.method) || '—' },
            { label: 'Reference', value: report.reference || 'None given' },
          ]} />
          {needsMethod && (
            <Select
              label="Paid by"
              value={method}
              onChange={e => { setMethod(e.target.value); setError(undefined) }}
              placeholder="Choose a method"
              hint="The customer chose Other, so say how the money reached you"
              options={PAYMENT_METHODS.map(m => ({ value: m.value, label: m.label }))}
              required
            />
          )}
          <Input label="Note for the record (optional)" value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

function TextReportModal({ report, mode, onClose, onDone }: { report: InvoiceReport | null; mode: 'reject' | 'answer'; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const reject = mode === 'reject'
  const min = reject ? 3 : 1

  useEffect(() => { setText(''); setError(undefined) }, [report])

  const save = useMutation({
    mutationFn: () => (reject ? financeAPI.rejectInvoiceReport(report!.id, text.trim()) : financeAPI.answerInvoiceReport(report!.id, text.trim())),
    onSuccess: onDone,
    onError: err => setError(errorMessage(err, reject ? 'We could not reject this report. Try again.' : 'We could not send this answer. Try again.')),
  })

  const submit = () => {
    if (text.trim().length < min) { setError(reject ? 'Say why the payment is rejected (at least 3 characters)' : 'Write your answer'); return }
    setError(undefined)
    save.mutate()
  }

  return (
    <Modal
      open={!!report}
      onClose={onClose}
      title={reject ? 'Reject this payment report' : 'Answer the customer'}
      description={reject
        ? 'The invoice stays unpaid and the customer is told why.'
        : report?.message ? `They asked: ${report.message}` : undefined}
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={reject ? 'danger' : 'primary'} loading={save.isPending}>{reject ? 'Reject report' : 'Send answer'}</Button>
        </>
      )}
    >
      <Textarea label={reject ? 'Reason' : 'Answer'} value={text} onChange={e => { setText(e.target.value); setError(undefined) }} maxLength={1000} rows={4} error={error} required />
    </Modal>
  )
}

/** The reports a customer made on one invoice: payments to confirm or reject, and questions to answer. */
export default function InvoiceReports({ invoiceId }: { invoiceId: string }) {
  const refresh = useRefreshAfterReport()
  const [confirming, setConfirming] = useState<InvoiceReport | null>(null)
  const [rejecting, setRejecting] = useState<InvoiceReport | null>(null)
  const [answering, setAnswering] = useState<InvoiceReport | null>(null)

  const reports = useQuery({ queryKey: ['finance', 'invoice-reports', invoiceId], queryFn: () => financeAPI.invoiceReports({ invoice_id: invoiceId }), enabled: !!invoiceId })
  const list = sortReports(reports.data ?? [])

  const done = (message: string) => () => {
    toast.success(message)
    setConfirming(null); setRejecting(null); setAnswering(null)
    refresh()
  }

  return (
    <section aria-label="Customer reports" className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-text">Customer reports</h2>
      {reports.isLoading && <p className="text-sm text-muted">Loading reports…</p>}
      {reports.isError && <ErrorState compact title="We could not load the customer reports" onRetry={() => reports.refetch()} />}
      {reports.data && list.length === 0 && (
        <EmptyState compact title="No reports" description="When the customer says they paid, or asks about this invoice, it shows here." />
      )}
      <ul className="space-y-3">
        {list.map(r => (
          <li key={r.id} className="space-y-3 rounded-card border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={TONE[r.status]}>{REPORT_STATUS_LABELS[r.status]}</StatusPill>
              <span className="text-sm font-medium text-text">{r.kind === 'payment' ? 'Payment reported' : 'Question'}</span>
              <span className="text-xs text-muted">{formatDateTime(r.created_at)}{r.customer_name ? ` · ${r.customer_name}` : ''}</span>
            </div>
            {r.kind === 'payment' ? (
              <DetailList columns={2} items={[
                { label: 'Amount', value: <span className="tabular">{r.amount != null ? formatRupees(r.amount) : '—'}</span> },
                { label: 'Date paid', value: r.paid_on ? formatDate(r.paid_on) : '—' },
                { label: 'Method', value: reportMethodLabel(r.method) || '—' },
                { label: 'Reference', value: r.reference || 'None given' },
                ...(r.message ? [{ label: 'Message', value: r.message }] : []),
              ]} />
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm text-text">{r.message}</p>
            )}
            {r.status === 'open' ? (
              <div className="flex flex-wrap gap-2">
                {r.kind === 'payment' ? (
                  <>
                    <Button icon={<Check size={16} />} onClick={() => setConfirming(r)}>Confirm payment</Button>
                    <Button variant="secondary" icon={<X size={16} />} onClick={() => setRejecting(r)}>Reject</Button>
                  </>
                ) : (
                  <Button icon={<MessageSquareReply size={16} />} onClick={() => setAnswering(r)}>Answer</Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">
                {r.status === 'confirmed' ? 'Confirmed' : r.status === 'rejected' ? 'Rejected' : 'Answered'}
                {r.handled_at ? ` on ${formatDateTime(r.handled_at)}` : ''}
                {r.staff_note ? `: ${r.staff_note}` : '.'}
              </p>
            )}
          </li>
        ))}
      </ul>

      <ConfirmReportModal report={confirming} onClose={() => setConfirming(null)} onDone={done('Payment confirmed and the invoice marked as paid')} />
      <TextReportModal report={rejecting} mode="reject" onClose={() => setRejecting(null)} onDone={done('Report rejected. The customer is told.')} />
      <TextReportModal report={answering} mode="answer" onClose={() => setAnswering(null)} onDone={done('Answer sent. The customer is told.')} />
    </section>
  )
}
