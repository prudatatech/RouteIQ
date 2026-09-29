import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ShieldAlert } from 'lucide-react'
import { telemetryAPI, vehiclesAPI } from '@/services/api'
import { Button, DataTable, Stat, StatusPill, buttonClasses, useConfirm, type Column } from '@/components/ui'
import { formatDateTime, formatRelative } from '@/utils/display'
import { isOpenSos, sosSeverityLabel, sosStatusLabel, sosStatusOf, sosStatusTone, sosTypeLabel } from '@/utils/sos'
import { apiErrorMessage } from './health'
import { useSosCounts } from './useSosCounts'

type History = Awaited<ReturnType<typeof vehiclesAPI.sosHistory>>
type Alert = History['alerts'][number]

/**
 * Every SOS this vehicle has raised, newest first, with the counts (all time, last 30 days, open,
 * cancelled) and the same acknowledge, resolve and false-alarm actions as Emergencies. The list
 * follows the table in realtime, so a driver cancelling from the app closes the row here at once.
 */
export default function VehicleSosTab({ vehicleId, plate, canAct, onRaise }: {
  vehicleId: string
  plate: string
  /** Staff can act on alerts and raise one for the driver. */
  canAct: boolean
  onRaise?: () => void
}) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  useSosCounts() // keeps the realtime subscription that refreshes the history
  const history = useQuery<History>({
    queryKey: ['vehicles', 'sos-history', vehicleId],
    queryFn: () => vehiclesAPI.sosHistory(vehicleId),
    refetchInterval: 60_000,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['vehicles', 'sos-history', vehicleId] })
    queryClient.invalidateQueries({ queryKey: ['vehicles', 'sos-counts'] })
    queryClient.invalidateQueries({ queryKey: ['sos-alerts'] })
  }

  const act = useMutation({
    mutationFn: ({ id, step }: { id: string; step: 'acknowledge' | 'resolve' | 'cancel' }) =>
      step === 'acknowledge' ? telemetryAPI.acknowledgeSos(id) : step === 'resolve' ? telemetryAPI.resolveSos(id) : telemetryAPI.cancelSos(id),
    onSuccess: (_d, { step }) => {
      toast.success(step === 'acknowledge' ? 'SOS acknowledged' : step === 'resolve' ? 'SOS resolved' : 'SOS closed as a false alarm')
      refresh()
    },
    onError: err => {
      toast.error(apiErrorMessage(err, 'We could not update this SOS. Try again.'))
      refresh() // someone else may already have closed it
    },
  })

  const close = async (a: Alert, step: 'resolve' | 'cancel') => {
    const ok = await confirm(step === 'resolve'
      ? { title: 'Resolve this SOS?', message: `Mark the ${sosTypeLabel(a.alert_type)} SOS for ${plate} as resolved.`, confirmLabel: 'Resolve SOS' }
      : { title: 'Close this SOS as a false alarm?', message: `The ${sosTypeLabel(a.alert_type)} SOS for ${plate} is closed as cancelled. It stays in the history.`, confirmLabel: 'Close as false alarm', cancelLabel: 'Keep it open' })
    if (ok) act.mutate({ id: a.id, step })
  }

  const counts = history.data?.counts
  const columns: Column<Alert>[] = [
    {
      key: 'raised', header: 'Raised', sortValue: a => a.created_at,
      cell: a => (
        <div>
          <p className="text-text">{formatDateTime(a.created_at)}</p>
          <p className="text-xs text-muted">{formatRelative(a.created_at)}</p>
        </div>
      ),
    },
    {
      key: 'type', header: 'What happened', sortValue: a => a.alert_type ?? '',
      cell: a => (
        <div>
          <p className="text-text">{sosTypeLabel(a.alert_type)}</p>
          {sosSeverityLabel(a.severity) && <p className={'text-xs ' + (a.severity === 'serious' ? 'font-medium text-danger' : 'text-muted')}>{sosSeverityLabel(a.severity)}</p>}
        </div>
      ),
    },
    {
      key: 'note', header: 'Note', hideBelow: 'md',
      cell: a => <span className="text-sm text-muted">{a.description ?? '—'}</span>,
    },
    {
      key: 'status', header: 'Status', sortValue: a => sosStatusOf(a.status),
      cell: a => <StatusPill tone={sosStatusTone(a.status)}>{sosStatusLabel(a.status)}</StatusPill>,
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: a => (
        <div className="flex flex-wrap justify-end gap-2" onClick={e => e.stopPropagation()}>
          {isOpenSos(a.status) && canAct && (
            <>
              {sosStatusOf(a.status) === 'active' && (
                <Button size="sm" variant="secondary" loading={act.isPending && act.variables?.id === a.id && act.variables.step === 'acknowledge'} onClick={() => act.mutate({ id: a.id, step: 'acknowledge' })}>Acknowledge</Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => close(a, 'resolve')}>Resolve</Button>
              <Button size="sm" variant="secondary" onClick={() => close(a, 'cancel')}>False alarm</Button>
            </>
          )}
          <Link to={`/emergency?open=${a.id}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Open</Link>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <section aria-label="SOS counts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Raised in total" value={counts?.total ?? 0} loading={history.isLoading} hint="Every SOS from this vehicle" />
        <Stat label="Last 30 days" value={counts?.last_30_days ?? 0} loading={history.isLoading} tone={counts && counts.last_30_days > 0 ? 'warning' : 'default'} />
        <Stat label="Open now" value={counts?.open ?? 0} loading={history.isLoading} tone={counts && counts.open > 0 ? 'danger' : 'default'} hint="Active or acknowledged" />
        <Stat label="Cancelled" value={counts?.cancelled ?? 0} loading={history.isLoading} hint="False alarms" />
      </section>
      {canAct && onRaise && (
        <div>
          <Button variant="danger" icon={<ShieldAlert size={16} />} onClick={onRaise}>Raise SOS</Button>
        </div>
      )}
      <DataTable
        caption={`SOS history for ${plate}`}
        columns={columns}
        rows={history.data?.alerts ?? []}
        rowKey={a => a.id}
        loading={history.isLoading}
        error={history.isError ? 'We could not load the SOS history.' : undefined}
        onRetry={() => history.refetch()}
        initialSort={{ key: 'raised', direction: 'desc' }}
        pageSize={10}
        empty={{
          icon: <ShieldAlert size={22} />,
          title: 'No SOS from this vehicle',
          description: 'When the driver presses the SOS button in the app, or staff raise one, it is listed here.',
        }}
      />
    </div>
  )
}
