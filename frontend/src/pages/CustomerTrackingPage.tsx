import { useState, useRef, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatEta } from '@/utils/timeFormat'
import {
  Package, MapPin, Clock, CheckCircle2,
  Search, Shield, Phone, AlertCircle,
  Truck, Box, Zap, Navigation, ArrowRight,
  FileText, Activity
} from 'lucide-react'
import { shipmentsAPI, telemetryWS } from '@/services/api'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

/* ─── Nexus Light Theme (Off-white/Grey & Yellow) ──────────────── */
const T = {
  bg: '#F4F4F5',  // Off-white/light gray background
  card: '#FFFFFF',  // White cards
  cardAlt: '#FAFAFA',  // Slightly offset gray for inner cards
  primary: '#FFC107',  // Yellow accent
  primaryDk: '#B38700',
  textHigh: '#18181B',  // Near black for high contrast text
  textMed: '#52525B',  // Medium gray for secondary text
  textLow: '#A1A1AA',  // Light gray for tertiary text
  border: '#E4E4E7',  // Light gray borders
  green: '#10B981',
  blue: '#3B82F6',
}

const S = {
  page: {
    minHeight: '100vh',
    background: T.bg,
    fontFamily: "'Inter', sans-serif",
    color: T.textHigh,
  } as React.CSSProperties,

  nav: {
    background: T.card,
    borderBottom: `1px solid ${T.border}`,
    position: 'sticky' as const,
    top: 0,
    zIndex: 50,
  },
  navInner: {
    maxWidth: 1400,
    margin: '0 auto',
    padding: '0 24px',
    height: 72,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    textDecoration: 'none',
  },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: T.primary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    fontSize: 20,
    color: '#000',
  },
  logoText: {
    color: T.textHigh,
    fontWeight: 900,
    fontSize: 20,
    letterSpacing: '1px',
  },
  logoSub: {
    color: T.primaryDk,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
  },

  main: {
    maxWidth: 1400,
    margin: '0 auto',
    padding: '48px 24px 80px',
  },

  /* ── Search ───────────────────────────────── */
  searchWrap: {
    marginBottom: 48,
  },
  searchHeader: {
    fontSize: 56,
    fontWeight: 900,
    color: T.textHigh,
    letterSpacing: '-2px',
    textTransform: 'uppercase' as const,
    lineHeight: 1.1,
    marginBottom: 8,
  },
  searchHeaderSub: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    color: T.textMed,
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 32,
  },
  searchBox: {
    position: 'relative' as const,
    display: 'flex',
    maxWidth: 600,
  },
  searchInput: {
    flex: 1,
    height: 64,
    border: `1px solid ${T.border}`,
    borderRadius: '12px',
    padding: '0 24px 0 60px',
    fontSize: 16,
    fontWeight: 600,
    color: T.textHigh,
    background: T.card,
    outline: 'none',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: 20,
    top: '50%',
    transform: 'translateY(-50%)',
    color: T.textLow,
  },
  searchBtn: {
    position: 'absolute' as const,
    right: 8,
    top: 8,
    bottom: 8,
    padding: '0 24px',
    background: T.primary,
    border: 'none',
    borderRadius: 8,
    fontWeight: 800,
    fontSize: 13,
    color: '#000',
    cursor: 'pointer',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    transition: 'all 0.2s',
  },

  /* ── Grid Layout ──────────────────────────── */
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 420px',
    gap: 32,
    alignItems: 'start',
  } as React.CSSProperties,

  card: {
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 0, // Sharper corners for aggressive look
    padding: 32,
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
  },

  /* ── Status Badge ─────────────────────────── */
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    borderRadius: 100,
    background: T.cardAlt,
    border: `1px solid ${T.border}`,
    color: T.primaryDk,
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
  },

  trackingIdLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: T.textLow,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    marginBottom: 8,
  },
  trackingIdValue: {
    fontSize: 48,
    fontWeight: 900,
    color: T.textHigh,
    letterSpacing: '-1px',
    lineHeight: 1,
    marginBottom: 40,
  },

  /* ── Progress Tracker ─────────────────────── */
  progressWrap: {
    display: 'flex',
    justifyContent: 'space-between',
    position: 'relative' as const,
    marginBottom: 48,
  },
  progressLineBg: {
    position: 'absolute' as const,
    top: 14,
    left: 20,
    right: 20,
    height: 2,
    background: T.border,
    zIndex: 0,
  },
  progressLineFill: (percent: number) => ({
    position: 'absolute' as const,
    top: 14,
    left: 20,
    height: 2,
    background: T.primary,
    width: `calc(${percent}% - 40px)`,
    transition: 'width 0.5s ease',
    zIndex: 1,
    boxShadow: `0 0 10px ${T.primary}`,
  }),
  stepItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 16,
    zIndex: 2,
    width: 80,
  },
  stepDot: (active: boolean, passed: boolean) => ({
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: passed || active ? T.primary : T.card,
    border: `2px solid ${passed || active ? T.primary : T.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: passed || active ? '#000' : T.textLow,
    boxShadow: active ? `0 0 20px ${T.primary}60` : 'none',
    transition: 'all 0.3s ease',
  }),
  stepLabel: (active: boolean, passed: boolean) => ({
    fontSize: 11,
    fontWeight: active ? 800 : 700,
    color: active ? T.textHigh : passed ? T.textMed : T.textLow,
    textAlign: 'center' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  }),

  /* ── Info Rows ────────────────────────────── */
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 32,
    borderTop: `1px solid ${T.border}`,
    paddingTop: 32,
  },
  infoCol: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: 800,
    color: T.textLow,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  infoValue: {
    fontSize: 18,
    fontWeight: 700,
    color: T.textHigh,
  },
  infoSub: {
    fontSize: 13,
    color: T.textMed,
    fontWeight: 500,
  },

  /* ── Right Panel Cards ────────────────────── */
  sideCard: {
    background: T.card,
    border: `1px solid ${T.border}`,
    padding: 24,
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
  },
  sideCardTitle: {
    fontSize: 12,
    fontWeight: 800,
    color: T.textHigh,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },

  /* ── ETA ──────────────────────────────────── */
  etaBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  etaNumber: {
    fontSize: 48,
    fontWeight: 900,
    color: T.primary,
    lineHeight: 1,
  },
  etaUnit: {
    fontSize: 14,
    fontWeight: 800,
    color: T.textHigh,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
  },

  /* ── Vehicle Info ─────────────────────────── */
  vehicleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '16px',
    background: T.cardAlt,
    border: `1px solid ${T.border}`,
  },
  vehicleIcon: {
    width: 48,
    height: 48,
    background: T.bg,
    border: `1px solid ${T.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: T.primaryDk,
  },

  /* ── Map ─────────────────────────────────── */
  mapInner: {
    width: '100%',
    height: 300,
    background: T.cardAlt,
    border: `1px solid ${T.border}`,
  },
}

import { point, lineString, nearestPointOnLine, lineSlice, length as turfLength } from '@turf/turf'
import { animateMarkerAlongRoute } from '@/utils/mapAnimation'

// Calculate bearing between two [lng,lat] points (returns degrees 0-360, 0=north)
function calcBearing(from: [number, number], to: [number, number]): number {
  const toRad = (d: number) => d * Math.PI / 180
  const toDeg = (r: number) => r * 180 / Math.PI
  const dLng = toRad(to[0] - from[0])
  const lat1 = toRad(from[1]), lat2 = toRad(to[1])
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/* ─── TrackingMap ──────────────────────────────────────────────── */
function TrackingMap({ shipment, onEtaUpdate }: { shipment: any, onEtaUpdate?: (eta: string) => void }) {
  const { trackingId } = useParams()
  const initialVehicle = shipment?.vehicle
  const destination = shipment?.destination
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const vMarker = useRef<mapboxgl.Marker | null>(null)
  const dMarker = useRef<mapboxgl.Marker | null>(null)
  const animCancelRef = useRef<(() => void) | null>(null)
  const routeFetchedRef = useRef(false)
  const prevCoordRef = useRef<[number, number] | null>(null)
  const markerElRef = useRef<HTMLDivElement | null>(null)
  const bearingRef = useRef(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const etaPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [liveVehicle, setLiveVehicle] = useState(initialVehicle)
  const [fullRouteCoords, setFullRouteCoords] = useState<any>(null)
  const [activeRouteCoords, setActiveRouteCoords] = useState<any>(null)
  const [eta, setEta] = useState<string | null>(null)
  const [city, setCity] = useState<string>('Locating...')
  const [mapLoaded, setMapLoaded] = useState(false)
  const [isFollowing, setIsFollowing] = useState(true)

  // Cleanup
  useEffect(() => {
    return () => {
      if (animCancelRef.current) animCancelRef.current()
      if (pollRef.current) clearInterval(pollRef.current)
      if (etaPollRef.current) clearInterval(etaPollRef.current)
    }
  }, [])

  // WebSocket + HTTP polling fallback every 5s
  useEffect(() => {
    if (!initialVehicle?.id || !trackingId) return;
    let wsAlive = false

    const ws = telemetryWS.connect((data) => {
      if (data.type === 'TELEMETRY_UPDATE' && data.data.vehicle_id === initialVehicle.id) {
        wsAlive = true
        setLiveVehicle((prev: any) => ({
          ...prev,
          lat: data.data.lat,
          lng: data.data.lng,
          speed: data.data.speed || 0
        }))
      }
    })

    // HTTP poll fallback every 5s using the public tracking API
    pollRef.current = setInterval(async () => {
      if (wsAlive) { wsAlive = false; return } // WS delivered data, skip poll
      try {
        const data = await shipmentsAPI.trackPublicly(trackingId)
        if (data?.vehicle) {
          setLiveVehicle((prev: any) => {
            let calculatedSpeed = prev?.speed || 0;
            if (prev?.lat && prev?.lng && (prev.lat !== data.vehicle.lat || prev.lng !== data.vehicle.lng)) {
              // rough distance calculation for speed (meters per 5 sec)
              const from = point([prev.lng, prev.lat]);
              const to = point([data.vehicle.lng, data.vehicle.lat]);
              const distanceKm = turfLength(lineString([from.geometry.coordinates, to.geometry.coordinates]), {units: 'kilometers'});
              // distanceKm / 5 seconds = (distanceKm * 1000) meters / 5 sec = m/s
              calculatedSpeed = (distanceKm * 1000) / 5;
            } else if (!prev?.lat || (prev.lat === data.vehicle.lat && prev.lng === data.vehicle.lng)) {
              calculatedSpeed = 0; // Stationary
            }

            return {
              ...prev,
              lat: data.vehicle.lat,
              lng: data.vehicle.lng,
              speed: calculatedSpeed
            };
          });
        }
      } catch { }
    }, 5000)

    return () => {
      ws.close()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [initialVehicle?.id, trackingId])

  // Auto-update ETA & city every 30s
  useEffect(() => {
    if (!destination?.lat || !destination?.lng || !MAPBOX_TOKEN || MAPBOX_TOKEN === 'your_mapbox_token_here') return
    if (shipment?.status === 'delivered' || shipment?.status === 'cancelled') return

    etaPollRef.current = setInterval(() => {
      const lat = liveVehicle?.lat; const lng = liveVehicle?.lng
      if (!lat || !lng) return

      // Refresh ETA via Mapbox Directions
      fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${lng},${lat};${destination.lng},${destination.lat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`)
        .then(r => r.json())
        .then(data => {
          if (data.routes?.[0]) {
            const calcEta = formatEta(data.routes[0].duration / 60)
            setEta(calcEta)
            if (onEtaUpdate) onEtaUpdate(calcEta)
          }
        }).catch(() => { })

      // Refresh city
      fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=place,locality`)
        .then(r => r.json())
        .then(data => { if (data.features?.[0]) setCity(data.features[0].text) })
        .catch(() => { })
    }, 30000)

    return () => { if (etaPollRef.current) clearInterval(etaPollRef.current) }
  }, [destination?.lat, destination?.lng, liveVehicle?.lat, liveVehicle?.lng, shipment?.status])

  // Fetch route ONCE
  useEffect(() => {
    if (routeFetchedRef.current) return
    const lat = liveVehicle?.lat || initialVehicle?.lat
    const lng = liveVehicle?.lng || initialVehicle?.lng
    const dLat = destination?.lat
    const dLng = destination?.lng

    if (!lat || !lng || !MAPBOX_TOKEN || MAPBOX_TOKEN === 'your_mapbox_token_here') return

    // Reverse Geocoding
    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=place,locality`)
      .then(r => r.json())
      .then(data => { if (data.features?.[0]) setCity(data.features[0].text) })
      .catch(console.error)

    if (shipment?.status === 'delivered' || shipment?.status === 'cancelled') {
      setEta('Delivered')
      if (onEtaUpdate) onEtaUpdate('Delivered')
      setFullRouteCoords([]); setActiveRouteCoords([])
      return
    }

    if (dLat && dLng && !routeFetchedRef.current) {
      routeFetchedRef.current = true
      if (trackingId) {
        fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${lng},${lat};${dLng},${dLat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`)
          .then(r => r.json())
          .then(data => {
            if (data.routes?.[0]) {
              const c = data.routes[0].geometry.coordinates
              setFullRouteCoords(c); setActiveRouteCoords(c)
              const calcEta = formatEta(data.routes[0].duration / 60)
              setEta(calcEta); if (onEtaUpdate) onEtaUpdate(calcEta)
            }
          }).catch(console.error)
      }
    }
  }, [liveVehicle?.lat, liveVehicle?.lng, destination?.lat, destination?.lng, onEtaUpdate, trackingId])

  // Slice blue line to vehicle position
  useEffect(() => {
    if (!fullRouteCoords || fullRouteCoords.length < 2 || !liveVehicle?.lat || !liveVehicle?.lng) return
    try {
      const routeLine = lineString(fullRouteCoords)
      const snapped = nearestPointOnLine(routeLine, point([liveVehicle.lng, liveVehicle.lat]))
      const destPt = point([destination.lng, destination.lat])
      const sliced = lineSlice(snapped, destPt, routeLine)
      setActiveRouteCoords(sliced.geometry.coordinates)
    } catch { setActiveRouteCoords(fullRouteCoords) }
  }, [liveVehicle?.lat, liveVehicle?.lng, fullRouteCoords])

  // Create map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!MAPBOX_TOKEN || MAPBOX_TOKEN === 'your_mapbox_token_here') return

    mapboxgl.accessToken = MAPBOX_TOKEN
    const cx = liveVehicle?.lng || destination?.lng || 77.209
    const cy = liveVehicle?.lat || destination?.lat || 28.613

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [cx, cy], zoom: 13, attributionControl: false,
    })

    map.on('load', () => {
      setMapLoaded(true)

      if (destination?.lat && destination?.lng) {
        const el = document.createElement('div')
        el.style.cssText = `width:24px;height:24px;border-radius:50%;background:#3B82F6;border:2px solid #fff;box-shadow:0 0 10px rgba(59,130,246,0.3);`
        dMarker.current = new mapboxgl.Marker(el).setLngLat([destination.lng, destination.lat]).addTo(map)
      }

      if (liveVehicle?.lat && liveVehicle?.lng) {
        const el = document.createElement('div')
        el.style.cssText = `
          width:44px;height:44px;
          display:flex;align-items:center;justify-content:center;
          transition: transform 0.8s ease;`
        el.innerHTML = `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="22" cy="22" r="20" fill="#3B82F6" fill-opacity="0.15" stroke="#3B82F6" stroke-width="2"/>
          <circle cx="22" cy="22" r="12" fill="#3B82F6"/>
          <path d="M22 14 L27 26 L22 23 L17 26 Z" fill="white"/>
        </svg>`
        markerElRef.current = el
        vMarker.current = new mapboxgl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
          .setLngLat([liveVehicle.lng, liveVehicle.lat]).addTo(map)
        prevCoordRef.current = [liveVehicle.lng, liveVehicle.lat]
      }

      map.on('dragstart', () => setIsFollowing(false))
      map.on('zoomstart', (e: any) => { if (e.originalEvent) setIsFollowing(false) })

      map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({
        id: 'route', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#4285F4', 'line-width': 6, 'line-opacity': 0.85 }
      })

      if (destination?.lat && destination?.lng && liveVehicle?.lat && liveVehicle?.lng) {
        const bounds = new mapboxgl.LngLatBounds()
        bounds.extend([destination.lng, destination.lat])
        bounds.extend([liveVehicle.lng, liveVehicle.lat])
        map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 1500 })
      }
    })

    mapRef.current = map
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  // Update route layer
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !activeRouteCoords || activeRouteCoords.length === 0) return
    const source = mapRef.current.getSource('route') as mapboxgl.GeoJSONSource
    if (source) {
      source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: activeRouteCoords } })
    }
  }, [activeRouteCoords, mapLoaded])

  // Animate marker with rotation (Uber/Ola style)
  useEffect(() => {
    if (!mapRef.current || !liveVehicle?.lat || !liveVehicle?.lng) return
    if (!vMarker.current) return

    const targetCoord = [liveVehicle.lng, liveVehicle.lat] as [number, number]
    const prev = prevCoordRef.current

    // Calculate bearing for rotation
    if (prev && (prev[0] !== targetCoord[0] || prev[1] !== targetCoord[1])) {
      const bearing = calcBearing(prev, targetCoord)
      bearingRef.current = bearing
      // Rotate via CSS transform for smooth transition
      if (markerElRef.current) {
        markerElRef.current.style.transform = `rotate(${bearing}deg)`
      }
    }

    const currentLngLat = vMarker.current.getLngLat()
    if (animCancelRef.current) animCancelRef.current()

    if (currentLngLat && (currentLngLat.lng !== targetCoord[0] || currentLngLat.lat !== targetCoord[1])) {
      const startCoord = [currentLngLat.lng, currentLngLat.lat] as [number, number]

      animCancelRef.current = animateMarkerAlongRoute({
        startCoord,
        endCoord: targetCoord,
        routeCoords: activeRouteCoords,
        duration: 2500,
        onTick: (coord) => {
          if (vMarker.current) {
            vMarker.current.setLngLat(coord)
            if (isFollowing) mapRef.current?.panTo(coord, { duration: 0 })
          }
        }
      })
    } else {
      vMarker.current.setLngLat(targetCoord)
      if (isFollowing) mapRef.current.panTo(targetCoord, { duration: 1000 })
    }
    prevCoordRef.current = targetCoord
  }, [liveVehicle?.lat, liveVehicle?.lng, activeRouteCoords, isFollowing])

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN === 'your_mapbox_token_here') {
    return (
      <div style={{ ...S.mapInner, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Activity size={32} color={T.textLow} />
        <p style={{ marginTop: 12, color: T.textLow, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '2px' }}>Telemetry Offline</p>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: 300, background: T.cardAlt, border: `1px solid ${T.border}` }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Live Data Overlay */}
      <div style={{
        position: 'absolute', top: 16, left: 16, zIndex: 10,
        background: 'rgba(59, 130, 246, 0.95)', backdropFilter: 'blur(8px)',
        border: '1px solid #60A5FA', borderRadius: 12, padding: '12px 20px',
        color: 'white', boxShadow: '0 4px 20px rgba(59, 130, 246, 0.4)',
        display: 'flex', gap: 24, alignItems: 'center'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: '#BFDBFE' }}>Location</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{city}</span>
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)' }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: '#BFDBFE' }}>ETA</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{eta !== null ? eta + ' MIN' : '--'}</span>
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)' }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: '#BFDBFE' }}>Speed</span>
          <span className="text-white text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-blue-500/20">{Math.round((liveVehicle?.speed || 0) * 3.6)} KM/H</span>
        </div>
      </div>

      {/* Live indicator */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 10,
        background: 'rgba(16,185,129,0.9)', borderRadius: 20, padding: '4px 12px',
        display: 'flex', alignItems: 'center', gap: 6,
        boxShadow: '0 2px 8px rgba(16,185,129,0.3)'
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'pulse 1.5s infinite' }} />
        <span style={{ color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '1px' }}>LIVE</span>
      </div>
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>

      {/* Locate Button */}
      <button
        onClick={() => {
          setIsFollowing(true);
          if (liveVehicle?.lat && liveVehicle?.lng && mapRef.current) {
            mapRef.current.flyTo({ center: [liveVehicle.lng, liveVehicle.lat], zoom: 15, duration: 1500 });
          }
        }}
        style={{
          position: 'absolute', bottom: 24, right: 24, zIndex: 10,
          width: 48, height: 48, borderRadius: 24,
          background: isFollowing ? '#3B82F6' : 'white',
          color: isFollowing ? 'white' : '#64748B',
          border: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.2s'
        }}
        title="Locate Vehicle"
      >
        <MapPin size={24} strokeWidth={isFollowing ? 3 : 2} />
      </button>

    </div>
  )
}

/* ─── Steps config ─────────────────────────────────────────────── */
const STEPS = [
  { key: 'created', label: 'Booked' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
]

/* ─── Main Page ────────────────────────────────────────────────── */
export default function CustomerTrackingPage() {
  const { trackingId } = useParams()
  const navigate = useNavigate()
  const [searchId, setSearchId] = useState(trackingId || '')
  const [liveEta, setLiveEta] = useState<string | null>(null)

  const { data: shipment, isLoading, error } = useQuery({
    queryKey: ['tracking', trackingId],
    queryFn: () => trackingId ? shipmentsAPI.trackPublicly(trackingId) : null,
    enabled: !!trackingId,
    refetchInterval: (query) => {
      const d = query?.state?.data as any
      if (!d) return 5000;
      return ['delivered', 'cancelled'].includes(d.status) ? false : 5000
    },
  })

  const currentStepIdx = STEPS.findIndex(s => s.key === (shipment as any)?.status)
  const progressPercent = currentStepIdx === -1 ? 0 : (currentStepIdx / (STEPS.length - 1)) * 100

  return (
    <div style={S.page}>
      {/* ── Navbar ── */}
      <nav style={S.nav}>
        <div style={S.navInner}>
          <Link to="/" style={S.logo}>
            <div style={S.logoBox}>RI</div>
            <div>
              <div style={S.logoText}>ROUTEIQ</div>
              <div style={S.logoSub}>by Prudata </div>
            </div>
          </Link>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Link to="/login" style={{ color: T.textMed, fontWeight: 700, fontSize: 12, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '2px' }}>
              Command Center
            </Link>
          </div>
        </div>
      </nav>

      <main style={S.main}>

        {/* ── Search ── */}
        <div style={S.searchWrap}>
          <h1 style={S.searchHeader}>
            CARGO <span style={{ color: T.primaryDk }}>TRACKER</span>
          </h1>
          <div style={S.searchHeaderSub}>
            <Activity size={16} color={T.primaryDk} />
            Enterprise Multi-Agent AI Ecosystem
          </div>

          <form
            onSubmit={e => { e.preventDefault(); if (searchId) navigate(`/track/${searchId}`) }}
            style={S.searchBox}
          >
            <span style={S.searchIcon}><Search size={20} /></span>
            <input
              style={S.searchInput}
              type="text"
              placeholder="ENTER SHIPMENT ID..."
              value={searchId}
              onChange={e => setSearchId(e.target.value)}
            />
            <button type="submit" style={S.searchBtn}>
              Track Cargo
            </button>
          </form>
        </div>

        {/* ── Loading ── */}
        {isLoading && (
          <div style={{ padding: '64px 0' }}>
            <div style={{ color: T.primaryDk, fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Activity size={20} className="animate-pulse" />
              Locating shipment telemetry...
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.05)', border: '1px solid #EF4444',
            padding: '24px', display: 'flex', alignItems: 'center', gap: 16,
            maxWidth: 600
          }}>
            <AlertCircle size={32} color="#EF4444" />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '1px' }}>Signal Lost</div>
              <div style={{ color: T.textMed, fontSize: 14, marginTop: 4 }}>
                Unable to locate shipment data. Verify the ID and try again.
              </div>
            </div>
          </div>
        )}

        {/* ── Shipment Data ── */}
        {shipment && (
          <div style={S.grid}>

            {/* ── LEFT COLUMN ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={S.trackingIdLabel}>Tracking ID</div>
                    <div style={S.trackingIdValue}>{(shipment as any).tracking_id}</div>
                  </div>
                  <div style={S.statusPill}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.primaryDk, boxShadow: `0 0 10px ${T.primary}` }} />
                    {(shipment as any).status.replace('_', ' ')}
                  </div>
                </div>

                {/* Progress Tracker */}
                <div style={S.progressWrap}>
                  <div style={S.progressLineBg} />
                  <div style={S.progressLineFill(progressPercent)} />

                  {STEPS.map((step, idx) => {
                    const passed = idx < currentStepIdx
                    const active = idx === currentStepIdx
                    return (
                      <div key={step.key} style={S.stepItem}>
                        <div style={S.stepDot(active, passed)}>
                          {passed && <CheckCircle2 size={16} />}
                        </div>
                        <div style={S.stepLabel(active, passed)}>{step.label}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Details Grid */}
                <div style={S.infoGrid}>
                  <div style={S.infoCol}>
                    <div style={S.infoLabel}><MapPin size={14} color={T.primaryDk} /> Origin</div>
                    <div style={S.infoValue}>{(shipment as any).origin_name || 'Terminal Alpha'}</div>
                    <div style={S.infoSub}>{(shipment as any).origin_address || 'N/A'}</div>
                  </div>
                  <div style={S.infoCol}>
                    <div style={S.infoLabel}><Navigation size={14} color={T.primaryDk} /> Destination</div>
                    <div style={S.infoValue}>{(shipment as any).destination?.name || 'Customer Site'}</div>
                    <div style={S.infoSub}>{(shipment as any).destination?.address || 'N/A'}</div>
                  </div>
                </div>
              </div>

              {/* Cargo Specs */}
              <div style={{ ...S.card, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                <div style={S.infoCol}>
                  <div style={S.infoLabel}>Weight</div>
                  <div style={S.infoValue}>{(shipment as any).total_weight_kg || 0} KG</div>
                </div>
                <div style={S.infoCol}>
                  <div style={S.infoLabel}>Items</div>
                  <div style={S.infoValue}>{(shipment as any).total_items || 0}</div>
                </div>
                <div style={S.infoCol}>
                  <div style={S.infoLabel}>Priority</div>
                  <div style={{ ...S.infoValue, color: T.primaryDk }}>{(shipment as any).priority?.toUpperCase() || 'STD'}</div>
                </div>
              </div>

            </div>

            {/* ── RIGHT COLUMN ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* ETA */}
              <div style={S.sideCard}>
                <div style={S.sideCardTitle}>
                  <span>Estimated Arrival</span>
                  <Clock size={16} color={T.primaryDk} />
                </div>
                <div style={S.etaBox}>
                  <div style={S.etaNumber}>
                    {liveEta !== null ? liveEta : '--'}
                  </div>
                  <div style={S.etaUnit}>
                    <div style={{ color: T.textHigh }}>Hours</div>
                    <div style={{ color: T.textLow, fontSize: 11, marginTop: 4 }}>Live Navigation</div>
                  </div>
                </div>
              </div>

              {/* Map */}
              <div style={{ ...S.sideCard, padding: 0 }}>
                <TrackingMap shipment={shipment} onEtaUpdate={setLiveEta} />
                <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.cardAlt }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: T.primaryDk, textTransform: 'uppercase', letterSpacing: '2px' }}>Live Telemetry Pipe</div>
                  <div style={{ fontSize: 11, color: T.textMed }}>GPS Sync: Active</div>
                </div>
              </div>

              {/* Vehicle Info */}
              <div style={S.sideCard}>
                <div style={S.sideCardTitle}>Carrier Details</div>
                <div style={S.vehicleRow}>
                  <div style={S.vehicleIcon}>
                    <Truck size={24} />
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: T.textHigh }}>
                      {(shipment as any).vehicle?.plate_number || 'Awaiting Assignment'}
                    </div>
                    <div style={{ fontSize: 12, color: T.textMed, marginTop: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>
                      {(shipment as any).vehicle?.type || 'Vehicle'} • {(shipment as any).vehicle?.status?.replace('_', ' ') || 'Standby'}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      `}</style>
    </div>
  )
}
