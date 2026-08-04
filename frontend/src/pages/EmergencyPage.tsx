import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/services/supabase'
import { telemetryWS } from '@/services/api'
import { format } from 'date-fns'
import { AlertTriangle, MapPin, Truck, User, Phone, CheckCircle, ShieldAlert } from 'lucide-react'
import mapboxgl from 'maplibre-gl'
import toast from 'react-hot-toast'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

interface SOSAlert {
  id: string
  driver_id: string
  vehicle_id: string
  alert_type: string
  description: string
  latitude: number
  longitude: number
  status: string
  created_at: string
  driver?: { full_name: string; phone: string }
  vehicle?: { plate_number: string }
  driverStatus?: string
}

export default function EmergencyPage() {
  const [alerts, setAlerts] = useState<SOSAlert[]>([])
  const [selectedAlert, setSelectedAlert] = useState<SOSAlert | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<{ [id: string]: mapboxgl.Marker }>({})
  const [liveVehicle, setLiveVehicle] = useState<{ lat: number, lng: number } | null>(null)

  useEffect(() => {
    fetchAlerts()
    
    // Real-time subscription for new SOS alerts
    const channel = supabase
      .channel('emergency_page_listener')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts' }, async (payload) => {
        const newAlert = payload.new as SOSAlert
        const enhanced = await attachDetails(newAlert)
        setAlerts(prev => [enhanced, ...prev])
        toast.error('NEW EMERGENCY ALERT TRIGGERED!')
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_alerts' }, (payload) => {
        setAlerts(prev => prev.map(a => a.id === payload.new.id ? { ...a, ...payload.new } : a))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // Real-time vehicle location tracking for selected alert
  useEffect(() => {
    setLiveVehicle(null)
    if (!selectedAlert?.vehicle_id) return

    // Listen for live pings from Supabase Realtime
    const channel = supabase.channel(`emergency-live-gps`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vehicles', filter: `id=eq.${selectedAlert.vehicle_id}` }, (payload: any) => {
        if (payload.new?.latitude && payload.new?.longitude) {
          setLiveVehicle({
            lat: payload.new.latitude,
            lng: payload.new.longitude
          })
        }
      }).subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedAlert?.vehicle_id])

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: '/map-style.json?v=3',
      center: [78.9629, 20.5937],
      zoom: 4
    })
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right')
    mapRef.current = map

    return () => {
      Object.values(markersRef.current).forEach(m => m.remove())
      map.remove()
    }
  }, [])

  const getEmoji = (type: string) => {
    if (type === 'accident_serious') return '💥'
    if (type === 'accident_non_serious') return '⚠️'
    if (type === 'vehicle_damage') return '🛠️'
    return '🚨'
  }

  // Update Markers
  useEffect(() => {
    if (!mapRef.current) return

    // Group active alerts by vehicle_id so we only show 1 pin per vehicle
    const activeVehicles = new Map<string, SOSAlert>()
    alerts.forEach(a => {
      if (!a.vehicle_id) return
      // Prefer active alerts over resolved for the pin
      if (a.status === 'active' || !activeVehicles.has(a.vehicle_id)) {
        activeVehicles.set(a.vehicle_id, a)
      }
    })

    // Remove old markers
    Object.keys(markersRef.current).forEach(vid => {
      if (!activeVehicles.has(vid)) {
        markersRef.current[vid].remove()
        delete markersRef.current[vid]
      }
    })

    activeVehicles.forEach((alert, vid) => {
      const isSelected = selectedAlert?.vehicle_id === vid
      const lat = (isSelected && liveVehicle?.lat) ? liveVehicle.lat : alert.latitude
      const lng = (isSelected && liveVehicle?.lng) ? liveVehicle.lng : alert.longitude

      if (!lat || !lng) return
      
      const isActive = alert.status === 'active'

      if (!markersRef.current[vid]) {
        const el = document.createElement('div')
        el.className = 'marker-container'
        
        const marker = new mapboxgl.Marker(el)
          .setLngLat([lng, lat])
          .addTo(mapRef.current!)
        
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          focusAlert(alert)
        })

        markersRef.current[vid] = marker
      } else {
        markersRef.current[vid].setLngLat([lng, lat])
      }

      const el = markersRef.current[vid].getElement()
      el.innerHTML = `
        <div style="position:relative; display:flex; align-items:center; justify-content:center; cursor:pointer; transform: scale(${isSelected ? '1.5' : '1'}); z-index: ${isSelected ? 50 : 10}; transition: all 0.3s ease;">
          ${isActive ? '<div style="position:absolute; width:64px; height:64px; background:rgba(239,68,68,0.3); border-radius:50%; animation: pulse 2s infinite;"></div>' : ''}
          <div style="font-size:36px; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.4)); display: flex; align-items: center; justify-content: center; background: white; border-radius: 50%; padding: 4px; border: 3px solid ${isActive ? '#EF4444' : '#94A3B8'};">
            🚚<div style="position:absolute; top:-10px; right:-10px; font-size:24px;">${getEmoji(alert.alert_type)}</div>
          </div>
        </div>
      `
    })

  }, [alerts, selectedAlert, liveVehicle])

  async function attachDetails(alert: SOSAlert) {
    let driver = { full_name: 'Unknown', phone: 'Unknown' }
    let vehicle = { plate_number: 'Unknown' }
    let driverStatus = alert.status === 'active' ? 'Accident' : 'Idle'

    if (alert.driver_id) {
      const { data } = await supabase.from('users').select('full_name, phone').eq('id', alert.driver_id).maybeSingle()
      if (data) driver = data as any
    }
    
    if (alert.vehicle_id) {
      const { data } = await supabase.from('vehicles').select('plate_number, status').eq('id', alert.vehicle_id).maybeSingle()
      if (data) {
        vehicle = data as any
        // If driver isn't in an accident, check if their vehicle is active on a journey
        if (driverStatus !== 'Accident' && (data.status === 'active' || data.status === 'in_transit')) {
          driverStatus = 'On Journey'
        }
      }
    }
    return { ...alert, driver, vehicle, driverStatus }
  }

  const fetchAlerts = async () => {
    const { data, error } = await supabase
      .from('sos_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (!error && data) {
      const enhanced = await Promise.all(data.map(attachDetails))
      setAlerts(enhanced)
      if (enhanced.length > 0) {
        focusAlert(enhanced[0])
      }
    }
  }

  const markResolved = async (id: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch(`/api/v1/telemetry/sos/${id}/resolve`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.detail || 'Failed to resolve')
      }
      toast.success('Alert marked as resolved')
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'resolved' } : a))
    } catch (error: any) {
      toast.error('Failed to resolve: ' + error.message)
    }
  }

  const focusAlert = (alert: SOSAlert) => {
    setSelectedAlert(alert)
    if (mapRef.current && alert.latitude && alert.longitude) {
      mapRef.current.flyTo({
        center: [alert.longitude, alert.latitude],
        zoom: 15,
        duration: 1500
      })
    }
  }

  const formatType = (type: string) => {
    switch(type) {
      case 'accident_serious': return 'Accident - Serious'
      case 'accident_non_serious': return 'Accident - Minor'
      case 'vehicle_damage': return 'Vehicle Damage'
      default: return 'Emergency (SOS)'
    }
  }

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col md:flex-row gap-6 p-4">
      
      {/* Left Panel: Alerts List */}
      <div className="w-full md:w-1/3 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-red-50 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 leading-tight">Emergency Alerts</h2>
            <p className="text-xs font-bold text-red-500 uppercase tracking-wider">{alerts.filter(a => a.status === 'active').length} Active</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {alerts.map(alert => {
            const isActive = alert.status === 'active'
            const isSelected = selectedAlert?.id === alert.id
            return (
              <div 
                key={alert.id}
                onClick={() => focusAlert(alert)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  isSelected ? 'border-red-400 bg-red-50/50 shadow-md ring-4 ring-red-400/20' : 
                  isActive ? 'border-slate-200 hover:border-red-300 hover:bg-slate-50' : 
                  'border-slate-200 bg-slate-50 opacity-70'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className={`flex items-center gap-2 text-xs font-black uppercase tracking-wider ${isActive ? 'text-red-600' : 'text-slate-500'}`}>
                    {isActive ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
                    {formatType(alert.alert_type)}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400">
                    {format(new Date(alert.created_at), 'HH:mm')}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                      <User size={14} className="text-slate-400" />
                      {alert.driver?.full_name || 'Unknown Driver'}
                    </div>
                    {alert.driverStatus && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        alert.driverStatus === 'Accident' ? 'bg-red-100 text-red-600' :
                        alert.driverStatus === 'On Journey' ? 'bg-blue-100 text-blue-600' :
                        'bg-slate-200 text-slate-600'
                      }`}>
                        {alert.driverStatus}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                    <Truck size={14} className="text-slate-400" />
                    {alert.vehicle?.plate_number || 'Unknown Vehicle'}
                  </div>
                  {alert.description && (
                    <div className="mt-2 text-sm text-slate-600 italic bg-white p-2 rounded border border-slate-100">
                      "{alert.description}"
                    </div>
                  )}
                </div>

                {isActive && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); markResolved(alert.id); }}
                    className="mt-4 w-full py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    MARK RESOLVED
                  </button>
                )}
              </div>
            )
          })}
          {alerts.length === 0 && (
            <div className="text-center p-8 text-slate-400 font-semibold">
              No emergency alerts found.
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Map */}
      <div className="flex-1 bg-slate-100 rounded-2xl overflow-hidden shadow-inner relative border border-slate-200">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Floating Detail Card for Selected Alert */}
        {selectedAlert && (
          <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md p-4 rounded-xl shadow-xl border border-slate-200 max-w-sm">
            <h3 className="font-black text-slate-900 mb-1">{formatType(selectedAlert.alert_type)}</h3>
            <p className="text-xs font-bold text-slate-500 mb-4">{format(new Date(selectedAlert.created_at), 'PPpp')}</p>
            
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <User size={14} className="text-slate-400" />
                <span className="font-semibold">{selectedAlert.driver?.full_name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Phone size={14} className="text-slate-400" />
                <span className="font-semibold">{selectedAlert.driver?.phone}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Truck size={14} className="text-slate-400" />
                <span className="font-semibold">{selectedAlert.vehicle?.plate_number}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <MapPin size={14} className="text-slate-400" />
                <span className="font-semibold font-mono text-xs text-slate-500">{selectedAlert.latitude.toFixed(5)}, {selectedAlert.longitude.toFixed(5)}</span>
              </div>
            </div>

            <a 
              href={`https://www.google.com/maps/search/?api=1&query=${selectedAlert.latitude},${selectedAlert.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="block w-full text-center bg-blue-50 text-blue-600 font-bold text-xs py-2 rounded-lg hover:bg-blue-100 transition-colors"
            >
              OPEN IN GOOGLE MAPS
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
