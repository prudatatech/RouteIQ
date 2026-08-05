import { useEffect, useState, useRef } from 'react'
import { Map, Package, Activity, Search, MapPin, Navigation, Clock, CheckCircle2, Truck, Box } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useQuery } from '@tanstack/react-query'
import { shipmentsAPI } from '@/services/api'
import { formatEta } from '@/utils/timeFormat'
import { Link } from 'react-router-dom'
import maplibregl from 'maplibre-gl'

const STEPS = [
  { key: 'created', label: 'Booked' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
]

function TrackingCard({ trackingId }: { trackingId: string }) {
  const { data: shipment, isLoading } = useQuery({
    queryKey: ['trackPublicly', trackingId],
    queryFn: () => shipmentsAPI.trackPublicly(trackingId),
    enabled: !!trackingId,
    refetchInterval: (query) => {
      const d = query?.state?.data as any
      if (!d) return 5000
      return ['delivered', 'cancelled'].includes(d.status) ? false : 5000
    },
  })

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-3xl p-8 animate-fade-in">
        <div className="flex items-center gap-3 text-muted">
          <Activity size={20} className="animate-pulse" />
          <span className="text-sm font-bold uppercase tracking-widest">Locating shipment telemetry...</span>
        </div>
      </div>
    )
  }

  if (!shipment) {
    return (
      <div className="bg-surface border border-border rounded-3xl p-8 animate-fade-in">
        <div className="flex items-center gap-3 text-red-400">
          <Package size={20} />
          <span className="text-sm font-bold uppercase tracking-widest">Shipment not found: {trackingId}</span>
        </div>
      </div>
    )
  }

  const s = shipment as any
  const currentStepIdx = STEPS.findIndex(step => step.key === s.status)
  const progressPercent = currentStepIdx === -1 ? 0 : (currentStepIdx / (STEPS.length - 1)) * 100

  return (
    <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-xl animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">

        {/* LEFT: Details (3 cols) */}
        <div className="lg:col-span-3 p-6 lg:p-8 flex flex-col gap-6">

          {/* Tracking ID + Status */}
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mb-1">Tracking ID</div>
              <div className="text-3xl font-black text-text font-mono tracking-tight">{s.tracking_id}</div>
            </div>
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--color-primary-rgb),0.6)]" />
              {s.status?.replace('_', ' ')}
            </div>
          </div>

          {/* Status Stepper */}
          <div className="relative flex items-center justify-between px-2">
            {/* Background line */}
            <div className="absolute top-[14px] left-[30px] right-[30px] h-[3px] bg-border rounded-full" />
            {/* Progress line */}
            <div
              className="absolute top-[14px] left-[30px] h-[3px] bg-primary rounded-full transition-all duration-700"
              style={{ width: `calc(${progressPercent}% - 60px * ${progressPercent / 100})` }}
            />

            {STEPS.map((step, idx) => {
              const passed = idx < currentStepIdx
              const active = idx === currentStepIdx
              return (
                <div key={step.key} className="flex flex-col items-center gap-2 z-10 relative">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border-2 transition-all ${
                    passed ? 'bg-primary border-primary text-white' :
                    active ? 'bg-primary border-primary text-white shadow-[0_0_12px_rgba(var(--color-primary-rgb),0.5)]' :
                    'bg-surface border-border text-muted'
                  }`}>
                    {passed ? <CheckCircle2 size={14} /> : null}
                  </div>
                  <span className={`text-[9px] font-black uppercase tracking-widest ${
                    active || passed ? 'text-text' : 'text-muted'
                  }`}>{step.label}</span>
                </div>
              )
            })}
          </div>

          {/* Origin / Destination */}
          <div className="grid grid-cols-2 gap-6 pt-2">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-black text-primary uppercase tracking-[0.15em] mb-2">
                <MapPin size={12} /> Origin
              </div>
              <div className="text-sm font-bold text-text">{s.origin_name || 'Driver Current Location'}</div>
              <div className="text-xs text-muted mt-1">{s.origin_address || `Lat: ${s.vehicle?.lat?.toFixed(4) || '--'}, Lng: ${s.vehicle?.lng?.toFixed(4) || '--'}`}</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-[10px] font-black text-primary uppercase tracking-[0.15em] mb-2">
                <Navigation size={12} /> Destination
              </div>
              <div className="text-sm font-bold text-text">{s.destination?.name || 'Customer Site'}</div>
              <div className="text-xs text-muted mt-1">{s.destination?.address || 'N/A'}</div>
            </div>
          </div>

          {/* Cargo Specs */}
          <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border">
            <div>
              <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-1">Weight</div>
              <div className="text-lg font-black text-text">{s.total_weight_kg || 0} <span className="text-xs text-muted">KG</span></div>
            </div>
            <div>
              <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-1">Items</div>
              <div className="text-lg font-black text-text">{s.total_items || 0}</div>
            </div>
            <div>
              <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-1">Priority</div>
              <div className="text-lg font-black text-primary">{s.priority?.toUpperCase() || 'STD'}</div>
            </div>
          </div>
        </div>

        {/* RIGHT: ETA + Map + Vehicle (2 cols) */}
        <div className="lg:col-span-2 bg-surface2/50 border-l border-border flex flex-col">

          {/* ETA */}
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black text-text uppercase tracking-[0.2em]">Estimated Arrival</span>
              <Clock size={14} className="text-primary" />
            </div>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-black text-primary leading-none">
                {s.status === 'delivered' ? 'Delivered' : (s.eta_minutes ? Math.ceil(s.eta_minutes / 60) : '--')}
              </div>
              <div>
                <div className="text-xs font-black text-text uppercase tracking-widest">
                  {s.status === 'delivered' ? '' : 'Hours'}
                </div>
                <div className="text-[10px] text-muted font-bold mt-1">Live Navigation</div>
              </div>
            </div>
          </div>

          {/* Live Tracking Link */}
          <div className="flex-1 flex flex-col items-center justify-center bg-surface2/30 p-6 relative group overflow-hidden">
             <div className="absolute inset-0 bg-primary/5 group-hover:bg-primary/10 transition-colors" />
             <div className="z-10 flex flex-col items-center gap-4 text-center">
                <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/30 group-hover:scale-110 transition-transform">
                  <Map className="text-black" size={32} />
                </div>
                <div>
                   <div className="text-text font-black text-lg">Launch Live Tracker</div>
                   <div className="text-muted text-[10px] font-bold uppercase tracking-widest mt-1 max-w-[200px]">View live vehicle movement, routing, and real-time ETA</div>
                </div>
                <Link to={`/track/${trackingId}`} className="mt-2 bg-text text-bg px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-black transition-colors">
                  Open Map
                </Link>
             </div>
          </div>

          {/* Vehicle Info */}
          <div className="p-6 border-t border-border">
            <div className="text-[10px] font-black text-text uppercase tracking-[0.2em] mb-3">Carrier Details</div>
            <div className="flex items-center gap-3 bg-surface border border-border rounded-xl p-3">
              <div className="w-10 h-10 bg-surface2 border border-border rounded-lg flex items-center justify-center">
                <Truck size={18} className="text-primary" />
              </div>
              <div>
                <div className="text-sm font-black text-text">{s.vehicle?.plate_number || 'Awaiting Assignment'}</div>
                <div className="text-[10px] text-muted font-bold uppercase tracking-widest">
                  {s.vehicle?.type || 'Vehicle'} • {s.vehicle?.status?.replace('_', ' ') || 'Standby'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* Small map using maplibre-gl directly */
function SmallTrackingMap({ shipment }: { shipment: any }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const destMarkerRef = useRef<any>(null)
  const vehicle = shipment?.vehicle
  const destination = shipment?.destination

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!vehicle?.lat && !vehicle?.lng) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: '/map-style.json?v=3',
      center: [vehicle.lng || 77.5, vehicle.lat || 12.9],
      zoom: 12,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Vehicle marker
    const el = document.createElement('div')
    el.innerHTML = '🚛'
    el.style.fontSize = '28px'
    markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([vehicle.lng, vehicle.lat]).addTo(map)

    // Destination marker
    if (destination?.lng && destination?.lat) {
      const dEl = document.createElement('div')
      dEl.innerHTML = '📍'
      dEl.style.fontSize = '24px'
      destMarkerRef.current = new maplibregl.Marker({ element: dEl }).setLngLat([destination.lng, destination.lat]).addTo(map)

      // Fit bounds to include both
      const bounds = new maplibregl.LngLatBounds()
      bounds.extend([vehicle.lng, vehicle.lat])
      bounds.extend([destination.lng, destination.lat])
      map.fitBounds(bounds, { padding: 40, maxZoom: 14 })
    }

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [vehicle?.lat, vehicle?.lng])

  // Update marker position on vehicle changes
  useEffect(() => {
    if (markerRef.current && vehicle?.lat && vehicle?.lng) {
      markerRef.current.setLngLat([vehicle.lng, vehicle.lat])
    }
  }, [vehicle?.lat, vehicle?.lng])

  if (!vehicle?.lat && !vehicle?.lng) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted gap-2">
        <Activity size={24} className="opacity-40" />
        <span className="text-[10px] font-bold uppercase tracking-widest">Awaiting GPS Signal</span>
      </div>
    )
  }

  return <div ref={containerRef} className="w-full h-full" />
}

export default function VendorTrackingPage() {
  const [activeTrackings, setActiveTrackings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [searchedId, setSearchedId] = useState('')
  const userId = useAuthStore(s => s.userId)

  useEffect(() => {
    if (!userId) return
    fetchData()
  }, [userId])

  const fetchData = async () => {
    try {
      const { data } = await supabase
        .from('vendor_shipment_requests')
        .select('*, cargo_manifest(id, status)')
        .eq('vendor_id', userId)
        .order('created_at', { ascending: false })

      if (data) {
        const withTracking = data
          .filter(r => r.cargo_manifest && r.cargo_manifest.length > 0)
          .map(r => ({
            ...r,
            tracking_id: `CM-${r.cargo_manifest[0].id.substring(0, 8).toUpperCase()}`
          }))
        setActiveTrackings(withTracking)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto p-6 lg:p-12 w-full animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
            <Map className="text-primary" size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-display font-black tracking-tight text-text">Live Tracking</h1>
            <p className="text-muted text-sm font-bold uppercase tracking-widest">Monitor your active shipments</p>
          </div>
        </div>

        {/* Manual Search */}
        <form onSubmit={e => { e.preventDefault(); setSearchedId(searchInput.trim().toUpperCase()) }} className="relative w-full sm:w-auto min-w-[300px]">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Enter Tracking ID..."
            className="w-full bg-surface border border-border rounded-xl pl-10 pr-4 py-3 font-mono text-sm focus:outline-none focus:border-primary transition-colors"
          />
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        </form>
      </div>

      <div className="space-y-8">
        {/* Search result */}
        {searchedId && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-muted uppercase tracking-widest flex items-center gap-2">
                <Search size={14} /> Search Result: {searchedId}
              </h3>
              <button onClick={() => { setSearchedId(''); setSearchInput(''); }} className="text-[10px] text-muted hover:text-red-500 font-bold bg-surface2 px-3 py-1 rounded-full uppercase tracking-widest border border-border">
                Clear
              </button>
            </div>
            <TrackingCard trackingId={searchedId} />
          </div>
        )}

        {/* No active orders */}
        {!searchedId && !loading && activeTrackings.length === 0 && (
          <div className="bg-surface border border-border rounded-3xl p-12 min-h-[400px] flex flex-col items-center justify-center text-center shadow-xl">
            <div className="w-20 h-20 bg-surface2 rounded-full flex items-center justify-center mb-6">
              <Package size={32} className="text-muted opacity-50" />
            </div>
            <h3 className="text-xl font-black text-text mb-2">No Active Orders</h3>
            <p className="text-muted max-w-md font-bold text-sm">
              You do not have any active shipments currently in transit. Once a vehicle is assigned to your request, it will appear here for live tracking.
            </p>
          </div>
        )}

        {/* Active tracking cards */}
        {!searchedId && !loading && activeTrackings.map(t => (
          <TrackingCard key={t.id} trackingId={t.tracking_id} />
        ))}
      </div>
    </div>
  )
}
