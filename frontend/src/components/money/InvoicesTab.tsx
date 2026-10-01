import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { financeAPI } from '@/services/api'
import { Button, Checkbox, DataTable, SearchInput, Select, Stat, StatusPill, type Column, type DateRangeValue } from '@/components/ui'
import { downloadCsv, toCsv } from '@/utils/csv'
import { formatDate, formatRupees, pluralize } from '@/utils/display'
import { INVOICE_CSV_COLUMNS, invoiceCsvRows, type Invoice, type InvoiceSummary } from '@/utils/finance'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'issued', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
]
const REQUESTER_OPTIONS = [
  { value: '', label: 'All requesters' },
  { value: 'vendor', label: 'Vendors' },
  { value: 'customer', label: 'Customers' },
]

/** Invoices for the chosen dates, with what is outstanding and what came in this month. Each opens on its own page. */
export default function InvoicesTab({ range }: { range: DateRangeValue }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [requester, setRequester] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [search, setSearch] = useState('')

  const invoices = useQuery<Invoice[]>({
    queryKey: ['finance', 'invoices', range.from, range.to, status, requester, overdueOnly],
    queryFn: () => financeAPI.invoices({
      from: range.from, to: range.to, status: status || undefined, requester: requester || undefined, overdue: overdueOnly ? '1' : undefined,
    }) as Promise<Invoice[]>,
  })
  const summary = useQuery<InvoiceSummary>({ queryKey: ['finance', 'invoice-summary'], queryFn: () => financeAPI.invoiceSummary() })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (invoices.data ?? []).filter(i => !q || [i.invoice_number, i.reference, i.requester_name, i.billed_to_name].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [invoices.data, search])
  const filtered = !!(status || requester || overdueOnly || search)
  const clear = () => { setStatus(''); setRequester(''); setOverdueOnly(false); setSearch('') }
  const s = summary.data

  const columns: Column<Invoice>[] = [
    {
      key: 'number', header: 'Invoice', sortValue: i => i.invoice_number,
      cell: i => <Link to={`/money/invoices/${i.id}`} className="font-mono text-sm font-medium text-brand hover:underline" onClick={e => e.stopPropagation()}>{i.invoice_number}</Link>,
    },
    {
      key: 'status', header: 'Status', sortValue: i => i.status,
      cell: i => (
        <span className="block">
          <StatusPill status={i.status} />
          {i.paid_at && <span className="mt-0.5 block text-xs text-muted">Paid {formatDate(i.paid_at)}</span>}
        </span>
      ),
    },
    { key: 'issued', header: 'Issued', hideBelow: 'md', sortValue: i => i.issued_at, cell: i => formatDate(i.issued_at) },
    {
      key: 'due', header: 'Due', sortValue: i => i.due_date ?? '',
      cell: i => (
        <span className="block">
          {i.due_date ? formatDate(i.due_date) : '—'}
          {i.overdue && <span className="mt-0.5 block text-xs font-medium text-danger">Overdue {pluralize(i.days_overdue ?? 0, 'day')}</span>}
        </span>
      ),
    },
    { key: 'ref', header: 'Delivery', hideBelow: 'xl', sortValue: i => i.reference ?? '', cell: i => i.reference ?? '—' },
    {
      key: 'billed', header: 'Billed to', hideBelow: 'md', sortValue: i => i.requester_name ?? i.billed_to_name ?? '',
      cell: i => (
        <span className="block min-w-0">
          <span className="block truncate">{i.requester_name ?? i.billed_to_name ?? 'Not recorded'}</span>
          {i.requester_type && i.requester_type !== 'staff' && <span className="text-xs capitalize text-muted">{i.requester_type}</span>}
        </span>
      ),
    },
    { key: 'total', header: 'Total', align: 'right', sortValue: i => i.total, cell: i => <span className="tabular font-medium">{formatRupees(i.total)}</span> },
  ]

  const exportCsv = () => downloadCsv(`invoices-${range.from}-to-${range.to}.csv`, toCsv(invoiceCsvRows(rows), INVOICE_CSV_COLUMNS))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:max-w-3xl sm:grid-cols-3">
        <Stat label="Outstanding" loading={summary.isLoading} value={formatRupees(s?.outstanding ?? 0)}
          hint={s ? `${s.outstanding_count.toLocaleString('en-IN')} unpaid` : undefined} tone={(s?.outstanding ?? 0) > 0 ? 'warning' : 'default'} />
        <Stat label="Overdue" loading={summary.isLoading} value={formatRupees(s?.overdue ?? 0)}
          hint={s ? `${s.overdue_count.toLocaleString('en-IN')} past due date` : undefined} tone={(s?.overdue ?? 0) > 0 ? 'danger' : 'default'} />
        <Stat label="Collected this month" loading={summary.isLoading} value={formatRupees(s?.collected_this_month ?? 0)}
          hint={s ? `${s.collected_count.toLocaleString('en-IN')} paid` : undefined} tone="success" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <SearchInput value={search} onChange={setSearch} label="Search invoices" placeholder="Search number, delivery or name" className="sm:w-72" />
        <Select label="Status" hideLabel className="sm:w-44" value={status} onChange={e => setStatus(e.target.value)} options={STATUS_OPTIONS} />
        <Select label="Requester" hideLabel className="sm:w-44" value={requester} onChange={e => setRequester(e.target.value)} options={REQUESTER_OPTIONS} />
        <Checkbox label="Overdue only" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} />
        {filtered && <Button variant="ghost" onClick={clear}>Clear filters</Button>}
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
        onRowClick={i => navigate(`/money/invoices/${i.id}`)}
        initialSort={{ key: 'issued', direction: 'desc' }}
        empty={filtered
          ? { title: 'No invoices match these filters', action: <Button variant="secondary" onClick={clear}>Clear filters</Button> }
          : { title: 'No invoices in this range', description: 'An invoice is issued when a delivery with a price is completed, or when you set a price under To price.' }}
      />
    </div>
  )
}
