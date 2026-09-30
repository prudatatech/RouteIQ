import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IndianRupee, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { financeAPI } from '@/services/api'
import { Alert, Button, DataTable, Input, Modal, StatusPill, type Column, type DateRangeValue } from '@/components/ui'
import { errorMessage, formatDate } from '@/utils/display'
import { useUnpriced, type Unpriced } from './useUnpriced'

function SetPriceModal({ target, onClose, onDone }: { target: Unpriced | null; onClose: () => void; onDone: (invoiceNumber: string | null) => void }) {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | undefined>()
  const save = useMutation({
    mutationFn: (value: number) => financeAPI.setPrice({ kind: target!.kind, id: target!.id, amount: value }),
    onSuccess: data => { setAmount(''); onDone(data.invoice_number) },
    onError: err => setError(errorMessage(err, 'We could not save this price. Try again.')),
  })

  const submit = () => {
    const value = Number(amount.replace(/,/g, ''))
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) { setError('Enter a price greater than zero'); return }
    if (value > 99_999_999.99) { setError('That price is too large'); return }
    setError(undefined)
    save.mutate(Math.round(value * 100) / 100)
  }
  const close = () => { setAmount(''); setError(undefined); onClose() }

  return (
    <Modal
      open={!!target}
      onClose={close}
      title="Set price"
      description={target ? `${target.label}${target.detail ? ` · ${target.detail}` : ''}` : undefined}
      onSubmit={submit}
      footer={(
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save price and issue invoice</Button>
        </>
      )}
    >
      <Input
        label="Price before GST"
        inputMode="decimal"
        leading="₹"
        value={amount}
        onChange={e => { setAmount(e.target.value); setError(undefined) }}
        error={error}
        hint="Saving issues the invoice right away. GST comes from the goods' HSN lines, if any."
        autoFocus
      />
    </Modal>
  )
}

/** Delivered goods without an invoice. Setting the price issues the invoice at once. */
export default function ToPriceTab({ range }: { range: DateRangeValue }) {
  const queryClient = useQueryClient()
  const list = useUnpriced(range)
  const [pricing, setPricing] = useState<Unpriced | null>(null)
  const [issued, setIssued] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (u: Unpriced) => financeAPI.createInvoice(u.kind === 'shipment' ? { shipment_id: u.id } : { manifest_id: u.id }),
    onSuccess: () => { toast.success('Invoice issued'); queryClient.invalidateQueries({ queryKey: ['finance'] }); queryClient.invalidateQueries({ queryKey: ['ops'] }) },
    onError: err => toast.error(errorMessage(err, 'We could not create this invoice. Try again.')),
  })

  const rows = list.data ?? []
  const onPriced = (invoiceNumber: string | null) => {
    setPricing(null)
    const label = invoiceNumber ? `Invoice ${invoiceNumber} issued` : 'Invoice issued'
    setIssued(label)
    toast.success(label)
    queryClient.invalidateQueries({ queryKey: ['finance'] })
    queryClient.invalidateQueries({ queryKey: ['ops'] })
  }

  const columns: Column<Unpriced>[] = [
    {
      key: 'label', header: 'Delivery', sortValue: u => u.label,
      cell: u => (
        <span className="block min-w-0">
          <Link to={`/shipments/${u.id}`} className="font-mono text-sm font-medium text-brand hover:underline">{u.label}</Link>
          {u.detail && <span className="block truncate text-xs text-muted">{u.detail}</span>}
        </span>
      ),
    },
    { key: 'kind', header: 'Type', hideBelow: 'md', sortValue: u => u.kind, cell: u => (u.kind === 'shipment' ? 'Shipment' : 'Vendor load') },
    { key: 'delivered', header: 'Delivered', sortValue: u => u.delivered_at, cell: u => formatDate(u.delivered_at) },
    {
      key: 'state', header: 'Price', sortValue: u => Number(u.can_invoice),
      cell: u => (u.can_invoice ? <StatusPill tone="info">Priced, not invoiced</StatusPill> : <StatusPill tone="warning">No price</StatusPill>),
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', width: 'w-44',
      cell: u => (u.can_invoice
        ? <Button size="sm" variant="secondary" icon={<FileText size={14} />} loading={create.isPending && create.variables?.id === u.id} onClick={() => create.mutate(u)}>Issue invoice</Button>
        : <Button size="sm" icon={<IndianRupee size={14} />} onClick={() => setPricing(u)}>Set price</Button>),
    },
  ]

  return (
    <div className="space-y-4">
      {issued !== null && (
        <Alert tone="success" title={issued} action={<Button size="sm" variant="ghost" onClick={() => setIssued(null)}>Dismiss</Button>}>
          The customer or vendor is told. Open it from the Invoices tab.
        </Alert>
      )}
      <DataTable
        caption="Deliveries to price"
        columns={columns}
        rows={rows}
        rowKey={u => `${u.kind}-${u.id}`}
        loading={list.isLoading}
        error={list.error ? 'We could not load deliveries. Check your connection and try again.' : undefined}
        onRetry={() => list.refetch()}
        initialSort={{ key: 'delivered', direction: 'desc' }}
        empty={{ title: 'Everything delivered in this range has an invoice', description: 'A delivery shows up here when it is delivered without a price.' }}
      />
      <SetPriceModal target={pricing} onClose={() => setPricing(null)} onDone={onPriced} />
    </div>
  )
}
