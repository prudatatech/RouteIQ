import { CloudRain, TriangleAlert } from 'lucide-react'
import { describeIncident } from '@/utils/traffic'
import { Card, EmptyState, ErrorState, Skeleton, StatusPill } from '@/components/ui'
import { useRouteIncidents, useRouteWeather } from './hooks'

const SEVERITY_LABEL = ['Unknown delay', 'Minor delay', 'Moderate delay', 'Major delay', 'Road closed or major delay']

/** Traffic incidents and current weather for one route. Both say plainly when they are not set up. */
export default function RouteConditions({ routeId }: { routeId: string }) {
  const traffic = useRouteIncidents(routeId)
  const weather = useRouteWeather(routeId)
  const w = weather.data

  return (
    <Card padded className="space-y-5">
      <h2 className="text-lg font-semibold text-text">Traffic and weather</h2>

      <section aria-labelledby="route-weather-heading" className="space-y-2">
        <h3 id="route-weather-heading" className="flex items-center gap-2 text-sm font-medium text-text">
          <CloudRain size={16} aria-hidden="true" /> Weather at the middle of the route
        </h3>
        {weather.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : weather.isError ? (
          <ErrorState compact description="We could not load the weather. Try again in a few minutes." onRetry={() => weather.refetch()} />
        ) : !w?.available ? (
          <p className="text-sm text-muted">{w?.reason ?? 'Weather is not available.'}</p>
        ) : (
          <div className="space-y-1 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-text">
              <span className="capitalize">{w.description}</span>
              {w.severe && <StatusPill tone="warning" dot={false}>Severe weather</StatusPill>}
            </p>
            <p className="text-muted tabular">
              {[
                w.temperature_c != null ? `${w.temperature_c} °C` : null,
                w.wind_kmph != null ? `Wind ${w.wind_kmph} km/h` : null,
                w.rain_mm_per_hour != null ? `Rain ${w.rain_mm_per_hour} mm/h` : null,
                w.visibility_m != null ? `Visibility ${(w.visibility_m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="route-traffic-heading" className="space-y-2 border-t border-border pt-4">
        <h3 id="route-traffic-heading" className="flex items-center gap-2 text-sm font-medium text-text">
          <TriangleAlert size={16} aria-hidden="true" /> Traffic incidents on this route
        </h3>
        {traffic.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : traffic.isError ? (
          <ErrorState compact description="We could not load traffic incidents. Try again in a few minutes." onRetry={() => traffic.refetch()} />
        ) : !traffic.data?.configured ? (
          <p className="text-sm text-muted">Traffic incidents are off. Add a TomTom key to check active routes.</p>
        ) : traffic.data.incidents.length === 0 ? (
          <EmptyState compact title="No incidents on this route" description="TomTom reports nothing along the path right now." />
        ) : (
          <ul className="divide-y divide-border rounded-control border border-border">
            {traffic.data.incidents.map(i => (
              <li key={i.id} className="px-3 py-2 text-sm">
                <p className="font-medium text-text">{describeIncident(i)}</p>
                <p className="text-xs text-muted">{SEVERITY_LABEL[i.severity] ?? SEVERITY_LABEL[0]}{i.description ? ` · ${i.description}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  )
}
