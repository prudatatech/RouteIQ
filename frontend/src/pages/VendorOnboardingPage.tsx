import { useState, useEffect, useRef } from 'react'
import { Package, MapPin, Building, ArrowRight, Loader2, Search } from 'lucide-react'
import axios from 'axios'
import mapboxgl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'

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

export default function VendorOnboardingPage() {
  const [companyName, setCompanyName] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [loading, setLoading] = useState(false)
  const [citySearchTerm, setCitySearchTerm] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInst = useRef<mapboxgl.Map | null>(null)
  const markerInst = useRef<mapboxgl.Marker | null>(null)

  const userId = useAuthStore(s => s.userId)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchExistingProfile = async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token
        if (!token) return
        const res = await fetch(`${import.meta.env.VITE_API_URL || '/api/v1'}/vendor/profile`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.ok) {
          const profile = await res.json()
          if (profile) {
            if (profile.company_name) setCompanyName(profile.company_name)
            if (profile.gst_number) setGstNumber(profile.gst_number)
            if (profile.address) setAddress(profile.address)
            if (profile.city) {
              setCity(profile.city)
              setCitySearchTerm(profile.city)
            }
            if (profile.latitude) setLat(profile.latitude.toString())
            if (profile.longitude) setLng(profile.longitude.toString())
          }
        }
      } catch (err) {
        console.error('Failed to load profile for onboarding edit', err)
      }
    }
    fetchExistingProfile()
  }, [])

  useEffect(() => {
    const searchMapbox = async (query: string) => {
      if (query.length < 3) {
        setSuggestions([])
        return
      }
      setIsSearching(true)
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN
        const geocodingBase = import.meta.env.VITE_MAPBOX_GEOCODING_URL || 'https://api.mapbox.com/geocoding/v5/mapbox.places'
        const resp = await axios.get(
          `${geocodingBase}/${encodeURIComponent(query)}.json`,
          {
            params: {
              access_token: token,
              country: 'IN',
              limit: 5,
              types: 'place,locality,address'
            }
          }
        )
        setSuggestions(resp.data.features || [])
      } catch (err) {
        console.error('Search failed', err)
      } finally {
        setIsSearching(false)
      }
    }

    const timer = setTimeout(() => searchMapbox(citySearchTerm), 500)
    return () => clearTimeout(timer)
  }, [citySearchTerm])

  const handleOnboard = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || '/api/v1'}/vendor/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          companyName,
          gstNumber,
          city,
          address,
          lat: parseFloat(lat),
          lng: parseFloat(lng)
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to complete profile')
      }

      navigate('/vendor')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGetLocation = () => {
    const fetchIpLocation = async () => {
      try {
        const res = await axios.get('https://ipapi.co/json/')
        if (res.data && res.data.latitude && res.data.longitude) {
          setLat(res.data.latitude.toString())
          setLng(res.data.longitude.toString())
          if (res.data.city && !city) {
            setCity(res.data.city)
            setCitySearchTerm(res.data.city)
          }
        } else {
          alert('Could not fetch location automatically.')
        }
      } catch (err) {
        alert('Could not fetch location automatically.')
      }
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const latitude = pos.coords.latitude
        const longitude = pos.coords.longitude
        setLat(latitude.toString())
        setLng(longitude.toString())
        
        try {
          const token = import.meta.env.VITE_MAPBOX_TOKEN
          const geocodingBase = import.meta.env.VITE_MAPBOX_GEOCODING_URL || 'https://api.mapbox.com/geocoding/v5/mapbox.places'
          const resp = await axios.get(
            `${geocodingBase}/${longitude},${latitude}.json`,
            {
              params: {
                access_token: token,
                types: 'place,locality,address'
              }
            }
          )
          if (resp.data?.features?.[0]) {
             const place = resp.data.features[0]
             setCity(place.text)
             setCitySearchTerm('')
             setSuggestions([])
          }
        } catch(e) {}
      }, () => {
        fetchIpLocation()
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
    } else {
      fetchIpLocation()
    }
  }

  useEffect(() => {
    if (!lat || !lng || !mapContainerRef.current) return
    const numLat = parseFloat(lat)
    const numLng = parseFloat(lng)
    if (isNaN(numLat) || isNaN(numLng)) return

    if (!mapInst.current) {
      mapInst.current = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: '/map-style.json',
        center: [numLng, numLat],
        zoom: 9,
        attributionControl: false,
      })
      
      mapInst.current.on('load', () => {
        if (!mapInst.current) return
        
        mapInst.current.addSource('geofence', {
          type: 'geojson',
          data: createGeoJSONCircle([numLng, numLat], 50)
        })

        mapInst.current.addLayer({
          id: 'geofence-fill',
          type: 'fill',
          source: 'geofence',
          paint: {
            'fill-color': '#F26122',
            'fill-opacity': 0.1
          }
        })

        mapInst.current.addLayer({
          id: 'geofence-border',
          type: 'line',
          source: 'geofence',
          paint: {
            'line-color': '#F26122',
            'line-width': 2,
            'line-dasharray': [2, 2]
          }
        })
      })

      markerInst.current = new mapboxgl.Marker({ color: '#F26122' })
        .setLngLat([numLng, numLat])
        .addTo(mapInst.current)
    } else {
      mapInst.current.flyTo({ center: [numLng, numLat], zoom: 9, duration: 1500 })
      if (markerInst.current) {
        markerInst.current.setLngLat([numLng, numLat])
      }
      const source = mapInst.current.getSource('geofence') as mapboxgl.GeoJSONSource
      if (source) {
        source.setData(createGeoJSONCircle([numLng, numLat], 50) as any)
      }
    }
  }, [lat, lng])

  if (!userId) return null

  return (
    <div className="min-h-screen bg-bg text-text font-sans selection:bg-primary/20 selection:text-primary pb-20 relative overflow-hidden">
      <div className="bg-mesh" />
      
      <div className="relative z-10 w-full max-w-7xl mx-auto p-6 pt-12 lg:pt-24 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-start">
        
        {/* Left Column: Profile Form */}
        <div className="flex flex-col gap-8 w-full max-w-lg mx-auto lg:mx-0">
          <div className="text-center lg:text-left">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto lg:mx-0 mb-6 shadow-lg shadow-primary/20">
              <Package className="text-white" size={32} />
            </div>
            <h1 className="text-4xl font-display font-black text-text tracking-tight uppercase">Vendor Profile</h1>
            <p className="text-muted mt-2 text-lg">Complete your profile to access capacity markets</p>
          </div>

          <form onSubmit={handleOnboard} className="glass-card rounded-2xl p-6 lg:p-8 space-y-6 relative z-50">
          <div>
            <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2 flex items-center gap-2">
              <Building size={14} /> Company Name
            </label>
            <input 
              required value={companyName} onChange={e => setCompanyName(e.target.value)}
              className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              placeholder="e.g. Reliance Logistics"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">GST Number</label>
            <input 
              required value={gstNumber} onChange={e => setGstNumber(e.target.value)}
              className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text font-mono uppercase focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              placeholder="22AAAAA0000A1Z5"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2 flex items-center gap-2">
              <MapPin size={14} /> Registered Address
            </label>
            <textarea 
              required value={address} onChange={e => setAddress(e.target.value)}
              className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-1 focus:ring-primary transition-all resize-none h-24"
              placeholder="Full address of the warehouse / office"
            />
          </div>

          <div className="relative group z-50">
            <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">Primary Hub City</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted">
                {isSearching ? <Loader2 size={16} className="animate-spin text-primary" /> : <Search size={16} />}
              </div>
              <input 
                required value={citySearchTerm || city} 
                onChange={e => {
                  setCitySearchTerm(e.target.value)
                  if (city) setCity('')
                }}
                className="w-full bg-surface2 border border-border focus:border-primary rounded-xl pl-12 pr-4 py-3 text-text focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                placeholder="Search city e.g. Mumbai..."
              />
            </div>
            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-surface rounded-2xl border border-border shadow-2xl overflow-hidden">
                {suggestions.map((p: any) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => {
                      setCity(p.text)
                      setLat(p.center[1].toString())
                      setLng(p.center[0].toString())
                      setCitySearchTerm('')
                      setSuggestions([])
                    }}
                    className="w-full px-5 py-3 text-left hover:bg-surface2 flex flex-col gap-0.5 border-b border-border/50 last:border-none"
                  >
                    <span className="text-xs font-black text-text">{p.text}</span>
                    <span className="text-[9px] font-bold text-muted uppercase truncate">{p.place_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                <MapPin size={14} /> Location Coordinates
              </label>
              <button type="button" onClick={handleGetLocation} className="text-xs bg-primary/20 text-primary px-3 py-1 rounded-md font-bold hover:bg-primary/30 transition-colors">
                Auto Fetch
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input 
                required type="number" step="any" value={lat} onChange={e => setLat(e.target.value)}
                className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-3 py-2 text-text font-mono text-sm focus:outline-none"
                placeholder="Lat"
              />
              <input 
                required type="number" step="any" value={lng} onChange={e => setLng(e.target.value)}
                className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-3 py-2 text-text font-mono text-sm focus:outline-none"
                placeholder="Lng"
              />
            </div>
            <p className="text-[10px] text-muted uppercase tracking-widest leading-relaxed">
              Your coordinates are used strictly for Geofencing. You will only see capacity passing within 50km of this location.
            </p>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full bg-primary hover:bg-primary-dark text-white py-4 rounded-xl font-bold shadow-lg shadow-primary/20 transition-all active:scale-95 flex items-center justify-center gap-2 mt-6 text-lg uppercase tracking-wider"
          >
            {loading ? 'Saving...' : 'Complete Registration'} <ArrowRight size={20} />
          </button>
        </form>
        </div>

        {/* Right Column: CTO Grade Interactive Map */}
        <div className="flex flex-col glass-card rounded-[2rem] overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] border border-white/10 h-[500px] lg:h-[calc(100vh-10rem)] lg:sticky top-20 w-full">
           {lat && lng ? (
              <div className="w-full h-full relative">
                <div ref={mapContainerRef} className="absolute inset-0" />
                <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-surface/90 backdrop-blur-md px-6 py-3 rounded-2xl border border-border text-xs font-black uppercase text-primary tracking-widest text-center shadow-2xl pointer-events-none z-10">
                  50km Capacity Geofence Active
                </div>
              </div>
           ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-surface2/30 text-muted p-10 text-center">
                 <MapPin size={64} className="opacity-20 mb-6" />
                 <h3 className="text-2xl font-black uppercase tracking-widest text-text/50">Map Preview</h3>
                 <p className="text-base mt-3 max-w-xs opacity-70">Select your Primary Hub City or Auto Fetch to preview your bidding territory.</p>
              </div>
           )}
        </div>
      </div>
    </div>
  )
}
