import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { Button, DataTable, Stat, StatusPill, Tabs, useConfirm, type Column, type TabItem } from '@/components/ui'
import { formatDateTime, formatRelative } from '@/utils/display'
import { alertTypeLabel, apiErrorMessage, fleetKeys, severityTone, type FleetAlert } from './health'

type Filter = 'active' | 'resolved'
const FILTERS: TabItem<Filter>[] = [{ id: 'active', label: 'Open' }, { id: 'resolved', label: 'Resolved' }]

interface Summary {
  open: number
  acknowledged: number
  by_severity: Record<string, number>
  last_30_days_by_type: Record<string, number>
}

const statusLabel = { open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' } as const
const statusTone = { open: 'danger', acknowledged: 'warning', resolved: 'neutral' } as const

/** Alarms from vehicles and server rules, with acknowledge and resolve. Test alarms are marked and left out of the counts. */
export default function AlertsView() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [filter, setFilter] = useState<Filter>('active')

  const alerts = useQuery<FleetAlert[]>({
    queryKey: fleetKeys.alerts(filter),
    queryFn: () => fleetAPI.alerts(filter) as Promise<FleetAlert[]>,
    refetchInterval: 30_000,
  })
  const summary = useQuery<Summary>({
    queryKey: fleetKeys.alertSummary,
    queryFn: () => fleetAPI.alertSummary() as Promise<Summary>,
    refetchInterval: 30_000,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['fleet-alerts'] })
    queryClient.invalidateQueries({ queryKey: fleetKeys.alertSummary })
    queryClient.invalidateQueries({ queryKey: fleetKeys.health })
  }
  const onError = (fallback: string) => (err: unknown) => toast.error(apiErrorMessage(err, fallback))

  const acknowledge = useMutation({
    mutationFn: (id: string) => fleetAPI.acknowledgeAlert(id),
    onSuccess: () => { toast.success('Alert acknowledged'); refresh() },
    onError: onError('We could not acknowledge this alert. Try again.'),
  })
  const resolve = useMutation({
    mutationFn: (id: string) => fleetAPI.resolveAlert(id),
    onSuccess: () => { toast.success('Alert resolved'); refresh() },
    onError: onError('We could not resolve this alert. Try again.'),
  })

  const onResolve = async (a: FleetAlert) => {
    const ok = await confirm({
      title: 'Resolve this alert?',
      message: `${alertTypeLabel(a.type)} on ${a.plate_number ?? 'this vehicle'} will be closed. A new alert opens if it happens again.`,
      confirmLabel: 'Resolve alert',
    })
    if (ok) resolve.mutate(a.id)
  }

  const columns: Column<FleetAlert>[] = [
    {
      key: 'vehicle', header: 'Vehicle', sortValue: r => r.plate_number ?? '',
      cell: r => <span className="font-mono text-sm">{r.plate_number ?? '—'}</span>,
    },
    {
      key: 'type', header: 'Alert', sortValue: r => r.type,
      cell: r => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{alertTypeLabel(r.type)}</span>
          {r.is_test && <StatusPill tone="info" dot={false}>Test</StatusPill>}
        </div>
      ),
    },
    {
      key: 'severity', header: 'Severity', sortValue: r => r.severity ?? '',
      cell: r => (r.severity ? <StatusPill tone={severityTone(r.severity)}>{r.severity.charAt(0).toUpperCase() + r.severity.slice(1)}</StatusPill> : '—'),
    },
    {
      key: 'message', header: 'Details', hideBelow: 'lg',
      cell: r => (
        <span>
          {r.message ?? '—'}
          {r.occurrences > 1 && <span className="text-muted"> ({r.occurrences} times)</span>}
        </span>
      ),
    },
    {
      key: 'status', header: 'Status', sortValue: r => r.status,
      cell: r => <StatusPill tone={statusTone[r.status]}>{statusLabel[r.status]}</StatusPill>,
    },
    {
      key: 'raised', header: 'Raised', sortValue: r => r.created_at,
      cell: r => <span title={formatDateTime(r.created_at)}>{formatRelative(r.created_at)}</span>,
    },
    {
      key: 'action', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: r => r.status === 'resolved' ? null : (
        <div className="flex justify-end gap-2">
          {r.status === 'open' && (
            <Button size="sm" variant="secondary" loading={acknowledge.isPending && acknowledge.variables === r.id} onClick={() => acknowledge.mutate(r.id)}>
              Acknowledge
            </Button>
          )}
          <Button size="sm" variant="secondary" loading={resolve.isPending && resolve.variables === r.id} onClick={() => onResolve(r)}>
            Resolve
          </Button>
        </div>
      ),
    },
  ]

  const s = summary.data
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open alerts" value={s?.open ?? 0} loading={summary.isLoading} tone={s && s.open > 0 ? 'danger' : 'default'} />
        <Stat label="Acknowledged" value={s?.acknowledged ?? 0} loading={summary.isLoading} />
        <Stat
          label="Critical or high"
          value={(s?.by_severity.critical ?? 0) + (s?.by_severity.high ?? 0)}
          loading={summary.isLoading}
          hint="Test alarms are not counted"
        />
      </div>
      <Tabs tabs={FILTERS} value={filter} onChange={setFilter} label="Alert status" />
      <DataTable
        caption={filter === 'active' ? 'Open alerts' : 'Resolved alerts'}
        columns={columns}
        rows={alerts.data ?? []}
        rowKey={r => r.id}
        loading={alerts.isLoading}
        error={alerts.isError ? 'We could not load alerts. Check your connection and try again.' : undefined}
        onRetry={() => alerts.refetch()}
        initialSort={{ key: 'raised', direction: 'desc' }}
        empty={{
          title: filter === 'active' ? 'No open alerts' : 'No resolved alerts yet',
          description: filter === 'active'
            ? 'Overspeed, long idle, GPS lost, low fuel and device alarms show up here as they happen.'
            : undefined,
        }}
      />
    </div>
  )
}
