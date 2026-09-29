import { useQuery } from '@tanstack/react-query'
import { fleetAPI } from '@/services/api'
import { DataTable, StatusPill, type Column } from '@/components/ui'
import { formatDate } from '@/utils/display'
import { fleetKeys, formatOdometer, serviceLabel, serviceTone, type ServiceDueRow } from './health'

const columns = (onOpen: (vehicleId: string) => void): Column<ServiceDueRow>[] => [
  { key: 'vehicle', header: 'Vehicle', sortValue: r => r.plate_number, cell: r => <span className="font-mono text-sm">{r.plate_number}</span> },
  { key: 'item', header: 'Item', sortValue: r => r.item, cell: r => r.item },
  { key: 'status', header: 'Status', sortValue: r => (r.status === 'overdue' ? 0 : 1), cell: r => <StatusPill tone={serviceTone[r.status]}>{serviceLabel[r.status]}</StatusPill> },
  { key: 'when', header: 'When', cell: r => r.summary },
  { key: 'odo', header: 'Odometer', align: 'right', hideBelow: 'md', cell: r => <span className="tabular">{formatOdometer(r.odometer_km)}</span> },
  { key: 'last', header: 'Last done', hideBelow: 'lg', cell: r => (r.last_done_at ? formatDate(r.last_done_at) : '—') },
  {
    key: 'open', header: <span className="sr-only">Open</span>, align: 'right',
    cell: r => (
      <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={e => { e.stopPropagation(); onOpen(r.vehicle_id) }}>
        Open vehicle
      </button>
    ),
  },
]

/** Service items that are overdue or due soon across the whole fleet. */
export default function ServiceDueView({ onOpenVehicle }: { onOpenVehicle: (vehicleId: string) => void }) {
  const { data = [], isLoading, isError, refetch } = useQuery<ServiceDueRow[]>({
    queryKey: fleetKeys.serviceDue,
    queryFn: () => fleetAPI.serviceDue() as Promise<ServiceDueRow[]>,
    refetchInterval: 60_000,
  })
  return (
    <DataTable
      caption="Service due"
      columns={columns(onOpenVehicle)}
      rows={data}
      rowKey={r => r.id}
      loading={isLoading}
      error={isError ? 'We could not load the service list. Check your connection and try again.' : undefined}
      onRetry={() => refetch()}
      onRowClick={r => onOpenVehicle(r.vehicle_id)}
      empty={{ title: 'Nothing is due', description: 'Add service items to a vehicle from its details to track them here.' }}
    />
  )
}
