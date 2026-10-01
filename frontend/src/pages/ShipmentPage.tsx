import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Pencil, Play, Trash2, Truck } from 'lucide-react'
import {
  Button, DetailList, ErrorState, LoadingState, Page, PageHeader, StatusPill, buttonClasses, humanize,
} from '@/components/ui'
import { shipmentsAPI } from '@/services/api'
import { openChannel, supabase } from '@/services/supabase'
import { useRouteStatusActions } from '@/hooks/useRouteStatusActions'
import AssignVehicleModal from '@/components/shipments/AssignVehicleModal'
import EditShipmentModal from '@/components/shipments/EditShipmentModal'
import NextStepBar from '@/components/shipments/NextStepBar'
import RelatedLinks from '@/components/shipments/RelatedLinks'
import { ShipmentDetailSections, ShipmentRecordSections } from '@/components/shipments/ShipmentSections'
import { useDeleteShipment } from '@/components/shipments/useDeleteShipment'
import { nextStep, type NextAction } from '@/components/shipments/nextStep'
import { priorityTone, shipmentStatusLabel } from '@/components/shipments/format'
import { shipmentFlags } from '@/components/shipments/rules'
import type { ShipmentOverview, ShipmentRow } from '@/components/shipments/types'
import { deliveryPointsOf, destinationOf } from '@/components/shipments/format'
import { errorMessage, isNotFoundError, formatDateTime, formatKg, formatRupees } from '@/utils/display'

/** A shipment's own page: what is next for it, everything it links to, and the sections of the drawer. */
export default function ShipmentPage() {
  const { id = '' } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const tripActions = useRouteStatusActions()
  const [editing, setEditing] = useState<ShipmentRow | null>(null)
  const [assigning, setAssigning] = useState<ShipmentRow | null>(null)

  const { data: overview, isLoading, isError, error, refetch } = useQuery<ShipmentOverview>({
    queryKey: ['shipments', 'overview', id],
    queryFn: () => shipmentsAPI.overview(id),
    enabled: !!id,
    refetchInterval: 30_000,
    retry: (count, err) => !isNotFoundError(err) && count < 2,
  })

  // Keep the page current when the shipment, its trip or its cargo change anywhere
  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['shipments', 'overview'] })
    const channel = openChannel(`public:shipment_page:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient, id])

  const shipment = overview?.shipment ?? null
  const del = useDeleteShipment(shipment, () => navigate('/shipments', { replace: true }))

  const step = useMemo(() => {
    if (!overview) return null
    const s = overview.shipment
    return nextStep({
      kind: overview.kind,
      status: s.status === 'completed' ? 'delivered' : s.status,
      isMaster: s.is_master === true,
      lots: s.lots_summary ? { count: s.lots_summary.count, delivered: s.lots_summary.delivered_lots } : null,
      holder: s.current_holder,
      onHoldReason: s.on_hold_reason,
      biddingOpen: !!s.open_bidding && !s.bid_id,
      plate: overview.vehicle?.plate_number ?? null,
      trip: overview.trip ? { status: overview.trip.status, stopCount: overview.trip.stop_count, stopsDone: overview.trip.stops_done } : null,
      openProblems: overview.problems.filter(p => p.open).map(p => ({ id: p.id, code: p.code })),
      price: overview.price,
      invoice: overview.invoice ? { status: overview.invoice.status, number: overview.invoice.invoice_number } : null,
    })
  }, [overview])

  if (isLoading) return <Page><LoadingState label="Loading shipment…" /></Page>
  if (isError || !overview || !shipment || !step) {
    const notFound = isNotFoundError(error)
    return (
      <Page>
        <PageHeader back={{ to: '/shipments', label: 'Shipments' }} title="Shipment" />
        <ErrorState
          title={notFound ? 'We could not find that shipment' : 'Something went wrong'}
          description={notFound ? `Nothing matches "${id}". Check the tracking ID or open it from the Shipments list.` : errorMessage(error, 'We could not load this shipment. Check your connection and try again.')}
          onRetry={notFound ? undefined : () => refetch()}
        />
      </Page>
    )
  }

  const s = shipment
  const f = shipmentFlags(s)

  // A vendor's request is decided, priced and given a vehicle in the Requests inbox
  const requestHref = `/requests?open=${encodeURIComponent(overview.requester.id ?? '')}&source=vendor`
  const requestOnly = overview.kind === 'request'
  const goToCargo = () => document.getElementById('shipment-cargo')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const sendTrip = async () => {
    if (!overview.trip) return
    await tripActions.dispatch({ id: overview.trip.id, status: overview.trip.status })
    queryClient.invalidateQueries({ queryKey: ['shipments'] })
  }

  const actionFor = (a: NextAction | null) => {
    if (!a) return null
    switch (a.kind) {
      case 'assign':
        return <Button icon={<Truck size={16} />} onClick={() => setAssigning(s)}>{a.label}</Button>
      case 'send':
        return <Button icon={<Play size={16} />} onClick={sendTrip} loading={tripActions.isPending}>{a.label}</Button>
      case 'set_price':
        // A vendor load's price is set on the vendor's request; a shipment's on the shipment
        return overview.kind !== 'shipment' && overview.requester.id
          ? <Link to={requestHref} className={buttonClasses({})}>{a.label}</Link>
          : <Button onClick={() => setEditing(s)}>{a.label}</Button>
      case 'open_request':
        return <Link to={requestHref} className={buttonClasses({})}>{a.label}</Link>
      case 'open_problem':
        return <Link to={`/cargo/exceptions/${a.problemId}`} className={buttonClasses({})}>{a.label}</Link>
      case 'open_invoice':
        return <Link to={overview.invoice ? `/money/invoices/${overview.invoice.id}` : '/money?tab=to-price'} className={buttonClasses({})}>{a.label}</Link>
      case 'open_bids':
        return <Link to="/bids" className={buttonClasses({})}>{a.label}</Link>
      case 'open_cargo':
      case 'open_lots':
        return <Button onClick={goToCargo}>{a.label}</Button>
    }
  }

  return (
    <Page>
      <PageHeader
        back={{ to: '/shipments', label: 'Shipments' }}
        title={<span className="inline-flex flex-wrap items-center gap-3"><span className="font-mono">{s.tracking_id}</span> {requestOnly
          ? <StatusPill status={s.status} kind="request" />
          : <StatusPill status={s.status} kind="cargo">{shipmentStatusLabel(s.status)}</StatusPill>}</span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {f.master && <StatusPill tone="brand" dot={false}>Split into lots</StatusPill>}
            {f.lot && s.lot_label && <StatusPill tone="brand" dot={false}>Lot {s.lot_label}</StatusPill>}
            {s.priority && <StatusPill tone={priorityTone[s.priority] ?? 'neutral'} dot={false}>{humanize(s.priority)} priority</StatusPill>}
          </span>
        }
        actions={
          <>
            {!requestOnly && !f.manifestOnly && f.canDelete && (
              <Button variant={s.status === 'cancelled' ? 'ghost' : 'danger'} icon={<Trash2 size={16} />} onClick={del.remove} loading={del.isPending}>Delete</Button>
            )}
            {!requestOnly && !f.manifestOnly && <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditing(s)}>Edit</Button>}
            <Link to={`/shipments/${s.id}/manifest`} className={buttonClasses({ variant: 'secondary' })}>
              <FileText size={16} aria-hidden="true" /> Manifest and label
            </Link>
          </>
        }
      />

      <NextStepBar step={step} action={actionFor(step.action)} />

      <RelatedLinks overview={overview} />

      {requestOnly ? (
        <RequestDetails shipment={s} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 space-y-6 rounded-card border border-border bg-surface p-4 sm:p-6 lg:col-span-7">
            <ShipmentDetailSections shipment={s} onAssign={setAssigning} />
          </div>
          <div className="min-w-0 space-y-6 rounded-card border border-border bg-surface p-4 sm:p-6 lg:col-span-5">
            <ShipmentRecordSections key={s.id} shipment={s} />
          </div>
        </div>
      )}

      <EditShipmentModal shipment={editing} onClose={() => setEditing(null)} />
      <AssignVehicleModal shipment={assigning} onClose={() => setAssigning(null)} />
    </Page>
  )
}

/** What a vendor asked for, before any vehicle is assigned: there is no load, trip or cargo record yet. */
function RequestDetails({ shipment: s }: { shipment: ShipmentRow }) {
  const drop = destinationOf(s)
  return (
    <section aria-label="The request" className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-text">The request</h2>
      <DetailList
        columns={3}
        items={[
          { label: 'Pickup', value: s.origin_name || s.origin_address },
          { label: 'Drop', value: drop?.name || drop?.address },
          ...(deliveryPointsOf(s).length > 1 ? [{ label: 'Stops', value: deliveryPointsOf(s).length.toLocaleString('en-IN') }] : []),
          { label: 'Capacity needed', value: formatKg(s.total_weight_kg) },
          { label: 'Price', value: s.freight_charge != null ? formatRupees(s.freight_charge) : 'Not set' },
          { label: 'Requested', value: formatDateTime(s.created_at) },
        ]}
      />
    </section>
  )
}
