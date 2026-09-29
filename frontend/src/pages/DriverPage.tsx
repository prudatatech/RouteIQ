import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Bell, CheckCircle2, Home, LogOut, Map as MapIcon, Package, Phone, Play, Pause, ShieldAlert, User,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import toast from 'react-hot-toast'
import type { AxiosError } from 'axios'
import { api, routesAPI, shipmentsAPI, telemetryAPI, usersAPI } from '@/services/api'
import { getRouteDistance, getRouteDuration, type RouteLike } from '@/utils/routeHelpers'
import DriverMap from '@/components/map/DriverMap'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { Card, DetailList } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { Select } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/States'
import { useConfirm } from '@/components/ui'
import { formatMinutes, formatTime } from '@/utils/display'

type Point = { x: number; y: number }
type ShiftStatus = 'offline' | 'on_duty' | 'on_mission'
type Tab = 'home' | 'nav' | 'deliveries' | 'alerts' | 'profile'

// Shapes returned by GET /routes for a driver's route
interface DeliveryPoint {
  name?: string
  address?: string
  latitude?: number
  longitude?: number
  demand_kg?: number
  shipment_id?: string | null
}
interface RouteStop {
  sequence?: number
  status?: string
  delivery_points?: DeliveryPoint
  delivery_point?: DeliveryPoint
}
interface DriverVehicle {
  id?: string
  plate_number?: string
  latitude?: number | null
  longitude?: number | null
  last_heartbeat?: string | null
}
interface DriverRoute {
  vehicles?: DriverVehicle | null
  vehicle?: DriverVehicle | null
  route_stops?: RouteStop[]
  stops?: RouteStop[]
  depot_id?: string | null
  total_distance_km?: number | null
  total_duration_minutes?: number | null
  estimated_fuel_liters?: number | null
}

type SosType = 'panic_button' | 'accident' | 'breakdown' | 'medical' | 'theft' | 'other'

const SOS_TYPES: { value: SosType; label: string }[] = [
  { value: 'panic_button', label: 'Emergency' },
  { value: 'accident', label: 'Accident' },
  { value: 'breakdown', label: 'Vehicle breakdown' },
  { value: 'medical', label: 'Medical' },
  { value: 'theft', label: 'Theft' },
  { value: 'other', label: 'Other' },
]

// Canvas can't read CSS variables at paint time on some browsers without a lookup,
// so resolve the theme colour once when drawing.
function strokeColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim() || '#18181B'
}

export interface SignaturePadHandle {
  /** The signature drawn on the canvas right now, or null if nothing is drawn. */
  getDataUrl: () => string | null
  /** Wipe the canvas (used after a successful submit). */
  clear: () => void
}

const SignaturePad = forwardRef<SignaturePadHandle, { onStrokesChange?: (hasStrokes: boolean) => void }>(function SignaturePad({ onStrokesChange }, ref) {
  const [isDrawing, setIsDrawing] = useState(false)
  // Finished strokes, plus strokes removed by Undo that Redo can bring back
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [undone, setUndone] = useState<Point[][]>([])
  const currentStroke = useRef<Point[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useImperativeHandle(ref, () => ({
    getDataUrl: () => {
      const canvas = canvasRef.current
      return canvas && strokes.length > 0 ? canvas.toDataURL('image/png') : null
    },
    clear: () => { setStrokes([]); setUndone([]) },
  }), [strokes])

  const setupPen = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = strokeColour()
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  // Repaint from the stroke list whenever it changes (undo, redo, clear)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setupPen(ctx)
    for (const stroke of strokes) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }, [strokes])

  // Map the pointer to canvas pixels (the canvas is scaled by CSS)
  const getPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const source = 'touches' in e ? e.touches[0] : e
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true)
    currentStroke.current = [getPos(e)]
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const stroke = currentStroke.current
    const prev = stroke[stroke.length - 1]
    const next = getPos(e)
    stroke.push(next)
    setupPen(ctx)
    ctx.beginPath()
    ctx.moveTo(prev.x, prev.y)
    ctx.lineTo(next.x, next.y)
    ctx.stroke()
  }

  // The pad reports whether it currently has any strokes; the signature
  // itself is read straight off the canvas at submit time via getDataUrl.
  useEffect(() => {
    onStrokesChange?.(strokes.length > 0)
  }, [strokes.length, onStrokesChange])

  const stopDrawing = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    const stroke = currentStroke.current
    currentStroke.current = []
    if (stroke.length === 0) return
    setStrokes(prev => [...prev, stroke])
    setUndone([])
  }

  const undo = () => {
    if (strokes.length === 0) return
    setUndone(prev => [...prev, strokes[strokes.length - 1]])
    setStrokes(prev => prev.slice(0, -1))
  }

  const redo = () => {
    if (undone.length === 0) return
    setStrokes(prev => [...prev, undone[undone.length - 1]])
    setUndone(prev => prev.slice(0, -1))
  }

  const clear = () => {
    setStrokes([])
    setUndone([])
  }

  return (
    <div className="space-y-3">
      <div className="relative h-40 touch-none overflow-hidden rounded-control border border-border bg-surface-subtle">
        {strokes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
            Sign here
          </div>
        )}
        <canvas
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          ref={canvasRef}
          width={400}
          height={200}
          className="relative z-10 h-full w-full cursor-crosshair"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={undo} disabled={strokes.length === 0}>Undo</Button>
        <Button type="button" variant="secondary" size="sm" onClick={redo} disabled={undone.length === 0}>Redo</Button>
        <Button type="button" variant="secondary" size="sm" onClick={clear} disabled={strokes.length === 0}>Clear</Button>
      </div>
    </div>
  )
})

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-control text-xs font-medium transition-colors ${active ? 'text-brand' : 'text-muted hover:text-text'}`}
    >
      {icon}
      {label}
    </button>
  )
}

export default function DriverPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const userId = useAuthStore(s => s.userId)
  const role = useAuthStore(s => s.role)
  const clearAuth = useAuthStore(s => s.clearAuth)

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('Sign-out failed', e)
    }
    clearAuth()
    navigate('/login')
  }
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [shiftStatus, setShiftStatus] = useState<ShiftStatus>('offline')
  const [isTracking, setIsTracking] = useState(false)
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number; speedKmph: number } | null>(null)
  // Time of the last GPS fix from this device
  const [lastFixAt, setLastFixAt] = useState<Date | null>(null)
  const [sosType, setSosType] = useState<SosType>('panic_button')

  // POD state
  const [recipientName, setRecipientName] = useState('')
  const [hasSignature, setHasSignature] = useState(false)
  const signaturePadRef = useRef<SignaturePadHandle>(null)
  const { confirm } = useConfirm()

  const { data: me } = useQuery({
    queryKey: ['me', userId],
    queryFn: () => usersAPI.me(),
    enabled: !!userId,
  })

  const { data: routes = [] } = useQuery<DriverRoute[]>({
    queryKey: ['driver-routes', userId],
    queryFn: () => routesAPI.list({ status: 'active' }) as Promise<DriverRoute[]>,
    refetchInterval: 30_000,
  })

  const activeRoute = routes[0]
  // GET /routes embeds the vehicle as `vehicles` and each stop's point as `delivery_points`
  const vehicle = activeRoute?.vehicles ?? activeRoute?.vehicle ?? null
  const stops: RouteStop[] = [...((activeRoute?.route_stops ?? activeRoute?.stops ?? []) as RouteStop[])]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  const pointOf = (stop?: RouteStop): DeliveryPoint | null => stop?.delivery_points ?? stop?.delivery_point ?? null
  const currentStopIndex = stops.findIndex(s => s.status === 'pending')
  const currentStop = currentStopIndex >= 0 ? stops[currentStopIndex] : undefined
  const currentPoint = pointOf(currentStop)
  const pendingStopCount = stops.filter(s => s.status === 'pending').length

  // Where the route starts: its depot when it has one (optimised routes), otherwise the first stop
  const { data: depots = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['depots'],
    queryFn: () => api.get('/depots/').then(r => r.data),
    enabled: !!activeRoute?.depot_id,
  })
  const routeOrigin = activeRoute?.depot_id
    ? depots.find(d => d.id === activeRoute.depot_id)?.name
    : pointOf(stops[0])?.name

  // Shipment behind the current stop, for cargo and consignee details
  const currentShipmentId: string | undefined = currentPoint?.shipment_id ?? undefined
  const { data: currentShipment } = useQuery({
    queryKey: ['shipment', currentShipmentId],
    queryFn: () => shipmentsAPI.get(currentShipmentId!),
    enabled: !!currentShipmentId,
  })
  const consigneePhone: string | undefined =
    currentShipment?.metadata?.consigneeContact || currentShipment?.metadata?.consignee?.contact || undefined

  const computedDist = activeRoute ? getRouteDistance(activeRoute as unknown as RouteLike) : 0
  const computedDuration = activeRoute ? getRouteDuration(activeRoute as unknown as RouteLike, computedDist) : 0

  // Last position report: this device's own fix, else the vehicle's last telemetry heartbeat
  const lastUpdate = lastFixAt ?? (vehicle?.last_heartbeat ? new Date(vehicle.last_heartbeat) : null)

  const triggerSos = useMutation({
    mutationFn: () => telemetryAPI.triggerSos({
      ...(liveLocation ? { lat: liveLocation.lat, lng: liveLocation.lng } : {}),
      alert_type: sosType,
    }),
    onSuccess: () => toast.success('SOS sent to the control room'),
    onError: (err: AxiosError<{ detail?: string }>) =>
      toast.error(err.response?.data?.detail || 'Could not send SOS. Call the control room directly.'),
  })

  const updateStatus = useMutation({
    mutationFn: ({ shipmentId, status, params }: { shipmentId: string; status: string; params?: Record<string, unknown> }) =>
      shipmentsAPI.updateStatus(shipmentId, status, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-routes'] })
      toast.success('Delivery completed')
      setRecipientName('')
      setHasSignature(false)
      signaturePadRef.current?.clear()
    },
    onError: (err: AxiosError<{ detail?: string }>) =>
      toast.error(err.response?.data?.detail || 'Could not record the delivery. Try again.'),
  })

  // Before the first fix, show the vehicle's last reported position
  useEffect(() => {
    if (!liveLocation && vehicle?.latitude != null && vehicle?.longitude != null) {
      setLiveLocation({ lat: vehicle.latitude, lng: vehicle.longitude, speedKmph: 0 })
    }
  }, [vehicle?.latitude, vehicle?.longitude, liveLocation])

  // Share this device's real location while on a trip (drivers only)
  useEffect(() => {
    if (!isTracking || role !== 'driver') return
    if (!('geolocation' in navigator)) {
      toast.error('Location is not available on this device')
      return
    }

    let lastSent = 0
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed, heading, accuracy } = pos.coords
        const speedMs = Math.max(0, speed ?? 0)
        setLiveLocation({ lat: latitude, lng: longitude, speedKmph: Math.round(speedMs * 3.6) })
        setLastFixAt(new Date(pos.timestamp))

        if (Date.now() - lastSent < 10_000) return
        lastSent = Date.now()
        telemetryAPI.driverPing({
          lat: latitude,
          lng: longitude,
          speed: speedMs,
          heading: heading ?? 0,
          accuracy,
          timestamp: new Date(pos.timestamp).toISOString(),
        }).catch(console.error)
      },
      (err) => toast.error(`Location unavailable: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 5_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [isTracking, role])

  const finalizeDelivery = () => {
    // Read the signature straight off the canvas — no separate "save" step.
    const signatureData = signaturePadRef.current?.getDataUrl() ?? null
    if (!recipientName || !signatureData) return toast.error('Enter the receiver name and collect a signature')
    if (!currentStop) return toast.error('No active stop')
    if (!currentShipmentId) return toast.error('This stop has no linked shipment')
    updateStatus.mutate({
      shipmentId: currentShipmentId,
      status: 'delivered',
      params: { received_by: recipientName, signature_data: signatureData },
    })
  }

  const startTrip = () => {
    if (shiftStatus === 'offline') { setShiftStatus('on_duty'); toast.success('You are online') }
    else { setShiftStatus('on_mission'); toast.success('Trip started'); setIsTracking(true) }
  }
  const pauseTrip = () => { setShiftStatus('on_duty'); setIsTracking(false); toast('Trip paused') }
  const endShift = async () => {
    const ok = await confirm({
      title: 'End your shift?',
      message: 'You will go offline and stop sharing your location until you sign back in.',
      confirmLabel: 'End shift',
      tone: 'danger',
    })
    if (!ok) return
    setShiftStatus('offline')
    setIsTracking(false)
    toast.success('Shift ended')
  }

  const renderHome = () => (
    <div className="space-y-4 pb-24">
      <Card padded className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">MargixIndia driver</p>
            <h1 className="text-lg font-semibold text-text">Welcome, {me?.full_name || 'Driver'}</h1>
          </div>
          <StatusPill tone={shiftStatus === 'offline' ? 'neutral' : 'success'}>{shiftStatus === 'offline' ? 'Offline' : 'Online'}</StatusPill>
        </div>
        {vehicle?.plate_number && (
          <p className="text-sm text-muted">Vehicle: <span className="font-medium text-text">{vehicle.plate_number}</span></p>
        )}
      </Card>

      <Card padded className="space-y-4">
        <h2 className="text-sm font-medium text-text">Current trip</h2>
        {activeRoute ? (
          <>
            <div className="relative space-y-6 border-l-2 border-border pl-4">
              <div className="relative">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand-fill" aria-hidden="true" />
                <p className="text-sm font-medium text-text">{routeOrigin || '—'}</p>
                <p className="text-xs text-muted">Origin</p>
              </div>
              <div className="relative">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
                <p className="text-sm font-medium text-text">{currentPoint?.name || (stops.length > 0 ? 'All stops completed' : '—')}</p>
                <p className="text-xs text-muted">Next stop</p>
              </div>
            </div>
            <DetailList
              columns={2}
              items={[
                { label: 'ETA', value: computedDuration > 0 ? formatMinutes(computedDuration) : '—' },
                { label: 'Distance', value: computedDist > 0 ? `${computedDist.toFixed(1)} km` : '—' },
              ]}
            />
          </>
        ) : (
          <p className="text-sm text-muted">No active trips assigned.</p>
        )}
      </Card>

      <Card padded className="space-y-3">
        <h2 className="text-sm font-medium text-text">Live vehicle status</h2>
        <DetailList
          columns={2}
          items={[
            { label: 'Speed', value: isTracking && lastFixAt && liveLocation ? `${liveLocation.speedKmph} km/h` : '—' },
            {
              label: 'GPS',
              value: isTracking && lastFixAt
                ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={14} aria-hidden="true" /> Connected</span>
                : isTracking ? 'Waiting for fix' : 'Off',
            },
            { label: 'Last update', value: lastUpdate ? formatTime(lastUpdate, { seconds: true }) : '—' },
          ]}
        />
      </Card>

      {currentStop && (
        <Card padded className="space-y-3">
          <h2 className="text-sm font-medium text-text">Cargo details</h2>
          <DetailList
            columns={2}
            items={[
              ...(currentShipment?.tracking_id ? [{ label: 'Shipment', value: currentShipment.tracking_id }] : []),
              ...(currentShipment?.total_weight_kg || currentPoint?.demand_kg
                ? [{ label: 'Weight', value: `${currentShipment?.total_weight_kg || currentPoint?.demand_kg} kg` }]
                : []),
              ...(currentShipment?.metadata?.productCategory ? [{ label: 'Type', value: currentShipment.metadata.productCategory }] : []),
              { label: 'Stops left', value: pendingStopCount },
            ]}
          />
        </Card>
      )}

      <Card padded className="space-y-3">
        <h2 className="text-sm font-medium text-text">Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          {shiftStatus !== 'on_mission' ? (
            <Button variant="secondary" icon={<Play size={16} />} onClick={startTrip}>
              {shiftStatus === 'offline' ? 'Go online' : 'Start trip'}
            </Button>
          ) : (
            <Button variant="secondary" icon={<Pause size={16} />} onClick={pauseTrip}>Pause trip</Button>
          )}
          <Button variant="secondary" icon={<CheckCircle2 size={16} />} onClick={() => setActiveTab('deliveries')}>
            Complete delivery
          </Button>
        </div>
      </Card>
    </div>
  )

  const renderNav = () => {
    if (!liveLocation) {
      return (
        <EmptyState
          compact
          icon={<MapIcon size={22} />}
          title="Waiting for your location"
          description="Start the trip and allow location access to see navigation."
        />
      )
    }
    return (
      <DriverMap
        currentLat={liveLocation.lat}
        currentLng={liveLocation.lng}
        targetLat={currentPoint?.latitude ?? liveLocation.lat}
        targetLng={currentPoint?.longitude ?? liveLocation.lng}
        shiftStatus={shiftStatus === 'on_mission' ? 'ON_MISSION' : shiftStatus === 'on_duty' ? 'ON_DUTY' : 'OFFLINE'}
        speed={liveLocation.speedKmph}
      />
    )
  }

  const renderDeliveries = () => (
    <div className="space-y-4 pb-24">
      {currentStop ? (
        <Card padded className="space-y-4">
          <h2 className="text-sm font-medium text-brand">Delivery stop {currentStopIndex + 1} of {stops.length}</h2>
          <DetailList
            columns={1}
            items={[
              ...(currentPoint?.name ? [{ label: 'Customer', value: currentPoint.name }] : []),
              ...(consigneePhone ? [{ label: 'Contact', value: consigneePhone }] : []),
              ...(currentPoint?.address ? [{ label: 'Address', value: currentPoint.address }] : []),
            ]}
          />

          <div className="grid grid-cols-2 gap-3">
            {consigneePhone && (
              <a href={`tel:${consigneePhone}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface text-sm font-medium text-text hover:bg-surface-subtle">
                <Phone size={14} aria-hidden="true" /> Call customer
              </a>
            )}
            <Button variant="secondary" icon={<MapIcon size={14} />} onClick={() => setActiveTab('nav')}>Navigate</Button>
          </div>

          <hr className="border-border" />

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text">Receiver name</span>
              <input
                type="text"
                value={recipientName}
                onChange={e => setRecipientName(e.target.value)}
                className="h-control w-full rounded-control border border-border-strong bg-surface px-3 text-base text-text placeholder:text-placeholder focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 sm:text-sm"
                placeholder="Who received this delivery?"
              />
            </label>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-text">Proof of delivery (signature)</span>
              <SignaturePad ref={signaturePadRef} onStrokesChange={setHasSignature} />
            </div>
            <Button
              fullWidth
              size="lg"
              loading={updateStatus.isPending}
              disabled={!hasSignature || !recipientName}
              onClick={finalizeDelivery}
            >
              Mark delivered
            </Button>
          </div>
        </Card>
      ) : (
        <Card padded>
          <EmptyState
            icon={<CheckCircle2 size={22} className="text-success" />}
            title="All done"
            description="No pending deliveries right now."
          />
        </Card>
      )}
    </div>
  )

  const renderAlerts = () => (
    <div className="space-y-4 pb-24">
      <Card padded className="space-y-4 border-danger/30 bg-danger-soft">
        <h2 className="flex items-center gap-2 text-sm font-medium text-danger"><ShieldAlert size={16} aria-hidden="true" /> Alert centre</h2>
        <p className="text-sm text-text">
          Report a critical emergency immediately. This raises an SOS for your vehicle{liveLocation ? ', with your current location,' : ''} on the control room's emergency screen.
        </p>
        <Select
          label="Type of emergency"
          value={sosType}
          onChange={e => setSosType(e.target.value as SosType)}
          options={SOS_TYPES}
        />
        <Button
          fullWidth
          size="lg"
          variant="danger"
          loading={triggerSos.isPending}
          disabled={role !== 'driver'}
          icon={<AlertTriangle size={18} />}
          onClick={() => triggerSos.mutate()}
        >
          Send SOS
        </Button>
        {role !== 'driver' && (
          <p className="text-xs text-muted">Only a driver's own account can raise an SOS.</p>
        )}
      </Card>
    </div>
  )

  const renderProfile = () => (
    <div className="space-y-4 pb-24">
      <Card padded className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
          <User size={26} aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text">{me?.full_name || 'Driver'}</h2>
          {vehicle?.plate_number && <p className="text-sm text-muted">Vehicle: {vehicle.plate_number}</p>}
        </div>
      </Card>

      <Card padded className="space-y-3">
        <h3 className="text-sm font-medium text-text">Shift controls</h3>
        <Button fullWidth size="lg" variant="danger" onClick={endShift}>End shift</Button>
        <Button fullWidth size="lg" variant="secondary" icon={<LogOut size={18} aria-hidden="true" />} onClick={signOut}>Sign out</Button>
      </Card>
    </div>
  )

  return (
    <div className="relative mx-auto min-h-screen bg-bg text-text sm:max-w-md sm:border-x sm:border-border">
      <div className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-surface px-4">
        <h1 className="text-base font-semibold text-text">MargixIndia <span className="text-sm font-normal text-muted">Driver</span></h1>
        <Button variant="ghost" size="sm" icon={<LogOut size={16} aria-hidden="true" />} onClick={signOut}>Sign out</Button>
      </div>

      <div className="h-[calc(100vh-7.5rem)] overflow-y-auto p-4">
        {activeTab === 'home' && renderHome()}
        {activeTab === 'nav' && renderNav()}
        {activeTab === 'deliveries' && renderDeliveries()}
        {activeTab === 'alerts' && renderAlerts()}
        {activeTab === 'profile' && renderProfile()}
      </div>

      <div className="sticky bottom-0 z-50 flex h-20 items-center justify-around border-t border-border bg-surface px-2">
        <TabButton active={activeTab === 'home'} icon={<Home size={22} aria-hidden="true" />} label="Home" onClick={() => setActiveTab('home')} />
        <TabButton active={activeTab === 'nav'} icon={<MapIcon size={22} aria-hidden="true" />} label="Nav" onClick={() => setActiveTab('nav')} />
        <TabButton active={activeTab === 'deliveries'} icon={<Package size={22} aria-hidden="true" />} label="Deliveries" onClick={() => setActiveTab('deliveries')} />
        <TabButton active={activeTab === 'alerts'} icon={<Bell size={22} aria-hidden="true" />} label="Alerts" onClick={() => setActiveTab('alerts')} />
        <TabButton active={activeTab === 'profile'} icon={<User size={22} aria-hidden="true" />} label="Profile" onClick={() => setActiveTab('profile')} />
      </div>
    </div>
  )
}
