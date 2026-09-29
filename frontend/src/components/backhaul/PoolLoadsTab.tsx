import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { cargoAPI } from '@/services/api'
import {
  Alert, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Select, Skeleton, Stat,
} from '@/components/ui'
import { useCargoStore } from '@/store/cargoStore'
import LoadActions from './LoadActions'
import { apiErrorMessage, formatKg, formatKm, useBackhaulVehicles, useOpenLoads, vehicleLabel, type OpenLoad } from './data'

interface PoolPlan {
  vehicle: { id: string; plate_number: string; capacity_kg: number }
  depot: { id: string; name: string }
  total_weight_kg: number
  separate_trips_distance_km: number
  pooled_distance_km: number
  distance_saved_km: number
  stops: { sequence: number; shipment_id: string; tracking_id: string; destination: string | null; weight_kg: number }[]
}

/** Why a load cannot be pooled, or null when it can. */
function missingInfo(load: OpenLoad): string | null {
  if (load.dest_lat == null || load.dest_lng == null) return 'No drop location'
  if (load.weight_kg == null) return 'No weight recorded'
  return null
}

/** Put several open loads on one truck and compare the pooled run with separate trips. */
export default function PoolLoadsTab() {
  const loads = useOpenLoads()
  const vehicles = useBackhaulVehicles()
  const storedVehicle = useCargoStore(s => s.selectedVehicleId)
  const setStoredVehicle = useCargoStore(s => s.setSelectedVehicle)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const vehicleOptions = useMemo(() => (vehicles.data ?? []).filter(v => v.capacity_kg), [vehicles.data])
  const vehicle = vehicleOptions.find(v => v.id === storedVehicle) ?? null

  const openIds = useMemo(() => new Set((loads.data ?? []).map(l => l.id)), [loads.data])
  const chosen = (loads.data ?? []).filter(l => picked.has(l.id))
  const totalKg = chosen.reduce((s, l) => s + (l.weight_kg ?? 0), 0)
  const overCapacity = !!vehicle?.capacity_kg && totalKg > vehicle.capacity_kg

  const plan = useMutation<PoolPlan, unknown, void>({
    mutationFn: () => cargoAPI.optimizePooling(chosen.map(l => l.id), vehicle!.id),
  })

  const toggle = (id: string) => {
    plan.reset()
    setPicked(prev => {
      const next = new Set([...prev].filter(x => openIds.has(x)))
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loads.isLoading || vehicles.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 max-w-xs" /><Skeleton className="h-64" /></div>
  }
  if (loads.isError || vehicles.isError) {
    return (
      <ErrorState
        title="We could not load loads and vehicles"
        description="Check your connection and try again."
        onRetry={() => { loads.refetch(); vehicles.refetch() }}
      />
    )
  }

  const canPlan = !!vehicle && chosen.length >= 2 && !overCapacity

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title="Choose loads" description="Pick two or more loads to carry on one truck." />
        {(loads.data ?? []).length < 2 ? (
          <EmptyState compact title="Not enough open loads" description="Pooling needs at least two shipments that are not on a route yet." />
        ) : (
          <ul className="divide-y divide-border">
            {(loads.data ?? []).map(load => {
              const missing = missingInfo(load)
              return (
                <li key={load.id} className="px-4 py-3 sm:px-6">
                  <Checkbox
                    checked={picked.has(load.id)}
                    disabled={!!missing}
                    onChange={() => toggle(load.id)}
                    label={
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono">{load.tracking_id}</span>
                        <span className="text-muted">{load.shipper ?? 'Unknown shipper'}</span>
                      </span>
                    }
                    description={missing
                      ? `${missing}, so it cannot be pooled`
                      : `To ${load.destination ?? 'drop location'} · ${formatKg(load.weight_kg)}`}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Plan the run" />
          <CardBody className="space-y-4">
            {vehicleOptions.length === 0 ? (
              <Alert tone="warning" title="No vehicle has a capacity recorded">Add a capacity to a vehicle in Fleet to plan a pooled run.</Alert>
            ) : (
              <Select
                label="Vehicle"
                placeholder="Choose a vehicle"
                value={vehicle?.id ?? ''}
                onChange={e => { plan.reset(); setStoredVehicle(e.target.value) }}
                options={vehicleOptions.map(v => ({ value: v.id, label: vehicleLabel(v) }))}
              />
            )}
            <p className="text-sm text-muted">
              {chosen.length === 0 ? 'No loads chosen yet.' : `${chosen.length} load${chosen.length === 1 ? '' : 's'} · ${formatKg(totalKg)}`}
              {vehicle?.capacity_kg ? ` of ${formatKg(vehicle.capacity_kg)}` : ''}
            </p>
            {overCapacity && (
              <Alert tone="warning">These loads weigh more than {vehicle?.plate_number} can carry. Remove a load or choose a bigger vehicle.</Alert>
            )}
            <Button fullWidth disabled={!canPlan} loading={plan.isPending} onClick={() => plan.mutate()}>
              Plan pooled route
            </Button>
          </CardBody>
        </Card>

        {plan.isError && (
          <Alert tone="danger" title="We could not plan this run">
            {apiErrorMessage(plan.error, 'Check your connection and try again.')}
          </Alert>
        )}

        {plan.data && (
          <Card>
            <CardHeader
              title={`Pooled run on ${plan.data.vehicle.plate_number}`}
              description={`Starts at ${plan.data.depot.name} · ${formatKg(plan.data.total_weight_kg)}`}
            />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <Stat label="Pooled run" value={formatKm(plan.data.pooled_distance_km)} />
                <Stat label="Separate trips" value={formatKm(plan.data.separate_trips_distance_km)} hint="Round trip to each drop" />
                <Stat
                  label="Distance saved"
                  value={formatKm(plan.data.distance_saved_km)}
                  tone={plan.data.distance_saved_km > 0 ? 'success' : 'warning'}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium text-text">Drop order</h3>
                <ol className="space-y-2">
                  {plan.data.stops.map(stop => (
                    <li key={stop.shipment_id} className="flex items-start gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-medium text-brand">{stop.sequence}</span>
                      <span className="min-w-0">
                        <span className="block text-text">{stop.destination ?? 'Drop location'}</span>
                        <span className="block text-muted"><span className="font-mono">{stop.tracking_id}</span> · {formatKg(stop.weight_kg)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <LoadActions
                loads={chosen}
                vehicle={vehicle}
                onAssigned={() => { plan.reset(); setPicked(new Set()) }}
              />
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
