import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fleetAPI } from '@/services/api'
import { Button, DataTable, DetailList, Drawer, Stat, StatusPill, Tabs, useConfirm, type Column, type TabItem } from '@/components/ui'
import { formatDateTime, formatRelative } from '@/utils/display'
import { alertTypeLabel, apiErrorMessage, fleetKeys, type FleetAlert } from './health'

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

/** Alerts from vehicles and server rules, with acknowledge and resolve. Test alerts are marked and left out of the counts. */
export default function AlertsView({ openId, onOpenHandled }: {
  /** An alert to open on arrival, from a notification link (?open=<alert id>). */
  openId?: string | null
  onOpenHandled?: () => void
} = {}) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [filter, setFilter] = useState<Filter>('active')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const alerts = useQuery<FleetAlert[]>({
    queryKey: fleetKeys.alerts(filter),
    queryFn: () => fleetAPI.alerts(filter) as Promise<FleetAlert[]>,
    refetchInterval: 30_000,
  })
  // A linked alert may be open or already resolved, so look in both lists.
  const linked = useQuery<FleetAlert[]>({
    queryKey: fleetKeys.alerts('all'),
    queryFn: () => fleetAPI.alerts('all') as Promise<FleetAlert[]>,
    enabled: !!openId,
  })
  useEffect(() => {
    if (!openId || linked.isLoading) return
    const match = linked.data?.find(a => a.id === openId)
    if (match) {
      setFilter(match.status === 'resolved' ? 'resolved' : 'active')
      setSelectedId(match.id)
    } else {
      toast.error('That alert could not be found')
    }
    onOpenHandled?.()
  }, [openId, linked.isLoading, linked.data, onOpenHandled])

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
      cell: r => (r.severity ? <StatusPill status={r.severity} /> : '—'),
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

  const selected = selectedId ? [...(alerts.data ?? []), ...(linked.data ?? [])].find(a => a.id === selectedId) ?? null : null
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
          hint="Test alerts are not counted"
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
        onRowClick={a => setSelectedId(a.id)}
        selectedKey={selectedId}
        empty={{
          title: filter === 'active' ? 'No open alerts' : 'No resolved alerts yet',
          description: filter === 'active'
            ? 'Overspeed, long idle, GPS lost, low fuel and device alerts show up here as they happen.'
            : undefined,
        }}
      />
      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? alertTypeLabel(selected.type) : ''}
        description={selected?.plate_number ?? undefined}
        footer={selected && selected.status !== 'resolved' ? (
          <>
            {selected.status === 'open' && (
              <Button variant="secondary" loading={acknowledge.isPending} onClick={() => acknowledge.mutate(selected.id)}>Acknowledge</Button>
            )}
            <Button loading={resolve.isPending} onClick={() => onResolve(selected)}>Resolve alert</Button>
          </>
        ) : undefined}
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={statusTone[selected.status]}>{statusLabel[selected.status]}</StatusPill>
              {selected.severity && <StatusPill status={selected.severity} />}
              {selected.is_test && <StatusPill tone="info" dot={false}>Test</StatusPill>}
            </div>
            <DetailList
              columns={1}
              items={[
                { label: 'Vehicle', value: <span className="font-mono">{selected.plate_number ?? '—'}</span> },
                { label: 'Details', value: selected.message ?? '—' },
                { label: 'Times it happened', value: selected.occurrences.toLocaleString('en-IN') },
                { label: 'Raised', value: formatDateTime(selected.created_at) },
                { label: 'Last seen', value: formatDateTime(selected.last_seen_at) },
                ...(selected.acknowledged_at ? [{ label: 'Acknowledged', value: formatDateTime(selected.acknowledged_at) }] : []),
                ...(selected.resolved_at ? [{ label: 'Resolved', value: formatDateTime(selected.resolved_at) }] : []),
              ]}
            />
          </div>
        )}
      </Drawer>
    </div>
  )
}
