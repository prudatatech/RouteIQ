import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Truck, MapPin } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, StatusPill } from '@/components/ui'
import { publicAPI, tplPortalAPI } from '@/services/api'
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
  const [selectedClass, setSelectedClass] = useState<string | undefined>(undefined)
  const vehicles = useQuery({ queryKey: ['tpl-portal-vehicles', partner.id], queryFn: () => tplPortalAPI.vehicles(partner.id) })

  const { data: vehicleClasses } = useQuery({
    queryKey: ['public', 'vehicle-classes'],
    queryFn: () => publicAPI.vehicleClasses(),
    staleTime: 3_600_000,
  })

  const openForm = (v: NetVehicle | null, defaultCls?: string) => {
    setEditing(v)
    setSelectedClass(defaultCls)
    setOpen(true)
  }

  // Parse declared fleet from onboarding
  const declaredFleet = useMemo(() => {
    if (!partner.truck_type && !partner.fleet_size) return null
    const classesMap = new Map((vehicleClasses ?? []).map(vc => [vc.key, vc.name]))

    let totalTrucks = 0
    const items: { key: string; name: string; count: number }[] = []

    if (partner.fleet_size === 'single') {
      const key = partner.truck_type || 'truck'
      totalTrucks = 1
      items.push({
        key,
        name: classesMap.get(key) || key.replace(/_/g, ' ').toUpperCase(),
        count: 1,
      })
    } else {
      try {
        const parsed = JSON.parse(partner.truck_type || '{}')
        for (const [key, count] of Object.entries(parsed)) {
          const num = Number(count) || 0
          if (num > 0) {
            totalTrucks += num
            items.push({
              key,
              name: classesMap.get(key) || key.replace(/_/g, ' ').toUpperCase(),
              count: num,
            })
          }
        }
      } catch {
        if (partner.truck_type) {
          totalTrucks = 1
          items.push({
            key: partner.truck_type,
            name: classesMap.get(partner.truck_type) || partner.truck_type,
            count: 1,
          })
        }
      }
    }

    return {
      fleetSize: partner.fleet_size,
      totalTrucks,
      operatingFrom: partner.operating_from,
      items,
    }
  }, [partner.fleet_size, partner.truck_type, partner.operating_from, vehicleClasses])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        description="The vehicles you carry loads on. Pick one of them when you accept a load."
        actions={<Button icon={<Plus size={16} />} onClick={() => openForm(null)}>Add vehicle</Button>}
      />

      {declaredFleet && (
        <Card padded className="space-y-4 border-brand/30 bg-surface">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Truck className="text-brand h-5 w-5" />
                <h3 className="text-base font-semibold text-text">Registered Fleet from Onboarding</h3>
              </div>
              <p className="text-xs text-muted mt-1 flex items-center gap-1">
                {declaredFleet.operatingFrom && (
                  <>
                    <MapPin size={12} className="text-muted inline shrink-0" />
                    <span>Operating base: {declaredFleet.operatingFrom} • </span>
                  </>
                )}
                <span>Declared during 3PL registration</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-control bg-brand-soft text-brand">
                {declaredFleet.totalTrucks} {declaredFleet.totalTrucks === 1 ? 'Truck Declared' : 'Total Trucks Declared'}
              </span>
              <span className="text-xs font-medium px-2.5 py-1 rounded-control bg-surface-subtle border border-border text-text capitalize">
                {declaredFleet.fleetSize === 'single' ? 'Single Vehicle' : 'Multiple Fleet'}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted uppercase">Fleet Breakdown</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {declaredFleet.items.map((item) => (
                <div key={item.key} className="flex items-center justify-between p-3 rounded-control border border-border bg-surface-subtle">
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-semibold text-text truncate">{item.name}</p>
                    <button
                      type="button"
                      onClick={() => openForm(null, item.key)}
                      className="text-xs text-brand hover:underline mt-0.5 inline-block"
                    >
                      + Register Plate / RC
                    </button>
                  </div>
                  <div className="flex items-center justify-center h-8 px-2.5 rounded-full bg-brand text-brand-fill text-xs font-semibold shrink-0">
                    {item.count} {item.count === 1 ? 'Truck' : 'Trucks'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {vehicles.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : vehicles.error ? (
        <ErrorState description="We could not load your vehicles." onRetry={() => vehicles.refetch()} />
      ) : (vehicles.data ?? []).length === 0 ? (
        <Card padded>
          <EmptyState
            compact
            icon={<Truck size={22} />}
            title="Complete Vehicle Registrations"
            description={
              declaredFleet && declaredFleet.totalTrucks > 0
                ? `You registered ${declaredFleet.totalTrucks} ${declaredFleet.totalTrucks === 1 ? 'truck' : 'trucks'} during onboarding (${declaredFleet.items.map(i => `${i.count}x ${i.name}`).join(', ')}). Add each vehicle's plate number, RC, and insurance to make them available for load assignments.`
                : 'Add the vehicles you own so you can accept loads on them.'
            }
            action={<Button icon={<Plus size={16} />} onClick={() => openForm(null)}>Add vehicle details</Button>}
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
      <VehicleFormModal partnerId={partner.id} vehicle={editing} defaultClass={selectedClass} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
