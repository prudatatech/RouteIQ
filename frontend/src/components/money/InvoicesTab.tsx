import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { financeAPI } from '@/services/api'
import {
  Alert, Button, DataTable, SearchInput, Select, Stat, StatusPill, useConfirm, type Column, type DateRangeValue,
} from '@/components/ui'
import { downloadCsv, toCsv } from '@/utils/csv'
import { errorMessage, formatDate, formatRupees } from '@/utils/display'
import { INVOICE_CSV_COLUMNS, invoiceCsvRows, type Invoice } from '@/utils/finance'

interface Unpriced {
  kind: 'shipment' | 'manifest'
  id: string
  label: string
  detail: string | null
  delivered_at: string
  can_invoice: boolean
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'issued', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
]

/** Invoices issued when deliveries complete, and deliveries that could not be invoiced. */
export default function InvoicesPanel({ range }: { range: DateRangeValue }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  const invoices = useQuery<Invoice[]>({
    queryKey: ['finance', 'invoices', range.from, range.to, status],
    queryFn: () => financeAPI.invoices({ from: range.from, to: range.to, status: status || undefined }) as Promise<Invoice[]>,
  })
  const unpriced = useQuery<Unpriced[]>({
    queryKey: ['finance', 'unpriced', range.from, range.to],
    queryFn: () => financeAPI.unpriced({ from: range.from, to: range.to }) as Promise<Unpriced[]>,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['finance'] })
  const pay = useMutation({
    mutationFn: (id: string) => financeAPI.payInvoice(id),
    onSuccess: () => { toast.success('Invoice marked as paid'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not update this invoice. Try again.')),
  })
  const voidInvoice = useMutation({
    mutationFn: (id: string) => financeAPI.voidInvoice(id),
    onSuccess: () => { toast.success('Invoice voided'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not update this invoice. Try again.')),
  })
  const create = useMutation({
    mutationFn: (u: Unpriced) => financeAPI.createInvoice(u.kind === 'shipment' ? { shipment_id: u.id } : { manifest_id: u.id }),
    onSuccess: () => { toast.success('Invoice created'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not create this invoice. Try again.')),
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (invoices.data ?? []).filter(i => !q || [i.invoice_number, i.reference, i.vendor_name].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [invoices.data, search])

  const live = rows.filter(i => i.status !== 'void')
  const billed = live.reduce((s, i) => s + i.total, 0)
  const outstanding = live.filter(i => i.status === 'issued').reduce((s, i) => s + i.total, 0)
  const filtered = !!(status || search)

  const onPay = async (i: Invoice) => {
    if (await confirm({ title: `Mark ${i.invoice_number} as paid?`, message: `${formatRupees(i.total)} received from ${i.vendor_name ?? 'the customer'}.`, confirmLabel: 'Mark as paid' })) pay.mutate(i.id)
  }
  const onVoid = async (i: Invoice) => {
    if (await confirm({
      title: `Void ${i.invoice_number}?`,
      message: 'It stops counting as revenue. A void invoice cannot be reopened.',
      confirmLabel: 'Void invoice',
      tone: 'danger',
    })) voidInvoice.mutate(i.id)
  }

  const columns: Column<Invoice>[] = [
    { key: 'number', header: 'Invoice', sortValue: i => i.invoice_number, cell: i => <span className="font-mono text-sm">{i.invoice_number}</span> },
    { key: 'issued', header: 'Issued', hideBelow: 'md', sortValue: i => i.issued_at, cell: i => formatDate(i.issued_at) },
    { key: 'ref', header: 'Delivery', hideBelow: 'lg', sortValue: i => i.reference ?? '', cell: i => i.reference ?? '—' },
    { key: 'vendor', header: 'Vendor', hideBelow: 'lg', sortValue: i => i.vendor_name ?? '', cell: i => i.vendor_name ?? '—' },
    {
      key: 'amount', header: 'Amount', align: 'right', hideBelow: 'md', sortValue: i => i.amount,
      cell: i => <span className="tabular">{formatRupees(i.amount)}</span>,
    },
    {
      key: 'gst', header: 'GST', align: 'right', hideBelow: 'xl', sortValue: i => i.gst_amount,
      cell: i => (i.gst_rate > 0 ? <span className="tabular">{formatRupees(i.gst_amount)} ({i.gst_rate}%)</span> : <span className="text-muted">None</span>),
    },
    { key: 'total', header: 'Total', align: 'right', sortValue: i => i.total, cell: i => <span className="tabular font-medium">{formatRupees(i.total)}</span> },
    { key: 'status', header: 'Status', sortValue: i => i.status, cell: i => <StatusPill status={i.status} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', width: 'w-44',
      cell: i => i.status === 'issued' && (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" icon={<CheckCircle2 size={14} />} onClick={() => onPay(i)}>Mark paid</Button>
          <Button size="sm" variant="ghost" icon={<Ban size={14} />} onClick={() => onVoid(i)}>Void</Button>
        </div>
      ),
    },
  ]

  const missing = unpriced.data ?? []
  const exportCsv = () => downloadCsv(`invoices-${range.from}-to-${range.to}.csv`, toCsv(invoiceCsvRows(rows), INVOICE_CSV_COLUMNS))

  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <Alert tone="warning" title={`${missing.length} ${missing.length === 1 ? 'delivery has' : 'deliveries have'} no invoice`}>
          <p>These were delivered in this range. Without a price on record they cannot be billed and are left out of revenue.</p>
          <ul className="mt-2 divide-y divide-border">
            {missing.slice(0, 8).map(u => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium text-text">{u.label}</span>
                  {u.detail && <span className="text-muted"> · {u.detail}</span>}
                  <span className="text-muted"> · delivered {formatDate(u.delivered_at)}</span>
                </span>
                {u.can_invoice
                  ? <Button size="sm" variant="secondary" loading={create.isPending && create.variables?.id === u.id} onClick={() => create.mutate(u)}>Create invoice</Button>
                  : <span className="text-muted">No price recorded</span>}
              </li>
            ))}
          </ul>
          {missing.length > 8 && <p className="mt-2 text-muted">And {missing.length - 8} more.</p>}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-3">
        <Stat label="Invoices" loading={invoices.isLoading} value={live.length.toLocaleString('en-IN')} />
        <Stat label="Billed, with GST" loading={invoices.isLoading} value={formatRupees(billed)} />
        <Stat label="Not yet paid" loading={invoices.isLoading} value={formatRupees(outstanding)} tone={outstanding > 0 ? 'warning' : 'default'} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <SearchInput value={search} onChange={setSearch} label="Search invoices" placeholder="Search number, delivery or vendor" className="sm:w-72" />
        <Select label="Status" hideLabel className="sm:w-48" value={status} onChange={e => setStatus(e.target.value)} options={STATUS_OPTIONS} />
        {filtered && <Button variant="ghost" onClick={() => { setStatus(''); setSearch('') }}>Clear filters</Button>}
        <Button className="sm:ml-auto" variant="secondary" icon={<Download size={16} />} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>

      <DataTable
        caption="Invoices"
        columns={columns}
        rows={rows}
        rowKey={i => i.id}
        loading={invoices.isLoading}
        error={invoices.error ? 'We could not load invoices. Check your connection and try again.' : undefined}
        onRetry={() => invoices.refetch()}
        initialSort={{ key: 'issued', direction: 'desc' }}
        empty={filtered
          ? { title: 'No invoices match these filters', action: <Button variant="secondary" onClick={() => { setStatus(''); setSearch('') }}>Clear filters</Button> }
          : { title: 'No invoices in this range', description: 'An invoice is created when a shipment or vendor load with an agreed price is delivered.' }}
      />
    </div>
  )
}
