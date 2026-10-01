import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { financeAPI } from '@/services/api'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { errorMessage, formatRupees } from '@/utils/display'
import { PAYMENT_METHODS, type InvoiceDetail } from '@/utils/finance'

/** Today as an India calendar day (YYYY-MM-DD). */
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

/** Records that money arrived: how it was paid, an optional reference, and the date it was received. */
export function MarkPaidModal({ invoice, open, onClose, onDone }: { invoice: InvoiceDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('bank')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(todayIST())
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!open) return
    setMethod('bank'); setReference(''); setPaidOn(todayIST()); setError(undefined)
  }, [open])

  const save = useMutation({
    mutationFn: () => financeAPI.payInvoice(invoice.id, { method, reference: reference.trim() || undefined, paid_on: paidOn }),
    onSuccess: onDone,
    onError: err => setError(errorMessage(err, 'We could not mark this invoice paid. Try again.')),
  })

  const submit = () => {
    if (!paidOn) { setError('Enter the date the money was received'); return }
    setError(undefined)
    save.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Mark ${invoice.invoice_number ?? 'invoice'} as paid`}
      description={`${formatRupees(invoice.total)} received${invoice.buyer.name ? ` from ${invoice.buyer.name}` : ''}. The customer or vendor is told. Payments are made outside the app: record here that the money arrived.`}
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Mark as paid</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Select label="Paid by" value={method} onChange={e => setMethod(e.target.value)} options={PAYMENT_METHODS.map(m => ({ value: m.value, label: m.label }))} />
        <Input
          label="Reference"
          value={reference}
          onChange={e => setReference(e.target.value)}
          maxLength={100}
          hint={method === 'cheque' ? 'Cheque number' : method === 'cash' ? 'Receipt number, if you gave one' : 'Transaction or UTR number'}
        />
        <Input
          label="Date received"
          type="date"
          value={paidOn}
          max={todayIST()}
          min={invoice.issued_at ? new Date(new Date(invoice.issued_at).getTime() + 330 * 60_000).toISOString().slice(0, 10) : undefined}
          onChange={e => setPaidOn(e.target.value)}
        />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}

/** Voids an issued invoice. A reason is kept on it. */
export function VoidModal({ invoice, open, onClose, onDone }: { invoice: InvoiceDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (open) { setReason(''); setError(undefined) }
  }, [open])

  const save = useMutation({
    mutationFn: () => financeAPI.voidInvoice(invoice.id, reason.trim()),
    onSuccess: onDone,
    onError: err => setError(errorMessage(err, 'We could not void this invoice. Try again.')),
  })

  const submit = () => {
    if (reason.trim().length < 3) { setError('Say why this invoice is voided'); return }
    setError(undefined)
    save.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Void ${invoice.invoice_number ?? 'invoice'}?`}
      description="It stops counting as revenue and cannot be reopened. The delivery goes back to To price, where a new invoice can be issued."
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Keep invoice</Button>
          <Button type="submit" variant="danger" loading={save.isPending}>Void invoice</Button>
        </>
      )}
    >
      <Textarea label="Reason" value={reason} onChange={e => { setReason(e.target.value); setError(undefined) }} maxLength={300} rows={3} error={error} required />
    </Modal>
  )
}
