import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Search, Navigation, X } from 'lucide-react'
import axios from 'axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { 
  INDIA_POSITIONS, 
  STATUS_COLORS, 
  VEHICLE_EMOJI, 
  CARGO_EMOJI,
  MAP_DEFAULTS 
} from '@/config/mapConfig'
import { telemetryWS, routesAPI, marketplaceAPI } from '@/services/api'
import { supabase } from '@/services/supabase'
import { animateMarkerAlongRoute } from '@/utils/mapAnimation'
import { formatEta } from '@/utils/timeFormat'

function createGeoJSONCircle(center: [number, number], radiusInKm: number, points = 64) {
    const coords = { latitude: center[1], longitude: center[0] };
    const distanceX = radiusInKm / (111.320 * Math.cos(coords.latitude * Math.PI / 180));
    const distanceY = radiusInKm / 110.574;
    const ret: [number, number][] = [];
    for (let i = 0; i < points; i++) {
        const theta = (i / points) * (2 * Math.PI);
        const x = distanceX * Math.cos(theta);
        const y = distanceY * Math.sin(theta);
        ret.push([coords.longitude + x, coords.latitude + y]);
    }
    ret.push(ret[0]);
    return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [ret] }, properties: {} };
}

interface Vehicle {
  id: string
  plate_number: string
  latitude?: number | null
  longitude?: number | null
  status: string
  vehicle_type?: string
  cargo_types?: string[]
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export default function LiveMap({ vehicles, selectedVehicleId, zoomFocusEvent, onVehicleSelect, customPendingStops }: { vehicles: Vehicle[], selectedVehicleId?: string | null, zoomFocusEvent?: number, onVehicleSelect?: (id: string) => void, customPendingStops?: any[] }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInst = useRef<mapboxgl.Map | null>(null)
  const intervalRef = useRef<any>(null)
  const queryClient = useQueryClient()

  const selectedVehicleIdRef = useRef(selectedVehicleId)
  useEffect(() => { selectedVehicleIdRef.current = selectedVehicleId }, [selectedVehicleId])

  const { data: activeRoutes } = useQuery({
    queryKey: ['routes', selectedVehicleId],
    queryFn: () => routesAPI.list({ vehicle_id: selectedVehicleId }),
    enabled: !!selectedVehicleId,
    refetchInterval: 10000,
    select: (routes: any[]) => routes.filter(r => r.status === 'active' || r.status === 'pending')
  })
  const activeRoutesRef = useRef<any[] | undefined>()
  useEffect(() => { activeRoutesRef.current = activeRoutes }, [activeRoutes])

  const customPendingStopsRef = useRef<any[] | undefined>()
  useEffect(() => { customPendingStopsRef.current = customPendingStops }, [customPendingStops])

  const { data: openLoads } = useQuery({
    queryKey: ['marketplace_loads'],
    queryFn: () => marketplaceAPI.openLoads(),
    refetchInterval: 15000,
  })

  // Only zoom when explicitly requested via zoomFocusEvent
  const lastZoomEvent = useRef<number | undefined>();
  useEffect(() => {
    if (!selectedVehicleId || !mapInst.current || !zoomFocusEvent) return
    if (lastZoomEvent.current === zoomFocusEvent) return;
    lastZoomEvent.current = zoomFocusEvent;
    
    // Prioritize LIVE position from Websocket
    const liveTarget = targetPositions.current[selectedVehicleId]
    if (liveTarget && liveTarget.lat && liveTarget.lng) {
      mapInst.current.flyTo({ center: [liveTarget.lng, liveTarget.lat], zoom: 16, duration: 2000 })
      return
    }

    // Fallback to DB position
    const v = vehicles.find(v => v.id === selectedVehicleId)
    if (v && v.latitude && v.longitude) {
      mapInst.current.flyTo({ center: [v.longitude, v.latitude], zoom: 16, duration: 2000 })
    }
  }, [zoomFocusEvent, selectedVehicleId, vehicles])

// VehicleStatusSheet component
function VehicleStatusSheet({ vehicle, targetPositionsRef }: { vehicle: Vehicle, targetPositionsRef: React.MutableRefObject<any> }) {
  const [telemetry, setTelemetry] = useState({ speed: 0, fuel: 0 })
  useEffect(() => {
    const interval = setInterval(() => {
      const t = targetPositionsRef.current[vehicle.id]
      if (t) {
        setTelemetry({ speed: t.speed || 0, fuel: t.fuel || 0 })
      }
    }, 1000)
    // Initial fetch
    const t = targetPositionsRef.current[vehicle.id]
    if (t) {
      setTelemetry({ speed: t.speed || 0, fuel: t.fuel || 0 })
    }
    return () => clearInterval(interval)
  }, [vehicle.id, targetPositionsRef])

  return (
    <div className="bg-surface/90 backdrop-blur-md text-text p-6 rounded-3xl border border-border shadow-2xl font-sans w-[350px]">
      <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
        <span className="text-sm font-black uppercase text-yellow-500 tracking-tighter">{vehicle.plate_number}</span>
        <span className="text-[10px] uppercase font-bold text-muted bg-surface2 px-2 py-1 rounded-lg">{vehicle.vehicle_type ?? 'Truck'}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[10px]">
        <div className="flex flex-col"><span className="text-muted font-bold">Geofence</span><span className="font-black">--</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">GPS Status</span><span className="font-black text-green-500">Online</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Network</span><span className="font-black">4G LTE</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Immobilizer</span><span className="font-black">Disarmed</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Parking</span><span className="font-black">--</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Fuel</span><span className="font-black text-yellow-500">{telemetry.fuel.toFixed(1)}%</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Door</span><span className="font-black">Closed</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Battery</span><span className="font-black">12.4V</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Trip Dist</span><span className="font-black">142 km</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Trip Time</span><span className="font-black">2h 15m</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Last Speed</span><span className="font-black text-white">{telemetry.speed.toFixed(0)} km/h</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Max Speed</span><span className="font-black">80 km/h</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Daily Dist</span><span className="font-black">210 km</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Idle Time</span><span className="font-black">10m</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Stops</span><span className="font-black">3</span></div>
        <div className="flex flex-col"><span className="text-muted font-bold">Odometer</span><span className="font-black">45,120 km</span></div>
      </div>
    </div>
  )
}
  
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  // Use refs for animation state to avoid re-renders
  const targetPositions = useRef<Record<string, { lat: number, lng: number, speed: number, fuel?: number }>>({})
  const currentPositions = useRef<Record<string, { lat: number, lng: number }>>({})

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!searchQuery || !mapInst.current) return

    setIsSearching(true)
    try {
      const resp = await axios.get(
        `${import.meta.env.VITE_MAPBOX_GEOCODING_URL}/${encodeURIComponent(searchQuery)}.json`,
        {
          params: {
            access_token: MAPBOX_TOKEN,
            country: 'IN',
            limit: 1,
            types: 'place,locality,address'
          }
        }
      )

      if (resp.data?.features?.length > 0) {
        const [lng, lat] = resp.data.features[0].center
        mapInst.current.flyTo({ center: [lng, lat], zoom: 12, duration: 2500 })
      }
    } catch (err) {
      console.error('Search failed', err)
    } finally {
      setIsSearching(false)
    }
  }

  const vehiclesRef = useRef(vehicles)
  useEffect(() => {
    vehiclesRef.current = vehicles
  }, [vehicles])

  // ── Direct Supabase GPS Polling (Guaranteed Fallback) ──
  // Polls Supabase every 5s for fresh coordinates
  // This guarantees the map always shows the latest GPS position
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('vehicles')
          .select('id, latitude, longitude, status, last_heartbeat')
        
        if (data) {
          for (const v of data) {
            if (v.latitude && v.longitude) {
              targetPositions.current[v.id] = {
                lat: v.latitude,
                lng: v.longitude,
                speed: v.status === 'on_route' ? 30 : 0,
                fuel: targetPositions.current[v.id]?.fuel
              }
              if (!currentPositions.current[v.id]) {
                currentPositions.current[v.id] = { lat: v.latitude, lng: v.longitude }
              }
            }
          }
        }
      } catch (e) {
        // Silent fail — other paths will keep working
      }
    }, 5000)

    return () => clearInterval(pollInterval)
  }, [])

  useEffect(() => {
    let ws: any = null
    let realtimeChannel: any = null
    let waypointChannel: any = null

    if (!mapRef.current || mapInst.current) return

    const map = new mapboxgl.Map({
      container: mapRef.current!,
      style: '/map-style.json?v=3',
      center: MAP_DEFAULTS.CENTER,
      zoom: MAP_DEFAULTS.ZOOM,
      minZoom: MAP_DEFAULTS.MIN_ZOOM,
      maxZoom: MAP_DEFAULTS.MAX_ZOOM,
      attributionControl: false,
    })

    map.on('load', () => {
      // Add GeoJSON source for trucks
      map.addSource('trucks', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        },
        cluster: true,
        clusterMaxZoom: 10,
        clusterRadius: 50
      })

      // Heatmap layer
      map.addLayer({ id: 'truck-heat', type: 'heatmap', source: 'trucks', maxzoom: 9, paint: { 'heatmap-weight': 1, 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3], 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(234,179,8,0)', 0.2, 'rgba(234,179,8,0.2)', 0.4, 'rgba(234,179,8,0.4)', 0.6, 'rgba(234,179,8,0.7)', 0.8, 'rgba(234,179,8,0.9)', 1, '#EAB308'], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 9, 20], 'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 1, 9, 0] } })
      
      // Active Route (Line)
      map.addSource('active-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'active-route-line', type: 'line', source: 'active-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#3B82F6', 'line-width': 4 }
      })

      // Geofence (Polygon)
      map.addSource('geofence', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'geofence-fill', type: 'fill', source: 'geofence',
        paint: { 'fill-color': '#10B981', 'fill-opacity': 0.15 }
      })
      map.addLayer({
        id: 'geofence-line', type: 'line', source: 'geofence',
        paint: { 'line-color': '#10B981', 'line-width': 2 }
      })

      // Destination (Icon)
      map.addSource('destination', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'destination-point', type: 'symbol', source: 'destination',
        layout: { 'text-field': '🏠', 'text-size': 20, 'text-allow-overlap': true }
      })

      // Marketplace Loads (Open Jobs)
      map.addSource('marketplace-loads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'marketplace-loads-circle', type: 'circle', source: 'marketplace-loads',
        paint: { 'circle-color': '#A855F7', 'circle-radius': 10, 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' }
      })
      map.addLayer({
        id: 'marketplace-loads-label', type: 'symbol', source: 'marketplace-loads',
        layout: { 'text-field': '🔥', 'text-size': 12, 'text-allow-overlap': true }
      })
      
      // Cluster Circle layer
      map.addLayer({ id: 'clusters', type: 'circle', source: 'trucks', filter: ['has', 'point_count'], paint: { 'circle-color': '#0F172A', 'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 50, 40], 'circle-stroke-width': 2, 'circle-stroke-color': '#EAB308' } })
      
      // Cluster Count layer
      map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'trucks', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count'], 'text-size': 12, 'text-font': ['Open Sans Regular'] }, paint: { 'text-color': '#ffffff' } })
      
      // Map Interactions
      map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = '' })
      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = '' })

      map.on('click', 'clusters', async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        const clusterId = features[0].properties?.cluster_id
        try {
          const zoom = await (map.getSource('trucks') as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId)
          map.easeTo({ center: (features[0].geometry as any).coordinates, zoom })
        } catch (err) {
          console.error('Failed to get cluster expansion zoom', err)
        }
      })

      map.on('click', 'unclustered-point', (e) => {
        const props = e.features?.[0]?.properties
        if (!props) return
        
        const coords = (e.features?.[0]?.geometry as any).coordinates
        const v_id = props.id

        if (onVehicleSelect) {
          onVehicleSelect(v_id)
        }

        const target = targetPositions.current[v_id]
        
        new mapboxgl.Popup({ closeButton: false, anchor: 'bottom', maxWidth: '300px', className: 'truck-popup' })
          .setLngLat(coords)
          .setHTML(`
            <div class="bg-surface text-text p-4 rounded-2xl border border-border shadow-2xl font-sans min-w-[200px]">
              <div class="flex items-center justify-between mb-3 border-b border-border pb-2">
                <span class="text-xs font-black uppercase text-yellow-500 tracking-tighter">${props.plate}</span>
                <span class="text-[10px] uppercase font-bold text-muted">${props.emoji}</span>
              </div>
              <div class="space-y-2">
                <div class="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted">
                  <span>LIVE SPEED</span>
                  <span class="text-text">${target?.speed?.toFixed(0) || 0} KM/H</span>
                </div>
                <div class="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted">
                  <span>FUEL PROBE</span>
                  <span class="text-text">${target?.fuel?.toFixed(1) || '--'}%</span>
                </div>
              </div>
              <div class="mt-4 pt-2 flex gap-2">
                 <div class="px-3 py-1 bg-surface2 rounded-lg text-[8px] font-black uppercase text-muted tracking-tighter">TELEMETRY: SYNCED</div>
                 <div class="px-3 py-1 bg-yellow-500/10 rounded-lg text-[8px] font-black uppercase text-yellow-500 tracking-tighter">OP STATUS: ${props.status}</div>
              </div>
            </div>
          `)
          .addTo(map)
      })

      // Helper to generate Mapbox Image from Emoji dynamically
      const addEmojiIcon = (name: string, emoji: string) => {
        if (map.hasImage(name)) return;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = '48px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emoji, 32, 36); // Slight offset for vertical centering
          map.addImage(name, ctx.getImageData(0, 0, 64, 64));
        }
      };

      // Individual Truck Icons (Emoji rendered as Image to preserve colors)
      map.addLayer({ 
        id: 'unclustered-point', 
        type: 'symbol', 
        source: 'trucks', 
        filter: ['!', ['has', 'point_count']], 
        layout: { 
          'icon-image': ['get', 'icon_name'], 
          'icon-size': 0.7, 
          'icon-allow-overlap': true,
        } 
      })

      
      // Track which vehicles need rendering
      const dirtyFlags: Record<string, boolean> = {}
      const animCancelers: Record<string, () => void> = {}

      // ── Supabase Realtime (PRIMARY path — direct from driver app GPS) ──
      // This is the Ola/Uber-style pipeline: Driver GPS → Supabase cloud → Dashboard
      realtimeChannel = supabase
        .channel('vehicle-gps-live')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'vehicles' },
          (payload: any) => {
            const { id, latitude, longitude, status } = payload.new
            if (latitude && longitude) {
              console.log(`🛰️ LIVE GPS: Vehicle ${id} → ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
              
              const current = currentPositions.current[id]
              if (!current) {
                currentPositions.current[id] = { lat: latitude, lng: longitude }
                dirtyFlags[id] = true
              } else {
                // Cancel existing animation for this vehicle
                if (animCancelers[id]) animCancelers[id]()
                
                const route = id === selectedVehicleIdRef.current ? (fetchedRouteGeometryRef.current as [number, number][] | undefined) : undefined;
                
                animCancelers[id] = animateMarkerAlongRoute({
                  startCoord: [current.lng, current.lat],
                  endCoord: [longitude, latitude],
                  routeCoords: route,
                  duration: 2000,
                  onTick: (coord) => {
                    currentPositions.current[id] = { lng: coord[0], lat: coord[1] }
                    dirtyFlags[id] = true
                  }
                })
              }

              targetPositions.current[id] = {
                lat: latitude,
                lng: longitude,
                speed: status === 'on_route' ? 30 : 0,
                fuel: targetPositions.current[id]?.fuel
              }
            }
          }
        )
        .subscribe()

      // Listen for dynamic waypoint additions (mid-route fills)
      waypointChannel = supabase
        .channel('map-waypoints')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'route_stops' },
          (payload: any) => {
             console.log('📍 New Waypoint Injected Live:', payload.new)
             queryClient.invalidateQueries({ queryKey: ['routes'] })
          }
        )
        .subscribe()

      let lastVehiclesRef: any[] = []; // Initialize to empty array to FORCE update on first frame!

      // Smooth Animation Loop (Master Render)
      const animate = () => {
        const source = map.getSource('trucks') as mapboxgl.GeoJSONSource
        if (!source) {
          intervalRef.current = requestAnimationFrame(animate)
          return
        }

        let needsUpdate = false;

        if (lastVehiclesRef !== vehiclesRef.current) {
          needsUpdate = true;
          lastVehiclesRef = vehiclesRef.current;
        }

        const features = vehiclesRef.current.map((v, i) => {
          const primaryCargo = v.cargo_types?.[0] || 'general'
          const cargoEmoji = CARGO_EMOJI[primaryCargo] || ''
          const vehicleEmoji = VEHICLE_EMOJI[v.vehicle_type || 'truck'] || '🚛'
          const combinedEmoji = `${vehicleEmoji}${cargoEmoji}`
          const iconName = `emoji-${combinedEmoji}`
          
          if (!map.hasImage(iconName)) {
            addEmojiIcon(iconName, combinedEmoji)
          }
          
          if (!currentPositions.current[v.id]) {
             const fallbackLat = INDIA_POSITIONS[i % INDIA_POSITIONS.length].lat
             const fallbackLng = INDIA_POSITIONS[i % INDIA_POSITIONS.length].lng
             currentPositions.current[v.id] = { lat: v.latitude ?? fallbackLat, lng: v.longitude ?? fallbackLng }
             dirtyFlags[v.id] = true
          }
          
          if (dirtyFlags[v.id]) {
             needsUpdate = true;
             dirtyFlags[v.id] = false; // Reset flag after picking it up
          }

          const current = currentPositions.current[v.id]

          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [current.lng, current.lat] },
            properties: { 
              id: v.id, status: v.status, plate: v.plate_number,
              emoji: combinedEmoji,
              icon_name: iconName,
              color: STATUS_COLORS[v.status] || '#94a3b8'
            }
          }
        })

        if (needsUpdate) {
          source.setData({ type: 'FeatureCollection', features })
        }
        
        const routeSource = map.getSource('active-route') as mapboxgl.GeoJSONSource
        const geofenceSource = map.getSource('geofence') as mapboxgl.GeoJSONSource
        const destSource = map.getSource('destination') as mapboxgl.GeoJSONSource
        
        if (routeSource && geofenceSource && destSource) {
           const routes = activeRoutesRef.current
           const customStops = customPendingStopsRef.current
           const selectedId = selectedVehicleIdRef.current
           const vPos = selectedId ? currentPositions.current[selectedId] : null
           
           if (selectedId && vPos) {
              let pendingStops: any[] = []
              if (customStops && customStops.length > 0) {
                pendingStops = customStops
              } else if (routes && routes.length > 0) {
                pendingStops = (routes[0].route_stops || []).filter((s: any) => s.status === 'pending').sort((a: any, b: any) => a.sequence - b.sequence)
              }
              
              if (pendingStops.length > 0) {
                 const coords = [[vPos.lng, vPos.lat]]
                 const destFeatures: any[] = []
                 const geofenceFeatures: any[] = []
                 
                 for (let i = 0; i < pendingStops.length; i++) {
                   const dp = pendingStops[i].delivery_points
                   const destLat = Array.isArray(dp) ? dp[0]?.latitude : dp?.latitude
                   const destLng = Array.isArray(dp) ? dp[0]?.longitude : dp?.longitude
                   
                   if (destLat && destLng) {
                     coords.push([destLng, destLat])
                     destFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [destLng, destLat] }, properties: { stopIdx: i + 1 } })
                     if (i === 0) {
                       geofenceFeatures.push(createGeoJSONCircle([destLng, destLat], 0.05))
                     }
                   }
                 }
                 
                 if (coords.length > 1) {
                   // If Mapbox fetched geometry is available, use it! Otherwise fallback to straight lines
                   const mbRoute = fetchedRouteGeometryRef.current;
                   let lineCoords = coords;
                   if (mbRoute && mbRoute.length > 0) {
                     // Connect current live position to the start of the fetched Mapbox road path
                     lineCoords = [[vPos.lng, vPos.lat], ...mbRoute];
                   }
                   
                   routeSource.setData({
                      type: 'FeatureCollection',
                      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: lineCoords }, properties: {} }]
                   })
                   geofenceSource.setData({
                      type: 'FeatureCollection',
                      features: geofenceFeatures
                   })
                   destSource.setData({
                      type: 'FeatureCollection',
                      features: destFeatures
                   })
                 }
              } else {
                 routeSource.setData({ type: 'FeatureCollection', features: [] })
                 geofenceSource.setData({ type: 'FeatureCollection', features: [] })
                 destSource.setData({ type: 'FeatureCollection', features: [] })
              }
           } else {
              routeSource.setData({ type: 'FeatureCollection', features: [] })
              geofenceSource.setData({ type: 'FeatureCollection', features: [] })
              destSource.setData({ type: 'FeatureCollection', features: [] })
           }
        }

        intervalRef.current = requestAnimationFrame(animate)
      }

      animate()
    })

    mapInst.current = map

    return () => {
      cancelAnimationFrame(intervalRef.current!)
      if (ws) ws.close()
      if (realtimeChannel) supabase.removeChannel(realtimeChannel)
      if (waypointChannel) supabase.removeChannel(waypointChannel)
      mapInst.current?.remove()
      mapInst.current = null
    }
  }, []) // Empty dependency array ensures we only initialize the Map once!

  useEffect(() => {
    if (!mapInst.current || !openLoads?.loads) return
    const map = mapInst.current
    const source = map.getSource('marketplace-loads') as mapboxgl.GeoJSONSource
    if (source) {
      const features = openLoads.loads.filter((l: any) => l.origin_lat && l.origin_lng).map((l: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [l.origin_lng, l.origin_lat] },
        properties: { id: l.id, name: l.origin_name, weight: l.weight_kg }
      }))
      source.setData({ type: 'FeatureCollection', features })
    }
  }, [openLoads])

  const fetchedRouteGeometryRef = useRef<number[][] | null>(null);
  const [liveETA, setLiveETA] = useState<number | null>(null);
  const [liveDistance, setLiveDistance] = useState<number | null>(null);

  useEffect(() => {
    const fetchRouteGeometry = async () => {
      if (!selectedVehicleId) {
        fetchedRouteGeometryRef.current = null;
        setLiveETA(null);
        setLiveDistance(null);
        return;
      }

      let pendingStops: any[] = [];
      if (customPendingStops && customPendingStops.length > 0) {
        pendingStops = customPendingStops;
      } else if (activeRoutes && activeRoutes.length > 0) {
        pendingStops = (activeRoutes[0].route_stops || []).filter((s: any) => s.status === 'pending').sort((a: any, b: any) => a.sequence - b.sequence);
      }
      
      if (pendingStops.length === 0) {
        fetchedRouteGeometryRef.current = null;
        setLiveETA(null);
        setLiveDistance(null);
        return;
      }

      const vPos = currentPositions.current[selectedVehicleId];
      const coords: [number, number][] = [];
      
      // Fallback to vehicle db position if no live pos yet
      if (vPos) {
        coords.push([vPos.lng, vPos.lat]);
      } else {
        const v = vehicles.find(v => v.id === selectedVehicleId);
        if (v && v.longitude && v.latitude) coords.push([v.longitude, v.latitude]);
      }

      for (const stop of pendingStops) {
        const dp = stop.delivery_points;
        const lat = Array.isArray(dp) ? dp[0]?.latitude : dp?.latitude;
        const lng = Array.isArray(dp) ? dp[0]?.longitude : dp?.longitude;
        if (lat && lng) coords.push([Number(lng), Number(lat)]);
      }

      if (coords.length < 2) {
        fetchedRouteGeometryRef.current = null;
        setLiveETA(null);
        setLiveDistance(null);
        return;
      }
      
      const limitedCoords = coords.slice(0, 25);
      const coordsString = limitedCoords.map(c => `${c[0]},${c[1]}`).join(';');
      
      try {
        const res = await axios.get(
          `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`
        );
        if (res.data.routes && res.data.routes.length > 0) {
          const routeData = res.data.routes[0];
          fetchedRouteGeometryRef.current = routeData.geometry.coordinates;
          setLiveETA(routeData.duration);
          setLiveDistance(routeData.distance);
        }
      } catch (e) {
        console.error('Failed to fetch route geometry:', e);
        fetchedRouteGeometryRef.current = null;
        setLiveETA(null);
        setLiveDistance(null);
      }
    };

    fetchRouteGeometry();
  }, [activeRoutes, selectedVehicleId, vehicles]);

  return (
    <div className="relative w-full h-full bg-surface2 rounded-[28px] overflow-hidden border border-border shadow-2xl">
      {/* Pan-India Search Bar */}
      {MAPBOX_TOKEN && MAPBOX_TOKEN !== 'your_mapbox_token_here' && (
        <form 
          onSubmit={handleSearch}
          className="absolute top-6 left-6 z-20 w-64 md:w-80 group"
        >
          <div className="relative">
            <input 
              type="text"
              placeholder="Search Pan-India Locations..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full h-12 bg-surface/90 backdrop-blur-md border border-border rounded-2xl px-12 text-xs font-bold text-text placeholder:text-muted focus:outline-none focus:border-yellow-500/50 transition-all shadow-2xl"
            />
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-yellow-500 transition-colors">
              {isSearching ? <Navigation size={14} className="animate-pulse" /> : <Search size={14} />}
            </div>
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-text"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </form>
      )}

      {/* Active Route Info Overlay */}
      {selectedVehicleId && activeRoutes && activeRoutes.length > 0 && (
        <div className="absolute top-6 right-6 z-20 w-72 bg-surface/90 backdrop-blur-md border border-blue-500/50 rounded-2xl p-4 shadow-2xl shadow-blue-500/10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Active Mission</span>
          </div>
          <div className="text-sm font-bold text-text truncate mb-1">
            {activeRoutes[0].name || `Route ${activeRoutes[0].id.slice(0, 8)}`}
          </div>
          <div className="flex gap-4 text-[10px] font-bold text-muted uppercase tracking-tighter">
            <div>Stops: <span className="text-text">{activeRoutes[0].route_stops?.filter((s:any) => s.status==='pending').length || 0} rem</span></div>
            <div>Status: <span className="text-blue-400">{activeRoutes[0].status}</span></div>
          </div>
          {(liveETA !== null || liveDistance !== null) && (
            <div className="flex gap-4 text-[10px] font-bold text-muted uppercase tracking-tighter mt-2 pt-2 border-t border-border">
              {liveETA !== null && <div>Live ETA: <span className="text-green-500">{formatEta(liveETA / 60)}</span></div>}
              {liveDistance !== null && <div>Dist: <span className="text-text">{(liveDistance / 1000).toFixed(1)} km</span></div>}
            </div>
          )}
        </div>
      )}

      <div ref={mapRef} className="w-full h-full min-h-[400px]" />
      
      {/* Legend / Overlay */}
      <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-2 p-4 rounded-2xl bg-surface/80 backdrop-blur-md border border-border shadow-2xl">
         <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase text-text/80 tracking-widest">Active Corridors</span>
         </div>
          <div className="flex gap-4 mt-2">
            {[
              { label: 'Moving', color: STATUS_COLORS.on_route },
              { label: 'Parked', color: STATUS_COLORS.available },
              { label: 'Open Load', color: '#A855F7' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                <span className="text-[8px] font-bold text-muted uppercase">{l.label}</span>
              </div>
            ))}
         </div>
      </div>


    </div>
  )
}
