import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, DetailList, humanize } from '@/components/ui'
import { vehiclesAPI } from '@/services/api'
import type { DraftShipmentData } from '@/store/draftStore'
import { formatKg, formatRupees } from '../format'
import type { VehicleOption } from '../types'
import { CARGO_TYPES, chargeableKg } from './payload'
import type { StepId } from './validation'

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-card border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Change ${title.toLowerCase()}`}>Change</Button>
      </div>
      {children}
    </section>
  )
}

export default function ReviewStep({ data, goTo }: { data: DraftShipmentData; goTo: (step: StepId) => void }) {
  const { data: vehicles = [] } = useQuery<VehicleOption[]>({ queryKey: ['vehicles'], queryFn: () => vehiclesAPI.list() as Promise<VehicleOption[]> })
  const vehicle = vehicles.find(v => v.id === data.selectedVehicleId)
  const cargoName = CARGO_TYPES.find(c => c.id === data.cargo_type)?.name ?? humanize(data.cargo_type || 'standard')
  const stops = data.stops || []

  return (
    <div className="space-y-4">
      <ReviewSection title="Route" onEdit={() => goTo('route')}>
        <DetailList
          columns={1}
          items={[
            { label: 'Pickup', value: data.origin_address || data.origin_name || null },
            ...stops.map((s, i) => ({ label: `Stop ${i + 1}`, value: s.address || s.name })),
            { label: 'Destination', value: data.delivery_point_address || data.delivery_point_name || null },
            { label: 'Dispatch', value: data.plan_for_later && data.scheduled_date
              ? new Date(`${data.scheduled_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
              : 'Today' },
          ]}
        />
      </ReviewSection>

      <ReviewSection title="Cargo" onEdit={() => goTo('cargo')}>
        <DetailList
          items={[
            { label: 'Type', value: cargoName },
            { label: 'Priority', value: humanize(data.priority || 'medium') },
            { label: 'Items', value: Number(data.total_items).toLocaleString('en-IN') },
            { label: 'Weight', value: formatKg(Number(data.total_weight_kg)) },
            { label: 'Package size', value: `${data.length_cm} × ${data.width_cm} × ${data.height_cm} cm` },
            { label: 'Chargeable weight', value: formatKg(chargeableKg(data)) },
            { label: 'Price', value: data.freight_charge ? formatRupees(Number(data.freight_charge)) : 'Not set' },
          ]}
        />
      </ReviewSection>

      <ReviewSection title="Vehicle" onEdit={() => goTo('vehicle')}>
        <DetailList
          items={[
            { label: 'Dispatch', value: data.open_bidding ? 'Open to vendor bids' : 'Assign directly' },
            { label: 'Vehicle', value: vehicle ? <span className="font-mono">{vehicle.plate_number}</span> : 'Assign later' },
            ...(data.open_bidding ? [
              { label: 'Bidding window', value: `${data.bidding_duration_mins || 5} minutes` },
              { label: 'Minimum bid', value: data.asking_price ? formatRupees(Number(data.asking_price)) : 'Not set' },
            ] : []),
            { label: 'Phone tracking', value: data.enable_mobile_gps ? 'On' : 'Off' },
          ]}
        />
      </ReviewSection>
    </div>
  )
}
