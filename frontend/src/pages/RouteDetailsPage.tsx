import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { routesAPI, optimizationAPI } from '@/services/api'
import { Card, Badge, StatusDot, Button } from '@/components/ui'
import { format, formatDistanceToNow } from 'date-fns'
import { formatEta } from '@/utils/timeFormat'
import { ArrowLeft, ArrowRight, MapPin, Clock, Activity, ShieldAlert, Droplets, Calendar, User, Truck, Edit2, Copy, XCircle, Trash2, Loader2 } from 'lucide-react'
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import toast from 'react-hot-toast'

export default function RouteDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: route, isLoading, isError } = useQuery({
    queryKey: ['route', id],
    queryFn: () => routesAPI.get(id as string),
    enabled: !!id,
  })

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => routesAPI.updateStatus(route.id, status),
    onSuccess: () => {
      toast.success('Route status updated')
      queryClient.invalidateQueries({ queryKey: ['route', id] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to update')
  })

  const deleteMutation = useMutation({
    mutationFn: () => routesAPI.delete(route.id),
    onSuccess: () => {
      toast.success('Route deleted')
      navigate('/routes')
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to delete')
  })

  const reoptimizeMutation = useMutation({
    mutationFn: () => optimizationAPI.reoptimizeRoute(route.id),
    onSuccess: (data: any) => {
      if (data.status === 'success') {
        toast.success(data.message)
        queryClient.invalidateQueries({ queryKey: ['route', id] })
      } else {
        toast(data.message, { icon: 'ℹ️' })
      }
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to re-optimize')
  })

  const [routeGeojson, setRouteGeojson] = useState<any>(null)
  const [liveDist, setLiveDist] = useState<number | null>(null)
  const [liveDuration, setLiveDuration] = useState<number | null>(null)

  useEffect(() => {
    if (!route) return
    const fetchDirections = async () => {
      const coords: [number, number][] = []
      
      // 1. Vehicle position
      if (route.vehicles?.longitude && route.vehicles?.latitude) {
        coords.push([route.vehicles.longitude, route.vehicles.latitude])
      }

      // 2. Stops
      const sorted = route.route_stops && route.route_stops.length > 0 ? [...route.route_stops].sort((a: any, b: any) => a.sequence - b.sequence) : []
      for (const stop of sorted) {
        if (stop.delivery_points?.longitude && stop.delivery_points?.latitude) {
          coords.push([stop.delivery_points.longitude, stop.delivery_points.latitude])
        }
      }

      if (coords.length < 2) return

      const coordsStr = coords.map(c => `${c[0]},${c[1]}`).join(';')
      const token = import.meta.env.VITE_MAPBOX_TOKEN || 'YOUR_MAPBOX_TOKEN_HERE'
      
      try {
        const res = await axios.get(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordsStr}?overview=full&geometries=geojson&access_token=${token}`)
        if (res.data.routes?.length > 0) {
          setRouteGeojson(res.data.routes[0].geometry)
          setLiveDist(res.data.routes[0].distance)
          setLiveDuration(res.data.routes[0].duration)
        }
      } catch (err) {
        console.error('Failed to fetch directions', err)
      }
    }
    fetchDirections()
  }, [route])

  if (isLoading) {
    return <div className="p-10 text-center text-muted">Loading route details...</div>
  }

  if (isError || !route) {
    return <div className="p-10 text-center text-red-500">Failed to load route or route not found.</div>
  }

  const shortId = (route.id || '').slice(0, 8).toUpperCase()
  const isActive = route.status === 'active' || route.status === 'on_route' || route.status === 'in_progress'
  const isCompleted = route.status === 'completed' || route.status === 'delivered'
  
  const hasStops = route.route_stops && route.route_stops.length > 0

  const createdDate = new Date(route.created_at)
  const timeAgo = formatDistanceToNow(createdDate, { addSuffix: true })
  
  const vehicleName = route.vehicles?.plate_number || route.vehicle_id?.slice(0,12) || 'UNASSIGNED'
  const driverName = route.vehicles?.driver_id ? `Driver ${route.vehicles.driver_id.slice(0,6)}` : 'UNASSIGNED'

  // Sort stops by sequence
  const sortedStops = hasStops ? [...route.route_stops].sort((a, b) => a.sequence - b.sequence) : []
  
  const initialLon = sortedStops[0]?.delivery_points?.longitude || route.vehicles?.longitude || 77.2090
  const initialLat = sortedStops[0]?.delivery_points?.latitude || route.vehicles?.latitude || 28.6139

  // Mapbox Live Directions are managed by hooks above

  const displayDistance = liveDist ? (liveDist / 1000).toFixed(1) : (route.total_distance_km?.toFixed(1) || '0.0')
  const displayDuration = liveDuration ? liveDuration / 60 : route.total_duration_minutes
  const displayFuel = liveDist ? ((liveDist / 1000) / 4).toFixed(1) : (route.estimated_fuel_liters?.toFixed(1) || '0.0')

  return (
    <div className="max-w-[1200px] mx-auto pb-12">
      {/* Header */}
      <div className="mb-6">
        <button 
          onClick={() => navigate('/routes')}
          className="flex items-center gap-2 text-xs font-bold text-muted hover:text-slate-900 transition-colors mb-4 uppercase tracking-wider"
        >
          <ArrowLeft size={14} /> Back to Route Grid
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-[28px] font-black text-slate-900 uppercase tracking-tight leading-none mb-1">Route Details</h1>
            <p className="text-muted text-xs">Comprehensive information and real-time status.</p>
          </div>
          <Button 
            variant="accent" 
            className="gap-2 px-6 py-2.5 h-auto text-[11px] shadow-sm disabled:opacity-70" 
            onClick={() => reoptimizeMutation.mutate()}
            disabled={reoptimizeMutation.isPending || (!isActive && route?.status !== 'pending')}
          >
            {reoptimizeMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> OPTIMIZING...</>
            ) : (
              <>RUN OPTIMIZER <ArrowRight size={14} /></>
            )}
          </Button>
        </div>
      </div>

      {/* Hero Summary Card */}
      <Card className="p-6 mb-6 border border-slate-100 shadow-sm rounded-2xl">
        {/* Top metrics row */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 border-b border-slate-100 pb-6 mb-6">
          <div className="col-span-2">
             <div className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-2">Route ID</div>
             <div className="flex items-center gap-4">
               <span className="font-heading text-[28px] font-black text-slate-900 leading-none">{shortId}</span>
               <Badge variant={isActive ? 'orange' : (isCompleted ? 'green' : 'blue')} className="h-6 flex items-center px-2.5">
                 <span className="flex items-center gap-1.5 text-[9px]">
                   <StatusDot status={route.status} /> {route.status}
                 </span>
               </Badge>
             </div>
          </div>
          <div>
             <div className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-2">Distance</div>
             <div className="font-heading text-lg font-black text-slate-900">{displayDistance} KM</div>
          </div>
          <div>
             <div className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-2">ETA</div>
             <div className="font-heading text-lg font-black text-slate-900">{displayDuration ? formatEta(displayDuration) : '--'}</div>
          </div>
          <div>
             <div className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-2">Fuel Est.</div>
             <div className="font-heading text-lg font-black text-slate-900">{displayFuel} L</div>
          </div>
          <div>
             <div className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-2">Score</div>
             <div className="font-heading text-lg font-black text-slate-900">{route.optimization_score ? (route.optimization_score * 100).toFixed(0) : '--'}</div>
          </div>
        </div>

        {/* Bottom entity row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0 border border-orange-500/20">
               <Truck size={20} />
             </div>
             <div>
               <div className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-1">Vehicle</div>
               <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                 <span className="text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded-md font-bold leading-none">TRK</span>
                 {vehicleName}
               </div>
             </div>
          </div>
          <div className="flex items-center gap-4 md:border-l md:border-slate-100 md:pl-6">
             <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 border border-slate-200 flex items-center justify-center shrink-0">
               <User size={20} />
             </div>
             <div>
               <div className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-1">Driver</div>
               <div className="font-bold text-sm text-slate-900 uppercase">{driverName}</div>
             </div>
          </div>
          <div className="flex items-center gap-4 md:border-l md:border-slate-100 md:pl-6">
             <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 border border-slate-200 flex items-center justify-center shrink-0">
               <Calendar size={20} />
             </div>
             <div>
               <div className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-1">Created</div>
               <div className="font-bold text-sm text-slate-900 uppercase tracking-tight">{format(createdDate, 'MMM dd, HH:mm')}</div>
               <div className="text-[10px] font-bold text-muted mt-0.5">{timeAgo}</div>
             </div>
          </div>
        </div>
      </Card>

      {/* Status Timeline */}
      <Card className="p-6 mb-6 border border-slate-100 shadow-sm rounded-2xl hidden md:block">
        <div className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em] mb-8">Status Timeline</div>
        <div className="relative flex justify-between items-center px-12 max-w-4xl mx-auto">
          <div className="absolute top-3 left-12 right-12 h-[2px] bg-slate-100 z-0"></div>
          
          <div className="relative z-10 flex flex-col items-center gap-3">
             <div className="w-6 h-6 rounded-full bg-white border-[3px] border-yellow-400 flex items-center justify-center shadow-[0_0_0_4px_rgba(250,204,21,0.15)]">
               <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
             </div>
             <div className="text-center absolute top-8 w-32 -ml-16 left-1/2">
               <div className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Created</div>
               <div className="text-[10px] font-medium text-muted mt-1">{format(createdDate, 'MMM dd, HH:mm')}</div>
             </div>
          </div>
          
          <div className="relative z-10 flex flex-col items-center gap-3">
             <div className={`w-6 h-6 rounded-full bg-white border-[3px] flex items-center justify-center ${isActive || isCompleted ? 'border-yellow-400 shadow-[0_0_0_4px_rgba(250,204,21,0.15)]' : 'border-slate-200'}`}>
                {(isActive || isCompleted) && <div className="w-2 h-2 rounded-full bg-yellow-400"></div>}
             </div>
             <div className="text-center absolute top-8 w-32 -ml-16 left-1/2">
               <div className={`text-[10px] font-black uppercase tracking-widest ${isActive || isCompleted ? 'text-slate-900' : 'text-muted'}`}>Dispatched</div>
             </div>
          </div>
          
          <div className="relative z-10 flex flex-col items-center gap-3">
             <div className={`w-6 h-6 rounded-full bg-white border-[3px] flex items-center justify-center ${isActive || isCompleted ? 'border-yellow-400 shadow-[0_0_0_4px_rgba(250,204,21,0.15)]' : 'border-slate-200'}`}>
               {(isActive || isCompleted) && <div className="w-2 h-2 rounded-full bg-yellow-400"></div>}
             </div>
             <div className="text-center absolute top-8 w-32 -ml-16 left-1/2">
               <div className={`text-[10px] font-black uppercase tracking-widest ${isActive || isCompleted ? 'text-slate-900' : 'text-muted'}`}>In Transit</div>
             </div>
          </div>
          
          <div className="relative z-10 flex flex-col items-center gap-3">
             <div className={`w-6 h-6 rounded-full bg-white border-[3px] flex items-center justify-center ${isCompleted ? 'border-yellow-400 shadow-[0_0_0_4px_rgba(250,204,21,0.15)]' : 'border-slate-200'}`}>
               {isCompleted && <div className="w-2 h-2 rounded-full bg-yellow-400"></div>}
             </div>
             <div className="text-center absolute top-8 w-32 -ml-16 left-1/2">
               <div className={`text-[10px] font-black uppercase tracking-widest ${isCompleted ? 'text-slate-900' : 'text-muted'}`}>Completed</div>
             </div>
          </div>
        </div>
        <div className="h-8"></div> {/* Spacer */}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-4 space-y-6">
          
          <Card className="p-5 border border-slate-100 shadow-sm rounded-2xl">
            <div className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em] mb-4">Route Overview</div>
            <div className="space-y-3">
               <div className="flex justify-between items-center py-1">
                 <span className="text-xs text-muted font-medium">Route ID</span>
                 <span className="text-xs font-bold text-slate-900 uppercase tracking-tight">{shortId}</span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-xs text-muted font-medium">Status</span>
                 <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900 uppercase tracking-tight">
                   <StatusDot status={route.status} /> {route.status}
                 </span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-xs text-muted font-medium">Vehicle</span>
                 <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900 uppercase tracking-tight">
                   {vehicleName}
                 </span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-xs text-muted font-medium">Driver</span>
                 <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900 uppercase tracking-tight">
                   <User size={12} className="text-slate-400" /> {driverName}
                 </span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-xs text-muted font-medium">Distance</span>
                 <span className="text-xs font-bold text-slate-900 tracking-tight">{displayDistance} KM</span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-xs text-muted font-medium">ETA</span>
                 <span className="text-xs font-bold text-slate-900 tracking-tight">{displayDuration ? formatEta(displayDuration) : '--'}</span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-xs text-muted font-medium">Fuel Estimate</span>
                 <span className="text-xs font-bold text-slate-900 tracking-tight">{displayFuel} L</span>
               </div>
            </div>
          </Card>

          <Card className="p-5 border border-slate-100 shadow-sm rounded-2xl">
             <div className="flex items-center justify-between mb-4">
               <div className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em]">Route Stops</div>
             </div>
             {hasStops ? (
                 <div className="space-y-0.5">
                   {sortedStops.map((stop: any, idx: number) => (
                     <div key={stop.id} className="flex gap-3 items-start py-2">
                       <div className="flex flex-col items-center mt-1 gap-1">
                         <div className="w-4 h-4 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-600">{idx + 1}</div>
                         {idx !== sortedStops.length - 1 && <div className="w-px h-6 bg-slate-100"></div>}
                       </div>
                       <div className="flex-1">
                         <div className="text-xs font-bold text-slate-900">{stop.delivery_points?.address || `Point ${stop.delivery_point_id?.slice(0,6) || 'Unknown'}`}</div>
                         <div className="text-[10px] text-muted mt-0.5">Status: <span className="uppercase font-bold text-slate-500">{stop.status}</span></div>
                       </div>
                     </div>
                   ))}
                 </div>
             ) : (
                <div className="bg-orange-50/80 border border-orange-200/60 rounded-xl p-4 flex gap-3">
                  <MapPin className="text-orange-400 shrink-0 mt-0.5" size={18} />
                  <div>
                    <div className="text-xs font-bold text-orange-700/90">No stops defined.</div>
                  </div>
                </div>
             )}
          </Card>

          <Card className="p-5 border border-slate-100 shadow-sm rounded-2xl">
             <div className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em] mb-4">Route Actions</div>
             <div className="grid grid-cols-2 gap-3">
               <button 
                 onClick={() => {
                   if (route.is_manifest) {
                     navigate(`/shipments/${route.id}/manifest`)
                   } else {
                     toast('Edit standard Route feature coming soon')
                   }
                 }} 
                 className="flex items-center justify-center gap-2 py-3 border border-yellow-500/30 text-yellow-600 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-yellow-50 transition-colors shadow-sm"
               >
                 <Edit2 size={12} /> Edit
               </button>
               <button 
                 onClick={() => {
                   if (route.is_manifest) {
                     navigate('/cargo-network', { state: { duplicateManifest: route } })
                     toast('Route copied to Cargo Network for duplication')
                   } else {
                     toast('Duplicate standard Route feature coming soon')
                   }
                 }} 
                 className="flex items-center justify-center gap-2 py-3 border border-yellow-500/30 text-yellow-600 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-yellow-50 transition-colors shadow-sm"
               >
                 <Copy size={12} /> Duplicate
               </button>
               <button onClick={() => updateStatusMutation.mutate('cancelled')} disabled={updateStatusMutation.isPending || isCompleted} className="flex items-center justify-center gap-2 py-3 border border-red-500/20 text-red-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-red-50 transition-colors shadow-sm disabled:opacity-50">
                 <XCircle size={12} /> Cancel
               </button>
               <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="flex items-center justify-center gap-2 py-3 border border-red-500/20 text-red-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-red-50 transition-colors shadow-sm disabled:opacity-50">
                 <Trash2 size={12} /> Delete
               </button>
             </div>
          </Card>
        </div>

        {/* Right Column (Map) */}
        <div className="lg:col-span-8">
           <Card className="h-full min-h-[600px] flex flex-col border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
             <div className="p-5 pb-4 border-b border-slate-100 bg-white z-10 relative shadow-sm">
                <div className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em]">Route Map</div>
             </div>
             <div className="flex-1 relative bg-slate-50">
                <div className="absolute inset-4 rounded-xl overflow-hidden border border-slate-200 shadow-inner">
                  <Map
                    initialViewState={{
                      longitude: initialLon,
                      latitude: initialLat,
                      zoom: 10
                    }}
                    mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
                    attributionControl={false}
                  >
                    {(hasStops || routeGeojson) && (
                      <Source 
                        id="route-line" 
                        type="geojson" 
                        data={{
                          type: 'Feature',
                          properties: {},
                          geometry: routeGeojson || {
                            type: 'LineString',
                            coordinates: sortedStops.map(s => [s.delivery_points?.longitude, s.delivery_points?.latitude]).filter(c => c[0] && c[1]) as number[][]
                          }
                        }}
                      >
                        <Layer 
                          id="route-line-layer" 
                          type="line" 
                          paint={{
                            'line-color': '#f59e0b',
                            'line-width': 4,
                            'line-dasharray': routeGeojson ? [1] : [2, 2]
                          }} 
                        />
                      </Source>
                    )}
                    
                    {route.vehicles?.longitude && route.vehicles?.latitude && (
                      <Marker longitude={route.vehicles.longitude} latitude={route.vehicles.latitude}>
                        <div className="w-8 h-8 rounded-full bg-orange-500 border-2 border-white shadow-md flex items-center justify-center text-white">
                          <Truck size={14} />
                        </div>
                      </Marker>
                    )}

                    {hasStops && sortedStops.map((stop: any, idx: number) => {
                      if (stop.delivery_points?.longitude && stop.delivery_points?.latitude) {
                        return (
                          <Marker 
                            key={stop.id}
                            longitude={stop.delivery_points.longitude}
                            latitude={stop.delivery_points.latitude}
                          >
                            <div className="w-6 h-6 rounded-full bg-slate-900 border-2 border-white shadow-md flex items-center justify-center text-[10px] font-bold text-white">
                              {idx + 1}
                            </div>
                          </Marker>
                        )
                      }
                      return null
                    })}
                  </Map>
                  {!isActive && !isCompleted && (
                    <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-md rounded-xl p-3.5 border border-slate-200 shadow-sm flex items-center gap-2.5 text-xs font-medium text-slate-500">
                      <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 border border-slate-200">
                        <MapPin size={10} />
                      </div>
                      Route polyline will appear once active
                    </div>
                  )}
                </div>
             </div>
           </Card>
        </div>
      </div>
    </div>
  )
}
