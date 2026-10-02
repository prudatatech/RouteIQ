import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Download } from 'lucide-react'
import { vendorAPI } from '@/services/api'
import { downloadInvoicePdf } from '@/services/vendorInvoicePdf'
import { useVendorContext } from '@/components/vendor/vendorContext'
import HowToPay from '@/components/vendor/HowToPay'
import { daysSince, invoiceLoadId, loadPath, overdueText, type VendorInvoice } from '@/components/vendor/loads'
import {
  Button, buttonClasses, DataTable, EmptyState, Page, PageHeader, SearchInput, Stat, StatusPill, Tabs, useTabParam, type Column, type TabItem,
} from '@/components/ui'
import { errorMessage, formatDate, formatRupees, pluralize } from '@/utils/display'

const isUnpaid = (i: VendorInvoice) => i.status !== 'paid' && i.status !== 'void'
const FILTERS = ['all', 'unpaid', 'paid'] as const

/** One button per row: fetches the PDF with the sign-in header, then downloads it. */
function PdfButton({ invoice }: { invoice: VendorInvoice }) {
  const [busy, setBusy] = useState(false)
  const download = async () => {
    setBusy(true)
    try {
      await downloadInvoicePdf(invoice.id, invoice.invoice_number)
    } catch (err) {
      toast.error(errorMessage(err, 'We could not download the invoice. Try again.'))
    } finally {
      setBusy(false)
    }
  }
  return <Button size="sm" variant="secondary" loading={busy} icon={<Download size={14} />} onClick={download} aria-label={`Download ${invoice.invoice_number} as PDF`}>PDF</Button>
}

/** The vendor's invoices, with the load and proof of delivery each one is for. Payments are made offline. */
export default function VendorInvoicesPage() {
  const { isVendor, isSignedIn } = useVendorContext()
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useTabParam(FILTERS, 'all', 'status')
  const focusId = params.get('open')

  const invoices = useQuery<VendorInvoice[]>({
    queryKey: ['vendor', 'invoices'],
    queryFn: () => vendorAPI.invoices() as Promise<VendorInvoice[]>,
    enabled: isVendor,
  })

  const all = useMemo(() => invoices.data ?? [], [invoices.data])
  const unpaid = all.filter(isUnpaid)
  const owed = unpaid.reduce((s, i) => s + (Number(i.total) || 0), 0)
  const now = Date.now()
  const oldest = unpaid.reduce<number | null>((max, i) => Math.max(max ?? 0, daysSince(i.issued_at, now) ?? 0), null)
  // The earliest due date among unpaid invoices, so the card says when, not just how long ago
  const nextDue = unpaid.map(i => i.due_date).filter((d): d is string => !!d).sort()[0] ?? null

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter(i => filter === 'all' || (filter === 'unpaid' ? isUnpaid(i) : i.status === 'paid'))
      .filter(i => !q || [i.invoice_number, i.reference].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [all, filter, search])

  const tabs: TabItem<(typeof FILTERS)[number]>[] = [
    { id: 'all', label: 'All', count: all.length },
    { id: 'unpaid', label: 'To pay', count: unpaid.length },
    { id: 'paid', label: 'Paid', count: all.filter(i => i.status === 'paid').length },
  ]

  const columns: Column<VendorInvoice>[] = [
    { key: 'number', header: 'Invoice', sortValue: i => i.invoice_number, cell: i => <span className="font-mono text-sm font-medium">{i.invoice_number}</span> },
    {
      key: 'load', header: 'Load', sortValue: i => i.reference ?? '',
      cell: i => {
        const id = invoiceLoadId(i)
        return id && i.reference
          ? <Link to={loadPath(id)} className="font-mono text-sm text-brand hover:underline" onClick={e => e.stopPropagation()}>{i.reference}</Link>
          : <span className="font-mono text-sm">{i.reference ?? '—'}</span>
      },
    },
    {
      key: 'issued', header: 'Issued / due', hideOnMobile: true, sortValue: i => i.issued_at,
      cell: i => (
        <span className="block">
          {formatDate(i.issued_at)}
          {isUnpaid(i) && i.due_date && <span className="block text-xs text-muted">Due {formatDate(i.due_date)}</span>}
        </span>
      ),
    },
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
          {isUnpaid(i) && overdueText(i) && <span className="mt-0.5 block text-xs font-medium text-danger">{overdueText(i)}</span>}
          {i.paid_at && <span className="mt-0.5 block text-xs text-muted">Paid {formatDate(i.paid_at)}</span>}
        </span>
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      cell: i => {
        const id = invoiceLoadId(i)
        return (
          <span className="flex flex-wrap items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
            {id && <Link to={`${loadPath(id)}#proof`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>Proof</Link>}
            <PdfButton invoice={i} />
          </span>
        )
      },
    },
  ]

  if (!isSignedIn || !isVendor) {
    return (
      <Page>
        <PageHeader title="Invoices and proofs" description="Your invoices, and the proof of delivery for each load." />
        <EmptyState
          title="Sign in to see your invoices"
          action={<Link to={`/login?as=vendor&next=${encodeURIComponent('/vendor/invoices')}`} className={buttonClasses({ variant: 'primary' })}>Sign in</Link>}
        />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader title="Invoices and proofs" description="An invoice is issued when your load is delivered. Each one links to its load and its proof of delivery.">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by invoice or load" className="max-w-sm" />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-3">
        <Stat label="Invoices" loading={invoices.isLoading} value={all.length.toLocaleString('en-IN')} />
        <Stat label="To pay" loading={invoices.isLoading} value={formatRupees(owed)} tone={owed > 0 ? 'warning' : 'default'} />
        <Stat
          className="col-span-2 sm:col-span-1"
          label="Oldest unpaid"
          loading={invoices.isLoading}
          value={oldest === null ? '—' : oldest === 0 ? 'Issued today' : pluralize(oldest, 'day') + ' old'}
          hint={nextDue ? `Due ${formatDate(nextDue)}` : undefined}
          tone={oldest !== null && oldest > 0 ? 'warning' : 'default'}
        />
      </div>

      {unpaid.length > 0 && <HowToPay invoiceNumber={unpaid.length === 1 ? unpaid[0].invoice_number : undefined} invoiceId={unpaid.length === 1 ? unpaid[0].id : undefined} />}

      <Tabs tabs={tabs} value={filter} onChange={setFilter} label="Filter invoices" />
      <DataTable
        caption="Your invoices"
        columns={columns}
        rows={rows}
        rowKey={i => i.id}
        selectedKey={focusId}
        loading={invoices.isLoading}
        error={invoices.isError ? 'We could not load your invoices. Check your connection and try again.' : undefined}
        onRetry={() => invoices.refetch()}
        initialSort={{ key: 'issued', direction: 'desc' }}
        empty={search || filter !== 'all'
          ? { title: 'No invoices match', description: 'Try another filter or search.' }
          : { title: 'No invoices yet', description: 'When one of your loads is delivered, its invoice appears here.' }}
      />
    </Page>
  )
}
