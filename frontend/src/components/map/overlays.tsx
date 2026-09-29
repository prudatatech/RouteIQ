import { useRef } from 'react'
import { useControl, type ControlPosition, type IControl } from 'react-map-gl/maplibre'
import { Loader2, TriangleAlert } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '@/components/ui/Button'
import { MAP_TONES, vehicleStatusStyle } from '@/config/mapConfig'
import type { MapVehicle } from './types'

/* ── Recenter control ───────────────────────────────────────────────────── */

// lucide "locate-fixed", inlined because native map controls are plain DOM.
const LOCATE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>'

class RecenterControl implements IControl {
  private container: HTMLDivElement | null = null
  constructor(private readonly onClick: () => void) {}

  onAdd() {
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const button = document.createElement('button')
    button.type = 'button'
    button.title = 'Recenter map'
    button.setAttribute('aria-label', 'Recenter map')
    button.className = 'flex items-center justify-center text-text'
    button.innerHTML = LOCATE_ICON
    button.addEventListener('click', () => this.onClick())
    container.appendChild(button)
    this.container = container
    return container
  }

  onRemove() {
    this.container?.remove()
    this.container = null
  }
}

/** Native-looking map button that fits the content again. */
export function RecenterButton({ onClick, position = 'top-right' }: { onClick: () => void; position?: ControlPosition }) {
  const latest = useRef(onClick)
  latest.current = onClick
  useControl(() => new RecenterControl(() => latest.current()), { position })
  return null
}

/* ── Legend ─────────────────────────────────────────────────────────────── */

/** Statuses of the vehicles on the map, with counts, so colour is never the only cue. */
export function StatusLegend({ vehicles }: { vehicles: MapVehicle[] }) {
  if (vehicles.length === 0) return null
  const counts = new Map<string, { label: string; bg: string; count: number }>()
  for (const v of vehicles) {
    const style = vehicleStatusStyle(v.status)
    const entry = counts.get(style.label) ?? { label: style.label, bg: MAP_TONES[style.tone].bg, count: 0 }
    entry.count += 1
    counts.set(style.label, entry)
  }

  return (
    <ul
      aria-label="Vehicle status"
      className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-6.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-control border border-border bg-surface px-3 py-2 text-xs text-text shadow-raised"
    >
      {[...counts.values()].map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span aria-hidden className={clsx('h-2 w-2 rounded-full', s.bg)} />
          {s.label}
          <span className="tabular text-muted">{s.count}</span>
        </li>
      ))}
    </ul>
  )
}

/* ── Loading and error ──────────────────────────────────────────────────── */

export function MapLoading() {
  return (
    <div role="status" className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-surface-subtle text-sm text-muted">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      Loading map…
    </div>
  )
}

export function MapError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface-subtle p-6 text-center">
      <TriangleAlert size={20} className="text-warning" aria-hidden />
      <div>
        <p className="text-sm font-medium text-text">The map could not be shown</p>
        <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>Try again</Button>
      )}
    </div>
  )
}
