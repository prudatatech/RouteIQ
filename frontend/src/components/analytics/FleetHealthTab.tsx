import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, DataTable, Stat, StatusPill, type Column } from '@/components/ui'
import { bandLabel, bandTone, type VehicleHealth } from '@/components/fleet/health'
import { useFleetHealth } from '@/components/fleet/useFleetHealth'

/** Vehicles that need attention: overdue service, expired documents, recent alerts or low fuel. */
export default function FleetHealthTab() {
  const navigate = useNavigate()
  const { data = [], isLoading, isError, refetch } = useFleetHealth()

  const attention = useMemo(() => data.filter(h => h.issues.length > 0 || h.band === 'attention' || h.band === 'poor'), [data])
  const scored = data.filter(h => h.score != null).length
  const noScore = data.length - scored

  const columns: Column<VehicleHealth>[] = [
    { key: 'vehicle', header: 'Vehicle', sortValue: r => r.plate_number, cell: r => <span className="font-mono text-sm">{r.plate_number}</span> },
    {
      key: 'score', header: 'Health', sortValue: r => r.score ?? -1,
      cell: r => (
        <span className="inline-flex items-center gap-2">
          <span className="w-7 text-right font-semibold tabular text-text">{r.score ?? '—'}</span>
          <StatusPill tone={bandTone[r.band]}>{bandLabel[r.band]}</StatusPill>
        </span>
      ),
    },
    {
      key: 'issues', header: 'What needs attention',
      cell: r => (
        <ul className="space-y-0.5 text-sm">
          {r.issues.slice(0, 4).map(i => (
            <li key={i.text} className={i.severity === 'critical' ? 'text-danger' : 'text-text'}>{i.text}</li>
          ))}
          {r.issues.length > 4 && <li className="text-muted">and {r.issues.length - 4} more</li>}
          {r.issues.length === 0 && <li className="text-muted">Score is low but no single cause is listed.</li>}
        </ul>
      ),
    },
    {
      key: 'open', header: <span className="sr-only">Open</span>, align: 'right',
      cell: r => (
        <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); navigate(`/fleet?open=${r.vehicle_id}`) }}>
          Open vehicle
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Vehicles scored" value={scored} loading={isLoading} hint="Have enough data for a score" />
        <Stat label="Need attention" value={attention.length} loading={isLoading} tone={attention.length > 0 ? 'warning' : 'default'} />
        <Stat label="Not enough data" value={noScore} loading={isLoading} hint="Add service items, document dates or GPS" />
      </div>
      <DataTable
        caption="Vehicles needing attention"
        columns={columns}
        rows={attention}
        rowKey={r => r.vehicle_id}
        loading={isLoading}
        error={isError ? 'We could not load fleet health. Check your connection and try again.' : undefined}
        onRetry={() => refetch()}
        onRowClick={r => navigate(`/fleet?open=${r.vehicle_id}`)}
        initialSort={{ key: 'score', direction: 'asc' }}
        empty={{
          title: data.length === 0 ? 'No vehicles yet' : 'No vehicle needs attention',
          description: data.length === 0 ? undefined : 'Scores come from service schedules, document expiry dates, alerts and device fuel levels.',
        }}
      />
    </div>
  )
}
