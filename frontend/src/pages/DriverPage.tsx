import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Home, Map as MapIcon, Package, Bell, User, Phone, Navigation, Play, Pause, 
  CheckCircle2, AlertTriangle, CloudRain, ShieldAlert, FileSignature, Loader2, Zap
} from 'lucide-react';
import { routesAPI, shipmentsAPI, telemetryAPI } from '@/services/api';
import DriverMap from '@/components/map/DriverMap';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

function SignaturePad({ onSave }: { onSave: (data: string) => void }) {
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = 'var(--primary)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
  }, []);

  const getPos = (e: any) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX || e.touches?.[0]?.clientX) - rect.left,
      y: (e.clientY || e.touches?.[0]?.clientY) - rect.top
    };
  };

  const startDrawing = (e: any) => {
    setIsDrawing(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: any) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
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
          onMouseUp={() => setIsDrawing(false)}
          onMouseLeave={() => setIsDrawing(false)}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={() => setIsDrawing(false)}
          ref={canvasRef}
          width={400}
          height={200}
          className="w-full h-full cursor-crosshair relative z-10"
        />
      </div>
      <button 
        onClick={() => onSave('SIG_' + Math.random().toString(16).slice(2, 10))}
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
  const [isSimulating, setIsSimulating] = useState(false);
  const [aiAlertVisible, setAiAlertVisible] = useState(false);
  const [liveLocation, setLiveLocation] = useState({ lat: 28.55, lng: 77.20 });

  // POD State
  const [recipientName, setRecipientName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['driver-routes', userId],
    queryFn: () => routesAPI.list({ status: 'active' }),
    refetchInterval: 30_000,
  });

  const activeRoute = routes[0];
  const stops = activeRoute?.stops || [];
  const currentStop = stops.find((s: any) => s.status === 'pending');

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

  // GPS Simulation
  useEffect(() => {
    if (shiftStatus === 'OFFLINE' || !activeRoute) return;

    let simInterval: any;
    if (isSimulating && currentStop) {
      let currentLat = activeRoute.vehicle?.latitude || 28.55;
      let currentLng = activeRoute.vehicle?.longitude || 77.20;
      const targetLat = currentStop.delivery_point?.lat || 28.61;
      const targetLng = currentStop.delivery_point?.lng || 77.23;
      
      const steps = 60;
      const latStep = (targetLat - currentLat) / steps;
      const lngStep = (targetLng - currentLng) / steps;
      
      toast.success('GPS Simulator Started');

      simInterval = setInterval(() => {
        currentLat += latStep;
        currentLng += lngStep;
        
        telemetryAPI.ingest({
          vehicle_id: activeRoute.vehicle_id,
          latitude: currentLat,
          longitude: currentLng,
          speed_kmph: 48,
          fuel_level_pct: 84,
          heading: 0
        }).catch(console.error);
        
        setLiveLocation({ lat: currentLat, lng: currentLng });
        
        // Randomly trigger AI Alert
        if (Math.random() > 0.98 && !aiAlertVisible) {
          setAiAlertVisible(true);
        }

      }, 2000);
    }
    return () => clearInterval(simInterval);
  }, [shiftStatus, activeRoute, isSimulating, currentStop?.id, aiAlertVisible]);

  const finalizeDelivery = () => {
    if (!recipientName || !signature) return toast.error('Check signature fields');
    if (!currentStop) return toast.error('No active stop');
    updateStatus.mutate({
      shipmentId: currentStop.delivery_point.shipment_id,
      status: 'delivered',
      params: { received_by: recipientName, signature_data: signature }
    });
  };

  const renderHome = () => (
    <div className="space-y-4 pb-24">
      {/* Driver Header */}
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
        <h2 className="text-xs font-bold text-muted uppercase tracking-widest">RouteIQ Driver</h2>
        <h1 className="text-xl font-black uppercase mt-1">Welcome, Driver</h1>
        <div className="mt-4 flex justify-between items-center text-sm">
           <div>
              <p className="text-muted">Truck: <span className="font-bold text-text">{activeRoute?.vehicle?.plate_number || 'HR38AC1276'}</span></p>
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
               <p className="text-sm font-bold">Delhi Hub</p>
               <div className="h-6" />
               <div className="absolute -left-[5px] bottom-1 w-2 h-2 rounded-full bg-primary" />
               <p className="text-sm font-bold">{currentStop?.delivery_point?.name || 'Destination'}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
               <div>
                 <p className="text-[10px] text-muted uppercase tracking-widest">ETA</p>
                 <p className="font-black text-lg">4h 15m</p>
               </div>
               <div>
                 <p className="text-[10px] text-muted uppercase tracking-widest">Distance</p>
                 <p className="font-black text-lg">245 km</p>
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
             <p className="font-black text-lg">{shiftStatus === 'ON_MISSION' ? '48' : '0'} km/h</p>
           </div>
           <div>
             <p className="text-xs text-muted mb-1">GPS</p>
             <p className="font-bold text-success flex items-center gap-1"><CheckCircle2 size={14}/> Connected</p>
           </div>
           <div>
             <p className="text-xs text-muted mb-1">Battery</p>
             <p className="font-bold">84%</p>
           </div>
           <div>
             <p className="text-xs text-muted mb-1">Last Update</p>
             <p className="font-bold">5 sec ago</p>
           </div>
        </div>
      </div>

      {/* Cargo Details */}
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
        <h2 className="text-[10px] font-black text-muted uppercase tracking-widest mb-4">Cargo Details</h2>
        <div className="space-y-2 text-sm">
           <div className="flex justify-between"><span className="text-muted">Shipment</span><span className="font-bold uppercase">SHP-001</span></div>
           <div className="flex justify-between"><span className="text-muted">Weight</span><span className="font-bold">10 Tons</span></div>
           <div className="flex justify-between"><span className="text-muted">Type</span><span className="font-bold">Electronics</span></div>
           <div className="flex justify-between"><span className="text-muted">Delivery Slots</span><span className="font-bold">3</span></div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
        <h2 className="text-[10px] font-black text-muted uppercase tracking-widest mb-4">Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={() => {
              if (shiftStatus === 'OFFLINE') { setShiftStatus('ON_DUTY'); toast.success('Online'); }
              else { setShiftStatus('ON_MISSION'); toast.success('Trip Started'); setIsSimulating(true); }
            }}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-success/10 text-success font-black text-[10px] uppercase tracking-widest hover:bg-success/20 transition-all"
          >
            <Play size={20} className="mb-2" /> Start Trip
          </button>
          <button 
            onClick={() => { setShiftStatus('ON_DUTY'); setIsSimulating(false); toast('Trip Paused'); }}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-yellow-500/10 text-yellow-500 font-black text-[10px] uppercase tracking-widest hover:bg-yellow-500/20 transition-all"
          >
            <Pause size={20} className="mb-2" /> Pause Trip
          </button>
          <button 
            onClick={() => toast.success('Delay reported to Control Tower')}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-orange-500/10 text-orange-500 font-black text-[10px] uppercase tracking-widest hover:bg-orange-500/20 transition-all"
          >
            <AlertTriangle size={20} className="mb-2" /> Report Delay
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

  const renderNav = () => (
    <DriverMap 
      currentLat={liveLocation.lat} 
      currentLng={liveLocation.lng} 
      targetLat={currentStop?.delivery_point?.lat || 28.61} 
      targetLng={currentStop?.delivery_point?.lng || 77.23} 
      shiftStatus={shiftStatus} 
      speed={shiftStatus === 'ON_MISSION' ? 48 : 0} 
    />
  );

  const renderDeliveries = () => (
    <div className="space-y-6 pb-24">
       {currentStop ? (
         <div className="bg-surface p-6 rounded-2xl border border-border shadow-md">
           <h2 className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-4">Delivery Stop #2</h2>
           <div className="space-y-3 mb-6">
              <div><p className="text-xs text-muted uppercase">Customer</p><p className="font-bold text-lg">ABC Pvt Ltd</p></div>
              <div><p className="text-xs text-muted uppercase">Contact</p><p className="font-bold text-lg text-primary">98xxxxxx12</p></div>
              <div><p className="text-xs text-muted uppercase">Address</p><p className="font-bold">{currentStop.delivery_point?.address || 'Jaipur Hub'}</p></div>
           </div>
           
           <div className="grid grid-cols-2 gap-3 mb-6">
              <button className="h-12 bg-surface2 rounded-xl flex items-center justify-center gap-2 text-xs font-bold uppercase"><Phone size={14}/> Call Customer</button>
              <button onClick={() => setActiveTab('nav')} className="h-12 bg-primary/20 text-primary rounded-xl flex items-center justify-center gap-2 text-xs font-bold uppercase"><MapIcon size={14}/> Navigate</button>
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
                <SignaturePad onSave={setSignature} />
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
        <h2 className="text-[10px] font-black text-error uppercase tracking-widest mb-4 flex items-center gap-2"><ShieldAlert size={14}/> Alert Center</h2>
        <p className="text-sm text-text mb-6">Report critical emergencies immediately. This notifies the Control Tower and initiates emergency protocols.</p>
        
        <div className="space-y-3">
          <button onClick={() => toast.success('SOS Sent')} className="w-full p-4 bg-surface2 rounded-xl flex items-center gap-3 font-bold hover:bg-error/20 hover:text-error transition-all"><AlertTriangle size={18}/> Vehicle Breakdown</button>
          <button onClick={() => toast.success('SOS Sent')} className="w-full p-4 bg-surface2 rounded-xl flex items-center gap-3 font-bold hover:bg-error/20 hover:text-error transition-all"><AlertTriangle size={18}/> Accident</button>
          <button onClick={() => toast.success('SOS Sent')} className="w-full p-4 bg-surface2 rounded-xl flex items-center gap-3 font-bold hover:bg-error/20 hover:text-error transition-all"><AlertTriangle size={18}/> Route Blocked</button>
          <button onClick={() => toast.success('SOS Sent')} className="w-full p-4 bg-surface2 rounded-xl flex items-center gap-3 font-bold hover:bg-error/20 hover:text-error transition-all"><AlertTriangle size={18}/> Medical Emergency</button>
        </div>

        <button onClick={() => toast.error('Initiating general SOS')} className="w-full mt-6 h-14 bg-error text-white font-black uppercase text-sm rounded-xl shadow-xl shadow-error/20 active:scale-95 transition-transform">
           Send SOS
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
            <h2 className="font-black text-xl">Rahul Kumar</h2>
            <p className="text-muted text-sm uppercase">Driver ID: D-8492</p>
         </div>
      </div>
      
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-md space-y-4">
         <h3 className="text-[10px] font-black text-muted uppercase tracking-widest">Shift Controls</h3>
         <button 
           onClick={() => { setShiftStatus('OFFLINE'); setIsSimulating(false); toast.success('Shift Ended') }}
           className="w-full h-14 bg-error/10 text-error font-black uppercase text-xs rounded-xl shadow-md active:scale-95 transition-transform"
         >
            End Shift & Logout
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

      {/* AI Suggestion Overlay (Simulated) */}
      {aiAlertVisible && (
         <div className="absolute inset-x-4 bottom-24 p-6 bg-primary/10 border-2 border-primary rounded-2xl backdrop-blur-xl shadow-[0_0_40px_rgba(79,172,254,0.3)] z-50 animate-in slide-in-from-bottom">
            <div className="flex items-center gap-3 mb-4">
               <Zap className="text-primary animate-pulse" />
               <h3 className="font-black text-primary uppercase tracking-widest text-sm">Nexus AI</h3>
            </div>
            <p className="font-bold text-white leading-tight mb-2">Heavy traffic ahead. Alternative route available.</p>
            <p className="text-xs text-primary font-bold uppercase tracking-widest mb-6">Time Saved: 32 mins</p>
            
            <div className="flex gap-3">
               <button onClick={() => setAiAlertVisible(false)} className="flex-1 h-12 bg-primary text-bg font-black uppercase text-xs rounded-xl">Accept Route</button>
               <button onClick={() => setAiAlertVisible(false)} className="flex-1 h-12 bg-surface2 font-black uppercase text-xs rounded-xl">Ignore</button>
            </div>
         </div>
      )}

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
