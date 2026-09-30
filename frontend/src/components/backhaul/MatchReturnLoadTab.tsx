import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { cargoAPI } from '@/services/api'
import { usePriceQuote } from '@/components/pricing/usePriceQuote'
import LoadActions from './LoadActions'
import {
  Alert, Button, Card, CardBody, CardHeader, DetailList, ErrorState, Input, Select, Skeleton,
} from '@/components/ui'
import { useCargoStore } from '@/store/cargoStore'
import { formatKg, formatKm } from '@/utils/display'
import {
  apiErrorMessage, spaceLeft, useBackhaulVehicles, useOpenLoads, vehicleLabel,
  type DuplicatedManifest,
} from './data'

type MatchResult =
  | {
      status: 'accepted'
      tracking_id: string
      shipper: string | null
      weight_kg: number
      remaining_capacity_kg: number
      depot_to_pickup_km: number
      pickup_to_drop_km: number
      added_distance_km: number
      waypoints: { role: 'start' | 'pickup' | 'drop'; name: string }[]
    }
  | { status: 'rejected'; tracking_id: string; weight_kg: number; reason: string }

const waypointLabel = { start: 'Start', pickup: 'Pick up', drop: 'Drop' }

/** Check whether an open load fits the space left on a returning truck, and how far out of the way it is. */
export default function MatchReturnLoadTab({ manifest, onDismissManifest }: {
  /** Route or manifest copied from Route details, used to prefill the truck. */
  manifest?: DuplicatedManifest | null
  onDismissManifest?: () => void
}) {
  const loads = useOpenLoads()
  const vehicles = useBackhaulVehicles()
  const { selectedVehicleId, selectedShipmentId, setSelectedVehicle, setSelectedShipment } = useCargoStore()
  const [capacity, setCapacity] = useState('')

  const vehicleList = useMemo(() => vehicles.data ?? [], [vehicles.data])
  const matchable = useMemo(() => (loads.data ?? []).filter(l => l.weight_kg != null), [loads.data])
  const vehicle = vehicleList.find(v => v.id === selectedVehicleId) ?? null
  const load = matchable.find(l => l.id === selectedShipmentId) ?? null

  const match = useMutation<MatchResult, unknown, void>({
    mutationFn: () => cargoAPI.backhaulMatch(load!.id, Number(capacity)),
  })

  // A price for the load that fits, to offer as the minimum bid if staff open a window instead of assigning it
  const fits = match.data?.status === 'accepted'
  const quote = usePriceQuote(fits && load && load.origin_lat != null && load.origin_lng != null && load.dest_lat != null && load.dest_lng != null && load.weight_kg
    ? {
        pickup: { lat: load.origin_lat, lng: load.origin_lng, label: load.origin },
        drop: { lat: load.dest_lat, lng: load.dest_lng, label: load.destination },
        weight_kg: load.weight_kg,
        vehicle_type: vehicle?.vehicle_type ?? null,
        source: 'backhaul',
      }
    : null)
  const suggested = quote.data?.status === 'ok' ? quote.data.suggested : null

  const chooseVehicle = (id: string) => {
    match.reset()
    setSelectedVehicle(id || null)
    const v = vehicleList.find(x => x.id === id)
    const space = v ? spaceLeft(v) : null
    setCapacity(space != null ? String(space) : '')
  }

  // A duplicated manifest brings its truck with it; on the way back the truck is empty.
  const appliedManifest = useRef<string | null>(null)
  useEffect(() => {
    if (!manifest?.vehicle_id || appliedManifest.current === manifest.id) return
    const v = vehicleList.find(x => x.id === manifest.vehicle_id)
    if (!v) return
    appliedManifest.current = manifest.id
    setSelectedVehicle(v.id)
    setCapacity(v.capacity_kg != null ? String(v.capacity_kg) : '')
  }, [manifest?.id, manifest?.vehicle_id, vehicleList, setSelectedVehicle])

  // Once, fill the space from a vehicle remembered from an earlier visit.
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !vehicle || manifest?.vehicle_id) return
    prefilled.current = true
    const space = spaceLeft(vehicle)
    if (space != null) setCapacity(String(space))
  }, [vehicle, manifest?.vehicle_id])

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

  const capacityKg = Number(capacity)
  const capacityError = capacity !== '' && !(capacityKg > 0) ? 'Enter a weight above 0 kg.' : undefined
  const canCheck = !!load && capacityKg > 0

  const stops = [...(manifest?.route_stops ?? [])].sort((a, b) => a.sequence - b.sequence)
  const manifestPath = stops.length
    ? stops.map(s => s.delivery_points?.address || s.delivery_points?.name).filter(Boolean).join(' → ')
    : null

  return (
    <div className="space-y-6">
      {manifest && (
        <Alert
          tone="info"
          title="Copied from Trip details"
          action={onDismissManifest && <Button variant="ghost" size="sm" onClick={onDismissManifest}>Dismiss</Button>}
        >
          {manifest.vehicles?.plate_number ? `${manifest.vehicles.plate_number}` : 'This trip'}
          {manifestPath ? `: ${manifestPath}. ` : '. '}
          {manifest.vehicle_id && vehicleList.some(v => v.id === manifest.vehicle_id)
            ? 'Its truck is filled in below. Choose a load to see if it fits the return trip.'
            : 'Its truck is not in your fleet list, so choose a vehicle below.'}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Truck and load" description="Space left is how much the truck can still take on the way back." />
          <CardBody className="space-y-4">
            <Select
              label="Vehicle"
              placeholder="Choose a vehicle"
              value={vehicle?.id ?? ''}
              onChange={e => chooseVehicle(e.target.value)}
              options={vehicleList.map(v => ({ value: v.id, label: vehicleLabel(v) }))}
              hint={vehicleList.length === 0 ? 'No vehicles yet. You can still enter the space left.' : undefined}
            />
            <Input
              label="Space left"
              type="number"
              inputMode="numeric"
              min={1}
              trailing="kg"
              value={capacity}
              onChange={e => { match.reset(); setCapacity(e.target.value) }}
              error={capacityError}
              required
            />
            <Select
              label="Load"
              placeholder={matchable.length ? 'Choose a load' : 'No open loads with a weight'}
              value={load?.id ?? ''}
              onChange={e => { match.reset(); setSelectedShipment(e.target.value || null) }}
              options={matchable.map(l => ({
                value: l.id,
                label: `${l.tracking_id} · ${l.origin ?? 'pickup'} to ${l.destination ?? 'drop'} · ${formatKg(l.weight_kg)}`,
              }))}
              disabled={matchable.length === 0}
              required
            />
            <Button fullWidth disabled={!canCheck} loading={match.isPending} onClick={() => match.mutate()}>
              Check match
            </Button>
          </CardBody>
        </Card>

        <div className="space-y-4">
          {match.isError && (
            <Alert tone="danger" title="We could not check this match">
              {apiErrorMessage(match.error, 'Check your connection and try again.')}
            </Alert>
          )}
          {match.data?.status === 'rejected' && (
            <Alert tone="warning" title={`${match.data.tracking_id} does not fit`}>{match.data.reason}</Alert>
          )}
          {match.data?.status === 'accepted' && (
            <Card>
              <CardHeader title={`${match.data.tracking_id} fits`} description={match.data.shipper ?? undefined} />
              <CardBody className="space-y-4">
                <DetailList
                  items={[
                    { label: 'Load weight', value: formatKg(match.data.weight_kg) },
                    { label: 'Space left after loading', value: formatKg(match.data.remaining_capacity_kg) },
                    { label: 'Extra distance', value: formatKm(match.data.added_distance_km) },
                    { label: 'Depot to pickup', value: formatKm(match.data.depot_to_pickup_km) },
                    { label: 'Pickup to drop', value: formatKm(match.data.pickup_to_drop_km) },
                  ]}
                />
                <ol className="space-y-2">
                  {match.data.waypoints.map((w, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-medium text-brand">{i + 1}</span>
                      <span><span className="text-muted">{waypointLabel[w.role]}:</span> <span className="text-text">{w.name}</span></span>
                    </li>
                  ))}
                </ol>
                {load && (
                  <LoadActions
                    loads={[load]}
                    vehicle={vehicle}
                    suggestedPrice={suggested}
                    onAssigned={() => { match.reset(); setSelectedShipment(null) }}
                  />
                )}
              </CardBody>
            </Card>
          )}
          {!match.data && !match.isError && (
            <Card padded>
              <p className="text-sm text-muted">Choose a truck and a load, then check the match to see whether it fits and how far out of the way it is.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
