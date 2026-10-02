import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Truck } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, StatusPill } from '@/components/ui'
import { tplPortalAPI } from '@/services/api'
import { formatKg } from '@/utils/display'
import type { NetVehicle } from '@/types/network'
import VehicleFormModal from './VehicleFormModal'
import { documentBadges } from '../networkHelpers'
import { usePortal } from './portalContext'

/** Fleet: the partner's own vehicles. A company only ever sees counts, never these documents. */
export default function FleetPage() {
  const { partner } = usePortal()
  const [editing, setEditing] = useState<NetVehicle | null>(null)
  const [open, setOpen] = useState(false)
  const vehicles = useQuery({ queryKey: ['tpl-portal-vehicles', partner.id], queryFn: () => tplPortalAPI.vehicles(partner.id) })

  const openForm = (v: NetVehicle | null) => { setEditing(v); setOpen(true) }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        description="The vehicles you carry loads on. Pick one of them when you accept a load."
        actions={<Button icon={<Plus size={16} />} onClick={() => openForm(null)}>Add vehicle</Button>}
      />
      {vehicles.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : vehicles.error ? (
        <ErrorState description="We could not load your vehicles." onRetry={() => vehicles.refetch()} />
      ) : (vehicles.data ?? []).length === 0 ? (
        <Card padded>
          <EmptyState
            compact
            icon={<Truck size={22} />}
            title="No vehicles yet"
            description="Add the vehicles you own so you can accept loads on them."
            action={<Button icon={<Plus size={16} />} onClick={() => openForm(null)}>Add vehicle</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(vehicles.data ?? []).map(v => {
            const badges = documentBadges(v)
            return (
              <Card key={v.id} padded className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-text">{v.plate_number}</p>
                    <p className="text-xs text-muted">
                      {[v.vehicle_class ?? v.vehicle_type, v.body_type, v.capacity_kg ? formatKg(v.capacity_kg) : null, v.vehicle_model].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {v.status && <StatusPill status={v.status} />}
                    <IconButton label={`Edit ${v.plate_number}`} icon={<Pencil size={16} />} onClick={() => openForm(v)} />
                  </div>
                </div>
                {badges.length === 0 ? (
                  <p className="text-xs text-muted">Documents are in order.</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {badges.map(b => <li key={b.key}><StatusPill tone={b.tone} dot={false}>{b.text}</StatusPill></li>)}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}
      <VehicleFormModal partnerId={partner.id} vehicle={editing} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
