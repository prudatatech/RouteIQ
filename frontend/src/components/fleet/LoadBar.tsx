import clsx from 'clsx'
import { LOAD_BANDS, NEAR_FULL_PCT, SOURCE_LABELS, loadSummary, vehicleLoad } from './load'
import type { Vehicle } from './types'

/**
 * The vehicle's load against its capacity: a bar coloured by how full it is (grey empty, green part
 * loaded, amber nearly full, red full or overloaded) with the load in words. `compact` is the list
 * cell; the default is the fuller block for the vehicle page.
 */
export default function LoadBar({ vehicle, compact = false, className }: {
  vehicle: Pick<Vehicle, 'capacity_kg' | 'current_load_kg' | 'declared_load_percentage' | 'available_capacity_kg'>
  compact?: boolean
  className?: string
}) {
  const load = vehicleLoad(vehicle)
  const band = LOAD_BANDS[load.band]
  const known = load.band !== 'unknown'
  return (
    <div className={clsx('space-y-1', compact ? 'w-40' : 'w-full', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className={clsx('text-xs font-medium', band.text)}>{band.label}</span>
        {known && <span className="text-xs tabular text-muted">{load.pct}%</span>}
      </div>
      <div
        role="progressbar"
        aria-label={`Load: ${band.label}${known ? `, ${load.pct}% of capacity` : ''}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? load.barPct : undefined}
        className="relative h-2 overflow-hidden rounded-full bg-neutral-soft"
      >
        <div className={clsx('h-full rounded-full transition-[width]', band.fill)} style={{ width: `${known ? Math.max(load.barPct, load.loadKg > 0 ? 2 : 0) : 0}%` }} />
        {/* Where "nearly full" starts */}
        <span aria-hidden="true" className="absolute inset-y-0 w-px bg-surface" style={{ left: `${NEAR_FULL_PCT}%` }} />
      </div>
      <p className={clsx('text-xs text-muted', compact && 'truncate')} title={compact ? loadSummary(load) : undefined}>
        {loadSummary(load)}
        {!compact && load.source && <span> · {SOURCE_LABELS[load.source]}</span>}
      </p>
    </div>
  )
}
