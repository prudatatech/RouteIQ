import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { vendorAPI } from '@/services/api'
import { DataTable, Page, PageHeader, SearchInput, Stat, StatusPill, type Column } from '@/components/ui'
import { formatDate, formatRupees } from '@/utils/display'
import type { Invoice } from '@/utils/finance'

/** The vendor's own invoices, issued when their loads are delivered. */
export default function VendorInvoicesPage() {
  const [search, setSearch] = useState('')
  const invoices = useQuery<Invoice[]>({
    queryKey: ['vendor', 'invoices'],
    queryFn: () => vendorAPI.invoices() as Promise<Invoice[]>,
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (invoices.data ?? []).filter(i => !q || [i.invoice_number, i.reference, i.status].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [invoices.data, search])

  const outstanding = (invoices.data ?? []).filter(i => i.status === 'issued').reduce((s, i) => s + i.total, 0)

  const columns: Column<Invoice>[] = [
    { key: 'number', header: 'Invoice', sortValue: i => i.invoice_number, cell: i => <span className="font-mono text-sm">{i.invoice_number}</span> },
    { key: 'issued', header: 'Issued', sortValue: i => i.issued_at, cell: i => formatDate(i.issued_at) },
    { key: 'ref', header: 'Delivery', hideOnMobile: true, sortValue: i => i.reference ?? '', cell: i => i.reference ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', hideOnMobile: true, sortValue: i => i.amount, cell: i => <span className="tabular">{formatRupees(i.amount)}</span> },
    {
      key: 'gst', header: 'GST', align: 'right', hideBelow: 'lg', sortValue: i => i.gst_amount,
      cell: i => (i.gst_rate > 0 ? <span className="tabular">{formatRupees(i.gst_amount)} ({i.gst_rate}%)</span> : <span className="text-muted">None</span>),
    },
    { key: 'total', header: 'Total', align: 'right', sortValue: i => i.total, cell: i => <span className="tabular font-medium">{formatRupees(i.total)}</span> },
    {
      key: 'status', header: 'Status', sortValue: i => i.status,
      cell: i => (
        <span className="block">
          <StatusPill status={i.status} />
          {i.paid_at && <span className="mt-0.5 block text-xs text-muted">Paid {formatDate(i.paid_at)}</span>}
        </span>
      ),
    },
  ]

  return (
    <Page>
      <PageHeader title="Invoices" description="An invoice is issued when your load is delivered.">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by invoice or delivery" className="max-w-sm" />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:max-w-lg">
        <Stat label="Invoices" loading={invoices.isLoading} value={(invoices.data?.length ?? 0).toLocaleString('en-IN')} />
        <Stat label="Not yet paid" loading={invoices.isLoading} value={formatRupees(outstanding)} tone={outstanding > 0 ? 'warning' : 'default'} />
      </div>

      <DataTable
        caption="Your invoices"
        columns={columns}
        rows={rows}
        rowKey={i => i.id}
        loading={invoices.isLoading}
        error={invoices.error ? 'We could not load your invoices. Check your connection and try again.' : undefined}
        onRetry={() => invoices.refetch()}
        initialSort={{ key: 'issued', direction: 'desc' }}
        empty={search
          ? { title: 'No invoices match your search' }
          : { title: 'No invoices yet', description: 'When one of your loads is delivered, its invoice appears here.' }}
      />
    </Page>
  )
}
