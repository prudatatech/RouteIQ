import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Navigation, RotateCw, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { optimizationAPI, vehiclesAPI, routesAPI, analyticsAPI, api } from '@/services/api'
import { getRouteDistance, getRouteDuration, getRouteFuel } from '@/utils/routeHelpers'
import { formatEta } from '@/utils/timeFormat'
import { MapView, type MapRouteStop, type MapVehicle } from '@/components/map'
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, StatusPill, Checkbox, Stat,
  EmptyState, LoadingState, Alert,
} from '@/components/ui'

// Algorithms the ML service actually runs (ml-service/main.py SUPPORTED_ALGORITHMS).
const ALGORITHM_OPTIONS = [
  { value: 'ortools', label: 'OR-Tools', description: 'Constraint programming solver' },
  { value: 'ga', label: 'Genetic algorithm', description: 'Evolutionary search' },
] as const

// Names for the algorithm the backend reports it ran, including its greedy fallback.
const ALGORITHM_LABELS: Record<string, string> = {
  ortools: 'OR-Tools',
  ga: 'Genetic algorithm',
  greedy: 'Greedy (fallback)',
}

interface Vehicle {
  id: string
  plate_number?: string | null
  status: string
  latitude?: number | null
  longitude?: number | null
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
}

interface OptimizedRouteStop {
  delivery_point_id?: string | null
  sequence?: number
  status?: string | null
}

interface OptimizedRoute {
  id?: string
  vehicle_id?: string | null
  total_distance_km?: number | null
  total_duration_minutes?: number | null
  estimated_fuel_liters?: number | null
  stops?: OptimizedRouteStop[] | null
  stop_ids?: string[] | null
  vehicles?: { plate_number?: string | null; latitude?: number | null; longitude?: number | null; status?: string | null } | null
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
}

interface RerouteSuggestion {
  id: string
  vehicle_id: string
  route_id: string
  new_sequence: string[]
  saved_mins: number
  insight: string
}

export default function OptimizePage() {
  const queryClient = useQueryClient()
  const location = useLocation() as { state?: { routeId?: string } }
  const navigate = useNavigate()
  const routeIdToReoptimize = location.state?.routeId

  const [algorithm, setAlgorithm] = useState<'ortools' | 'ga'>('ortools')
  const [considerTraffic, setConsiderTraffic] = useState(true)
  const [considerWeather, setConsiderWeather] = useState(true)
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string>>(new Set())
  const [selectedShipmentIds, setSelectedShipmentIds] = useState<Set<string>>(new Set())
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set())

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ['vehicles', 'optimizable'],
    queryFn: () => vehiclesAPI.list({ limit: 100 }).then((list: Vehicle[]) =>
      list.filter(v => ['available', 'idle', 'on_route', 'offline'].includes(v.status)),
    ),
  })

  const { data: pendingShipments = [], isLoading: shipmentsLoading } = useQuery<Shipment[]>({
    queryKey: ['shipments', 'pending'],
    queryFn: () => api.get('/shipments/').then(r => r.data.filter((s: Shipment & { status: string; vehicle_id?: string | null }) => s.status === 'created' && !s.vehicle_id)),
  })

  // Every vehicle and shipment is available to pick from; default to all selected
  // so a first run behaves like before, but the operator can narrow it down.
  const effectiveVehicleIds = selectedVehicleIds.size > 0 ? selectedVehicleIds : new Set(vehicles.map(v => v.id))
  const effectiveShipmentIds = selectedShipmentIds.size > 0 ? selectedShipmentIds : new Set(pendingShipments.map(s => s.id))

  const toggleVehicle = (id: string) => {
    setSelectedVehicleIds(prev => {
      const base = prev.size > 0 ? prev : new Set(vehicles.map(v => v.id))
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleShipment = (id: string) => {
    setSelectedShipmentIds(prev => {
      const base = prev.size > 0 ? prev : new Set(pendingShipments.map(s => s.id))
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
        }
      }
      return optimizationAPI.optimize({
        vehicle_ids: [...effectiveVehicleIds],
        shipment_ids: [...effectiveShipmentIds],
        algorithm,
        consider_traffic: considerTraffic,
        consider_weather: considerWeather,
        max_solve_time_seconds: 30,
      })
    },
    onSuccess: (data) => {
      if (routeIdToReoptimize) {
        toast.success(data.message || 'Route re-optimized')
        queryClient.invalidateQueries({ queryKey: ['route', routeIdToReoptimize] })
      } else {
        toast.success(`Optimized ${data.routes?.length ?? 0} route${data.routes?.length === 1 ? '' : 's'} in ${(data.solve_time_seconds || 0).toFixed(1)}s`)
        queryClient.invalidateQueries({ queryKey: ['routes'] })
        queryClient.invalidateQueries({ queryKey: ['shipments'] })
      }
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail
      setError(Array.isArray(msg) ? msg.map((e: any) => e.msg).join(', ') : (msg || err.message || 'Optimization failed'))
    },
  })

  const canOptimize = !!routeIdToReoptimize || (effectiveVehicleIds.size > 0 && effectiveShipmentIds.size > 0)

  // ── Suggestions panel: reroute suggestions the ML service has already found ──
  const { data: insights = [], isLoading: insightsLoading } = useQuery<any[]>({
    queryKey: ['ai-insights'],
    queryFn: () => analyticsAPI.insights(),
    refetchInterval: 15_000,
  })
  const suggestions: RerouteSuggestion[] = insights
    .filter((i: any) => i.type === 'reroute_suggestion' && !dismissedSuggestions.has(i.id))
    .map((i: any) => ({ id: i.id, vehicle_id: i.vehicle_id, route_id: i.route_id, new_sequence: i.new_sequence, saved_mins: i.saved_mins, insight: i.insight }))

  const { data: activeVehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles', 'active-for-suggestions'],
    queryFn: () => vehiclesAPI.list({ limit: 100 }).then((list: Vehicle[]) => list.filter(v => v.status === 'on_route')),
  })

  const applySuggestion = useMutation({
    mutationFn: (s: RerouteSuggestion) => routesAPI.reroute(s.route_id, s.new_sequence),
    onSuccess: (_data, s) => {
      toast.success('Reroute applied')
      setDismissedSuggestions(prev => new Set(prev).add(s.id))
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] })
      queryClient.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Could not apply the reroute'),
  })

  const checkVehicle = useMutation({
    mutationFn: (vehicleId: string) => optimizationAPI.incubate(vehicleId),
    onSuccess: (data: any) => {
      if (data.status === 'suggested') toast.success(data.message)
      else toast(data.message, { icon: 'ℹ️' })
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] })
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Could not check this vehicle'),
  })

  // ── Map: the optimized routes' actual stops, not the raw shipment list ──
  const mapVehicles: MapVehicle[] = useMemo(() => {
    if (!result?.routes?.length) {
      return vehicles.flatMap(v => v.latitude != null && v.longitude != null
        ? [{ id: v.id, label: v.plate_number || v.id.slice(0, 8), status: v.status, position: { lat: v.latitude, lng: v.longitude } }]
        : [])
    }
    return result.routes.flatMap((r, i) => {
      if (r.vehicles?.latitude != null && r.vehicles?.longitude != null) {
        return [{ id: r.vehicle_id ?? `route-${i}`, label: r.vehicles.plate_number || 'Vehicle', status: r.vehicles.status ?? 'on_route', position: { lat: r.vehicles.latitude, lng: r.vehicles.longitude } }]
      }
      const v = r.vehicle_id ? vehicleById.get(r.vehicle_id) : undefined
      return v?.latitude != null && v?.longitude != null
        ? [{ id: v.id, label: v.plate_number || v.id.slice(0, 8), status: v.status, position: { lat: v.latitude, lng: v.longitude } }]
        : []
    })
  }, [result, vehicles, vehicleById])

  const mapStops: MapRouteStop[] = useMemo(() => {
    if (!result?.routes?.length) {
      return pendingShipments.flatMap(s => {
        const dp = s.delivery_points?.[0]
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

  return (
    <Page>
      <PageHeader
        title="Route optimization"
        description={routeIdToReoptimize
          ? `Re-optimizing route ${routeIdToReoptimize.slice(0, 8).toUpperCase()}`
          : `Evaluating ${vehicles.length.toLocaleString('en-IN')} vehicles and ${pendingShipments.length.toLocaleString('en-IN')} pending shipments.`}
      />

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

              <div className="space-y-2 border-t border-border pt-4">
                <Checkbox label="Consider real-time traffic" checked={considerTraffic} onChange={e => setConsiderTraffic(e.target.checked)} />
                <Checkbox label="Consider weather conditions" checked={considerWeather} onChange={e => setConsiderWeather(e.target.checked)} />
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
                        label={v.plate_number || v.id.slice(0, 8)}
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
                        label={s.tracking_id || s.id.slice(0, 8)}
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
            {isPending ? 'Optimizing…' : routeIdToReoptimize ? 'Re-optimize route' : 'Run optimization'}
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
          <Card className="overflow-hidden">
            <div className="h-80">
              <MapView mode="route" vehicles={mapVehicles} route={{ coordinates: [], stops: mapStops }} ariaLabel="Optimization map" />
            </div>
          </Card>

          <Card>
            <CardHeader title="Result" />
            <CardBody>
              {isPending ? (
                <LoadingState label="Running the solver…" />
              ) : !result ? (
                <EmptyState compact title="No result yet" description="Run an optimization to see routes here." />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Stat label="Routes" value={(result.routes?.length ?? 0).toLocaleString('en-IN')} />
                    <Stat label="Total distance" value={`${(result.total_distance_km ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`} />
                    <Stat label="ETA" value={formatEta(result.new_eta_minutes ?? result.routes?.[0]?.total_duration_minutes ?? 0)} />
                    <Stat label="Fuel" value={`${(result.total_fuel_liters ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`} />
                    <Stat label="Savings" value={result.estimated_savings_pct != null ? `${result.estimated_savings_pct.toFixed(1)}%` : '—'} />
                    <Stat label="Algorithm used" value={result.algorithm ? (ALGORITHM_LABELS[result.algorithm] ?? result.algorithm) : '—'} />
                  </div>

                  <div className="space-y-2">
                    {(result.routes ?? []).map((r, i) => {
                      const vehicle = r.vehicles?.plate_number || (r.vehicle_id ? vehicleById.get(r.vehicle_id)?.plate_number : undefined)
                      const stopCount = r.route_stops?.length ?? r.stops?.length ?? r.stop_ids?.length ?? 0
                      return (
                        <div key={r.id ?? i} className="flex items-center justify-between gap-3 rounded-control border border-border px-4 py-3">
                          <div>
                            <div className="text-sm font-medium text-text">{vehicle || (r.vehicle_id ? r.vehicle_id.slice(0, 8) : `Route ${i + 1}`)}</div>
                            <div className="text-xs text-muted">{stopCount.toLocaleString('en-IN')} stop{stopCount === 1 ? '' : 's'}</div>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted">
                            <span>{(r.total_distance_km ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km</span>
                            <span>{formatEta(r.total_duration_minutes ?? 0)}</span>
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
                      Check {v.plate_number || v.id.slice(0, 8)}
                    </Button>
                  ))}
                </div>
              )}

              {insightsLoading ? (
                <LoadingState label="Checking for suggestions…" />
              ) : suggestions.length === 0 ? (
                <EmptyState compact title="No suggestions right now" description="Nothing better than the current routes was found." />
              ) : (
                <ul className="space-y-2">
                  {suggestions.map(s => {
                    const vehicle = vehicleById.get(s.vehicle_id)
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-3 rounded-control border border-border px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-text">{vehicle?.plate_number || s.vehicle_id.slice(0, 8)}</div>
                          <div className="text-xs text-muted">{s.insight}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <StatusPill tone="brand" dot={false}>-{s.saved_mins} min</StatusPill>
                          <Button
                            size="sm"
                            icon={<Check size={14} />}
                            loading={applySuggestion.isPending && applySuggestion.variables?.id === s.id}
                            onClick={() => applySuggestion.mutate(s)}
                          >
                            Apply
                          </Button>
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
