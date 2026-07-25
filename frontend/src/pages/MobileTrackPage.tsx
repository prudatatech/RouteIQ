import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Wifi, WifiOff, Navigation, CheckCircle, AlertCircle, Loader2, Battery } from 'lucide-react'

type SessionInfo = {
  vehicle_id: string
  phone: string
  plate: string
  created_at: string
  active: boolean
}

type PushStatus = 'idle' | 'connecting' | 'tracking' | 'error' | 'denied'

export default function MobileTrackPage() {
  const { token } = useParams<{ token: string }>()
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [status, setStatus] = useState<PushStatus>('idle')
  const [error, setError] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number; speed: number; accuracy: number } | null>(null)
  const [pushCount, setPushCount] = useState(0)
  const [lastPush, setLastPush] = useState<Date | null>(null)
  const watchId = useRef<number | null>(null)
  const baseUrl = window.location.origin

  // Load session info
  useEffect(() => {
    if (!token) return
    fetch(`${baseUrl}/api/v1/telemetry/mobile-session/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.detail) { setError(data.detail); setStatus('error'); return }
        setSession(data)
      })
      .catch(() => { setError('Could not connect to server'); setStatus('error') })
  }, [token, baseUrl])

  const pushLocation = useCallback(async (pos: GeolocationPosition) => {
    const { latitude, longitude, speed, accuracy, heading } = pos.coords
    setCoords({ lat: latitude, lng: longitude, speed: speed ?? 0, accuracy: accuracy ?? 0 })
    try {
      await fetch(`${baseUrl}/api/v1/telemetry/mobile-push/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: latitude, lng: longitude, speed: speed ?? 0, heading: heading ?? 0, accuracy }),
      })
      setPushCount(c => c + 1)
      setLastPush(new Date())
      setStatus('tracking')
    } catch {
      // silent — will retry on next position
    }
  }, [token, baseUrl])

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser')
      setStatus('error')
      return
    }
    setStatus('connecting')
    watchId.current = navigator.geolocation.watchPosition(
      pushLocation,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied')
          setError('Location access denied. Please allow location in browser settings.')
        } else {
          setStatus('error')
          setError(`GPS error: ${err.message}`)
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    )
  }, [pushLocation])

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    setStatus('idle')
  }, [])

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
  }, [])

  const isActive = status === 'tracking' || status === 'connecting'

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-['Inter',sans-serif]">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div className="w-full max-w-sm mb-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <span className="text-yellow-400 text-xs font-black uppercase tracking-widest">RouteIQ</span>
        </div>
        <h1 className="text-white text-2xl font-black">Mobile GPS Tracker</h1>
        {session && (
          <p className="text-slate-400 text-sm mt-1">Vehicle: <span className="text-white font-bold">{session.plate}</span></p>
        )}
      </div>

      {/* Main Card */}
      <div className="w-full max-w-sm bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl">

        {/* Status Banner */}
        <div className={`px-6 py-4 flex items-center gap-3 transition-colors duration-500 ${
          status === 'tracking' ? 'bg-emerald-500/20 border-b border-emerald-500/30' :
          status === 'connecting' ? 'bg-yellow-500/20 border-b border-yellow-500/30' :
          status === 'denied' || status === 'error' ? 'bg-red-500/20 border-b border-red-500/30' :
          'bg-slate-800/50 border-b border-slate-700'
        }`}>
          {status === 'tracking' && <><CheckCircle className="text-emerald-400 flex-shrink-0" size={20} /><span className="text-emerald-300 font-bold text-sm">Live Tracking Active</span><Wifi className="text-emerald-400 ml-auto" size={16} /></>}
          {status === 'connecting' && <><Loader2 className="text-yellow-400 flex-shrink-0 animate-spin" size={20} /><span className="text-yellow-300 font-bold text-sm">Acquiring GPS Signal…</span></>}
          {(status === 'denied' || status === 'error') && <><AlertCircle className="text-red-400 flex-shrink-0" size={20} /><span className="text-red-300 font-bold text-sm">{status === 'denied' ? 'Permission Denied' : 'Error'}</span><WifiOff className="text-red-400 ml-auto" size={16} /></>}
          {status === 'idle' && <><Navigation className="text-slate-400 flex-shrink-0" size={20} /><span className="text-slate-300 font-bold text-sm">Ready to Track</span></>}
        </div>

        {/* GPS Data */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
              <p className="text-red-400 text-xs font-medium">{error}</p>
            </div>
          )}

          {coords && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800 rounded-2xl p-4">
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1">Latitude</p>
                <p className="text-white text-sm font-bold">{coords.lat.toFixed(6)}°</p>
              </div>
              <div className="bg-slate-800 rounded-2xl p-4">
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1">Longitude</p>
                <p className="text-white text-sm font-bold">{coords.lng.toFixed(6)}°</p>
              </div>
              <div className="bg-slate-800 rounded-2xl p-4">
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1">Speed</p>
                <p className="text-white text-sm font-bold">{coords.speed > 0 ? (coords.speed * 3.6).toFixed(1) : '0'} km/h</p>
              </div>
              <div className="bg-slate-800 rounded-2xl p-4">
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1">Accuracy</p>
                <p className="text-white text-sm font-bold">±{coords.accuracy.toFixed(0)}m</p>
              </div>
            </div>
          )}

          {!coords && status === 'idle' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
                <MapPin className="text-slate-500" size={28} />
              </div>
              <p className="text-slate-400 text-sm text-center">Tap the button below to start sharing your live location with RouteIQ</p>
            </div>
          )}

          {/* Stats Row */}
          {pushCount > 0 && (
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>📡 {pushCount} updates sent</span>
              {lastPush && <span>Last: {lastPush.toLocaleTimeString()}</span>}
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="px-6 pb-6">
          {!isActive ? (
            <button
              onClick={startTracking}
              disabled={!session || status === 'error' && !error.includes('denied')}
              className="w-full h-14 bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-slate-900 font-black uppercase tracking-widest text-sm rounded-2xl transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Navigation size={18} />
              Start Tracking
            </button>
          ) : (
            <button
              onClick={stopTracking}
              className="w-full h-14 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 active:scale-95 text-red-400 font-black uppercase tracking-widest text-sm rounded-2xl transition-all flex items-center justify-center gap-2"
            >
              <WifiOff size={18} />
              Stop Tracking
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <p className="mt-6 text-slate-600 text-xs text-center">
        Your location is only shared while this page is open.<br />
        Powered by RouteIQ · Prudata Technologies
      </p>
    </div>
  )
}
