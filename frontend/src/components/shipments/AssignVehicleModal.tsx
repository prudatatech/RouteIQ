import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, DataTable, Modal, StatusPill, humanize, type Column } from '@/components/ui'
import LiveMap from '@/components/map/LiveMap'
import { shipmentsAPI } from '@/services/api'
import { apiErrorMessage, formatKg, freeCapacityKg, knownDistance } from './format'
import type { ShipmentRow, VehicleOption } from './types'

/** Pick a vehicle for a shipment that has none. Vehicles nearest the pickup come first. */
export default function AssignVehicleModal({ shipment, onClose }: { shipment: ShipmentRow | null; onClose: () => void }) {
  const queryClient = useQueryClient()

  const { data: options = [], isLoading, isError, refetch } = useQuery<VehicleOption[]>({
    queryKey: ['assignOptions', shipment?.id, 'near'],
    queryFn: () => shipmentsAPI.getAssignOptions(shipment!.id, 'near'),
    enabled: !!shipment,
  })

  const assign = useMutation({
    mutationFn: (vehicleId: string) => shipmentsAPI.assignDriver(shipment!.id, vehicleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success('Vehicle assigned')
      onClose()
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error, 'We could not assign the vehicle. Try again.')),
  })

  const columns: Column<VehicleOption>[] = [
    {
      key: 'plate',
      header: 'Vehicle',
      sortValue: v => v.plate_number,
      cell: v => (
        <div className="min-w-0">
          <div className="font-mono font-medium">{v.plate_number}</div>
          {(v.vehicle_model || v.vehicle_type) && <div className="text-xs text-muted">{v.vehicle_model || humanize(v.vehicle_type!)}</div>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: v => <StatusPill status={v.status} />, hideBelow: 'lg' },
    {
      key: 'free',
      header: 'Free capacity',
      align: 'right',
      sortValue: v => freeCapacityKg(v),
      cell: v => (
        <span className="tabular">
          {formatKg(freeCapacityKg(v))}
          {v.capacity_kg != null && <span className="text-muted"> of {formatKg(v.capacity_kg)}</span>}
        </span>
      ),
    },
    {
      key: 'distance',
      header: 'From pickup',
      align: 'right',
      sortValue: v => knownDistance(v),
      cell: v => {
        const d = knownDistance(v)
        return d == null ? <span className="text-muted">Unknown</span> : <span className="tabular">{d.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km</span>
      },
    },
    {
      key: 'action',
      header: <span className="sr-only">Action</span>,
      align: 'right',
      cell: v => (
        <Button
          size="sm"
          variant="secondary"
          loading={assign.isPending && assign.variables === v.id}
          disabled={assign.isPending}
          onClick={() => assign.mutate(v.id)}
          aria-label={`Assign ${v.plate_number}`}
        >
          Assign
        </Button>
      ),
    },
  ]

  const mapVehicles = options
    .filter(v => v.latitude != null && v.longitude != null)
    .map(v => ({ id: v.id, plate_number: v.plate_number, status: v.status ?? 'unknown', latitude: v.latitude, longitude: v.longitude, vehicle_type: v.vehicle_type ?? undefined }))

  return (
    <Modal
      open={!!shipment}
      onClose={onClose}
      title="Assign vehicle"
      description={shipment ? `Choose a vehicle for ${shipment.tracking_id}. Vehicles nearest the pickup are listed first.` : undefined}
      size="xl"
      footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}
    >
      <div className="space-y-4">
        {mapVehicles.length > 0 && (
          <div className="hidden h-64 overflow-hidden rounded-card border border-border md:block">
            <LiveMap vehicles={mapVehicles} />
          </div>
        )}
        <DataTable
          caption="Vehicles that can take this shipment"
          columns={columns}
          rows={options}
          rowKey={v => v.id}
          loading={isLoading}
          error={isError ? 'We could not load vehicles. Check your connection and try again.' : undefined}
          onRetry={() => refetch()}
          empty={{ title: 'No vehicles available', description: 'Only vehicles that are available, idle or on a route can be assigned.' }}
          pageSize={10}
        />
      </div>
    </Modal>
  )
}
