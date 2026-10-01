import { Swatch } from '@/components/map/Swatch'
import { Alert, Stat, StatusPill } from '@/components/ui'
import { formatKg, formatKm, formatMinutes } from '@/utils/display'
import { engineInfo, unassignedTitle, type OptimizerEngine, type UnassignedShipment } from './plan'

/** Which engine made the routes, said plainly, with the reason when it was not the planning service. */
export function EngineBanner({ engine, matrixSource, note }: {
  engine?: OptimizerEngine
  matrixSource?: string | null
  note?: string | null
}) {
  const info = engineInfo(engine, matrixSource)
  if (!info) return null
  return (
    <div className="space-y-1 rounded-control border border-border px-4 py-3" data-testid="engine-banner">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Planned by</span>
        <StatusPill tone={info.tone} dot={false}>{info.title}</StatusPill>
      </div>
      <p className="text-sm text-muted">{info.detail}</p>
      {note && engine !== 'ml-service' && <p className="text-xs text-muted">{note}</p>}
    </div>
  )
}

/** Kilometres and minutes saved against visiting the same stops in the order they were booked. */
export function SavingsStats({ savedKm, savedMinutes, beforeKm, estimated }: {
  savedKm?: number | null
  savedMinutes?: number | null
  beforeKm?: number | null
  estimated?: boolean
}) {
  if (savedKm == null && savedMinutes == null) return null
  const pct = savedKm != null && beforeKm ? (savedKm / beforeKm) * 100 : null
  const show = (n: number, unit: string) => `${n > 0 ? '' : n < 0 ? '+' : ''}${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${unit}`
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Distance saved"
          value={savedKm != null ? show(savedKm, 'km') : '—'}
          tone={savedKm != null && savedKm > 0 ? 'success' : 'default'}
          hint={pct != null ? `${pct.toFixed(1)}% shorter${estimated ? ' (estimated)' : ''}` : undefined}
        />
        <Stat
          label="Time saved"
          value={savedMinutes != null ? show(savedMinutes, 'min') : '—'}
          tone={savedMinutes != null && savedMinutes > 0 ? 'success' : 'default'}
          hint={estimated ? 'Estimated' : undefined}
        />
      </div>
      <p className="text-xs text-muted">Compared with visiting the same stops in the order they were booked.</p>
    </div>
  )
}

/** Shipments the optimizer could not place, and why. */
export function UnassignedList({ items }: { items?: UnassignedShipment[] | null }) {
  if (!items || items.length === 0) return null
  return (
    <Alert tone="warning" title={`${items.length.toLocaleString('en-IN')} shipment${items.length === 1 ? ' was' : 's were'} not planned`}>
      <ul className="mt-1 space-y-1.5">
        {items.map(u => (
          <li key={u.shipment_id} className="text-sm">
            <span className="font-medium">{u.tracking_id ?? 'Shipment'}</span>
            <span className="text-muted"> · {formatKg(u.weight_kg)} · </span>
            <span className="font-medium">{unassignedTitle(u.reason)}.</span>{' '}
            <span>{u.message}</span>
          </li>
        ))}
      </ul>
    </Alert>
  )
}

/** One line for a route in the result list: its colour, vehicle, distance, time and what it saved. */
export function RouteSummaryLine({ color, label, stops, km, minutes, savedKm, savedMinutes }: {
  color: string
  label: string
  stops: number
  km?: number | null
  minutes?: number | null
  savedKm?: number | null
  savedMinutes?: number | null
}) {
  return (
    <div className="flex items-center gap-3">
      <Swatch color={color} className="shrink-0" />
      <div>
        <div className="text-sm font-medium text-text">{label}</div>
        <div className="text-xs text-muted">
          {stops.toLocaleString('en-IN')} stop{stops === 1 ? '' : 's'}
          {savedKm != null && savedKm > 0 ? ` · ${formatKm(savedKm)} saved` : ''}
          {savedMinutes != null && savedMinutes > 0 ? ` · ${formatMinutes(savedMinutes)} saved` : ''}
        </div>
      </div>
      <span className="ml-auto hidden text-sm text-muted tabular sm:inline">{formatKm(km ?? 0)} · {formatMinutes(minutes ?? 0)}</span>
    </div>
  )
}
