import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Home, Map as MapIcon, Package, Bell, User, Phone, Play, Pause,
  CheckCircle2, AlertTriangle, ShieldAlert, Loader2
} from 'lucide-react';
import { api, routesAPI, shipmentsAPI, telemetryAPI, usersAPI } from '@/services/api';
import { getRouteDistance, getRouteDuration } from '@/utils/routeHelpers';
import { formatEta } from '@/utils/timeFormat';
import DriverMap from '@/components/map/DriverMap';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import type { AxiosError } from 'axios';

type Point = { x: number; y: number };

// Shapes returned by GET /routes for a driver's route
type DeliveryPoint = {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  demand_kg?: number;
  shipment_id?: string | null;
};
type RouteStop = {
  sequence?: number;
  status?: string;
  delivery_points?: DeliveryPoint;
  delivery_point?: DeliveryPoint;
};

// Canvas can't read CSS variables, so resolve the theme colour when drawing
function strokeColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#000';
}

function SignaturePad({ onSave, onClear }: { onSave: (data: string) => void; onClear: () => void }) {
  const [isDrawing, setIsDrawing] = useState(false);
  // Finished strokes, plus strokes removed by Undo that Redo can bring back
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [undone, setUndone] = useState<Point[][]>([]);
  const currentStroke = useRef<Point[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const setupPen = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = strokeColour();
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  // Repaint from the stroke list whenever it changes (undo, redo, clear)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setupPen(ctx);
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }, [strokes]);

  // Map the pointer to canvas pixels (the canvas is scaled by CSS)
  const getPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const source = 'touches' in e ? e.touches[0] : e;
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    currentStroke.current = [getPos(e)];
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const stroke = currentStroke.current;
    const prev = stroke[stroke.length - 1];
    const next = getPos(e);
    stroke.push(next);
    setupPen(ctx);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const stroke = currentStroke.current;
    currentStroke.current = [];
    if (stroke.length === 0) return;
    setStrokes(prev => [...prev, stroke]);
    setUndone([]);
    onClear(); // a saved signature no longer matches the pad
  };

  const undo = () => {
    if (strokes.length === 0) return;
    setUndone(prev => [...prev, strokes[strokes.length - 1]]);
    setStrokes(prev => prev.slice(0, -1));
    onClear();
  };

  const redo = () => {
    if (undone.length === 0) return;
    setStrokes(prev => [...prev, undone[undone.length - 1]]);
    setUndone(prev => prev.slice(0, -1));
    onClear();
  };

  const clear = () => {
    setStrokes([]);
    setUndone([]);
    onClear();
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-xl overflow-hidden touch-none h-48 relative shadow-inner">
        <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
          <span className="text-3xl font-black uppercase tracking-widest text-text">SIGN HERE</span>
        </div>
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
          className="w-full h-full cursor-crosshair relative z-10"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <button type="button" onClick={undo} disabled={strokes.length === 0} className="h-10 bg-surface2 rounded-xl text-xs font-bold uppercase disabled:opacity-50">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={undone.length === 0} className="h-10 bg-surface2 rounded-xl text-xs font-bold uppercase disabled:opacity-50">
          Redo
        </button>
        <button type="button" onClick={clear} disabled={strokes.length === 0} className="h-10 bg-surface2 rounded-xl text-xs font-bold uppercase disabled:opacity-50">
          Clear
        </button>
      </div>
      <button
        onClick={() => {
          const canvas = canvasRef.current;
          if (!canvas || strokes.length === 0) {
            toast.error('Please sign first');
            return;
          }
          onSave(canvas.toDataURL('image/png'));
          toast.success('Signature saved');
        }}
        className="w-full h-14 bg-yellow-500 text-black font-black uppercase tracking-widest text-xs rounded-xl shadow-lg active:scale-95 transition-transform"
      >
        Save Signature
      </button>
    </div>
  );
}

export default function DriverPage() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s: any) => s.userId);
  const [activeTab, setActiveTab] = useState<'home' | 'nav' | 'deliveries' | 'alerts' | 'profile'>('home');
  const [shiftStatus, setShiftStatus] = useState<'OFFLINE' | 'ON_DUTY' | 'ON_MISSION'>('OFFLINE');
  const role = useAuthStore((s: any) => s.role);
  const [isTracking, setIsTracking] = useState(false);
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number; speedKmph: number } | null>(null);
  // Time of the last GPS fix from this device
  const [lastFixAt, setLastFixAt] = useState<Date | null>(null);

  // POD State
  const [recipientName, setRecipientName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  const { data: me } = useQuery({
    queryKey: ['me', userId],
    queryFn: () => usersAPI.me(),
    enabled: !!userId,
  });

  const { data: routes = [], isLoading: _isLoading } = useQuery({
    queryKey: ['driver-routes', userId],
    queryFn: () => routesAPI.list({ status: 'active' }),
    refetchInterval: 30_000,
  });

  const activeRoute = routes[0];
  // GET /routes embeds the vehicle as `vehicles` and each stop's point as `delivery_points`
  const vehicle = activeRoute?.vehicles ?? activeRoute?.vehicle ?? null;
  const stops: RouteStop[] = [...((activeRoute?.route_stops ?? activeRoute?.stops ?? []) as RouteStop[])]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const pointOf = (stop?: RouteStop): DeliveryPoint | null => stop?.delivery_points ?? stop?.delivery_point ?? null;
  const currentStopIndex = stops.findIndex(s => s.status === 'pending');
  const currentStop = currentStopIndex >= 0 ? stops[currentStopIndex] : undefined;
  const currentPoint = pointOf(currentStop);
  const pendingStopCount = stops.filter(s => s.status === 'pending').length;

  // Where the route starts: its depot when it has one (optimised routes), otherwise the first stop
  const { data: depots = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['depots'],
    queryFn: () => api.get('/depots/').then(r => r.data),
    enabled: !!activeRoute?.depot_id,
  });
  const routeOrigin = activeRoute?.depot_id
    ? depots.find(d => d.id === activeRoute.depot_id)?.name
    : pointOf(stops[0])?.name;

  // Shipment behind the current stop, for cargo and consignee details
  const currentShipmentId: string | undefined = currentPoint?.shipment_id ?? undefined;
  const { data: currentShipment } = useQuery({
    queryKey: ['shipment', currentShipmentId],
    queryFn: () => shipmentsAPI.get(currentShipmentId!),
    enabled: !!currentShipmentId,
  });
  const consigneePhone: string | undefined =
    currentShipment?.metadata?.consigneeContact || currentShipment?.metadata?.consignee?.contact || undefined;

  const computedDist = activeRoute ? getRouteDistance(activeRoute) : 0;
  const computedDuration = activeRoute ? getRouteDuration(activeRoute, computedDist) : 0;

  // Last position report: this device's own fix, else the vehicle's last telemetry heartbeat
  const lastUpdate = lastFixAt ?? (vehicle?.last_heartbeat ? new Date(vehicle.last_heartbeat) : null);

  const triggerSos = useMutation({
    mutationFn: () => telemetryAPI.triggerSos(liveLocation ? { lat: liveLocation.lat, lng: liveLocation.lng } : {}),
    onSuccess: () => toast.success('SOS sent to the control room'),
    onError: (err: AxiosError<{ detail?: string }>) =>
      toast.error(err.response?.data?.detail || 'Could not send SOS. Call the control room directly.'),
  });

  const updateStatus = useMutation({
    mutationFn: ({ shipmentId, status, params }: any) =>
      shipmentsAPI.updateStatus(shipmentId, status, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-routes'] });
      toast.success('Delivery completed successfully!');
      setRecipientName('');
      setSignature(null);
    }
  });

  // Before the first fix, show the vehicle's last reported position
  useEffect(() => {
    if (!liveLocation && vehicle?.latitude != null && vehicle?.longitude != null) {
      setLiveLocation({ lat: vehicle.latitude, lng: vehicle.longitude, speedKmph: 0 });
    }
  }, [vehicle?.latitude, vehicle?.longitude]);

  // Share this device's real location while on a trip (drivers only)
  useEffect(() => {
    if (!isTracking || role !== 'driver') return;
    if (!('geolocation' in navigator)) {
      toast.error('Location is not available on this device');
      return;
    }

    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed, heading, accuracy } = pos.coords;
        const speedMs = Math.max(0, speed ?? 0);
        setLiveLocation({ lat: latitude, lng: longitude, speedKmph: Math.round(speedMs * 3.6) });
        setLastFixAt(new Date(pos.timestamp));

        if (Date.now() - lastSent < 10_000) return;
        lastSent = Date.now();
        telemetryAPI.driverPing({
          lat: latitude,
          lng: longitude,
          speed: speedMs,
          heading: heading ?? 0,
          accuracy,
          timestamp: new Date(pos.timestamp).toISOString(),
        }).catch(console.error);
      },
      (err) => toast.error(`Location unavailable: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 5_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isTracking, role]);

  const finalizeDelivery = () => {
    if (!recipientName || !signature) return toast.error('Check signature fields');
    if (!currentStop) return toast.error('No active stop');
    if (!currentShipmentId) return toast.error('This stop has no linked shipment');
    updateStatus.mutate({
      shipmentId: currentShipmentId,
      status: 'delivered',
      params: { received_by: recipientName, signature_data: signature }
    });
  };

  const renderHome = () => (
    <div className="space-y-4 pb-24">
      {/* Driver Header */}
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
        <h2 className="text-xs font-bold text-muted uppercase tracking-widest">margixindia Driver</h2>
        <h1 className="text-xl font-black uppercase mt-1">Welcome, {me?.full_name || 'Driver'}</h1>
        <div className="mt-4 flex justify-between items-center text-sm">
          <div>
            {vehicle?.plate_number && (
              <p className="text-muted">Vehicle: <span className="font-bold text-text">{vehicle.plate_number}</span></p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${shiftStatus !== 'OFFLINE' ? 'bg-success animate-pulse' : 'bg-slate-500'}`} />
            <span className="font-black tracking-widest text-[10px] uppercase">
              {shiftStatus !== 'OFFLINE' ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </div>

      {/* Current Trip */}
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
        <h2 className="text-[10px] font-black text-muted uppercase tracking-widest mb-4">Current Trip</h2>
        {activeRoute ? (
          <div className="space-y-4">
            <div className="relative pl-6 border-l-2 border-surface2">
              <div className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-yellow-500" />
              <p className="text-sm font-bold">{routeOrigin || '—'}</p>
              <div className="h-6" />
              <div className="absolute -left-[5px] bottom-1 w-2 h-2 rounded-full bg-primary" />
              <p className="text-sm font-bold">{currentPoint?.name || (stops.length > 0 ? 'All stops completed' : '—')}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
              <div>
                <p className="text-[10px] text-muted uppercase tracking-widest">ETA</p>
                <p className="font-black text-lg">{computedDuration > 0 ? formatEta(computedDuration) : '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted uppercase tracking-widest">Distance</p>
                <p className="font-black text-lg">{computedDist > 0 ? `${computedDist.toFixed(1)} km` : '—'}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No active trips assigned.</p>
        )}
      </div>

      {/* Live Vehicle Status */}
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
        <h2 className="text-[10px] font-black text-muted uppercase tracking-widest mb-4">Live Vehicle Status</h2>
        <div className="grid grid-cols-2 gap-y-4">
          <div>
            <p className="text-xs text-muted mb-1">Speed</p>
            <p className="font-black text-lg">{isTracking && lastFixAt && liveLocation ? `${liveLocation.speedKmph} km/h` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted mb-1">GPS</p>
            {isTracking && lastFixAt ? (
              <p className="font-bold text-success flex items-center gap-1"><CheckCircle2 size={14} /> Connected</p>
            ) : (
              <p className="font-bold text-muted">{isTracking ? 'Waiting for fix' : 'Off'}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted mb-1">Last Update</p>
            <p className="font-bold">{lastUpdate ? lastUpdate.toLocaleTimeString() : '—'}</p>
          </div>
        </div>
      </div>

      {/* Cargo Details */}
      {currentStop && (
        <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
          <h2 className="text-[10px] font-black text-muted uppercase tracking-widest mb-4">Cargo Details</h2>
          <div className="space-y-2 text-sm">
            {currentShipment?.tracking_id && (
              <div className="flex justify-between"><span className="text-muted">Shipment</span><span className="font-bold uppercase">{currentShipment.tracking_id}</span></div>
            )}
            {(currentShipment?.total_weight_kg || currentPoint?.demand_kg) ? (
              <div className="flex justify-between"><span className="text-muted">Weight</span><span className="font-bold">{currentShipment?.total_weight_kg || currentPoint?.demand_kg} kg</span></div>
            ) : null}
            {currentShipment?.metadata?.productCategory && (
              <div className="flex justify-between"><span className="text-muted">Type</span><span className="font-bold">{currentShipment.metadata.productCategory}</span></div>
            )}
            <div className="flex justify-between"><span className="text-muted">Stops Left</span><span className="font-bold">{pendingStopCount}</span></div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
        <h2 className="text-[10px] font-black text-muted uppercase tracking-widest mb-4">Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              if (shiftStatus === 'OFFLINE') { setShiftStatus('ON_DUTY'); toast.success('Online'); }
              else { setShiftStatus('ON_MISSION'); toast.success('Trip Started'); setIsTracking(true); }
            }}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-success/10 text-success font-black text-[10px] uppercase tracking-widest hover:bg-success/20 transition-all"
          >
            <Play size={20} className="mb-2" /> Start Trip
          </button>
          <button
            onClick={() => { setShiftStatus('ON_DUTY'); setIsTracking(false); toast('Trip Paused'); }}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-yellow-500/10 text-yellow-500 font-black text-[10px] uppercase tracking-widest hover:bg-yellow-500/20 transition-all"
          >
            <Pause size={20} className="mb-2" /> Pause Trip
          </button>
          <button
            onClick={() => setActiveTab('deliveries')}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-primary/10 text-primary font-black text-[10px] uppercase tracking-widest hover:bg-primary/20 transition-all"
          >
            <CheckCircle2 size={20} className="mb-2" /> Complete Delivery
          </button>
        </div>
      </div>
    </div>
  );

  const renderNav = () => {
    if (!liveLocation) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted text-center px-6">
          Waiting for your location. Start the trip and allow location access to see navigation.
        </div>
      );
    }
    return (
      <DriverMap
        currentLat={liveLocation.lat}
        currentLng={liveLocation.lng}
        targetLat={currentPoint?.latitude ?? liveLocation.lat}
        targetLng={currentPoint?.longitude ?? liveLocation.lng}
        shiftStatus={shiftStatus}
        speed={liveLocation.speedKmph}
      />
    );
  };

  const renderDeliveries = () => (
    <div className="space-y-6 pb-24">
      {currentStop ? (
        <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
          <h2 className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-4">Delivery Stop #{currentStopIndex + 1} of {stops.length}</h2>
          <div className="space-y-3 mb-6">
            {currentPoint?.name && (
              <div><p className="text-xs text-muted uppercase">Customer</p><p className="font-bold text-lg">{currentPoint.name}</p></div>
            )}
            {consigneePhone && (
              <div><p className="text-xs text-muted uppercase">Contact</p><p className="font-bold text-lg text-primary">{consigneePhone}</p></div>
            )}
            {currentPoint?.address && (
              <div><p className="text-xs text-muted uppercase">Address</p><p className="font-bold">{currentPoint.address}</p></div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            {consigneePhone && (
              <a href={`tel:${consigneePhone}`} className="h-12 bg-surface2 rounded-xl flex items-center justify-center gap-2 text-xs font-bold uppercase"><Phone size={14} /> Call Customer</a>
            )}
            <button onClick={() => setActiveTab('nav')} className="h-12 bg-primary/20 text-primary rounded-xl flex items-center justify-center gap-2 text-xs font-bold uppercase"><MapIcon size={14} /> Navigate</button>
          </div>

          <hr className="border-border mb-6" />

          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted uppercase mb-1 block">Recipient Name</label>
              <input
                type="text"
                value={recipientName}
                onChange={e => setRecipientName(e.target.value)}
                className="w-full h-12 bg-surface2 border border-border rounded-xl px-4 text-sm outline-none focus:border-yellow-500"
                placeholder="Enter name"
              />
            </div>
            <div>
              <label className="text-xs text-muted uppercase mb-1 block">Proof of Delivery (Signature)</label>
              <SignaturePad onSave={setSignature} onClear={() => setSignature(null)} />
            </div>
            <button
              onClick={finalizeDelivery}
              disabled={!signature || updateStatus.isPending}
              className="w-full h-14 bg-success text-bg rounded-xl font-black uppercase text-sm disabled:opacity-50 mt-4 shadow-lg shadow-success/20 active:scale-95 transition-all"
            >
              {updateStatus.isPending ? <Loader2 className="animate-spin mx-auto" /> : 'Mark Delivered & Upload POD'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-surface p-10 rounded-2xl border border-border text-center shadow-md">
          <CheckCircle2 size={40} className="text-success mx-auto mb-4" />
          <h2 className="font-black text-xl uppercase">All Done!</h2>
          <p className="text-muted text-sm mt-2">No pending deliveries right now.</p>
        </div>
      )}
    </div>
  );

  const renderAlerts = () => (
    <div className="space-y-6 pb-24">
      <div className="bg-error/10 p-6 rounded-2xl border border-error/20 shadow-md">
        <h2 className="text-[10px] font-black text-error uppercase tracking-widest mb-4 flex items-center gap-2"><ShieldAlert size={14} /> Alert Center</h2>
        <p className="text-sm text-text mb-6">Report critical emergencies immediately. This raises an SOS alert for your vehicle{liveLocation ? ' with your current location' : ''} on the control room's emergency screen.</p>

        <button
          onClick={() => triggerSos.mutate()}
          disabled={triggerSos.isPending}
          className="w-full mt-6 h-14 bg-error text-white font-black uppercase text-sm rounded-xl shadow-xl shadow-error/20 active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {triggerSos.isPending ? <Loader2 className="animate-spin" /> : <><AlertTriangle size={18} /> Send SOS</>}
        </button>
      </div>
    </div>
  );

  const renderProfile = () => (
    <div className="space-y-6 pb-24">
      <div className="bg-surface p-6 rounded-2xl border border-border flex items-center gap-4 shadow-md">
        <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center">
          <User size={32} className="text-primary" />
        </div>
        <div>
          <h2 className="font-black text-xl">{me?.full_name || 'Driver'}</h2>
          {vehicle?.plate_number && <p className="text-muted text-sm uppercase">Vehicle: {vehicle.plate_number}</p>}
        </div>
      </div>

      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md space-y-4">
        <h3 className="text-[10px] font-black text-muted uppercase tracking-widest">Shift Controls</h3>
        <button
          onClick={() => { setShiftStatus('OFFLINE'); setIsTracking(false); toast.success('Shift Ended') }}
          className="w-full h-14 bg-error/10 text-error font-black uppercase text-xs rounded-xl shadow-md active:scale-95 transition-transform"
        >
          End Shift
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#09090b] text-text font-sans selection:bg-primary sm:max-w-md sm:mx-auto sm:border-x sm:border-border sm:shadow-2xl relative">

      {/* Top Bar */}
      <div className="h-16 border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-50 flex items-center justify-center">
        <h1 className="text-lg font-black tracking-tighter uppercase italic">
          Route<span className="text-primary">IQ</span> <span className="text-xs font-bold text-muted ml-1 font-sans not-italic">Driver</span>
        </h1>
      </div>

      {/* Main Content Area */}
      <div className="p-4 h-[calc(100vh-128px)] overflow-y-auto">
        {activeTab === 'home' && renderHome()}
        {activeTab === 'nav' && renderNav()}
        {activeTab === 'deliveries' && renderDeliveries()}
        {activeTab === 'alerts' && renderAlerts()}
        {activeTab === 'profile' && renderProfile()}
      </div>

      {/* Bottom Tab Bar */}
      <div className="h-20 bg-surface border-t border-border sticky bottom-0 z-50 flex items-center justify-around px-2">
        <TabButton active={activeTab === 'home'} icon={<Home size={22} />} label="Home" onClick={() => setActiveTab('home')} />
        <TabButton active={activeTab === 'nav'} icon={<MapIcon size={22} />} label="Nav" onClick={() => setActiveTab('nav')} />
        <TabButton active={activeTab === 'deliveries'} icon={<Package size={22} />} label="Deliveries" onClick={() => setActiveTab('deliveries')} />
        <TabButton active={activeTab === 'alerts'} icon={<Bell size={22} />} label="Alerts" onClick={() => setActiveTab('alerts')} />
        <TabButton active={activeTab === 'profile'} icon={<User size={22} />} label="Profile" onClick={() => setActiveTab('profile')} />
      </div>
    </div>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean, icon: any, label: string, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-16 h-16 rounded-xl transition-all ${active ? 'text-primary' : 'text-muted hover:text-white'}`}
    >
      <div className={`${active ? 'scale-110 mb-1' : 'mb-1'} transition-transform`}>{icon}</div>
      <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}
