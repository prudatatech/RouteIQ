import { useMemo, useState, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Card } from '@/components/ui'
import { Swatch } from '@/components/map/Swatch'
import { MapView, directionsAvailable, fetchDrivingRoute, type MapPoint, type MapRouteStop, type MapVehicle } from '@/components/map'
import { formatKm, formatMinutes } from '@/utils/display'
import {
  BEFORE_COLOR, buildMapContent, geometryKey, waypointsOf,
  type CompareMode, type LatLng, type RoutePlan,
} from './plan'

/** The Mapbox directions call takes at most this many waypoints; longer routes are drawn straight. */
const MAX_WAYPOINTS = 25

const MODES: { id: CompareMode; label: string }[] = [
  { id: 'after', label: 'Optimized' },
  { id: 'before', label: 'Booked order' },
  { id: 'both', label: 'Both' },
]

/** Road lines for each order of each plan, where a routing key allows; the rest is drawn straight. */
function useRoadGeometry(plans: RoutePlan[]): ReadonlyMap<string, [number, number][]> {
  const wanted = useMemo(() => plans.flatMap(plan => (['before', 'after'] as const).flatMap(order => {
    const waypoints = waypointsOf(plan, order)
    return waypoints.length >= 2 && waypoints.length <= MAX_WAYPOINTS ? [{ key: geometryKey(plan, order), waypoints }] : []
  })), [plans])
  const results = useQueries({
    queries: wanted.map(w => ({
      queryKey: ['optimize-road', w.key, w.waypoints.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')],
      queryFn: () => fetchDrivingRoute(w.waypoints),
      enabled: directionsAvailable,
      staleTime: 10 * 60_000,
      retry: false,
    })),
  })
  return useMemo(() => {
    const map = new Map<string, [number, number][]>()
    results.forEach((r, i) => { if (r.data?.coordinates.length) map.set(wanted[i].key, r.data.coordinates) })
    return map
    // results changes identity every render; the data it carries is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, results.map(r => r.dataUpdatedAt).join(',')])
}

/**
 * The optimization map. With route plans it draws each vehicle's route in its own colour with numbered
 * stops, and the order the stops were booked in as a muted dashed line under it. With none it shows
 * the fallback content (pending shipments and vehicles) it is given.
 */
export function OptimizeMap({ plans, depot, fallbackStops, fallbackVehicles, header, height = 'h-96' }: {
  plans: RoutePlan[]
  depot: LatLng | null
  fallbackStops: MapRouteStop[]
  fallbackVehicles: MapVehicle[]
  /** Shown above the map (a preview banner). */
  header?: ReactNode
  height?: string
}) {
  const [mode, setMode] = useState<CompareMode>('both')
  const [focus, setFocus] = useState<string | null>(null)
  const geometry = useRoadGeometry(plans)
  const hasBefore = plans.some(p => p.before && p.before.length > 0)
  const effectiveMode: CompareMode = hasBefore ? mode : 'after'
  const focusKey = focus && plans.some(p => p.key === focus) ? focus : null

  const content = useMemo(
    () => (plans.length > 0
      ? buildMapContent({ plans, depot, mode: effectiveMode, focusKey, geometry })
      : { lines: [], stops: fallbackStops, points: [] as MapPoint[] }),
    [plans, depot, effectiveMode, focusKey, geometry, fallbackStops],
  )
  const route = useMemo(() => ({ coordinates: [] as [number, number][], stops: content.stops }), [content.stops])

  return (
    <Card className="overflow-hidden">
      {header}
      {plans.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
          {hasBefore ? (
            <div role="group" aria-label="Which order to show" className="inline-flex rounded-control border border-border p-0.5">
              {MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={mode === m.id}
                  onClick={() => setMode(m.id)}
                  className={`rounded-control px-3 py-1 text-sm font-medium transition-colors ${mode === m.id ? 'bg-brand-soft text-text' : 'text-muted hover:text-text'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : <span className="text-sm text-muted">Stops in the order chosen</span>}
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {plans.map(p => (
              <li key={p.key}>
                <button
                  type="button"
                  aria-pressed={focusKey === p.key}
                  onClick={() => setFocus(focusKey === p.key ? null : p.key)}
                  className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 text-text hover:bg-surface-subtle aria-pressed:bg-brand-soft"
                >
                  <Swatch color={p.color} />
                  <span className="font-medium">{p.label}</span>
                  {p.afterKm != null && <span className="text-muted tabular">{formatKm(p.afterKm)}, {formatMinutes(p.afterMin)}</span>}
                </button>
              </li>
            ))}
            {effectiveMode !== 'after' && (
              <li className="inline-flex items-center gap-1.5 text-muted">
                <Swatch color={BEFORE_COLOR} shape="dash" />
                Booked order
              </li>
            )}
          </ul>
        </div>
      )}
      <div className={height}>
        <MapView
          mode="route"
          vehicles={plans.length > 0 ? [] : fallbackVehicles}
          lines={content.lines}
          route={route}
          points={content.points}
          ariaLabel="Optimization map"
        />
      </div>
      {plans.length > 0 && !directionsAvailable && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted">Lines run straight between stops. Add a Mapbox token to draw them along the roads.</p>
      )}
    </Card>
  )
}
