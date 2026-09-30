import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Download, FileText } from 'lucide-react'
import { capacityAPI, vendorAPI } from '@/services/api'
import { cargoKeys, custodyAPI } from '@/services/cargo'
import { downloadInvoicePdf } from '@/services/vendorInvoicePdf'
import { useVendorContext } from '@/components/vendor/vendorContext'
import {
  claimWindowText, nextAction, STAGE_LABELS, type LoadStage, type VendorLoadDetail,
} from '@/components/vendor/loads'
import { ActionCell, LoadFacts, ProblemPill, Route, TrackLink, TruckLine } from '@/components/vendor/LoadBits'
import RaiseClaimModal from '@/components/vendor/RaiseClaimModal'
import { CustodyTimeline } from '@/components/cargo/CustodyTimeline'
import { Steps } from '@/components/cargo/CargoBits'
import { holderLabel, claimTypeLabel } from '@/components/cargo/logic'
import {
  Alert, Button, buttonClasses, Card, DetailList, EmptyState, ErrorState, Page, PageHeader, Skeleton, StatusPill, useConfirm,
} from '@/components/ui'
import { errorMessage, formatDate, formatDateTime, formatRupees } from '@/utils/display'

const STEP_STAGES: LoadStage[] = ['waiting', 'accepted', 'assigned', 'on_the_way', 'delivered']

function stageSteps(stage: LoadStage) {
  if (stage === 'closed') return STEP_STAGES.map(key => ({ key, label: STAGE_LABELS[key], state: 'done' as const }))
  const at = STEP_STAGES.indexOf(stage)
  return STEP_STAGES.map((key, i) => ({ key, label: STAGE_LABELS[key], state: i < at ? 'done' as const : i === at ? 'current' as const : 'todo' as const }))
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-20 space-y-3">
      <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  )
}

function ProofOfDelivery({ pod }: { pod: NonNullable<VendorLoadDetail['pod']> }) {
  const signature = pod.signature_url ?? pod.signature_data
  const empty = !pod.photo_url && !signature && !pod.received_by
  if (empty) return <p className="text-sm text-muted">The driver has not recorded a photo or signature for this delivery.</p>
  return (
    <Card padded className="space-y-3 !p-4">
      {pod.received_by && <p className="text-sm text-text">Received by <span className="font-medium">{pod.received_by}</span></p>}
      <div className="flex flex-wrap gap-3">
        {pod.photo_url && (
          <a href={pod.photo_url} target="_blank" rel="noreferrer" className="block">
            <img src={pod.photo_url} alt="Delivery photo" loading="lazy" className="h-32 w-32 rounded-control border border-border object-cover sm:h-40 sm:w-40" />
          </a>
        )}
        {signature && (
          <a href={signature} target="_blank" rel="noreferrer" className="block">
            <img src={signature} alt="Receiver's signature" loading="lazy" className="h-32 w-44 rounded-control border border-border bg-white object-contain sm:h-40 sm:w-56" />
          </a>
        )}
      </div>
    </Card>
  )
}

export default function VendorLoadPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { isVendor } = useVendorContext()
  const [claiming, setClaiming] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const load = useQuery<VendorLoadDetail>({
    queryKey: ['vendor', 'load', id],
    queryFn: () => vendorAPI.load(id) as Promise<VendorLoadDetail>,
    enabled: isVendor && !!id,
    retry: false,
    refetchInterval: query => (query.state.data && ['delivered', 'closed'].includes(query.state.data.stage) ? false : 30_000),
  })

  const notFound = (load.error as { response?: { status?: number } } | null)?.response?.status === 404
  // A bid outcome notification carries the bid id: send it to the bid on Return trips
  const bids = useQuery({
    queryKey: ['vendor', 'bids'],
    queryFn: () => capacityAPI.myBids() as Promise<{ id: string }[]>,
    enabled: notFound,
  })

  const data = load.data
  const ref = data ? data.manifest_id ?? data.shipment_id : null
  const timeline = useQuery({
    queryKey: cargoKeys.timeline(ref ?? ''),
    queryFn: () => custodyAPI.timeline(ref as string),
    enabled: !!ref,
    refetchInterval: data && !['delivered', 'closed'].includes(data.stage) ? 30_000 : false,
  })

  const cancel = useMutation({
    mutationFn: () => vendorAPI.cancelRequest(id),
    onSuccess: () => {
      toast.success('Load cancelled. Dispatch has been told.')
      queryClient.invalidateQueries({ queryKey: ['vendor'] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not cancel this load. Try again.')),
  })

  if (notFound && bids.data?.some(b => b.id === id)) return <Navigate to={`/vendor/return-trips?bid=${encodeURIComponent(id)}`} replace />

  const header = (
    <PageHeader title="Load" back={{ to: '/vendor/loads', label: 'My loads' }} />
  )

  if (load.isLoading || (notFound && bids.isLoading)) {
    return <Page>{header}<Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></Page>
  }
  if (notFound) {
    return <Page>{header}<EmptyState title="We could not find this load" description="It may belong to another account, or the link is out of date." action={<Link to="/vendor/loads" className={buttonClasses({ variant: 'primary' })}>Back to My loads</Link>} /></Page>
  }
  if (load.isError || !data) {
    return <Page>{header}<ErrorState title="We could not load this load" description="Check your connection and try again." onRetry={() => load.refetch()} /></Page>
  }

  const action = nextAction(data)
  const canCancel = data.kind === 'posted' && !data.manifest_id && (data.status === 'pending' || data.status === 'approved')
  const claimLoad = data.manifest_id ? [{ id: data.id, label: data.code, manifest_id: data.manifest_id }] : []
  const finished = data.stage === 'delivered' || data.stage === 'closed'

  const askCancel = async () => {
    const ok = await confirm({
      title: 'Cancel this load?',
      message: `The load from ${data.pickup ?? 'the pickup'} to ${data.drop ?? 'the drop-off'} is withdrawn and dispatch is told. You can post it again later.`,
      confirmLabel: 'Cancel load',
      cancelLabel: 'Keep it',
      tone: 'danger',
    })
    if (ok) cancel.mutate()
  }

  const downloadPdf = async () => {
    if (!data.invoice) return
    setDownloading(true)
    try {
      await downloadInvoicePdf(data.invoice.id, data.invoice.invoice_number)
    } catch (err) {
      toast.error(errorMessage(err, 'We could not download the invoice. Try again.'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={<span className="font-mono">{data.code}</span>}
        back={{ to: '/vendor/loads', label: 'My loads' }}
        description={<Route pickup={data.pickup} drop={data.drop} className="text-sm text-text sm:text-base" />}
        actions={(
          <>
            <TrackLink load={data} />
            {canCancel && <Button variant="secondary" loading={cancel.isPending} onClick={askCancel}>Cancel load</Button>}
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={data.stage === 'closed' ? 'neutral' : data.stage === 'delivered' ? 'success' : 'info'}>{STAGE_LABELS[data.stage]}</StatusPill>
          <ProblemPill count={data.problems.length} />
          {data.kind === 'space' && <StatusPill tone="info" dot={false}>Return trip</StatusPill>}
        </div>
      </PageHeader>

      {data.problems.length > 0 && (
        <section aria-label="Problems" className="space-y-2">
          {data.problems.map(p => (
            <Alert key={p.id} tone="danger" title={<span className="inline-flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden="true" /> {p.title}</span>}>
              <p>{p.message}</p>
              {p.revised_eta && <p className="mt-1 font-medium">New arrival time: about {formatDateTime(p.revised_eta.eta_at)}</p>}
              {p.opened_at && <p className="mt-0.5 text-xs text-muted">Reported {formatDateTime(p.opened_at)}</p>}
            </Alert>
          ))}
        </section>
      )}

      <Card padded className="space-y-4">
        <Steps steps={stageSteps(data.stage)} label="Where your load is" />
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs text-muted">Next</p>
            <ActionCell action={action} className="text-sm" />
          </div>
          {data.where && (
            <p className="text-sm text-muted">
              {holderLabel(data.where.current_holder)}
              {data.where.depot?.name ? ` (${data.where.depot.name})` : ''}
            </p>
          )}
        </div>
      </Card>

      <Card padded>
        <DetailList
          columns={3}
          items={[
            { label: 'Pickup', value: data.pickup },
            { label: 'Drop', value: data.drop },
            { label: 'Load', value: <LoadFacts load={data} /> },
            { label: 'Truck', value: data.truck ? <TruckLine truck={data.truck} /> : 'Not assigned yet' },
            { label: 'Posted', value: formatDate(data.created_at) },
            { label: data.kind === 'space' ? 'Your bid' : 'Price', value: data.price != null ? formatRupees(data.price) : 'To be set by MargixIndia' },
          ]}
        />
      </Card>

      {data.lots.length > 0 && (
        <Section id="lots" title="Lots">
          <p className="text-sm text-muted">Your load was split so each part can go to its own drop. Each lot has its own proof of delivery.</p>
          <div className="space-y-3">
            {data.lots.map(l => (
              <Card key={l.code} padded className="space-y-2 !p-4">
                <p className="text-sm font-medium text-text">{l.text}</p>
                <p className="font-mono text-xs text-muted">{l.code}{l.vehicle?.plate_number ? ` · ${l.vehicle.plate_number}` : ''}</p>
                {l.pod && <ProofOfDelivery pod={l.pod} />}
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section title="Where your load has been">
        {!ref ? (
          <p className="text-sm text-muted">Nothing is recorded yet. This fills in once a truck is assigned and picks the load up.</p>
        ) : timeline.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : timeline.isError ? (
          <ErrorState compact title="We could not load the history" onRetry={() => timeline.refetch()} />
        ) : (timeline.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing is recorded yet. This fills in once the truck picks the load up.</p>
        ) : (
          <Card padded><CustodyTimeline events={timeline.data ?? []} /></Card>
        )}
      </Section>

      {(finished || data.pod) && data.lots.length === 0 && (
        <Section id="proof" title="Proof of delivery">
          {data.pod ? <ProofOfDelivery pod={data.pod} /> : <p className="text-sm text-muted">No proof of delivery is on record yet.</p>}
        </Section>
      )}

      <Section id="invoice" title="Invoice">
        {data.invoice ? (
          <Card padded className="flex flex-col gap-3 !p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono font-medium text-text">{data.invoice.invoice_number}</span>
                <StatusPill status={data.invoice.status} />
              </p>
              <p className="text-sm text-muted">
                {data.invoice.total != null ? `${formatRupees(data.invoice.total)} in all` : ''}
                {data.invoice.issued_at ? ` · issued ${formatDate(data.invoice.issued_at)}` : ''}
                {data.invoice.paid_at ? ` · paid ${formatDate(data.invoice.paid_at)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<Download size={16} />} loading={downloading} onClick={downloadPdf}>Download PDF</Button>
              <Link to="/vendor/invoices" className={buttonClasses({ variant: 'ghost' })}>All invoices</Link>
            </div>
          </Card>
        ) : (
          <p className="text-sm text-muted">{finished ? 'MargixIndia has not issued the invoice yet. You will be told when it is ready.' : 'An invoice is issued once your load is delivered.'}</p>
        )}
      </Section>

      <Section id="claims" title="Claims">
        {data.claims.length > 0 && (
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {data.claims.map(c => (
              <li key={c.id}>
                <Link to={`/vendor/claims?open=${encodeURIComponent(c.id)}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-subtle">
                  <span className="flex items-center gap-2 text-sm text-text">
                    <FileText size={16} aria-hidden="true" className="text-muted" />
                    <span className="font-mono font-medium">{c.code}</span> {claimTypeLabel(c.claim_type)}{c.lot_code ? ` · ${c.lot_code}` : ''}
                  </span>
                  <StatusPill status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">{claimWindowText(data.claim_window, formatDate)}</p>
          <Button variant="secondary" disabled={!data.claim_window.allowed || claimLoad.length === 0} onClick={() => setClaiming(true)}>Raise a claim</Button>
        </div>
      </Section>

      {claiming && (
        <RaiseClaimModal
          open
          loads={claimLoad}
          onClose={() => setClaiming(false)}
          onFiled={() => queryClient.invalidateQueries({ queryKey: ['vendor'] })}
        />
      )}
    </Page>
  )
}
