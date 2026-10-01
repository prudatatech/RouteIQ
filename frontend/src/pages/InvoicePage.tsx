import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, Download, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { invoicesAPI } from '@/services/api'
import { Alert, Button, EmptyState, ErrorState, LoadingState, Page, PageHeader, StatusPill } from '@/components/ui'
import InvoiceDocument from '@/components/money/InvoiceDocument'
import InvoiceReports from '@/components/money/InvoiceReports'
import { CustomerProfileEditor } from '@/components/requests/CustomerProfileEditor'
import { MarkPaidModal, VoidModal } from '@/components/money/InvoiceModals'
import { requesterHref } from '@/components/shipments/requesterHref'
import { downloadBlob } from '@/utils/download'
import { errorMessage, isNotFoundError, tripNumber } from '@/utils/display'
import type { InvoiceDetail } from '@/utils/finance'

const REQUESTER_LABEL: Record<string, string> = {
  customer_booking: 'Customer booking',
  vendor_load: 'Vendor load',
  vendor_bid: 'Vendor bid',
  staff: 'Created by staff',
}
const linkClass = 'font-medium text-brand hover:underline'

function Related({ inv }: { inv: InvoiceDetail }) {
  const { shipment, requester, trip } = inv.links
  const requesterLink = requester ? requesterHref(requester) : null
  const item = (label: string, body: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-text">{body}</dd>
    </div>
  )
  return (
    <section aria-label="Related" className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-text">Related</h2>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
        {item('Shipment', shipment
          ? <Link to={`/shipments/${encodeURIComponent(shipment.id)}`} className={`${linkClass} font-mono`}>{shipment.code}</Link>
          : <span className="text-muted">Not on record</span>)}
        {item(requester ? (REQUESTER_LABEL[requester.kind] ?? 'Requester') : 'Requester', requester && requester.kind !== 'staff'
          ? (requesterLink
            ? <Link to={requesterLink} className={linkClass}>{requester.name ?? inv.buyer.name ?? 'Open'}</Link>
            : <span>{requester.name ?? inv.buyer.name ?? '—'}</span>)
          : <span className="text-muted">{inv.buyer.name ?? 'Created by staff'}</span>)}
        {item('Trip', trip
          ? <span className="inline-flex flex-wrap items-center gap-2"><Link to={`/routes/${trip.id}`} className={linkClass}>{tripNumber(trip.id)}</Link><StatusPill status={trip.status} kind="route" /></span>
          : <span className="text-muted">No trip yet</span>)}
      </dl>
    </section>
  )
}

/** One invoice: the document, its payment status, PDF, and the shipment, requester and trip it belongs to. */
export default function InvoicePage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [paying, setPaying] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [editingBuyer, setEditingBuyer] = useState(false)

  const query = useQuery({ queryKey: ['finance', 'invoice', id], queryFn: () => invoicesAPI.get(id), enabled: !!id, retry: (count, err) => !isNotFoundError(err) && count < 2 })
  const inv = query.data

  const pdf = useMutation({
    mutationFn: () => invoicesAPI.pdf(id),
    onSuccess: blob => downloadBlob(`${inv?.invoice_number ?? 'invoice'}.pdf`, blob),
    onError: err => toast.error(errorMessage(err, 'We could not prepare the PDF. Try again.')),
  })

  const changed = (message: string) => {
    toast.success(message)
    setPaying(false)
    setVoiding(false)
    queryClient.invalidateQueries({ queryKey: ['finance'] })
    queryClient.invalidateQueries({ queryKey: ['shipments'] })
  }

  if (query.isLoading) return <Page><LoadingState label="Loading invoice…" /></Page>
  if (query.isError || !inv) {
    const notFound = isNotFoundError(query.error)
    return (
      <Page>
        <PageHeader back={{ to: '/money?tab=invoices', label: 'Money' }} title="Invoice" />
        {notFound
          ? <EmptyState title="We could not find this invoice" description="It may have been removed, or the link is wrong." />
          : <ErrorState title="We could not load this invoice" onRetry={() => query.refetch()} />}
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        back={{ to: '/money?tab=invoices', label: 'Money' }}
        title={<span className="inline-flex flex-wrap items-center gap-3"><span className="font-mono">{inv.invoice_number}</span> <StatusPill status={inv.status} />{inv.overdue && <StatusPill tone="danger">Overdue {inv.days_overdue} {inv.days_overdue === 1 ? 'day' : 'days'}</StatusPill>}</span>}
        description={inv.status === 'issued' ? 'Waiting for payment. Mark it paid when the money arrives.' : undefined}
        actions={(
          <>
            {inv.buyer.kind === 'customer' && inv.buyer.id && (
              <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditingBuyer(true)}>Edit customer details</Button>
            )}
            <Button variant="secondary" icon={<Download size={16} />} loading={pdf.isPending} onClick={() => pdf.mutate()}>Download PDF</Button>
            {inv.status === 'issued' && (
              <>
                <Button variant="secondary" icon={<Ban size={16} />} onClick={() => setVoiding(true)}>Void</Button>
                <Button icon={<CheckCircle2 size={16} />} onClick={() => setPaying(true)}>Mark paid</Button>
              </>
            )}
          </>
        )}
      />

      {inv.seller_gaps.length > 0 && (
        <Alert
          tone="warning"
          title="Company details are missing on this invoice"
          action={<Link to="/admin/settings" className="text-sm font-medium text-brand hover:underline">Open Settings</Link>}
        >
          Add your {inv.seller_gaps.join(', ')} under Company and invoicing. Invoices show whatever is saved there.
        </Alert>
      )}

      <InvoiceDocument inv={inv} />
      <Related inv={inv} />
      <InvoiceReports invoiceId={inv.id} />

      {inv.buyer.kind === 'customer' && inv.buyer.id && (
        <CustomerProfileEditor customerId={inv.buyer.id} open={editingBuyer} onClose={() => setEditingBuyer(false)} />
      )}
      <MarkPaidModal invoice={inv} open={paying} onClose={() => setPaying(false)} onDone={() => changed('Invoice marked as paid')} />
      <VoidModal invoice={inv} open={voiding} onClose={() => setVoiding(false)} onDone={() => changed('Invoice voided')} />
    </Page>
  )
}
