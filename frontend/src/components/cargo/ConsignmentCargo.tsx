import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  AlertTriangle, ArrowRightLeft, Building2, Hand, KeyRound, LogIn, LogOut, PackageCheck, PackagePlus, Play, RotateCcw, Truck, Undo2, User, Warehouse,
} from 'lucide-react'
import { Button, DetailList, ErrorState, Skeleton, StatusPill, useConfirm } from '@/components/ui'
import { errorMessage, formatRelative } from '@/utils/display'
import { cargoKeys, custodyAPI, type CargoRef, type WhereIsIt } from '@/services/cargo'
import { PiecesBar, SlaBadge } from './CargoBits'
import { useNow } from './useNow'
import { CustodyTimeline } from './CustodyTimeline'
import RaiseExceptionModal from './RaiseExceptionModal'
import {
  DeliveryModal, HoldModal, HubModal, MoveToVehicleModal, PickupModal, ReattemptModal, StartReturnModal, type ConsignmentModal,
} from './ConsignmentActionModals'
import { consignmentActions, exceptionTypeLabel, holderLabel } from './logic'
import LotsPanel from './LotsPanel'
import type { SplitAvailable } from './lots'

const HOLDER_ICON = { consignor: User, vehicle: Truck, hub: Warehouse, consignee: PackageCheck } as const

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-text">{children}</h3>
}

/** "Where is it now" for one consignment (GET /cargo/where/:ref). */
export function WhereCard({ where, now }: { where: WhereIsIt; now: number }) {
  const Icon = HOLDER_ICON[where.current_holder] ?? Building2
  const place = where.current_holder === 'vehicle' && where.vehicle
    ? (
      <span>
        <Link to={`/fleet/${where.vehicle.id}`} className="font-mono font-medium text-brand hover:underline">{where.vehicle.plate_number}</Link>
        {where.vehicle.driver_name && <span className="text-muted"> · {where.vehicle.driver_name}</span>}
        {where.vehicle.last_seen_at && <span className="block text-xs text-muted">Last seen {formatRelative(where.vehicle.last_seen_at, now)}</span>}
      </span>
    )
    : where.current_holder === 'hub' && where.depot
      ? <span><span className="font-medium">{where.depot.name}</span>{where.depot.address && <span className="block text-xs text-muted">{where.depot.address}</span>}</span>
      : null
  const attempts = where.delivery_attempts > 0 || where.max_delivery_attempts
    ? `${where.delivery_attempts.toLocaleString('en-IN')}${where.max_delivery_attempts ? ` of ${where.max_delivery_attempts.toLocaleString('en-IN')}` : ''}`
    : 'None yet'

  return (
    <div className="space-y-4 rounded-control border border-border p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden="true"><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
            {holderLabel(where.current_holder)}
            <StatusPill status={where.status} kind="cargo" />
            {where.rto && <StatusPill tone="warning" dot={false}><Undo2 size={12} aria-hidden="true" /> Return to sender</StatusPill>}
          </p>
          {place && <div className="mt-0.5 text-sm text-text">{place}</div>}
          {where.status === 'on_hold' && where.on_hold_reason && <p className="mt-1 text-xs text-warning">On hold: {where.on_hold_reason}</p>}
        </div>
      </div>
      <PiecesBar pieces={where.pieces} />
      <DetailList
        items={[
          { label: 'Seal', value: where.seal_number ? <span className="font-mono">{where.seal_number}</span> : 'No seal recorded' },
          { label: 'Delivery attempts', value: attempts },
          ...(where.delivery_otp_required ? [{ label: 'Delivery OTP', value: 'Required at delivery' }] : []),
        ]}
      />
      {where.open_exceptions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted">Open cases</p>
          <ul className="space-y-1.5">
            {where.open_exceptions.map(x => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/cargo/exceptions/${x.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-danger hover:underline">
                  <AlertTriangle size={14} aria-hidden="true" /> {x.code} · {exceptionTypeLabel(x.type)}
                </Link>
                <SlaBadge dueAt={x.sla_due_at} status={x.status} now={now} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Cargo custody for one consignment: where it is now, the actions its state allows, its lots, and
 * the custody timeline. Used in the shipment drawer and for vendor loads. `code` is the RTX-/CM- id
 * (a lot's is `RTX-ABC123-B`). `figures` are its weight, declared value and freight, for a split.
 */
export default function ConsignmentCargo({ code, cargoRef, figures }: { code: string; cargoRef: CargoRef; figures?: Omit<SplitAvailable, 'pieces'> }) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const now = useNow(30_000)
  const [modal, setModal] = useState<ConsignmentModal | 'raise' | null>(null)

  const where = useQuery({ queryKey: cargoKeys.where(code), queryFn: () => custodyAPI.where(code), refetchInterval: 30_000 })
  const timeline = useQuery({ queryKey: cargoKeys.timeline(code), queryFn: () => custodyAPI.timeline(code) })

  const custody = useMutation({
    mutationFn: custodyAPI.record,
    onSuccess: (_d, body) => {
      queryClient.invalidateQueries({ queryKey: cargoKeys.all })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success(body.kind === 'release_hold' ? `${code} released from hold` : body.kind === 'departed' ? `${code} is in transit` : 'Saved')
    },
    onError: err => toast.error(errorMessage(err, 'We could not save that. Try again.')),
  })
  const otp = useMutation({
    mutationFn: () => custodyAPI.sendOtp(cargoRef),
    onSuccess: () => toast.success('Delivery OTP sent to the receiver'),
    onError: err => toast.error(errorMessage(err, 'We could not send the OTP. Try again in a minute.')),
  })

  if (where.isLoading) {
    return (
      <div className="space-y-3">
        <Heading>Where is it now</Heading>
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (where.isError || !where.data) {
    return (
      <div className="space-y-3">
        <Heading>Where is it now</Heading>
        <ErrorState compact title="We could not load where this consignment is" onRetry={() => where.refetch()} />
      </div>
    )
  }

  const w = where.data
  const can = consignmentActions(w)
  const release = async () => {
    const ok = await confirm({ title: `Release the hold on ${code}?`, message: 'The goods can move again as planned.', confirmLabel: 'Release hold' })
    if (ok) custody.mutate({ ref: cargoRef, kind: 'release_hold' })
  }
  const depart = async () => {
    const ok = await confirm({ title: `Mark ${code} in transit?`, message: `The goods have left the pickup on ${w.vehicle?.plate_number ?? 'the vehicle'}.`, confirmLabel: 'Mark in transit' })
    if (ok) custody.mutate({ ref: cargoRef, kind: 'departed' })
  }
  const sendOtp = async () => {
    const ok = await confirm({
      title: `Send a delivery OTP for ${code}?`,
      message: 'A 6-digit code valid for 24 hours goes to the receiver. The driver needs it to complete the delivery. Any earlier code stops working.',
      confirmLabel: 'Send OTP',
    })
    if (ok) otp.mutate()
  }

  // Movement goes through custody events with counts and proof, never a raw status change
  const buttons = [
    can.pickup && <Button key="pickup" size="sm" icon={<PackagePlus size={14} />} onClick={() => setModal('pickup')}>Record pickup</Button>,
    can.depart && <Button key="depart" size="sm" variant="secondary" icon={<Play size={14} />} loading={custody.isPending && custody.variables?.kind === 'departed'} onClick={depart}>Mark in transit</Button>,
    can.deliver && <Button key="deliver" size="sm" icon={<PackageCheck size={14} />} onClick={() => setModal('deliver')}>Record delivery</Button>,
    can.moveToVehicle && <Button key="move" size="sm" variant="secondary" icon={<ArrowRightLeft size={14} />} onClick={() => setModal('move')}>Move to another vehicle</Button>,
    can.hubIn && <Button key="hub_in" size="sm" variant="secondary" icon={<LogIn size={14} />} onClick={() => setModal('hub_in')}>Hub in</Button>,
    can.hubOut && <Button key="hub_out" size="sm" variant="secondary" icon={<LogOut size={14} />} onClick={() => setModal('hub_out')}>Hub out</Button>,
    can.reattemptOn && <Button key="reattempt" size="sm" variant="secondary" icon={<RotateCcw size={14} />} onClick={() => setModal('reattempt')}>Re-attempt</Button>,
    can.sendOtp && <Button key="otp" size="sm" variant="secondary" icon={<KeyRound size={14} />} loading={otp.isPending} onClick={sendOtp}>Send delivery OTP</Button>,
    can.hold && <Button key="hold" size="sm" variant="secondary" icon={<Hand size={14} />} onClick={() => setModal('hold')}>Hold</Button>,
    can.release && <Button key="release" size="sm" variant="secondary" icon={<Hand size={14} />} loading={custody.isPending && custody.variables?.kind === 'release_hold'} onClick={release}>Release hold</Button>,
    can.startReturn && <Button key="return" size="sm" variant="secondary" icon={<Undo2 size={14} />} onClick={() => setModal('return')}>Start return</Button>,
    can.raiseException && <Button key="raise" size="sm" variant="ghost" icon={<AlertTriangle size={14} />} onClick={() => setModal('raise')}>Raise exception</Button>,
  ].filter(Boolean)

  const common = { cargoRef, code, where: w, onClose: () => setModal(null) }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Heading>Where is it now</Heading>
        <WhereCard where={w} now={now} />
        {w.is_master && (
          <p className="text-sm text-muted">This consignment is split into lots. The goods are picked up, moved and delivered per lot: open a lot below to work it.</p>
        )}
        {buttons.length > 0 && <div className="flex flex-wrap gap-2">{buttons}</div>}
      </section>

      <LotsPanel code={code} cargoRef={cargoRef} where={w} figures={figures} />

      <section className="space-y-3">
        <Heading>Custody history</Heading>
        {timeline.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : timeline.isError ? (
          <ErrorState compact title="We could not load the custody history" onRetry={() => timeline.refetch()} />
        ) : (timeline.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">No handover recorded yet. Pickup, hubs, transfers and delivery appear here with counts, photos and signatures.</p>
        ) : (
          <CustodyTimeline events={timeline.data ?? []} showLots={w.is_master} />
        )}
      </section>

      {modal === 'raise' && <RaiseExceptionModal open consignment={{ ref: cargoRef, code, where: w }} onClose={() => setModal(null)} />}
      {modal === 'move' && <MoveToVehicleModal {...common} />}
      {modal === 'hold' && <HoldModal {...common} />}
      {modal === 'hub_in' && <HubModal {...common} direction="in" />}
      {modal === 'hub_out' && <HubModal {...common} direction="out" />}
      {modal === 'reattempt' && can.reattemptOn && <ReattemptModal {...common} caseId={can.reattemptOn} />}
      {modal === 'return' && <StartReturnModal {...common} />}
      {modal === 'pickup' && <PickupModal {...common} />}
      {modal === 'deliver' && <DeliveryModal {...common} />}
    </div>
  )
}
