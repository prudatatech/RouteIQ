import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cargoAPI } from '@/services/api'
import { Button, DataTable, StatusPill, humanize, useConfirm, type Column } from '@/components/ui'
import { apiErrorMessage, backhaulKeys, useCargoAlerts, type CargoAlert } from './data'

const severityTone = (s: string | null) => (s === 'critical' ? 'danger' : s === 'high' ? 'warning' : 'neutral')

/** Unresolved cargo alerts (tamper, geofence, temperature) raised against vehicles. */
export default function CargoAlertsTab() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { data = [], isLoading, isError, refetch } = useCargoAlerts()

  const resolve = useMutation({
    mutationFn: (id: string) => cargoAPI.resolveAlert(id),
    onSuccess: () => {
      toast.success('Alert resolved')
      queryClient.invalidateQueries({ queryKey: backhaulKeys.alerts })
    },
    onError: err => toast.error(apiErrorMessage(err, 'We could not resolve this alert. Try again.')),
  })

  const onResolve = async (alert: CargoAlert) => {
    const ok = await confirm({
      title: 'Resolve this alert?',
      message: `${humanize(alert.type)} on ${alert.plate_number ?? 'this vehicle'} will be closed and removed from this list.`,
      confirmLabel: 'Resolve alert',
    })
    if (ok) resolve.mutate(alert.id)
  }

  const columns: Column<CargoAlert>[] = [
    {
      key: 'vehicle', header: 'Vehicle', sortValue: r => r.plate_number ?? '',
      cell: r => <span className="font-mono text-sm">{r.plate_number ?? '—'}</span>,
    },
    { key: 'type', header: 'Alert', sortValue: r => r.type, cell: r => humanize(r.type) },
    {
      key: 'severity', header: 'Severity', sortValue: r => r.severity ?? '',
      cell: r => (r.severity ? <StatusPill tone={severityTone(r.severity)}>{humanize(r.severity)}</StatusPill> : '—'),
    },
    { key: 'message', header: 'Details', hideBelow: 'lg', cell: r => r.message ?? '—' },
    {
      key: 'raised', header: 'Raised', sortValue: r => r.timestamp,
      cell: r => new Date(r.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    },
    {
      key: 'action', header: <span className="sr-only">Action</span>, align: 'right',
      cell: r => (
        <Button
          size="sm"
          variant="secondary"
          loading={resolve.isPending && resolve.variables === r.id}
          onClick={e => { e.stopPropagation(); onResolve(r) }}
        >
          Resolve
        </Button>
      ),
    },
  ]

  return (
    <DataTable
      caption="Unresolved cargo alerts"
      columns={columns}
      rows={data}
      rowKey={r => r.id}
      loading={isLoading}
      error={isError ? 'We could not load cargo alerts. Check your connection and try again.' : undefined}
      onRetry={() => refetch()}
      initialSort={{ key: 'raised', direction: 'desc' }}
      empty={{ title: 'No open cargo alerts', description: 'Tamper, geofence and temperature alerts from vehicles show up here.' }}
    />
  )
}
