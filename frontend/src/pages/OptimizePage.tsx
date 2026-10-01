import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, Navigation, RotateCw, Sparkles, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { optimizationAPI, vehiclesAPI, routesAPI, analyticsAPI, api } from '@/services/api'
import { getRouteDistance, getRouteDuration, getRouteFuel } from '@/utils/routeHelpers'
import { isDraftVehicle } from '@/utils/vehicles'
import { licenceWarning } from '@/components/people/docs'
import type { MapRouteStop, MapVehicle } from '@/components/map'
import { OptimizeMap } from '@/components/optimize/OptimizeMap'
import { EngineBanner, RouteSummaryLine, SavingsStats, UnassignedList } from '@/components/optimize/ResultPanels'
import {
  pendingStopPoints, plansFromReorder, plansFromResult,
  type LatLng, type OptimizerEngine, type RoutePlan, type ServerRoute, type UnassignedShipment,
} from '@/components/optimize/plan'
import { formatMinutes, formatKm, pluralize, tripNumber } from '@/utils/display'
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, StatusPill, Checkbox, Select, Stat,
  EmptyState, LoadingState, Alert, useConfirm,
} from '@/components/ui'
import { needsVehicle } from '@/components/dispatch/logic'
import type { ShipmentRow } from '@/components/shipments/types'

// Algorithms the ML service actually runs (ml-service/main.py SUPPORTED_ALGORITHMS).
const ALGORITHM_OPTIONS = [
  { value: 'ortools', label: 'Standard planner', description: 'Plans with OR-Tools, the default.' },
  { value: 'ga', label: 'Alternative planner', description: 'Plans with a genetic algorithm. Try it if the standard plan is not good enough.' },
] as const

// Names for the algorithm the backend reports it ran, including its greedy fallback.
const ALGORITHM_LABELS: Record<string, string> = {
  ortools: 'OR-Tools',
  ga: 'Genetic algorithm',
  greedy: 'Greedy (fallback)',
  'cheapest-insertion+2opt': 'Cheapest insertion + 2-opt (built in)',
}

interface Vehicle {
  id: string
  plate_number?: string | null
  status: string
  latitude?: number | null
  longitude?: number | null
  driver_licence_status?: 'valid' | 'expiring' | 'expired' | 'missing' | null
  driver_id?: string | null
}

interface DeliveryPoint {
  id: string
  name?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}

interface Shipment {
  id: string
  tracking_id?: string | null
  total_weight_kg?: number | null
  weight_kg?: number | null
  delivery_points?: DeliveryPoint[] | null
  /** A split master is never dispatched; its lots are. */
  is_master?: boolean | null
}

interface OptimizedRouteStop {
  delivery_point_id?: string | null
  sequence?: number
  status?: string | null
}

interface OptimizedRoute extends ServerRoute {
  estimated_fuel_liters?: number | null
  stops?: OptimizedRouteStop[] | null
  stop_ids?: string[] | null
  vehicles?: { plate_number?: string | null; latitude?: number | null; longitude?: number | null; status?: string | null } | null
  depot_id?: string | null
  route_stops?: { id?: string; sequence: number; status?: string | null; delivery_points?: DeliveryPoint | DeliveryPoint[] | null }[] | null
}

interface OptimizeResult {
  routes?: OptimizedRoute[]
  total_distance_km?: number
  total_fuel_liters?: number
  estimated_savings_pct?: number | null
  solve_time_seconds?: number
  algorithm?: string
  message?: string
  new_eta_minutes?: number
  /** Which engine planned the routes; the built-in solver runs when the ML service is not reachable. */
  engine?: OptimizerEngine
  engine_note?: string | null
  matrix_source?: string | null
  /** True when any distance is straight-line x a road factor rather than a routed value. */
  estimated?: boolean
  saved_km?: number | null
  saved_minutes?: number | null
  before_total_km?: number | null
  depot?: { id: string; name: string | null; latitude: number; longitude: number } | null
  unassigned?: UnassignedShipment[]
  /** Set for a re-optimized route: the stop order before and after, as delivery point ids. */
  reorder?: { oldSequence: string[]; newSequence: string[]; routeId: string }
  /** Where the weather effect came from: live conditions, a value set by hand, or none. */
  weather?: { source: 'off' | 'manual' | 'live' | 'unavailable'; severity: number; description: string | null }
}

const MANUAL_WEATHER = [
  { value: '0', label: 'None' },
  { value: '0.3', label: 'Light' },
  { value: '0.5', label: 'Moderate' },
  { value: '0.8', label: 'Severe' },
]

function weatherNote(w: NonNullable<OptimizeResult['weather']>): string | null {
  if (w.source === 'live') return `Weather: live conditions${w.description ? ` (${w.description})` : ''} were used.`
  if (w.source === 'manual') return 'Weather: the level you chose was used.'
  if (w.source === 'unavailable') return 'Weather: live conditions were not available, so weather did not change the result.'
  return null
}

interface RerouteSuggestion {
  id: string
  vehicle_id: string
  route_id: string
  new_sequence: string[] | null
  /** Minutes a better stop order saves. Null when the solver found no better order. */
  saved_mins: number | null
  insight: string
  /** Why the suggestion exists, for example "Accident on NH48, +25 min". */
  cause: string | null
  engine: OptimizerEngine | null
}

interface Insight {
  id: string
  type: string
  vehicle_id: string
  route_id: string
  new_sequence: string[] | null
  saved_mins: number | null
  insight: string
  cause?: string | null
  engine?: OptimizerEngine | null
}

// useMutation's onError is called with the generic query-error type, so these read the
// Axios error shape defensively rather than asserting a specific AxiosError generic.
type ApiError = Error & {
  response?: { data?: { detail?: string | { msg: string }[] } }
}

/**
 * Plan many trips at once. `embedded` is for the Dispatch workspace: no page title, the shipments
 * to plan can start from a chosen few (`initialShipmentIds`), and the result sends the person on to
 * Trips to send (`onReviewTrips`).
 */
export default function OptimizePage({ embedded = false, initialShipmentIds, onReviewTrips }: {
  embedded?: boolean
  initialShipmentIds?: string[]
  onReviewTrips?: () => void
} = {}) {
  const queryClient = useQueryClient()
  const location = useLocation() as { state?: { routeId?: string } }
  const navigate = useNavigate()
  const { confirm } = useConfirm()
  const routeIdToReoptimize = location.state?.routeId

  const [algorithm, setAlgorithm] = useState<'ortools' | 'ga'>('ortools')
  const [solveTime, setSolveTime] = useState(30)
  const [considerTraffic, setConsiderTraffic] = useState(true)
  const [considerWeather, setConsiderWeather] = useState(true)
  const [manualWeather, setManualWeather] = useState(false)
  const [weatherLevel, setWeatherLevel] = useState('0.5')
  // null means nothing was touched yet, so everything counts as selected.
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string> | null>(null)
  const [selectedShipmentIds, setSelectedShipmentIds] = useState<Set<string> | null>(() => (initialShipmentIds ? new Set(initialShipmentIds) : null))
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set())
  // The suggestion whose new order is drawn on the map before it is applied
  const [previewId, setPreviewId] = useState<string | null>(null)

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ['vehicles', 'optimizable'],
    queryFn: () => (vehiclesAPI.list({ limit: 500 }) as Promise<Vehicle[]>).then((list: Vehicle[]) =>
      // Same rule as the server: vehicles in service, never a placeholder (TEMP-/DRFT- plate)
      list.filter(v => ['available', 'idle', 'on_route', 'offline'].includes(v.status) && !isDraftVehicle(v)),
    ),
  })

  const { data: pendingShipments = [], isLoading: shipmentsLoading } = useQuery<Shipment[]>({
    queryKey: ['shipments', 'pending'],
    queryFn: () => api.get('/shipments/', { params: { limit: 500 } }).then(r => (r.data as (Shipment & ShipmentRow)[]).filter(
      // The shipments Dispatch lists under Needs a vehicle: new loads and lots, and failed deliveries
      // waiting for another attempt (the server plans both). A split master is never planned.
      s => needsVehicle(s),
    )),
  })

  // Every vehicle and shipment is available to pick from; default to all selected
  // so a first run behaves like before, but the operator can narrow it down.
  const effectiveVehicleIds = selectedVehicleIds ?? new Set(vehicles.map(v => v.id))
  const effectiveShipmentIds = selectedShipmentIds ?? new Set(pendingShipments.map(s => s.id))

  const toggleVehicle = (id: string) => {
    setSelectedVehicleIds(prev => {
      const base = prev ?? new Set(vehicles.map(v => v.id))
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleShipment = (id: string) => {
    setSelectedShipmentIds(prev => {
      const base = prev ?? new Set(pendingShipments.map(s => s.id))
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const deliveryPointById = useMemo(() => {
    const map = new Map<string, DeliveryPoint>()
    for (const s of pendingShipments) for (const dp of s.delivery_points ?? []) map.set(dp.id, dp)
    return map
  }, [pendingShipments])

  const vehicleById = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles])

  const [error, setError] = useState<string | null>(null)

  const { mutate: runOptimization, data: result, isPending, reset } = useMutation<OptimizeResult>({
    mutationFn: async () => {
      setError(null)
      if (routeIdToReoptimize) {
        const startedAt = performance.now()
        const reoptData = await optimizationAPI.reoptimizeRoute(routeIdToReoptimize)
        const routeData = await routesAPI.get(routeIdToReoptimize)

        const distance = reoptData.new_distance_km || getRouteDistance(routeData)
        const duration = reoptData.new_eta_minutes || getRouteDuration(routeData, distance)
        const fuel = reoptData.estimated_fuel_liters || getRouteFuel(routeData, distance)
        const savedMins = reoptData.saved_minutes || 0
        // Re-optimisation does not use the traffic/weather toggles; savings are only shown when the solver reports them.
        const savingsPct = savedMins > 0 ? (savedMins / Math.max(1, duration + savedMins)) * 100 : null

        return {
          routes: [{ ...routeData, total_duration_minutes: duration, total_distance_km: distance, estimated_fuel_liters: fuel }],
          total_distance_km: distance,
          total_fuel_liters: fuel,
          estimated_savings_pct: savingsPct,
          solve_time_seconds: (performance.now() - startedAt) / 1000,
          message: reoptData.message,
          new_eta_minutes: duration,
          engine: reoptData.engine,
          estimated: reoptData.estimated ?? undefined,
          saved_km: reoptData.saved_km,
          saved_minutes: reoptData.saved_minutes,
          reorder: Array.isArray(reoptData.new_stop_sequence)
            ? { oldSequence: reoptData.old_stop_sequence ?? [], newSequence: reoptData.new_stop_sequence, routeId: routeIdToReoptimize }
            : undefined,
        }
      }
      return optimizationAPI.optimize({
        vehicle_ids: [...effectiveVehicleIds],
        shipment_ids: [...effectiveShipmentIds],
        algorithm,
        consider_traffic: considerTraffic,
        consider_weather: considerWeather,
        // Left out, the server uses live OpenWeather conditions
        ...(considerWeather && manualWeather ? { weather_severity: Number(weatherLevel) } : {}),
        max_solve_time_seconds: solveTime,
      })
    },
    onSuccess: (data) => {
      if (routeIdToReoptimize) {
        toast.success(data.message || 'Trip re-optimized')
        queryClient.invalidateQueries({ queryKey: ['route', routeIdToReoptimize] })
      } else {
        toast.success(`Planned ${data.routes?.length ?? 0} ${data.routes?.length === 1 ? 'trip' : 'trips'} in ${(data.solve_time_seconds || 0).toFixed(1)}s. Send them from Trips to send.`)
        queryClient.invalidateQueries({ queryKey: ['routes'] })
        queryClient.invalidateQueries({ queryKey: ['shipments'] })
        queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      }
    },
    onError: (err: ApiError) => {
      const msg = err.response?.data?.detail
      setError(Array.isArray(msg) ? msg.map((e) => e.msg).join(', ') : (msg || err.message || 'Optimization failed'))
    },
  })

  const canOptimize = !!routeIdToReoptimize || (effectiveVehicleIds.size > 0 && effectiveShipmentIds.size > 0)

  // ── Suggestions panel: reroute suggestions the ML service has already found ──
  const { data: insights = [], isLoading: insightsLoading } = useQuery<Insight[]>({
    queryKey: ['ai-insights'],
    queryFn: () => analyticsAPI.insights() as Promise<Insight[]>,
    refetchInterval: 15_000,
  })
  const suggestions: RerouteSuggestion[] = insights
    .filter((i) => i.type === 'reroute_suggestion' && !dismissedSuggestions.has(i.id))
    .map((i) => ({ id: i.id, vehicle_id: i.vehicle_id, route_id: i.route_id, new_sequence: i.new_sequence, saved_mins: i.saved_mins, insight: i.insight, cause: i.cause ?? null, engine: i.engine ?? null }))

  const { data: activeVehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles', 'active-for-suggestions'],
    queryFn: () => (vehiclesAPI.list({ limit: 500 }) as Promise<Vehicle[]>).then((list: Vehicle[]) => list.filter(v => v.status === 'on_route')),
  })

  const applySuggestion = useMutation({
    mutationFn: (s: RerouteSuggestion) => routesAPI.reroute(s.route_id, s.new_sequence as string[]),
    onSuccess: (_data, s) => {
      toast.success('Reroute applied')
      setDismissedSuggestions(prev => new Set(prev).add(s.id))
      setPreviewId(null)
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] })
      queryClient.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: ApiError) => toast.error((typeof err.response?.data?.detail === 'string' ? err.response.data.detail : undefined) || 'Could not apply the reroute'),
  })

  const checkVehicle = useMutation({
    mutationFn: (vehicleId: string) => optimizationAPI.incubate(vehicleId),
    onSuccess: (data: { status: string; message: string }) => {
      if (data.status === 'suggested') toast.success(data.message)
      else toast(data.message, { icon: 'ℹ️' })
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] })
    },
    onError: (err: ApiError) => toast.error((typeof err.response?.data?.detail === 'string' ? err.response.data.detail : undefined) || 'Could not check this vehicle'),
  })

  // ── Map: the optimized routes' actual stops, not the raw shipment list ──
  const mapVehicles: MapVehicle[] = useMemo(() => {
    if (!result?.routes?.length) {
      return vehicles.flatMap(v => v.latitude != null && v.longitude != null
        ? [{ id: v.id, label: v.plate_number || 'Unnamed vehicle', status: v.status, position: { lat: v.latitude, lng: v.longitude } }]
        : [])
    }
    return result.routes.flatMap((r, i) => {
      if (r.vehicles?.latitude != null && r.vehicles?.longitude != null) {
        return [{ id: r.vehicle_id ?? `route-${i}`, label: r.vehicles.plate_number || 'Vehicle', status: r.vehicles.status ?? 'on_route', position: { lat: r.vehicles.latitude, lng: r.vehicles.longitude } }]
      }
      const v = r.vehicle_id ? vehicleById.get(r.vehicle_id) : undefined
      return v?.latitude != null && v?.longitude != null
        ? [{ id: v.id, label: v.plate_number || 'Unnamed vehicle', status: v.status, position: { lat: v.latitude, lng: v.longitude } }]
        : []
    })
  }, [result, vehicles, vehicleById])

  const mapStops: MapRouteStop[] = useMemo(() => {
    if (!result?.routes?.length) {
      return pendingShipments.flatMap(s => {
        // The final drop is the last point, as everywhere else
        const dp = s.delivery_points?.[s.delivery_points.length - 1]
        return dp?.latitude != null && dp?.longitude != null
          ? [{ id: s.id, sequence: 0, label: dp.name || dp.address || s.tracking_id || undefined, position: { lat: dp.latitude, lng: dp.longitude } }]
          : []
      })
    }
    return result.routes.flatMap(r => {
      // Re-optimize result: full route_stops with nested delivery points already loaded.
      if (r.route_stops?.length) {
        return [...r.route_stops]
          .sort((a, b) => a.sequence - b.sequence)
          .flatMap((s, i) => {
            const dp = Array.isArray(s.delivery_points) ? s.delivery_points[0] : s.delivery_points
            return dp?.latitude != null && dp?.longitude != null
              ? [{ id: s.id ?? `${i}`, sequence: i + 1, status: s.status ?? undefined, label: dp.name || dp.address || undefined, position: { lat: dp.latitude, lng: dp.longitude } }]
              : []
          })
      }
      // Freshly optimized result: stops reference delivery_point_id only.
      if (r.stops?.length) {
        return r.stops.flatMap((s, i) => {
          const dp = s.delivery_point_id ? deliveryPointById.get(s.delivery_point_id) : undefined
          return dp?.latitude != null && dp?.longitude != null
            ? [{ id: s.delivery_point_id as string, sequence: i + 1, status: s.status ?? undefined, label: dp.name || dp.address || undefined, position: { lat: dp.latitude, lng: dp.longitude } }]
            : []
        })
      }
      return []
    })
  }, [result, pendingShipments, deliveryPointById])

  // ── Route plans for the map: the optimized routes, a re-optimized route, or a suggestion being previewed ──
  const previewSuggestion = suggestions.find(x => x.id === previewId) ?? null
  const { data: previewRoute } = useQuery({
    queryKey: ['route', previewSuggestion?.route_id, 'preview'],
    queryFn: () => routesAPI.get(previewSuggestion!.route_id) as Promise<OptimizedRoute & { vehicles?: { plate_number?: string | null; latitude?: number | null; longitude?: number | null } | null }>,
    enabled: !!previewSuggestion,
  })
  const vehicleLabel = (id: string) => vehicleById.get(id)?.plate_number || 'Vehicle'
  const vehiclePosition = (v?: { latitude?: number | null; longitude?: number | null } | null): LatLng | null =>
    v?.latitude != null && v?.longitude != null ? { lat: v.latitude, lng: v.longitude } : null

  const previewPlan: RoutePlan | null = useMemo(() => {
    if (!previewSuggestion || !previewRoute || !previewSuggestion.new_sequence) return null
    const v = vehicleById.get(previewSuggestion.vehicle_id) ?? activeVehicles.find(a => a.id === previewSuggestion.vehicle_id)
    return plansFromReorder({
      key: `preview-${previewSuggestion.id}`,
      label: v?.plate_number || 'Vehicle',
      vehicleId: previewSuggestion.vehicle_id,
      origin: vehiclePosition(previewRoute.vehicles) ?? vehiclePosition(v),
      current: pendingStopPoints(previewRoute.route_stops as never),
      newSequence: previewSuggestion.new_sequence,
      savedMin: previewSuggestion.saved_mins,
    })
  }, [previewSuggestion, previewRoute, vehicleById, activeVehicles])

  const resultPlans: RoutePlan[] = useMemo(() => {
    if (!result) return []
    if (result.reorder) {
      const route = result.routes?.[0]
      const stops = pendingStopPoints(route?.route_stops as never)
      const v = route?.vehicles
      const plan = plansFromReorder({
        key: `reopt-${result.reorder.routeId}`,
        label: v?.plate_number || 'Trip',
        vehicleId: route?.vehicle_id ?? null,
        origin: vehiclePosition(v),
        // The stops as they were driven before the change, then the new order
        current: result.reorder.oldSequence.length > 0
          ? result.reorder.oldSequence.flatMap(id => stops.filter(x => x.id === id))
          : stops,
        newSequence: result.reorder.newSequence,
        savedMin: result.saved_minutes,
      })
      return plan ? [plan] : []
    }
    return plansFromResult(result.routes, result.depot ? { lat: result.depot.latitude, lng: result.depot.longitude } : null, vehicleLabel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, vehicleById])

  const mapPlans = previewPlan ? [previewPlan] : resultPlans
  const mapDepot: LatLng | null = previewPlan ? null : result?.depot ? { lat: result.depot.latitude, lng: result.depot.longitude } : null

  const summaryLine = routeIdToReoptimize
    ? `Re-optimizing trip ${tripNumber(routeIdToReoptimize)}`
    : `Evaluating ${pluralize(vehicles.length, 'vehicle')} and ${pluralize(pendingShipments.length, 'shipment')} that need a vehicle.`

  return (
    <Page>
      {embedded ? (
        <p className="text-sm text-muted">{summaryLine}</p>
      ) : (
        <PageHeader title="Optimize" description={summaryLine} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Configuration */}
        <div className="space-y-6 lg:col-span-4">
          {!routeIdToReoptimize && (
            <Card padded className="space-y-5">
              <div>
                <h2 className="mb-2 text-sm font-medium text-text">Algorithm</h2>
                <div role="radiogroup" aria-label="Algorithm" className="space-y-2">
                  {ALGORITHM_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={algorithm === opt.value}
                      onClick={() => setAlgorithm(opt.value)}
                      className={`flex w-full items-start gap-3 rounded-control border px-3 py-2.5 text-left transition-colors ${
                        algorithm === opt.value ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-subtle'
                      }`}
                    >
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${algorithm === opt.value ? 'border-brand' : 'border-border-strong'}`}>
                        {algorithm === opt.value && <span className="h-2 w-2 rounded-full bg-brand-fill" />}
                      </span>
                      <span>
                        <span className="block text-sm font-medium text-text">{opt.label}</span>
                        <span className="block text-xs text-muted">{opt.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <Select
                  label="Solve time"
                  hint="Longer searches can find shorter trips but take more time."
                  value={String(solveTime)}
                  onChange={e => setSolveTime(Number(e.target.value))}
                  options={[
                    { value: '10', label: '10 seconds' },
                    { value: '30', label: '30 seconds (default)' },
                    { value: '60', label: '60 seconds' },
                  ]}
                />
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <Checkbox label="Consider real-time traffic" checked={considerTraffic} onChange={e => setConsiderTraffic(e.target.checked)} />
                <Checkbox label="Consider weather conditions" checked={considerWeather} onChange={e => setConsiderWeather(e.target.checked)} />
                {considerWeather && (
                  <div className="space-y-2 pl-6">
                    <p className="text-xs text-muted">
                      {manualWeather ? 'Using the level you choose below.' : 'Uses live weather where the vehicles are. With no live data, weather does not change the result.'}
                    </p>
                    <Checkbox label="Set the weather level myself" checked={manualWeather} onChange={e => setManualWeather(e.target.checked)} />
                    {manualWeather && (
                      <Select label="Weather level" value={weatherLevel} onChange={e => setWeatherLevel(e.target.value)} options={MANUAL_WEATHER} />
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-text">Vehicles</h2>
                  <span className="text-xs text-muted">{effectiveVehicleIds.size} of {vehicles.length} selected</span>
                </div>
                {vehiclesLoading ? <LoadingState label="Loading vehicles…" /> : vehicles.length === 0 ? (
                  <EmptyState compact title="No vehicles available" />
                ) : (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-control border border-border p-2">
                    {vehicles.map(v => (
                      <Checkbox
                        key={v.id}
                        label={(
                          <>
                            {v.plate_number || 'Unnamed vehicle'}
                            {licenceWarning(v.driver_licence_status) && (
                              <>
                                {' · '}
                                {v.driver_id
                                  ? <Link to={`/admin/users/${encodeURIComponent(v.driver_id)}?tab=documents`} className="text-brand hover:underline">{licenceWarning(v.driver_licence_status)!.text}</Link>
                                  : licenceWarning(v.driver_licence_status)!.text}
                              </>
                            )}
                          </>
                        )}
                        checked={effectiveVehicleIds.has(v.id)}
                        onChange={() => toggleVehicle(v.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-text">Shipments</h2>
                  <span className="text-xs text-muted">{effectiveShipmentIds.size} of {pendingShipments.length} selected</span>
                </div>
                {shipmentsLoading ? <LoadingState label="Loading shipments…" /> : pendingShipments.length === 0 ? (
                  <EmptyState compact title="No pending shipments" description="Every shipment already has a vehicle." />
                ) : (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-control border border-border p-2">
                    {pendingShipments.map(s => (
                      <Checkbox
                        key={s.id}
                        label={s.tracking_id || 'Shipment'}
                        checked={effectiveShipmentIds.has(s.id)}
                        onChange={() => toggleShipment(s.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {!canOptimize && !isPending && (
            <Alert tone="warning" title="Nothing to optimize">
              {vehicles.length === 0 ? 'No vehicles are available. ' : ''}
              {pendingShipments.length === 0 ? 'There are no pending shipments.' : ''}
            </Alert>
          )}

          <Button
            variant="primary"
            fullWidth
            icon={<Navigation size={16} />}
            loading={isPending}
            disabled={!canOptimize}
            onClick={() => { reset(); runOptimization() }}
          >
            {isPending ? 'Optimizing…' : routeIdToReoptimize ? 'Re-optimize trip' : 'Run optimization'}
          </Button>
          {routeIdToReoptimize && (
            <Button variant="ghost" fullWidth onClick={() => navigate('/optimize', { replace: true })}>
              Start a new optimization instead
            </Button>
          )}

          {error && (
            <Alert tone="danger" title="Optimization failed">{error}</Alert>
          )}
        </div>

        {/* Map + result */}
        <div className="space-y-6 lg:col-span-8">
          <OptimizeMap
            plans={mapPlans}
            depot={mapDepot}
            fallbackStops={mapStops}
            fallbackVehicles={mapVehicles}
            header={previewPlan && previewSuggestion ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-brand-soft px-4 py-2 text-sm text-text">
                <span>
                  Previewing the suggested order for <span className="font-medium">{previewPlan.label}</span>
                  {previewSuggestion.saved_mins != null ? `, about ${previewSuggestion.saved_mins} min shorter` : ''}. Nothing has changed yet.
                </span>
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setPreviewId(null)}>Close preview</Button>
              </div>
            ) : undefined}
          />

          <Card>
            <CardHeader title="Result" />
            <CardBody>
              {isPending ? (
                <LoadingState label="Planning the trips…" />
              ) : !result ? (
                <EmptyState compact title="No result yet" description="Run an optimization to see trips here." />
              ) : (
                <div className="space-y-6">
                  <EngineBanner engine={result.engine} matrixSource={result.matrix_source} note={result.engine_note} />

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Stat label="Trips" value={(result.routes?.length ?? 0).toLocaleString('en-IN')} />
                    <Stat label="Total distance" value={formatKm(result.total_distance_km ?? 0)} />
                    <Stat label="ETA" value={formatMinutes(result.new_eta_minutes ?? result.routes?.[0]?.total_duration_minutes ?? 0)} />
                    <Stat label="Fuel" value={`${(result.total_fuel_liters ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`} />
                    <Stat label="Savings" value={result.estimated_savings_pct != null ? `${result.estimated_savings_pct.toFixed(1)}%` : '—'} />
                    <Stat label="Algorithm used" value={result.algorithm ? (ALGORITHM_LABELS[result.algorithm] ?? result.algorithm) : '—'} />
                  </div>

                  <SavingsStats
                    savedKm={result.saved_km}
                    savedMinutes={result.saved_minutes}
                    beforeKm={result.before_total_km}
                    estimated={result.estimated}
                  />

                  <UnassignedList items={result.unassigned} />

                  {result.weather && weatherNote(result.weather) && (
                    <p className="text-sm text-muted">{weatherNote(result.weather)}</p>
                  )}

                  {!routeIdToReoptimize && (result.routes?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-brand-soft px-4 py-3 text-sm text-text">
                      <span>{(result.routes?.length ?? 0).toLocaleString('en-IN')} {result.routes?.length === 1 ? 'trip' : 'trips'} ready. Review and send them in Trips to send.</span>
                      <Button size="sm" variant="secondary" onClick={() => (onReviewTrips ? onReviewTrips() : navigate('/dispatch?tab=to-send'))}>Go to Trips to send</Button>
                    </div>
                  )}

                  <div className="space-y-2">
                    {(result.routes ?? []).map((r, i) => {
                      const vehicle = r.vehicles?.plate_number || (r.vehicle_id ? vehicleById.get(r.vehicle_id)?.plate_number : undefined)
                      const stopCount = r.route_stops?.length ?? r.stops?.length ?? r.stop_ids?.length ?? 0
                      return (
                        <div key={r.id ?? i} className="flex items-center justify-between gap-3 rounded-control border border-border px-4 py-3">
                          <RouteSummaryLine
                            color={resultPlans.find(p => p.key === (r.id ?? `route-${i}`))?.color ?? 'transparent'}
                            label={vehicle || `Trip ${i + 1}`}
                            stops={stopCount}
                            km={r.total_distance_km}
                            minutes={r.total_duration_minutes}
                            savedKm={r.saved_km}
                            savedMinutes={r.saved_minutes}
                          />
                          <div className="flex shrink-0 items-center gap-4 text-sm text-muted">
                            {r.id && (
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/routes/${r.id}`)}>View</Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Suggestions: reroute opportunities the ML service already found from live traffic. */}
          <Card>
            <CardHeader
              title="Suggestions"
              description="Reroutes the solver has already found for vehicles on the road."
            />
            <CardBody className="space-y-4">
              {activeVehicles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {activeVehicles.map(v => (
                    <Button
                      key={v.id}
                      size="sm"
                      variant="secondary"
                      icon={checkVehicle.isPending && checkVehicle.variables === v.id ? <RotateCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      disabled={checkVehicle.isPending}
                      onClick={() => checkVehicle.mutate(v.id)}
                    >
                      Check {v.plate_number || 'Unnamed vehicle'}
                    </Button>
                  ))}
                </div>
              )}

              {insightsLoading ? (
                <LoadingState label="Checking for suggestions…" />
              ) : suggestions.length === 0 ? (
                <EmptyState compact title="No suggestions right now" description="Nothing better than the current trips was found." />
              ) : (
                <ul className="space-y-2">
                  {suggestions.map(s => {
                    const vehicle = vehicleById.get(s.vehicle_id)
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-3 rounded-control border border-border px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-text">{vehicle?.plate_number || 'Vehicle'}</div>
                          {s.cause && <div className="text-sm text-text">{s.cause}</div>}
                          <div className="text-xs text-muted">{s.insight}</div>
                          {s.engine && s.engine !== 'ml-service' && <div className="text-xs text-muted">Found by the built-in solver.</div>}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {s.saved_mins != null && <StatusPill tone="brand" dot={false}>-{s.saved_mins} min</StatusPill>}
                          {s.new_sequence && s.new_sequence.length > 0 && (
                            <Button
                              size="sm"
                              variant={previewId === s.id ? 'primary' : 'secondary'}
                              icon={<Eye size={14} />}
                              aria-pressed={previewId === s.id}
                              onClick={() => setPreviewId(previewId === s.id ? null : s.id)}
                            >
                              {previewId === s.id ? 'Previewing' : 'Preview'}
                            </Button>
                          )}
                          {s.new_sequence && s.new_sequence.length > 0 ? (
                            <Button
                              size="sm"
                              icon={<Check size={14} />}
                              loading={applySuggestion.isPending && applySuggestion.variables?.id === s.id}
                              onClick={async () => {
                              const ok = await confirm({
                                title: 'Apply this reroute?',
                                message: `${vehicle?.plate_number ?? 'The vehicle'} will follow the new stop order and its driver will see the change.${previewId === s.id ? '' : ' Preview it on the map first to see the difference.'}`,
                                confirmLabel: 'Apply reroute',
                              })
                              if (ok) applySuggestion.mutate(s)
                            }}
                            >
                              Apply
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<RotateCw size={14} />}
                              onClick={() => { reset(); navigate('/optimize', { state: { routeId: s.route_id } }) }}
                            >
                              Re-optimize trip
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </Page>
  )
}
