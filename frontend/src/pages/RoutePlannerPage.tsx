import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Copy, ExternalLink, Navigation, Sparkles, Truck } from 'lucide-react'
import { vehiclesAPI } from '@/services/api'
import { reversePlace, type ResolvedPlace } from '@/services/geocoding'
import { routingAPI, type CreateRouteRequest, type OrderResult, type PlanRequest, type PlanResult } from '@/services/routing'
import { MapView, type MapAltRoute, type MapPoint, type MapRouteStop, type MapViewHandle } from '@/components/map'
import type { Vehicle } from '@/components/fleet/types'
import { containerSize } from '@/components/fleet/types'
import StopsEditor from '@/components/routePlanner/StopsEditor'
import RouteCards from '@/components/routePlanner/RouteCards'
import LoadPicker from '@/components/routePlanner/LoadPicker'
import {
  Alert, Button, Card, CardBody, CardHeader, Checkbox, DetailList, EmptyState, ErrorState, Input, LoadingState, Page, PageHeader, Select, buttonClasses,
} from '@/components/ui'
import { formatKg, formatKm, formatMinutes } from '@/utils/display'
import { isFleetVehicle } from '@/utils/vehicles'
import { useAuthStore } from '@/store/authStore'
import {
  MAX_STOPS, applyOrder, describeSaving, formatArrival, googleMapsUrl, isoToIstInput, loadWeightOfStops, pickupDropWarning, planText, pointTimes,
  requestKey, routingErrorMessage, sectionMidpoint, shortName, tagRoutes, toPlanRequest, truckProfileText, type PlannerInput, type PlannerStop,
} from '@/utils/routePlanner'

type PlannerVehicle = Vehicle & { fuel_efficiency_kmpl?: number | null }

const OPERATING = ['available', 'on_route', 'idle', 'offline']
const NO_AVOID = { tolls: false, highways: false, ferries: false, unpaved: false }
const AVOID_OPTIONS = [
  { key: 'tolls', label: 'Avoid toll roads' },
  { key: 'highways', label: 'Avoid highways' },
  { key: 'ferries', label: 'Avoid ferries' },
  { key: 'unpaved', label: 'Avoid unpaved roads' },
] as const

/** The kerb weight typed for a vehicle is kept in this browser, so it is asked for once. */
const kerbStorageKey = (vehicleId: string) => `route-planner:kerb:${vehicleId}`
function readKerb(vehicleId: string): string {
  try { return (vehicleId && window.localStorage.getItem(kerbStorageKey(vehicleId))) || '' } catch { return '' }
}
function saveKerb(vehicleId: string, value: string) {
  try {
    if (!vehicleId) return
    if (value.trim() === '') window.localStorage.removeItem(kerbStorageKey(vehicleId))
    else window.localStorage.setItem(kerbStorageKey(vehicleId), value)
  } catch { /* the value still works for this visit */ }
}

const placeToPoint = (p: ResolvedPlace) => ({ lat: p.lat, lng: p.lng, address: p.address })

/**
 * Plan a truck trip by hand. `embedded` is for the Dispatch workspace: no page title, and the new
 * trip goes to Trips to send (`onCreated`) instead of opening its page.
 */
export default function RoutePlannerPage({ embedded = false, onCreated }: { embedded?: boolean; onCreated?: (tripId: string) => void }) {
  const navigate = useNavigate()
  const mapRef = useRef<MapViewHandle>(null)

  const [origin, setOrigin] = useState<ResolvedPlace | null>(null)
  const [destination, setDestination] = useState<ResolvedPlace | null>(null)
  const [stops, setStops] = useState<PlannerStop[]>([])
  const [vehicleId, setVehicleId] = useState('')
  const [loadEdit, setLoadEdit] = useState<string | null>(null)
  const [kerbEdit, setKerbEdit] = useState<string | null>(null)
  const [departLater, setDepartLater] = useState(false)
  const [departLocal, setDepartLocal] = useState('')
  const [avoid, setAvoid] = useState(NO_AVOID)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [locating, setLocating] = useState(false)

  const [result, setResult] = useState<PlanResult | null>(null)
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [optimization, setOptimization] = useState<{ key: string; data: OrderResult } | null>(null)

  const statusQ = useQuery({ queryKey: ['routing', 'status'], queryFn: routingAPI.status, staleTime: 5 * 60_000 })
  const vehiclesQ = useQuery({ queryKey: ['vehicles'], queryFn: () => vehiclesAPI.list() })

  const vehicles = useMemo(
    () => (vehiclesQ.data as PlannerVehicle[] | undefined ?? [])
      .filter(v => isFleetVehicle(v) && OPERATING.includes(v.status))
      .sort((a, b) => a.plate_number.localeCompare(b.plate_number)),
    [vehiclesQ.data],
  )
  const vehicle = vehicles.find(v => v.id === vehicleId) ?? null

  // Load: what was typed, else the weight of the picked shipments, else what the vehicle carries now
  const stopsLoad = loadWeightOfStops(stops)
  const autoLoad = stopsLoad > 0 ? String(stopsLoad) : vehicle?.current_load_kg ? String(vehicle.current_load_kg) : ''
  const loadValue = loadEdit ?? autoLoad
  const kerbValue = kerbEdit ?? readKerb(vehicleId)

  const input: PlannerInput = {
    origin: origin && placeToPoint(origin),
    destination: destination && placeToPoint(destination),
    stops, vehicleId, loadKg: loadValue, kerbKg: kerbValue,
    departLocal: departLater ? departLocal : '',
    avoid,
  }
  const request = toPlanRequest(input)
  const currentKey = request ? requestKey(request) : null
  const stale = result !== null && currentKey !== resultKey
  const fresh = result && !stale ? result : null

  const selected = fresh?.routes.find(r => r.id === selectedId) ?? fresh?.routes[0] ?? null
  const tags = fresh ? tagRoutes(fresh.routes) : []
  const times = selected && fresh ? pointTimes(fresh.departure_at, selected.legs) : []
  const orderWarning = pickupDropWarning(stops)
  const laterInvalid = departLater && departLocal !== '' && Date.parse(`${departLocal}:00+05:30`) < Date.now() - 60_000
  const isSuperadmin = useAuthStore(s => s.role) === 'superadmin'
  const routingUnavailable = statusQ.data ? !statusQ.data.available : false

  // ── Actions ──
  const plan = useMutation({
    mutationFn: (req: PlanRequest) => routingAPI.plan(req),
    onSuccess: (data, req) => {
      setResult(data)
      setResultKey(requestKey(req))
      const tagList = tagRoutes(data.routes)
      setSelectedId(data.routes[Math.max(0, tagList.indexOf('Fastest'))]?.id ?? '')
      setOptimization(null)
    },
  })
  const optimize = useMutation({
    mutationFn: (req: PlanRequest) => routingAPI.optimizeOrder(req),
    onSuccess: (data, req) => setOptimization({ key: requestKey(req), data }),
  })
  const createRoute = useMutation({
    mutationFn: (body: CreateRouteRequest) => routingAPI.createRoute(body),
    onSuccess: created => {
      toast.success('Trip created. Send it to the driver from Trips to send in Dispatch.')
      if (onCreated) onCreated(created.id)
      else navigate(`/routes/${created.id}`)
    },
  })

  const runPlan = () => {
    if (!request) return
    optimize.reset()
    plan.mutate(request)
  }
  const runOptimize = () => {
    if (!request) return
    setOptimization(null)
    optimize.mutate(request)
  }
  const applyOptimized = (order: number[]) => {
    const next = applyOrder(stops, order)
    setStops(next)
    setOptimization(null)
    const req = toPlanRequest({ ...input, stops: next })
    if (req) plan.mutate(req)
  }

  const changeVehicle = (id: string) => {
    setVehicleId(id)
    setLoadEdit(null)
    setKerbEdit(null)
  }

  const useVehicleStart = async () => {
    if (!vehicle?.latitude || !vehicle.longitude) return
    setLocating(true)
    const place = await reversePlace(vehicle.latitude, vehicle.longitude).catch(() => null)
    setLocating(false)
    setOrigin(place ?? {
      address: vehicle.current_location_name || `${vehicle.plate_number} location (${vehicle.latitude.toFixed(4)}, ${vehicle.longitude.toFixed(4)})`,
      lat: vehicle.latitude, lng: vehicle.longitude,
    })
  }

  const mapsLink = useMemo(() => {
    if (!origin || !destination) return null
    return googleMapsUrl(origin, destination, stops, avoid)
  }, [origin, destination, stops, avoid])

  const pointNames = [origin && shortName(origin.address), ...stops.map(s => s.name), destination && shortName(destination.address)]
  const copyPlan = async () => {
    if (!fresh || !selected || !mapsLink) return
    const text = planText({
      vehicle: fresh.vehicle?.plate_number ?? null,
      departureIso: fresh.departure_at,
      points: pointNames.map(name => ({ name: name ?? '' })),
      route: selected,
      fuel: selected.fuel,
      provider: fresh.provider,
      truckAware: fresh.truck_aware,
      mapsUrl: mapsLink.url,
    })
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Plan copied')
    } catch {
      toast.error('Could not copy. Your browser blocked it.')
    }
  }

  const create = () => {
    if (!fresh || !selected || !origin || !destination || !vehicleId) return
    createRoute.mutate({
      vehicle_id: vehicleId,
      origin: { lat: origin.lat, lng: origin.lng, name: shortName(origin.address) },
      stops: [
        ...stops.map(s => ({ name: s.name, address: s.address, lat: s.lat, lng: s.lng, delivery_point_id: s.delivery_point_id ?? null })),
        { name: shortName(destination.address), address: destination.address, lat: destination.lat, lng: destination.lng, delivery_point_id: null },
      ],
      distance_km: selected.distance_km,
      duration_minutes: selected.travel_minutes,
      traffic_delay_minutes: selected.traffic_delay_minutes,
      estimated_fuel_liters: selected.fuel?.litres ?? null,
      departure_at: fresh.departure_at,
      provider: fresh.provider,
      truck_aware: fresh.truck_aware,
      toll_km: selected.toll_km,
      avoid,
    })
  }

  // ── Map ──
  const mapStops: MapRouteStop[] = useMemo(() => {
    const all = [
      origin && { name: shortName(origin.address), lat: origin.lat, lng: origin.lng },
      ...stops.map(s => ({ name: s.name, lat: s.lat, lng: s.lng })),
      destination && { name: shortName(destination.address), lat: destination.lat, lng: destination.lng },
    ].filter((p): p is { name: string; lat: number; lng: number } => !!p)
    // Numbers match the list: the start is 1 even before the end is chosen
    let n = 0
    return all.map(p => ({ id: `stop-${++n}`, sequence: n, label: p.name, position: { lat: p.lat, lng: p.lng } }))
  }, [origin, destination, stops])

  const altRoutes: MapAltRoute[] = fresh && selected
    ? fresh.routes.filter(r => r.id !== selected.id).map(r => ({
      id: r.id, coordinates: r.geometry, label: `Alternative route, ${formatMinutes(r.travel_minutes)}, ${formatKm(r.distance_km)}. Select to show it.`,
    }))
    : []

  const jamPoints: MapPoint[] = useMemo(() => (selected?.traffic_sections ?? []).slice(0, 4).flatMap((s, i) => {
    const position = sectionMidpoint(s.coordinates)
    return position ? [{ id: `jam-${selected?.id}-${i}`, kind: 'incident' as const, position, label: `${s.label}, about ${formatMinutes(Math.max(1, Math.round(s.delay_seconds / 60)))} delay` }] : []
  }), [selected])

  const canPlan = !!request && !routingUnavailable && !laterInvalid
  const busy = plan.isPending || optimize.isPending

  const opt = optimization && optimization.key === currentKey ? optimization.data : null
  const needsVehicleHint = fresh && !vehicleId

  return (
    <Page>
      {!embedded && (
        <PageHeader
          title="Plan a trip"
          description="Plan a truck trip with live traffic, tolls and a fuel estimate. Compare routes, put the stops in the best order, then create the trip."
        />
      )}

      {routingUnavailable && (
        <Alert tone="danger" title="Trip planning is not available">
          {isSuperadmin
            ? <>Trip planning isn't set up. <Link to="/admin/settings" className="font-medium underline">Open Settings</Link></>
            : 'Your administrator can switch it on in Settings.'}
        </Alert>
      )}
      {statusQ.data?.available && !statusQ.data.truck_routing && (
        <Alert tone="warning" title="Truck restrictions will not be considered">{isSuperadmin ? statusQ.data.message : 'Trips are planned without height, weight and length limits for now.'}</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* Map and results. On a phone they come first, above the form. */}
        <div className="space-y-4 lg:col-start-2 lg:row-start-1">
          <div className="h-80 overflow-hidden rounded-card border border-border sm:h-96 lg:h-[34rem]">
            <MapView
              ref={mapRef}
              mode="route"
              traffic={{ flow: true, incidents: true }}
              route={{ coordinates: fresh && selected ? selected.geometry : [], stops: mapStops, planned: !fresh }}
              altRoutes={altRoutes}
              onAltRouteSelect={setSelectedId}
              points={jamPoints}
              ariaLabel="Route map. Numbered markers show the start, the stops in driving order and the end."
            />
          </div>

          <Results
            plan={plan.isPending} planError={plan.isError ? routingErrorMessage(plan.error, 'Could not plan the trip. Try again in a moment.') : null}
            onRetry={runPlan} hasRequest={!!request} stale={stale}
            fresh={fresh}
            tags={tags}
            selectedId={selected?.id ?? ''}
            onSelect={setSelectedId}
            onZoomTo={pos => mapRef.current?.flyTo(pos, 12)}
          />

          {fresh && selected && (
            <Card padded>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  icon={<Navigation size={16} />}
                  loading={createRoute.isPending}
                  disabled={!vehicleId}
                  onClick={create}
                >
                  Create trip{vehicle ? ` for ${vehicle.plate_number}` : ''}
                </Button>
                {mapsLink && (
                  <a href={mapsLink.url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: 'secondary' })}>
                    <ExternalLink size={16} aria-hidden="true" /> Open in Google Maps
                  </a>
                )}
                <Button variant="secondary" icon={<Copy size={16} />} onClick={copyPlan}>Copy plan</Button>
              </div>
              <div className="mt-3 space-y-1 text-xs text-muted">
                {needsVehicleHint && <p>Choose a vehicle to create the trip.</p>}
                {mapsLink && mapsLink.omitted > 0 && <p>Google Maps opens up to 9 stops, so the last {mapsLink.omitted} are left out of that link.</p>}
                <p>Arrival times do not include time spent loading or unloading at stops.</p>
                {createRoute.isError && (
                  <p role="alert" className="text-danger">{routingErrorMessage(createRoute.error, 'Could not create the trip. Try again.')}</p>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Form */}
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
          <Card>
            <CardHeader title="Vehicle" description="Its weight, size and fuel use go into the trip and the fuel estimate." />
            <CardBody className="space-y-4">
              {vehiclesQ.isLoading ? <LoadingState label="Loading vehicles" className="py-6" /> : vehiclesQ.isError ? (
                <ErrorState compact title="Could not load vehicles" onRetry={() => vehiclesQ.refetch()} />
              ) : vehicles.length === 0 ? (
                <EmptyState compact icon={<Truck size={22} />} title="No vehicles yet" description="Add a vehicle in Fleet to plan a trip for it." />
              ) : (
                <>
                  <Select
                    label="Vehicle"
                    value={vehicleId}
                    onChange={e => changeVehicle(e.target.value)}
                    placeholder="Choose a vehicle"
                    options={vehicles.map(v => ({
                      value: v.id,
                      label: `${v.plate_number}${v.vehicle_type ? ` · ${v.vehicle_type}` : ''}${v.capacity_kg ? ` · ${formatKg(v.capacity_kg)}` : ''}`,
                    }))}
                  />
                  {vehicle && <VehicleSummary vehicle={vehicle} />}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <Input
                      label="Load on board"
                      type="number" inputMode="decimal" min={0}
                      value={loadValue}
                      onChange={e => setLoadEdit(e.target.value)}
                      trailing="kg"
                      hint={stopsLoad > 0 ? 'Weight of the shipments you picked.' : vehicle ? 'What the vehicle carries now.' : undefined}
                    />
                    <Input
                      label="Empty (kerb) weight"
                      type="number" inputMode="decimal" min={0}
                      value={kerbValue}
                      onChange={e => { setKerbEdit(e.target.value); saveKerb(vehicleId, e.target.value) }}
                      trailing="kg"
                      disabled={!vehicleId}
                      hint="Needed to apply weight limits on roads and bridges. Remembered on this device."
                    />
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Places" description="Drag stops, or use the arrows, to change the order." />
            <CardBody>
              <StopsEditor
                origin={origin} onOrigin={setOrigin}
                destination={destination} onDestination={setDestination}
                stops={stops} onStops={setStops}
                maxStops={MAX_STOPS}
                times={fresh && selected ? times.map((t, i) => (i === 0 ? `Leaves ${formatArrival(t, fresh.departure_at)}` : `Arrive ${formatArrival(t, fresh.departure_at)}`)) : []}
                onOpenLoads={() => setPickerOpen(true)}
                vehicleStart={vehicle?.latitude && vehicle.longitude ? { label: `Start from ${vehicle.plate_number}'s location`, onUse: useVehicleStart, busy: locating } : null}
                orderWarning={orderWarning}
                disabled={busy}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Departure and roads" />
            <CardBody className="space-y-4">
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-text">Departure</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input type="radio" name="depart" className="h-4 w-4 accent-brand" checked={!departLater} onChange={() => setDepartLater(false)} /> Leave now
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="radio" name="depart" className="h-4 w-4 accent-brand" checked={departLater}
                      onChange={() => { setDepartLater(true); if (!departLocal) setDepartLocal(isoToIstInput(Date.now() + 3600_000).replace(/:\d{2}$/, ':00')) }}
                    /> Leave later
                  </label>
                </div>
                {departLater && (
                  <Input
                    className="mt-3"
                    label="Departure time (India time)"
                    type="datetime-local"
                    value={departLocal}
                    min={isoToIstInput(Date.now())}
                    onChange={e => setDepartLocal(e.target.value)}
                    error={laterInvalid ? 'Choose a time that has not passed.' : undefined}
                    hint="Traffic is predicted for that time."
                  />
                )}
              </fieldset>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-text">Roads</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {AVOID_OPTIONS.map(o => (
                    <Checkbox key={o.key} label={o.label} checked={avoid[o.key]} onChange={e => setAvoid(a => ({ ...a, [o.key]: e.target.checked }))} />
                  ))}
                </div>
              </fieldset>
            </CardBody>
          </Card>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="lg" className="flex-1" icon={<Navigation size={18} />} loading={plan.isPending} disabled={!canPlan || optimize.isPending} onClick={runPlan}>
                {result ? 'Plan again' : 'Plan trip'}
              </Button>
              <Button
                size="lg" variant="secondary" className="flex-1" icon={<Sparkles size={18} />} loading={optimize.isPending}
                disabled={!canPlan || stops.length < 2 || plan.isPending || statusQ.data?.truck_routing === false}
                onClick={runOptimize}
              >
                Best stop order
              </Button>
            </div>
            {!request && <p className="text-xs text-muted">Choose a start and an end to plan the trip.</p>}
            {request && stops.length < 2 && <p className="text-xs text-muted">Add at least two stops to look for a better order.</p>}
            {statusQ.data?.truck_routing === false && statusQ.data.available && <p className="text-xs text-muted">Putting the stops in the best order is not available right now.</p>}
            {optimize.isError && <p role="alert" className="text-sm text-danger">{routingErrorMessage(optimize.error, 'Could not find a better order. Try again.')}</p>}

            {opt && <OrderSuggestion result={opt} onApply={() => applyOptimized(opt.order)} onDismiss={() => setOptimization(null)} />}
          </div>
        </div>
      </div>

      <LoadPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={added => { if (added.length > 0) setStops(current => [...current, ...added].slice(0, MAX_STOPS)) }}
        added={new Set(stops.flatMap(s => (s.shipment_id ? [s.shipment_id] : [])))}
        room={MAX_STOPS - stops.length}
      />
    </Page>
  )
}

function VehicleSummary({ vehicle }: { vehicle: PlannerVehicle }) {
  const size = containerSize(vehicle)
  const consequences: string[] = []
  if (!size) consequences.push('height and width limits are not checked')
  if (!vehicle.fuel_efficiency_kmpl) consequences.push('fuel cannot be estimated')
  return (
    <div className="space-y-3">
      <DetailList
        columns={2}
        items={[
          { label: 'Capacity', value: vehicle.capacity_kg ? formatKg(vehicle.capacity_kg) : '—' },
          { label: 'Carrying now', value: vehicle.current_load_kg != null ? formatKg(vehicle.current_load_kg) : '—' },
          { label: 'Container', value: size ?? '—' },
          { label: 'Fuel', value: vehicle.fuel_type ? `${vehicle.fuel_type}${vehicle.fuel_efficiency_kmpl ? `, ${vehicle.fuel_efficiency_kmpl} km/l` : ''}` : (vehicle.fuel_efficiency_kmpl ? `${vehicle.fuel_efficiency_kmpl} km/l` : '—') },
        ]}
      />
      {consequences.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>Missing on this vehicle: {consequences.join('; ')}. Add the details in Fleet.</span>
        </p>
      )}
    </div>
  )
}

function OrderSuggestion({ result, onApply, onDismiss }: { result: OrderResult; onApply: () => void; onDismiss: () => void }) {
  if (!result.applicable) {
    return (
      <Alert tone="warning" title="Your stop order was kept" action={<Button variant="secondary" size="sm" onClick={onDismiss}>Dismiss</Button>}>
        {result.reason}
      </Alert>
    )
  }
  if (!result.changed || (result.saved_km <= 0 && result.saved_minutes <= 0)) {
    return (
      <Alert tone="success" title={result.changed ? 'The best order is not any quicker' : 'Your order is already the fastest'} action={<Button variant="secondary" size="sm" onClick={onDismiss}>Dismiss</Button>}>
        {result.changed
          ? `The suggested order would be ${describeSaving(result.saved_km, result.saved_minutes)}, so it is not worth changing.`
          : `No other order of these stops is quicker (${formatKm(result.entered.distance_km)}, ${formatMinutes(result.entered.travel_minutes)}).`}
      </Alert>
    )
  }
  return (
    <Alert
      tone="info"
      title={`A better order is ${describeSaving(result.saved_km, result.saved_minutes)}`}
      action={
        <div className="flex gap-2">
          <Button size="sm" onClick={onApply}>Use this order</Button>
          <Button variant="secondary" size="sm" onClick={onDismiss}>Keep mine</Button>
        </div>
      }
    >
      <p>Yours: {formatKm(result.entered.distance_km)}, {formatMinutes(result.entered.travel_minutes)}. Suggested: {formatKm(result.optimized.distance_km)}, {formatMinutes(result.optimized.travel_minutes)}. The start and end stay where they are, and pickups stay before their drops.</p>
    </Alert>
  )
}

function Results({ plan, planError, onRetry, hasRequest, stale, fresh, tags, selectedId, onSelect, onZoomTo }: {
  plan: boolean
  planError: string | null
  onRetry: () => void
  hasRequest: boolean
  stale: boolean
  fresh: PlanResult | null
  tags: ReturnType<typeof tagRoutes>
  selectedId: string
  onSelect: (id: string) => void
  onZoomTo: (pos: { lat: number; lng: number }) => void
}) {
  if (plan) return <Card><LoadingState label="Finding the best routes" /></Card>
  if (planError) return <Card><ErrorState title="Could not plan the trip" description={planError} onRetry={hasRequest ? onRetry : undefined} /></Card>

  if (stale) {
    return <Alert tone="info" title="You changed the trip">Press Plan again to update the routes. The map shows your places in the order you set.</Alert>
  }
  if (!fresh) {
    return (
      <Card>
        <EmptyState
          compact
          icon={<Navigation size={22} />}
          title="No trip planned yet"
          description="Choose a start and an end, add any stops, pick a vehicle, then press Plan trip. You will see up to three routes to compare."
        />
      </Card>
    )
  }

  const selected = fresh.routes.find(r => r.id === selectedId) ?? fresh.routes[0]
  const profile = truckProfileText(fresh.truck_profile)
  return (
    <div className="space-y-4">
      {!fresh.truck_aware && (
        <Alert tone="warning" title="Truck restrictions are not considered">
          These routes are for a car, so they may use roads a truck cannot. Weight, height, width and truck bans are not checked.
        </Alert>
      )}
      {fresh.notes.length > 0 && (
        <Alert tone="info" title={fresh.notes.length > 1 ? 'Things to know' : undefined}>
          {fresh.notes.length > 1
            ? <ul className="list-disc space-y-1 pl-4">{fresh.notes.map(n => <li key={n}>{n}</li>)}</ul>
            : <p>{fresh.notes[0]}</p>}
        </Alert>
      )}
      <RouteCards routes={fresh.routes} tags={tags} selectedId={selected.id} onSelect={onSelect} departureIso={fresh.departure_at} trafficIsLive={fresh.provider === 'tomtom'} />
      {profile && <p className="text-xs text-muted">Truck limits used: {profile}. Routes by {fresh.provider === 'tomtom' ? 'TomTom' : 'Mapbox'}.</p>}
      {!profile && <p className="text-xs text-muted">Routes by {fresh.provider === 'tomtom' ? 'TomTom' : 'Mapbox'}.</p>}

      {selected.traffic_sections.length > 0 && (
        <Card>
          <CardHeader title="Where you will slow down" description="The biggest traffic delays on the selected route." />
          <div>
            <ul className="divide-y divide-border">
              {selected.traffic_sections.slice(0, 5).map((s, i) => {
                const mid = sectionMidpoint(s.coordinates)
                return (
                  <li key={i} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text">{s.label}</p>
                      <p className="text-xs text-muted">
                        {formatKm(s.length_m / 1000)}{s.effective_speed_kmh != null ? ` at about ${s.effective_speed_kmh} km/h` : ''}
                      </p>
                    </div>
                    <span className="tabular text-sm text-warning">+{formatMinutes(Math.max(1, Math.round(s.delay_seconds / 60)))}</span>
                    {mid && <Button variant="ghost" size="sm" onClick={() => onZoomTo(mid)}>Show</Button>}
                  </li>
                )
              })}
            </ul>
          </div>
        </Card>
      )}
    </div>
  )
}
