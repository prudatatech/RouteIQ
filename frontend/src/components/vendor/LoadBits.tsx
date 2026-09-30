import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Radio, Truck } from 'lucide-react'
import { buttonClasses, StatusPill } from '@/components/ui'
import { isTrackable, piecesText, priceText, trackingPath, type NextAction, type VendorLoad } from './loads'
import { formatKg } from '@/utils/display'

/** The route as one line: pickup → drop. Both places wrap on a narrow screen. */
export function Route({ pickup, drop, className }: { pickup: string | null; drop: string | null; className?: string }) {
  return (
    <p className={className}>
      <span className="break-words">{pickup ?? '—'}</span>
      <ArrowRight size={14} aria-label="to" className="mx-1.5 inline-block align-[-2px] text-muted" />
      <span className="break-words">{drop ?? '—'}</span>
    </p>
  )
}

export function TruckLine({ truck }: { truck: VendorLoad['truck'] }) {
  if (!truck) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <Truck size={14} aria-hidden="true" className="text-muted" />
      <span className="font-mono">{truck.plate_number ?? 'Truck assigned'}</span>
      {truck.vehicle_type && <span className="text-muted">{truck.vehicle_type}</span>}
    </span>
  )
}

export function ProblemPill({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <StatusPill tone="danger" dot={false}>
      <AlertTriangle size={12} aria-hidden="true" /> {count === 1 ? 'Problem' : `${count} problems`}
    </StatusPill>
  )
}

/** The one next step of a load: a button, or the party it waits on. */
export function ActionCell({ action, className }: { action: NextAction; className?: string }) {
  if (action.kind === 'do') {
    // A long label (an invoice number) wraps instead of running off a phone screen
    return <Link to={action.to} className={`${buttonClasses({ variant: 'secondary', size: 'sm' })} !h-auto !whitespace-normal py-1.5 text-left`}>{action.label}</Link>
  }
  return (
    <p className={className ?? 'text-sm'}>
      <span className={action.kind === 'wait' ? 'font-medium text-text' : 'text-muted'}>{action.label}</span>
      {action.kind === 'wait' && action.detail && <span className="block text-xs text-muted">{action.detail}</span>}
    </p>
  )
}

export function LoadFacts({ load }: { load: Pick<VendorLoad, 'pieces' | 'weight_kg' | 'price' | 'price_source'> }) {
  const parts = [piecesText(load.pieces), load.weight_kg != null ? formatKg(load.weight_kg) : null, priceText(load)].filter(Boolean)
  return <>{parts.join(' · ')}</>
}

export function TrackLink({ load }: { load: Pick<VendorLoad, 'stage' | 'tracking_id'> }) {
  const to = isTrackable(load) ? trackingPath(load) : null
  if (!to) return null
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
      <Radio size={14} aria-hidden="true" /> Track live
    </Link>
  )
}
