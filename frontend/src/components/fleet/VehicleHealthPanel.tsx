import { useQuery } from '@tanstack/react-query'
import { fleetAPI } from '@/services/api'
import { Alert, Button, Skeleton, StatusPill } from '@/components/ui'
import { bandLabel, bandTone, checkLabel, checkTone, type VehicleHealth } from './health'
import { VehicleMaintenanceTab } from './maintenance/VehicleMaintenanceTab'

/**
 * Health score for one vehicle, then its maintenance: current condition (odometer, service items,
 * documents), the maintenance job in progress, and the service history. Shown in the Fleet drawer.
 */
export default function VehicleHealthPanel({ vehicleId }: { vehicleId: string; plate: string }) {
  const health = useQuery<VehicleHealth>({
    queryKey: ['fleet-vehicle-health', vehicleId],
    queryFn: () => fleetAPI.vehicleHealth(vehicleId) as Promise<VehicleHealth>,
  })

  if (health.isLoading) return <Skeleton className="h-48 w-full" />
  if (health.isError || !health.data) {
    return (
      <Alert tone="danger" title="We could not load this vehicle's health" action={<Button size="sm" variant="secondary" onClick={() => health.refetch()}>Try again</Button>}>
        Check your connection and try again.
      </Alert>
    )
  }
  const h = health.data

  return (
    <div className="space-y-6">
      <section aria-labelledby={`health-${vehicleId}`} className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id={`health-${vehicleId}`} className="text-base font-semibold text-text">Health</h3>
          <StatusPill tone={bandTone[h.band]}>{bandLabel[h.band]}</StatusPill>
        </div>
        <div className="flex items-end gap-2">
          <p className="text-3xl font-semibold tabular text-text">{h.score ?? '—'}</p>
          <p className="pb-1 text-sm text-muted">
            {h.score == null ? 'Nothing to score yet' : `out of 100, from ${h.checks_known} of ${h.checks.length} checks`}
          </p>
        </div>
        <ul className="divide-y divide-border rounded-card border border-border">
          {h.checks.map(c => (
            <li key={c.key} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{c.label}</p>
                <p className="text-sm text-muted">{c.detail}</p>
              </div>
              <StatusPill tone={checkTone[c.state]} className="shrink-0">{checkLabel[c.state]}</StatusPill>
            </li>
          ))}
        </ul>
        {h.issues.length > 0 && (
          <ul className="space-y-1 text-sm">
            {h.issues.map(i => (
              <li key={i.text} className={i.severity === 'critical' ? 'text-danger' : 'text-warning'}>{i.text}</li>
            ))}
          </ul>
        )}
      </section>

      <VehicleMaintenanceTab vehicleId={vehicleId} />
    </div>
  )
}
