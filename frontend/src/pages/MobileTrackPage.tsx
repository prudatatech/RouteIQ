import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, MapPin, Navigation, WifiOff } from 'lucide-react'
import { api } from '@/services/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ErrorState, Alert } from '@/components/ui/States'
import { Spinner } from '@/components/ui/Spinner'
import { MapView, type MapVehicle } from '@/components/map'
import { formatTime } from '@/utils/display'

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
  const [pushFailing, setPushFailing] = useState(false)
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
      setPushFailing(false)
      setStatus('tracking')
    } catch {
      // One failed push is not fatal: the next GPS fix retries. Tell the driver dispatch may not see them.
      setPushFailing(true)
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
    setPushFailing(false)
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
    <div className="flex min-h-screen flex-col items-center bg-bg px-4 py-8 text-text selection:bg-brand/20">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-soft text-brand text-xs font-bold uppercase tracking-wider mb-2">
            <Navigation size={13} className={isActive ? 'animate-spin-slow' : ''} /> MargixIndia Telemetry
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text">Live Vehicle GPS</h1>
          {session && (
            <p className="mt-1 text-sm text-muted">
              Vehicle plate: <span className="font-mono font-bold text-text bg-surface-subtle px-2 py-0.5 rounded-control border border-border">{session.plate}</span>
            </p>
          )}
        </div>

        {status === 'loading' && (
          <Card padded className="flex flex-col items-center gap-3 py-10 shadow-raised">
            <Spinner size={32} label="Loading tracking link" />
            <p className="text-xs text-muted">Connecting to fleet dispatch…</p>
          </Card>
        )}

        {status === 'session-invalid' && (
          <Card padded className="shadow-raised">
            <ErrorState title="This link doesn't work" description={errorMessage} />
          </Card>
        )}

        {status !== 'loading' && status !== 'session-invalid' && (
          <>
            <Card padded className="space-y-4 shadow-raised">
              {status === 'denied' && (
                <Alert tone="danger" title="Permission denied">{errorMessage}</Alert>
              )}
              {status === 'error' && (
                <Alert tone="danger" title="Could not get your location">{errorMessage}</Alert>
              )}
              {status === 'tracking' && (
                <div className="flex items-center justify-between rounded-control border border-success/30 bg-success-soft px-3 py-2 text-xs font-medium text-success">
                  <span className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success"></span>
                    </span>
                    Live GPS broadcasting active
                  </span>
                  <span className="font-mono">{formatTime(new Date(), { seconds: true })}</span>
                </div>
              )}
              {isActive && pushFailing && (
                <Alert tone="warning" title="Dispatch cannot see your location right now">
                  Check your mobile data connection. We keep trying while this page is open.
                </Alert>
              )}
              {status === 'connecting' && (
                <div className="flex items-center justify-center gap-2 rounded-control border border-border bg-surface-subtle p-3 text-sm text-muted">
                  <Spinner size={16} /> Acquiring satellite GPS fix…
                </div>
              )}
              {status === 'ready' && (
                <div className="flex flex-col items-center gap-3 py-5 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-brand shadow-xs">
                    <MapPin size={30} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-text">Ready to transmit</h3>
                    <p className="mt-1 text-xs text-muted leading-relaxed">Tap start below to transmit real-time road telemetry directly to operations.</p>
                  </div>
                </div>
              )}

              {coords && (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-card border border-border bg-surface-subtle p-3.5 shadow-xs">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Speed</dt>
                    <dd className="mt-1 font-mono text-xl font-extrabold text-text">
                      {Math.round(coords.speed * 3.6)} <span className="text-xs font-normal text-muted">km/h</span>
                    </dd>
                  </div>
                  <div className="rounded-card border border-border bg-surface-subtle p-3.5 shadow-xs">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Accuracy</dt>
                    <dd className="mt-1 font-mono text-xl font-extrabold text-text">
                      ±{coords.accuracy.toFixed(0)} <span className="text-xs font-normal text-muted">meters</span>
                    </dd>
                  </div>
                </dl>
              )}

              {pushCount > 0 && (
                <div className="flex items-center justify-between text-xs text-muted border-t border-border pt-3">
                  <span className="flex items-center gap-1.5 font-medium text-text">
                    <CheckCircle2 size={15} className="text-success shrink-0" aria-hidden="true" /> {pushCount} telemetry packets sent
                  </span>
                  {lastPush && <span className="text-[11px] tabular">Last: {formatTime(lastPush, { seconds: true })}</span>}
                </div>
              )}

              {!isActive ? (
                <Button fullWidth size="lg" icon={<Navigation size={18} />} disabled={!session} onClick={startTracking} className="font-bold py-3">
                  Start sharing location
                </Button>
              ) : (
                <Button fullWidth size="lg" variant="danger" icon={<WifiOff size={18} />} onClick={stopTracking} className="font-bold py-3">
                  Stop sharing
                </Button>
              )}
            </Card>

            {coords && (
              <Card className="overflow-hidden border border-border shadow-raised">
                <MapView mode="tracking" height={220} interactive={false} vehicles={vehicles} />
              </Card>
            )}
          </>
        )}

        <p className="text-center text-xs text-muted leading-relaxed">
          Your location is only transmitted securely while this browser page remains open.
        </p>
      </div>
    </div>
  )
}
