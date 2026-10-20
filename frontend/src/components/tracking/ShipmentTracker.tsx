import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Activity, ArrowRight, Box, Check, CheckCircle2, Clock, Copy, CornerDownRight,
  FileText, MapPin, Navigation, Package, PackageCheck, Printer, Radio, Share2,
  ShieldAlert, ShieldCheck, Truck, UserCheck, Zap
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, DetailList } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { Timeline } from '@/components/ui/Timeline'
import { MapView, type MapPoint, type MapVehicle } from '@/components/map'
import { fetchTrackedRoute, type DrivingRoute } from '@/components/map/directions'
import { formatKg, formatMinutes, formatDateTime, formatPieces, formatRelative } from '@/utils/display'
import { formatAddress } from '@/utils/address'
import {
  isPartlyDelivered, lotIsDone, lotLine, partDeliveredStep, partDeliveredText,
  publicHistory, splitDestination, type PublicDrop, type PublicLot
} from './publicView'

/** Vehicle fields the public tracking endpoint returns — no driver identity or phone. */
export interface TrackedVehicle {
  id?: string | null
  plate_number?: string | null
  type?: string | null
  status?: string | null
  lat?: number | null
  lng?: number | null
}

export interface TrackedDestination {
  name?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
}

/** Shape of `GET /shipments/track/:trackingId` (see backend-ts `ShipmentService.getPublicTracking`). */
export interface ShipmentTrackingData {
  tracking_id: string
  status: string
  priority?: string | null
  total_items?: number | null
  total_weight_kg?: number | null
  origin_name?: string | null
  origin_address?: string | null
  origin_lat?: number | null
  origin_lng?: number | null
  destination?: TrackedDestination | null
  vehicle?: TrackedVehicle | null
  /** Arrival estimate from the vehicle's position to the next stop (straight line, average speed). */
  eta_minutes?: number | null
  /** Status timeline, public-safe: status and time only, no names. See ShipmentService.getPublicTracking. */
  history?: { status: string; at: string }[] | null
  /** A split booking: how each lot stands. */
  lots?: PublicLot[] | null
  /** A multi-drop booking: its drops, when the answer lists them. */
  drops?: PublicDrop[] | null
}

type LatLngPoint = { lat: number; lng: number }

/** Where the vehicle is heading next: the pickup for a manifest that is not yet in transit, otherwise the drop. */
function nextStopOf(shipment: ShipmentTrackingData): LatLngPoint | null {
  const toPickup = shipment.tracking_id.startsWith('CM-') && shipment.status !== 'in_transit'
  const origin = shipment.origin_lat != null && shipment.origin_lng != null
    ? { lat: shipment.origin_lat, lng: shipment.origin_lng } : null
  const drop = shipment.destination?.lat != null && shipment.destination?.lng != null
    ? { lat: shipment.destination.lat, lng: shipment.destination.lng } : null
  return toPickup ? origin ?? drop : drop
}

/** Road route (with live traffic) from the vehicle to its next stop; null when unavailable. */
function useRemainingRoute(trackingId: string | null, vehicle: LatLngPoint | null, stop: LatLngPoint | null, enabled: boolean) {
  // ~100 m rounding so each position poll does not trigger a new Directions request.
  const key = trackingId && vehicle && stop && enabled
    ? [vehicle.lat.toFixed(3), vehicle.lng.toFixed(3), stop.lat.toFixed(5), stop.lng.toFixed(5)].join(',')
    : null
  const [result, setResult] = useState<{ key: string; route: DrivingRoute | null } | null>(null)
  useEffect(() => {
    if (!key) return
    const ctrl = new AbortController()
    fetchTrackedRoute(trackingId!, key, ctrl.signal)
      .then(route => setResult({ key, route }))
      .catch(() => { /* aborted or failed: fall back to the backend estimate */ })
    return () => ctrl.abort()
  }, [key, trackingId])
  return key && result?.key === key ? result.route : null
}

const STEPS = [
  { key: 'created', label: 'Booked', icon: Package },
  { key: 'assigned', label: 'Assigned', icon: UserCheck },
  { key: 'picked_up', label: 'Picked Up', icon: PackageCheck },
  { key: 'in_transit', label: 'In Transit', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle2 },
] as const

function stepIndex(status: string | undefined) {
  if (!status) return -1
  if (isPartlyDelivered(status)) return STEPS.findIndex(s => s.key === 'in_transit')
  const idx = STEPS.findIndex(s => s.key === status)
  if (idx >= 0) return idx
  if (status === 'exception') return STEPS.findIndex(s => s.key === 'in_transit')
  if (status !== 'cancelled') return 0
  return -1
}

/**
 * One shipment's status timeline, origin/destination, ETA, carrier and live map.
 * Used by the public customer tracker (`/track/:trackingId`) and reusable by vendor
 * tracking.
 */
export function ShipmentTracker({ shipment, trackingId, isLoading, error, onRetry, className }: {
  trackingId?: string
  shipment: ShipmentTrackingData | null | undefined
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const vLat = shipment?.vehicle?.lat
  const vLng = shipment?.vehicle?.lng
  const vehiclePos = vLat != null && vLng != null ? { lat: vLat, lng: vLng } : null
  const nextStop = useMemo(() => (shipment ? nextStopOf(shipment) : null), [shipment])
  const inProgress = !!shipment && shipment.status !== 'delivered' && shipment.status !== 'cancelled'
  const drivingRoute = useRemainingRoute(shipment?.tracking_id ?? null, vehiclePos, nextStop, inProgress)

  if (isLoading) {
    return (
      <div className={clsx('space-y-6', className)}>
        <div className="rounded-3xl border border-border bg-surface p-6 sm:p-8 space-y-6 shadow-xs animate-pulse">
          <div className="flex items-center justify-between">
            <Skeleton className="h-9 w-64 rounded-xl" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={clsx('rounded-3xl border border-border bg-surface p-6 sm:p-8 shadow-xs', className)}>
        <ErrorState title="We could not load this shipment" description={error} onRetry={onRetry} />
      </div>
    )
  }

  if (!shipment) {
    return (
      <div className={clsx('rounded-3xl border border-border bg-surface p-6 sm:p-8 shadow-xs text-center', className)}>
        <EmptyState
          icon={<MapPin size={24} className="text-brand" />}
          title={trackingId ? `No shipment found for "${trackingId}"` : 'No shipment found'}
          description="Check the consignment code for typos. Consignments begin with RTX- or CM-LOAD. If you were sent a link, please request a refreshed code from your dispatcher."
        />
      </div>
    )
  }

  const cancelled = shipment.status === 'cancelled'
  const delivered = shipment.status === 'delivered'
  const failed = shipment.status === 'exception'
  const partly = isPartlyDelivered(shipment.status)
  const lots = shipment.lots ?? []
  const isSplit = lots.length > 0
  const lotsDone = lots.filter(lotIsDone).length
  const history = publicHistory(shipment.history, shipment.status)
  const currentStepIdx = cancelled ? -1 : partly && isSplit ? partDeliveredStep(lots) : stepIndex(shipment.status)

  const vehicles: MapVehicle[] = (shipment.vehicle?.lat != null && shipment.vehicle?.lng != null)
    ? [{
      id: shipment.vehicle.id ?? 'vehicle',
      label: shipment.vehicle.plate_number ?? 'Your delivery',
      status: shipment.vehicle.status ?? 'on_route',
      position: { lat: shipment.vehicle.lat, lng: shipment.vehicle.lng },
    }]
    : []
  const points: MapPoint[] = (shipment.destination?.lat != null && shipment.destination?.lng != null)
    ? [{
      id: 'drop',
      kind: 'drop',
      label: `Delivery address: ${shipment.destination.name ?? 'Destination'}`,
      position: { lat: shipment.destination.lat, lng: shipment.destination.lng },
    }]
    : []

  const etaMinutes = drivingRoute ? drivingRoute.durationSeconds / 60 : shipment.eta_minutes
  const route = drivingRoute ? { coordinates: drivingRoute.coordinates } : null

  const handleCopy = () => {
    navigator.clipboard.writeText(shipment.tracking_id)
    setCopied(true)
    toast.success(`Copied ${shipment.tracking_id} to clipboard`)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShare = async () => {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Track Shipment ${shipment.tracking_id}`,
          text: `Live tracking for shipment ${shipment.tracking_id}`,
          url,
        })
        return
      } catch {
        // Fallback
      }
    }
    navigator.clipboard.writeText(url)
    toast.success('Tracking URL copied to clipboard')
  }

  const timeForStep = (stepKey: string) => {
    const match = history.find(h => {
      if (stepKey === 'created') return h.status === 'created' || h.status === 'booked'
      if (stepKey === 'assigned') return h.status === 'assigned' || h.status === 'dispatched'
      if (stepKey === 'picked_up') return h.status === 'picked_up'
      if (stepKey === 'in_transit') return h.status === 'in_transit' || h.status === 'out_for_delivery'
      if (stepKey === 'delivered') return h.status === 'delivered' || h.status === 'completed'
      return false
    })
    return match ? formatDateTime(match.at) : null
  }

  const originText = formatAddress(shipment.origin_name, shipment.origin_address) || 'Origin Hub'
  const destinationText = shipment.destination
    ? formatAddress(shipment.destination.name, shipment.destination.address) || 'Destination Address'
    : isSplit ? splitDestination(shipment.drops, lots, formatAddress) ?? 'Multiple Drops' : 'Destination Address'

  return (
    <div className={clsx('space-y-6', className)}>
      {/* Consignment Master Hero Card */}
      <div className="overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-raised">
        {/* Top Header Banner */}
        <div className="border-b border-border/80 bg-surface-subtle/50 p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">Consignment Waybill</span>
                <span className="h-1.5 w-1.5 rounded-full bg-border" />
                <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-brand">
                  <Activity size={12} className="animate-pulse" /> Verified
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-mono text-2xl sm:text-3xl font-black tracking-tight text-text">
                  {shipment.tracking_id}
                </h2>
                <button
                  type="button"
                  onClick={handleCopy}
                  title="Copy Tracking ID"
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-muted transition-all hover:border-brand/40 hover:bg-surface-subtle hover:text-text shadow-xs active:scale-95"
                >
                  {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Status Jewel Pill & Quick Actions */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-muted transition-all hover:border-brand/40 hover:bg-surface-subtle hover:text-text shadow-xs active:scale-95"
              >
                <Share2 size={14} /> Share
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-muted transition-all hover:border-brand/40 hover:bg-surface-subtle hover:text-text shadow-xs active:scale-95"
              >
                <Printer size={14} /> Print
              </button>
              <StatusPill status={shipment.status}>
                {failed ? 'Delivery Attempt Failed' : undefined}
              </StatusPill>
            </div>
          </div>

          {/* Corridor Waypoint Summary */}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted sm:text-sm">
            <span className="font-semibold text-text truncate max-w-xs">{originText}</span>
            <ArrowRight size={14} className="text-brand shrink-0" />
            <span className="font-semibold text-text truncate max-w-xs">{destinationText}</span>
          </div>

          {failed && (
            <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-xs sm:text-sm font-medium text-danger flex items-center gap-2">
              <ShieldAlert size={16} className="shrink-0" />
              <span>A delivery attempt was not completed. The carrier dispatch team has scheduled automatic resolution.</span>
            </div>
          )}

          {partly && (
            <div className="mt-4 rounded-xl border border-brand/30 bg-brand-soft p-3 text-xs sm:text-sm font-medium text-brand flex items-center gap-2">
              <PackageCheck size={16} className="shrink-0" />
              <span>{partDeliveredText(lots)}. Remaining consignments are actively in highway transit.</span>
            </div>
          )}
        </div>

        {/* Milestone Progression Stepper */}
        {!cancelled ? (
          <div className="p-6 sm:p-8 bg-surface">
            <div className="relative">
              <ol className="grid grid-cols-2 gap-4 sm:grid-cols-5" aria-label="Consignment Delivery Milestones">
                {STEPS.map((step, i) => {
                  const isDone = i < currentStepIdx
                  const active = i === currentStepIdx
                  const Icon = step.icon
                  const milestoneTime = timeForStep(step.key)

                  return (
                    <li key={step.key} className="relative flex flex-col items-center text-center">
                      <div className="relative flex items-center justify-center">
                        <div
                          className={clsx(
                            'flex h-12 w-12 items-center justify-center rounded-2xl border-2 transition-all duration-300 shadow-xs',
                            active
                              ? 'border-brand bg-brand text-on-brand shadow-raised ring-4 ring-brand/20 scale-105'
                              : isDone
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-border bg-surface-subtle text-muted'
                          )}
                        >
                          <Icon size={20} />
                        </div>
                        {active && (
                          <span className="absolute -top-1 -right-1 flex h-3 w-3">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-brand" />
                          </span>
                        )}
                      </div>

                      <div className="mt-3 space-y-0.5">
                        <p
                          className={clsx(
                            'text-xs font-bold tracking-tight',
                            active ? 'text-brand' : isDone ? 'text-text' : 'text-muted'
                          )}
                        >
                          {step.label}
                        </p>
                        {milestoneTime && (
                          <p className="text-[11px] text-muted font-medium">{milestoneTime}</p>
                        )}
                        {active && !milestoneTime && inProgress && (
                          <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-brand">
                            In Progress
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </div>
        ) : (
          <div className="p-6 text-center text-sm font-medium text-muted">
            This shipment was cancelled by the booking consignor.
          </div>
        )}
      </div>

      {/* Operational Telemetry 4-Card Strip */}
      <section aria-label="Highway Telemetry Pulse" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Card 1: ETA & Time to Arrival */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-brand/40 hover:shadow-raised">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">Estimated Arrival</span>
            <Clock size={16} className="text-brand shrink-0" />
          </div>
          <div className="mt-2 text-xl font-black text-text">
            {delivered
              ? 'Delivered Safely'
              : cancelled
              ? 'Cancelled'
              : failed
              ? 'Attempt Failed'
              : etaMinutes != null
              ? etaMinutes < 1
                ? 'Arriving Now'
                : formatMinutes(etaMinutes)
              : 'Calculating'}
          </div>
          <p className="mt-1 text-xs text-muted truncate">
            {delivered
              ? 'Final milestone reached'
              : inProgress && etaMinutes != null
              ? 'Live highway traffic adjusted'
              : 'Vehicle dispatch in progress'}
          </p>
        </div>

        {/* Card 2: Assigned Vehicle & Plate */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-brand/40 hover:shadow-raised">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">Assigned Truck</span>
            <Truck size={16} className="text-emerald-500 shrink-0" />
          </div>
          <div className="mt-2 font-mono text-xl font-black text-text tracking-wide truncate">
            {shipment.vehicle?.plate_number || 'Pending'}
          </div>
          <p className="mt-1 text-xs text-muted truncate">
            {shipment.vehicle?.type || 'Dedicated freight carrier'}
          </p>
        </div>

        {/* Card 3: Payload & Weight */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-brand/40 hover:shadow-raised">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">Consignment Load</span>
            <Package size={16} className="text-amber-500 shrink-0" />
          </div>
          <div className="mt-2 text-xl font-black text-text">
            {shipment.total_weight_kg ? formatKg(shipment.total_weight_kg) : 'Standard Load'}
          </div>
          <p className="mt-1 text-xs text-muted truncate">
            {shipment.total_items ? `${shipment.total_items.toLocaleString('en-IN')} package units` : 'Commercial parcel'}
          </p>
        </div>

        {/* Card 4: Electronic Proof of Delivery */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-brand/40 hover:shadow-raised">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">EPOD Custody</span>
            <ShieldCheck size={16} className="text-indigo-500 shrink-0" />
          </div>
          <div className="mt-2 text-xl font-black text-text truncate">
            {delivered ? 'Verified' : 'In Custody'}
          </div>
          <p className="mt-1 text-xs text-muted truncate">
            {delivered ? 'Sign-off stamp recorded' : 'Secure highway seal active'}
          </p>
        </div>
      </section>

      {/* Main Content Grid: Live Map & Waypoints */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Interactive Highway Map View */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-raised">
            {/* Map Header Overlay Bar */}
            <div className="flex items-center justify-between border-b border-border bg-surface/90 px-4 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <span className="text-xs font-bold tracking-tight text-text">Live Highway Radar</span>
              </div>
              {shipment.vehicle?.plate_number && (
                <span className="font-mono text-xs font-semibold text-muted">
                  Truck: {shipment.vehicle.plate_number}
                </span>
              )}
            </div>

            <div className="relative">
              <MapView
                mode="tracking"
                height={380}
                vehicles={vehicles}
                points={points}
                route={route}
                ariaLabel="Live shipment highway tracking map"
              />
            </div>
          </div>
        </div>

        {/* Right: Waypoint Journey Details & Split Lots */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-raised space-y-6">
            <h3 className="text-base font-bold text-text flex items-center gap-2">
              <Navigation size={18} className="text-brand" /> Waypoint Corridor
            </h3>

            {/* Visual Route Corridor Stepper */}
            <div className="space-y-6 relative pl-2">
              {/* Origin Point */}
              <div className="flex items-start gap-3 relative">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand shadow-xs">
                  <Box size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Origin Depot</span>
                  <p className="font-bold text-text text-sm leading-tight mt-0.5">
                    {shipment.origin_name || 'Origin Hub'}
                  </p>
                  {shipment.origin_address && (
                    <p className="text-xs text-muted mt-0.5 break-words">{shipment.origin_address}</p>
                  )}
                </div>
              </div>

              {/* Connecting Dotted Line */}
              <div className="ml-4 h-6 border-l-2 border-dashed border-border" />

              {/* Destination Point */}
              <div className="flex items-start gap-3 relative">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs">
                  <MapPin size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Destination Drop</span>
                  <p className="font-bold text-text text-sm leading-tight mt-0.5">
                    {shipment.destination?.name || (isSplit ? splitDestination(shipment.drops, lots, formatAddress) : 'Consignee')}
                  </p>
                  {shipment.destination?.address && (
                    <p className="text-xs text-muted mt-0.5 break-words">{shipment.destination.address}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Consignment Specs List */}
            <div className="border-t border-border pt-4">
              <DetailList
                columns={2}
                items={[
                  { label: 'Priority', value: shipment.priority ? `${shipment.priority.toUpperCase()} FREIGHT` : 'Standard' },
                  { label: 'Pieces', value: shipment.total_items ? formatPieces(shipment.total_items) : '—' },
                  { label: 'Total Weight', value: formatKg(shipment.total_weight_kg) },
                  { label: 'Corridor Security', value: 'Seal Verified' },
                ]}
              />
            </div>
          </div>

          {/* Split Lots Card (If Multi-lot consignment) */}
          {isSplit && (
            <div className="rounded-3xl border border-border bg-surface p-6 shadow-raised space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-text flex items-center gap-2">
                  <PackageCheck size={16} className="text-brand" /> Split Consignment Lots
                </h4>
                <span className="text-xs font-bold text-brand">
                  {lotsDone} of {lots.length} Delivered
                </span>
              </div>

              <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {lots.map(l => (
                  <li key={l.tracking_id} className="p-3 bg-surface hover:bg-surface-subtle transition-colors flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-bold text-text">{lotLine(l)}</p>
                      {l.vehicle?.plate_number && (
                        <p className="text-[11px] text-muted">Truck {l.vehicle.plate_number}</p>
                      )}
                    </div>
                    <span className="font-mono text-xs text-muted font-semibold">{l.tracking_id}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Milestone Event History Stream */}
      {history.length > 0 && (
        <div className="rounded-3xl border border-border bg-surface p-6 sm:p-8 shadow-raised space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-text flex items-center gap-2">
              <Activity size={20} className="text-brand" /> Verified Milestone History
            </h3>
            <span className="text-xs text-muted font-medium">Automatic Highway Audit</span>
          </div>

          <Timeline
            events={history.map(e => (e.status === 'exception' ? { ...e, note: 'Delivery attempt failed' } : e))}
            formatAt={formatDateTime}
          />
        </div>
      )}
    </div>
  )
}

