import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, MapPin, Navigation, WifiOff } from 'lucide-react'
import { api } from '@/services/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ErrorState, Alert } from '@/components/ui/States'
import { Spinner } from '@/components/ui/Spinner'
import { MapView, type MapVehicle } from '@/components/map'

interface SessionInfo {
  vehicle_id: string
  plate: string
  active: boolean
}

type Status = 'loading' | 'ready' | 'connecting' | 'tracking' | 'denied' | 'error' | 'session-invalid'

/**
 * Public phone GPS sharing page for drivers without the app: open `/m/:token` on a
 * phone and it pushes the phone's real location to the vehicle every few seconds.
 * No sign-in — the link's token is the credential.
 */
export default function MobileTrackPage() {
  const { token } = useParams<{ token: string }>()
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number; speed: number; accuracy: number } | null>(null)
  const [pushCount, setPushCount] = useState(0)
  const [lastPush, setLastPush] = useState<Date | null>(null)
  const watchId = useRef<number | null>(null)

  useEffect(() => {
    if (!token) return
    api.get(`/telemetry/mobile-session/${token}`)
      .then(r => setSession(r.data))
      .catch((err) => {
        setErrorMessage(err?.response?.data?.detail || 'This tracking link is invalid or has expired.')
        setStatus('session-invalid')
      })
  }, [token])

  useEffect(() => {
    if (session) setStatus(s => (s === 'loading' ? 'ready' : s))
  }, [session])

  const pushLocation = useCallback(async (pos: GeolocationPosition) => {
    const { latitude, longitude, speed, accuracy, heading } = pos.coords
    setCoords({ lat: latitude, lng: longitude, speed: speed ?? 0, accuracy: accuracy ?? 0 })
    try {
      await api.post(`/telemetry/mobile-push/${token}`, {
        lat: latitude, lng: longitude, speed: speed ?? 0, heading: heading ?? 0, accuracy,
      })
      setPushCount(c => c + 1)
      setLastPush(new Date())
      setStatus('tracking')
    } catch {
      // A single failed push is not fatal — the next GPS fix retries.
    }
  }, [token])

  const startTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setErrorMessage('This browser does not support sharing your location.')
      setStatus('error')
      return
    }
    setStatus('connecting')
    watchId.current = navigator.geolocation.watchPosition(
      pushLocation,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied')
          setErrorMessage('Location access was denied. Allow location for this site in your browser settings, then reload.')
        } else {
          setStatus('error')
          setErrorMessage(err.message || 'Could not get your location.')
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    )
  }, [pushLocation])

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    setStatus('ready')
  }, [])

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
  }, [])

  const isActive = status === 'tracking' || status === 'connecting'
  const vehicles: MapVehicle[] = coords
    ? [{ id: 'me', label: 'This phone', status: 'on_route', position: { lat: coords.lat, lng: coords.lng } }]
    : []

  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-4 py-8 text-text">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-xs font-medium uppercase text-brand">MargixIndia</p>
          <h1 className="mt-1 text-2xl font-semibold text-text">Share your location</h1>
          {session && <p className="mt-1 text-sm text-muted">Vehicle: <span className="font-medium text-text">{session.plate}</span></p>}
        </div>

        {status === 'loading' && (
          <Card padded className="flex flex-col items-center gap-3 py-10">
            <Spinner size={28} label="Loading tracking link" />
          </Card>
        )}

        {status === 'session-invalid' && (
          <Card padded>
            <ErrorState title="This link doesn't work" description={errorMessage} />
          </Card>
        )}

        {status !== 'loading' && status !== 'session-invalid' && (
          <>
            <Card padded className="space-y-4">
              {status === 'denied' && (
                <Alert tone="danger" title="Permission denied">{errorMessage}</Alert>
              )}
              {status === 'error' && (
                <Alert tone="danger" title="Could not get your location">{errorMessage}</Alert>
              )}
              {status === 'tracking' && (
                <Alert tone="success" title="Sharing your live location" />
              )}
              {status === 'connecting' && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner size={16} /> Getting a GPS fix…
                </div>
              )}
              {status === 'ready' && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-soft text-muted">
                    <MapPin size={26} aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted">Tap the button below to start sharing your live location with dispatch.</p>
                </div>
              )}

              {coords && (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-control border border-border bg-surface-subtle p-3">
                    <dt className="text-xs text-muted">Speed</dt>
                    <dd className="mt-0.5 font-medium text-text">{coords.speed > 0 ? `${(coords.speed * 3.6).toFixed(1)} km/h` : '0 km/h'}</dd>
                  </div>
                  <div className="rounded-control border border-border bg-surface-subtle p-3">
                    <dt className="text-xs text-muted">Accuracy</dt>
                    <dd className="mt-0.5 font-medium text-text">±{coords.accuracy.toFixed(0)} m</dd>
                  </div>
                </dl>
              )}

              {pushCount > 0 && (
                <p className="flex items-center justify-between text-xs text-muted">
                  <span className="flex items-center gap-1"><CheckCircle2 size={14} className="text-success" aria-hidden="true" /> {pushCount} updates sent</span>
                  {lastPush && <span>Last: {lastPush.toLocaleTimeString()}</span>}
                </p>
              )}

              {!isActive ? (
                <Button fullWidth size="lg" icon={<Navigation size={18} />} disabled={!session} onClick={startTracking}>
                  Start sharing location
                </Button>
              ) : (
                <Button fullWidth size="lg" variant="danger" icon={<WifiOff size={18} />} onClick={stopTracking}>
                  Stop sharing
                </Button>
              )}
            </Card>

            {coords && (
              <Card className="overflow-hidden">
                <MapView mode="tracking" height={200} interactive={false} vehicles={vehicles} />
              </Card>
            )}
          </>
        )}

        <p className="text-center text-xs text-muted">
          Your location is only shared while this page is open.
        </p>
      </div>
    </div>
  )
}
