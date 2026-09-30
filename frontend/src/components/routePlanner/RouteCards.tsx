import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Check, Clock, Fuel, Gauge, Route as RouteIcon, TrafficCone } from 'lucide-react'
import { StatusPill } from '@/components/ui'
import type { PlannedRoute } from '@/services/routing'
import { formatKm, formatMinutes, formatRupees } from '@/utils/display'
import { formatArrival, type RouteTag } from '@/utils/routePlanner'

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted"><span aria-hidden="true">{icon}</span>{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{children}</dd>
    </div>
  )
}

/** "12 min" when late by that much, or "None" when the service says there is no delay. */
const delayText = (minutes: number | null) => (minutes === null ? 'Not reported' : minutes <= 0 ? 'None' : formatMinutes(minutes))

/**
 * The route options to compare. Each card is one radio choice: arrival time in India, time,
 * distance, traffic delay, toll km and the fuel estimate.
 */
export default function RouteCards({ routes, tags, selectedId, onSelect, departureIso, trafficIsLive }: {
  routes: PlannedRoute[]
  tags: RouteTag[]
  selectedId: string
  onSelect: (id: string) => void
  departureIso: string
  /** false when the delay is measured against typical traffic rather than free-flow. */
  trafficIsLive: boolean
}) {
  return (
    <div role="radiogroup" aria-label="Route options" className={clsx('grid gap-3', routes.length > 1 && 'lg:grid-cols-2 xl:grid-cols-3')}>
      {routes.map((r, i) => {
        const selected = r.id === selectedId
        const fuel = r.fuel
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(r.id)}
            className={clsx(
              'rounded-card border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              selected ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-subtle',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-muted">{tags[i] === 'Alternative' ? `Option ${i + 1}` : tags[i]}</p>
                <p className="text-base font-semibold text-text tabular">Arrives {formatArrival(r.arrival_at, departureIso)}</p>
              </div>
              {selected
                ? <StatusPill tone="brand" dot={false}><Check size={12} aria-hidden="true" className="mr-1" />Selected</StatusPill>
                : <span className="text-xs text-muted">Show</span>}
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact icon={<Clock size={12} />} label="Travel time">
                <span className="font-medium tabular">{formatMinutes(r.travel_minutes)}</span>
                {r.no_traffic_minutes !== null && <span className="block text-xs text-muted">{formatMinutes(r.no_traffic_minutes)} without traffic</span>}
              </Fact>
              <Fact icon={<RouteIcon size={12} />} label="Distance"><span className="font-medium tabular">{formatKm(r.distance_km)}</span></Fact>
              <Fact icon={<Gauge size={12} />} label={trafficIsLive ? 'Traffic delay' : 'Delay vs typical'}>
                <span className={clsx('tabular', (r.traffic_delay_minutes ?? 0) >= 15 && 'font-medium text-warning')}>{delayText(r.traffic_delay_minutes)}</span>
              </Fact>
              <Fact icon={<TrafficCone size={12} />} label="Toll roads">
                <span className="tabular">{r.toll_km === null ? 'Not reported' : r.toll_km <= 0 ? 'None' : formatKm(r.toll_km)}</span>
              </Fact>
              <div className="col-span-2 border-t border-border pt-3">
                <dt className="flex items-center gap-1 text-xs text-muted"><Fuel size={12} aria-hidden="true" />Fuel estimate</dt>
                <dd className="mt-0.5 text-sm text-text">
                  {!fuel ? <span className="text-muted">Choose a vehicle to estimate fuel</span> : fuel.litres === null ? (
                    <span className="text-muted">{fuel.note}</span>
                  ) : (
                    <>
                      <span className="font-medium tabular">{fuel.litres.toLocaleString('en-IN')} L</span>
                      {fuel.cost !== null && fuel.price_per_litre !== null ? (
                        <>
                          <span className="font-medium tabular"> · {formatRupees(fuel.cost)}</span>
                          <span className="block text-xs text-muted">
                            at {formatRupees(fuel.price_per_litre)} per litre ({fuel.price_source === 'vehicle_log' ? "this vehicle's last fill" : 'fleet average of recent fills'})
                          </span>
                        </>
                      ) : (
                        <span className="block text-xs text-muted">{fuel.note}</span>
                      )}
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </button>
        )
      })}
    </div>
  )
}
