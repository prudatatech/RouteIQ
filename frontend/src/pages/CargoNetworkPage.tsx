import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Network, Truck, Shield, Zap, TrendingUp, BarChart3, Clock, Lock, 
  AlertTriangle, MapPin, User, FileCheck, RefreshCw, Play, Check, 
  HelpCircle, Activity, FileText, CloudRain, Loader2, Thermometer,
  ShieldAlert, LockKeyhole, Camera, Landmark, Info
} from 'lucide-react'
import { cargoAPI } from '@/services/api'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function CargoNetworkPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'control-tower' | 'pooling-optimizer' | 'security-pod'>('control-tower')
  
  // Simulation Map State
  const [mapSimulation, setMapSimulation] = useState<'idle' | 'pooling' | 'backhaul' | 'deviation'>('idle')
  const [simulationStep, setSimulationStep] = useState(0)

  // 1. Fetch default scenarios
  const { data: scenarios } = useQuery({
    queryKey: ['cargo-scenarios'],
    queryFn: cargoAPI.scenarios,
  })

  // 2. Fetch live alert feed
  const { data: alerts = [], refetch: refetchAlerts } = useQuery({
    queryKey: ['cargo-alerts'],
    queryFn: cargoAPI.securityAlerts,
    refetchInterval: 5000,
  })

  // 3. Mutation: Resolve simulated alert
  const resolveAlertMutation = useMutation({
    mutationFn: (alertId: string) => cargoAPI.resolveAlert(alertId),
    onSuccess: () => {
      toast.success('Security anomaly marked as resolved')
      queryClient.invalidateQueries({ queryKey: ['cargo-alerts'] })
    }
  })

  // 4. Mutation: Trigger simulated alert
  const triggerAlertMutation = useMutation({
    mutationFn: (payload: { type: string, plate_number: string, message: string }) => 
      cargoAPI.triggerAlert(payload.type, payload.plate_number, payload.message),
    onSuccess: (data) => {
      toast.error(`Control Tower Alert: ${data.alert.message}`)
      queryClient.invalidateQueries({ queryKey: ['cargo-alerts'] })
    }
  })

  // 5. Mutation: Optimize Pooling
  const [poolingResult, setPoolingResult] = useState<any>(null)
  const optimizePoolingMutation = useMutation({
    mutationFn: (demands: any[]) => cargoAPI.optimizePooling(demands),
    onSuccess: (data) => {
      setPoolingResult(data)
      setMapSimulation('pooling')
      setSimulationStep(0)
      toast.success('AI Freight Optimization Complete: 3 loads consolidated!')
    }
  })

  // 6. Mutation: Backhaul Match
  const [backhaulResult, setBackhaulResult] = useState<any>(null)
  const [selectedBackhaulOpp, setSelectedBackhaulOpp] = useState<string>('opp-02')
  const backhaulMatchMutation = useMutation({
    mutationFn: ({ oppId, capacity }: { oppId: string, capacity: number }) => 
      cargoAPI.backhaulMatch(oppId, capacity),
    onSuccess: (data) => {
      setBackhaulResult(data)
      if (data.status === 'accepted') {
        setMapSimulation('backhaul')
        setSimulationStep(0)
        toast.success(`Backhaul matched with ${data.shipper}! Added profit: ₹${data.net_profit_inr}`)
      } else {
        toast.error(`Match Rejected: ${data.reason}`)
      }
    }
  })

  // 7. Proof of Delivery Form State
  const [podTrackingId, setPodTrackingId] = useState('SH-99210')
  const [podOtp, setPodOtp] = useState('')
  const [podPhotoUploaded, setPodPhotoUploaded] = useState(false)
  const [podLat, setPodLat] = useState(24.5854) // Default Udaipur
  const [podLng, setPodLng] = useState(73.7125)
  const [podResult, setPodResult] = useState<any>(null)
  const [podIsUploading, setPodIsUploading] = useState(false)

  const verifyPodMutation = useMutation({
    mutationFn: (payload: any) => cargoAPI.verifyPod(payload),
    onSuccess: (data) => {
      setPodResult(data)
      toast.success('Proof of Delivery verified and sealed!')
    },
    onError: (err: any) => {
      setPodResult(null)
    }
  })

  // 8. Dynamic AI Pricing State
  const [pricingDistance, setPricingDistance] = useState(650)
  const [pricingWeight, setPricingWeight] = useState(6000)
  const [pricingCargoType, setPricingCargoType] = useState('cold_chain')
  const [pricingCongestion, setPricingCongestion] = useState(0.4)
  const [pricingWeather, setPricingWeather] = useState(0.2)
  const [pricingResult, setPricingResult] = useState<any>(null)

  const fetchPricingMutation = useMutation({
    mutationFn: () => cargoAPI.pricingRecommendations({
      distance_km: pricingDistance,
      weight_kg: pricingWeight,
      cargo_type: pricingCargoType,
      congestion_index: pricingCongestion,
      weather_severity: pricingWeather
    }),
    onSuccess: (data) => {
      setPricingResult(data)
    }
  })

  // Run dynamic pricing query initially or when sliders change
  useEffect(() => {
    fetchPricingMutation.mutate()
  }, [pricingDistance, pricingWeight, pricingCargoType, pricingCongestion, pricingWeather])

  // Interactive SVG Map path steps animation loop
  useEffect(() => {
    if (mapSimulation === 'idle') return
    
    const interval = setInterval(() => {
      setSimulationStep(prev => {
        const limit = mapSimulation === 'pooling' ? 3 : mapSimulation === 'backhaul' ? 3 : 2
        if (prev >= limit) return 0 // Loop animation
        return prev + 1
      })
    }, 4000)
    
    return () => clearInterval(interval)
  }, [mapSimulation])

  // Trigger default pooling optimization on load if scenarios exist
  useEffect(() => {
    if (scenarios?.pooling?.demands && !poolingResult) {
      optimizePoolingMutation.mutate(scenarios.pooling.demands)
    }
  }, [scenarios])

  return (
    <div className="space-y-8 pb-16">
      
      {/* Title Header */}
      <div className="relative p-10 rounded-[2.5rem] bg-surface border border-border overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 p-8">
          <Network className="w-28 h-28 text-primary/10 animate-pulse" />
        </div>
        
        <div className="relative z-10">
          <span className="px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[10px] font-black tracking-[0.2em] uppercase border border-primary/20">
            Cargo Collaboration Core
          </span>
          <h1 className="text-5xl font-black text-text font-heading tracking-tighter uppercase mt-4 mb-4">
            AI-Powered Cargo Collaboration <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent-secondary">Network</span>
          </h1>
          <p className="max-w-3xl text-text-muted font-bold text-sm leading-relaxed tracking-tight">
            Uber for dispatching, BlaBlaCar for cargo sharing, and AI for capacity optimization. 
            Maximizing truck utilization, cutting empty backhaul miles, lowering emissions, and securing high-value logistics corridors.
          </p>
        </div>
        
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(var(--accent) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
      </div>

      {/* Tabs Menu */}
      <div className="flex bg-surface p-2 rounded-3xl border border-border gap-2">
        {[
          { id: 'control-tower', label: '1. CONTROL TOWER DASHBOARD', icon: BarChart3 },
          { id: 'pooling-optimizer', label: '2. AI POOLING & BACKHAUL', icon: Zap },
          { id: 'security-pod', label: '3. CARGO SECURITY & POD', icon: Shield },
        ].map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={clsx(
                "flex-1 h-14 rounded-2xl flex items-center justify-center gap-3 text-[11px] font-black tracking-widest transition-all",
                active ? "bg-primary text-slate-950 font-bold shadow-lg shadow-primary/20" : "text-text-muted hover:text-text hover:bg-surface-opaque"
              )}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Grid Layout: Visual Map (Left / Top) & Main tab container (Right / Bottom) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Interactive SVG Map (5 Columns) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="p-6 rounded-[2rem] bg-surface border border-border flex flex-col h-[520px] relative overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between mb-4 z-10">
              <div>
                <h3 className="text-xs font-black uppercase text-text tracking-widest">Route Optimizer Visualizer</h3>
                <p className="text-[10px] text-text-muted font-bold tracking-tight uppercase">Simulated Logistics Corridor Nodes</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={clsx(
                  "px-3 py-1 rounded-full text-[9px] font-mono tracking-widest uppercase text-black font-black",
                  mapSimulation === 'pooling' ? "bg-primary" : 
                  mapSimulation === 'backhaul' ? "bg-accent-secondary" :
                  mapSimulation === 'deviation' ? "bg-red-500 text-text animate-pulse" :
                  "bg-slate-700 text-text-muted"
                )}>
                  Sim: {mapSimulation.toUpperCase()}
                </span>
                {mapSimulation !== 'idle' && (
                  <button 
                    onClick={() => { setMapSimulation('idle'); setSimulationStep(0); }}
                    className="p-1 rounded-lg hover:bg-surface-opaque text-text-muted hover:text-text"
                    title="Stop Simulation"
                  >
                    <RefreshCw size={12} className="animate-spin-slow" />
                  </button>
                )}
              </div>
            </div>

            {/* Interactive SVG Mapping Area */}
            <div className="flex-1 w-full bg-surface2/80 rounded-2xl border border-border relative flex items-center justify-center p-4">
              <svg className="w-full h-full min-h-[350px]" viewBox="0 0 300 400">
                {/* Dotted Connection Grid */}
                <line x1="30" y1="0" x2="30" y2="400" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                <line x1="100" y1="0" x2="100" y2="400" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                <line x1="200" y1="0" x2="200" y2="400" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                <line x1="0" y1="100" x2="300" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                <line x1="0" y1="200" x2="300" y2="200" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                <line x1="0" y1="300" x2="300" y2="300" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />

                {/* Corridor Roads (Background Lines) */}
                {/* Delhi-Mumbai main highway */}
                <path 
                  id="delhi-mumbai-path"
                  d="M 150,40 L 110,100 L 70,270 L 50,310 L 90,360" 
                  fill="none" 
                  stroke="rgba(255, 255, 255, 0.1)" 
                  strokeWidth="3" 
                  strokeDasharray="4 4"
                />

                {/* Rajasthan Pooling Branch */}
                <path 
                  id="rajasthan-pooling-path"
                  d="M 150,40 L 110,100 L 80,130 L 60,220" 
                  fill="none" 
                  stroke="rgba(255, 255, 255, 0.1)" 
                  strokeWidth="3" 
                  strokeDasharray="4 4"
                />

                {/* Deviation Alarm Highway */}
                {mapSimulation === 'deviation' && (
                  <path 
                    d="M 70,270 L 160,285" 
                    fill="none" 
                    stroke="rgba(239, 68, 68, 0.4)" 
                    strokeWidth="3" 
                    className="animate-pulse"
                  />
                )}

                {/* Active Route Highlight Paths */}
                {mapSimulation === 'pooling' && (
                  <path 
                    d="M 150,40 L 110,100 L 80,130 L 60,220" 
                    fill="none" 
                    stroke="var(--accent)" 
                    strokeWidth="3" 
                    strokeDasharray="8 8"
                    className="animate-shimmer"
                  />
                )}
                
                {mapSimulation === 'backhaul' && (
                  <path 
                    d="M 90,360 L 50,310 L 70,270 L 110,100 L 150,40" 
                    fill="none" 
                    stroke="var(--accent-secondary)" 
                    strokeWidth="3" 
                    strokeDasharray="8 8"
                  />
                )}

                {/* City Nodes */}
                {[
                  { id: 'delhi', name: 'Delhi', x: 150, y: 40, desc: 'Central Dispatch Hub' },
                  { id: 'jaipur', name: 'Jaipur', x: 110, y: 100, desc: 'Drop A / Backhaul Node' },
                  { id: 'ajmer', name: 'Ajmer', x: 80, y: 130, desc: 'Drop B Node' },
                  { id: 'udaipur', name: 'Udaipur', x: 60, y: 220, desc: 'Drop C Terminal' },
                  { id: 'vadodara', name: 'Vadodara', x: 70, y: 270, desc: 'Corridor Checkpoint' },
                  { id: 'surat', name: 'Surat', x: 50, y: 310, desc: 'Pharma Hub' },
                  { id: 'mumbai', name: 'Mumbai', x: 90, y: 360, desc: 'Port Depot' },
                ].map(city => {
                  const isAlert = mapSimulation === 'deviation' && city.id === 'vadodara'
                  return (
                    <g key={city.id} className="cursor-pointer group">
                      <circle 
                        cx={city.x} 
                        cy={city.y} 
                        r={isAlert ? "8" : "5"} 
                        className={clsx(
                          "transition-all duration-300",
                          isAlert ? "fill-red-500 stroke-red-200 animate-ping" : "fill-slate-800 stroke-white/40 hover:fill-primary hover:stroke-primary-dark"
                        )}
                        strokeWidth="2"
                      />
                      <circle 
                        cx={city.x} 
                        cy={city.y} 
                        r="4" 
                        className={clsx(
                          isAlert ? "fill-red-500" : "fill-slate-900 group-hover:fill-slate-950"
                        )}
                      />
                      {/* Name tag */}
                      <text 
                        x={city.x + 8} 
                        y={city.y + 4} 
                        fill="rgba(255, 255, 255, 0.7)" 
                        fontSize="8" 
                        fontFamily="monospace"
                        className="font-bold select-none group-hover:fill-white transition-colors"
                      >
                        {city.name}
                      </text>
                    </g>
                  )
                })}

                {/* Animated Truck Asset */}
                {mapSimulation !== 'idle' && (() => {
                  let tx = 150
                  let ty = 40
                  let emoji = '🚛'
                  
                  if (mapSimulation === 'pooling') {
                    // Coordinates: Delhi (150,40) -> Jaipur (110,100) -> Ajmer (80,130) -> Udaipur (60,220)
                    if (simulationStep === 0) { tx = 150; ty = 40; }
                    else if (simulationStep === 1) { tx = 110; ty = 100; emoji = '📦'; }
                    else if (simulationStep === 2) { tx = 80; ty = 130; emoji = '📦'; }
                    else { tx = 60; ty = 220; emoji = '✅'; }
                  } else if (mapSimulation === 'backhaul') {
                    // Return coordinates: Mumbai (90,360) -> Surat (50,310) -> Vadodara (70,270) -> Delhi (150,40)
                    if (simulationStep === 0) { tx = 90; ty = 360; }
                    else if (simulationStep === 1) { tx = 50; ty = 310; emoji = '♻️'; }
                    else if (simulationStep === 2) { tx = 70; ty = 270; emoji = '📦'; }
                    else { tx = 150; ty = 40; emoji = '🏢'; }
                  } else if (mapSimulation === 'deviation') {
                    // Delhi -> Vadodara (70,270) -> Diverges off route (160,285)
                    if (simulationStep === 0) { tx = 110; ty = 100; }
                    else if (simulationStep === 1) { tx = 70; ty = 270; }
                    else { tx = 160; ty = 285; emoji = '🚨'; }
                  }

                  return (
                    <g className="transition-all duration-[2000ms] cubic-bezier(0.4, 0, 0.2, 1)">
                      <circle cx={tx} cy={ty} r="14" fill="rgba(79, 172, 254, 0.15)" stroke="var(--accent)" strokeWidth="1" className="animate-ping" />
                      <text x={tx - 6} y={ty + 5} fontSize="14">{emoji}</text>
                    </g>
                  )
                })()}

                {/* Simulated Geofence Bounds */}
                <circle cx="70" cy="270" r="30" fill="none" stroke="rgba(16, 185, 129, 0.15)" strokeWidth="1" strokeDasharray="3 3" />
                <text x="75" y="255" fill="rgba(16, 185, 129, 0.4)" fontSize="6" fontFamily="monospace">Geo-fence: 30km radius</text>
              </svg>

              {/* Live Overlay Panel */}
              <div className="absolute bottom-4 left-4 right-4 bg-surface/90 border border-border p-3 rounded-xl backdrop-blur-md">
                <div className="flex justify-between text-[8px] font-black text-text-muted tracking-widest uppercase">
                  <span>Simulated Corridor telemetry</span>
                  <span className="text-primary animate-pulse">Live link active</span>
                </div>
                <div className="mt-1.5 flex justify-between items-center text-xs font-bold text-text">
                  <span>Current Vector:</span>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent-secondary">
                    {mapSimulation === 'pooling' ? "Consolidated Delhi ➔ Udaipur manifest" :
                     mapSimulation === 'backhaul' ? "Surat ➔ Delhi Pharma backhaul" :
                     mapSimulation === 'deviation' ? "UNAUTHORIZED OUT-OF-GEOFENCE DEVIATION!" :
                     "Awaiting Route Sim Trigger"}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Visual Guide instructions */}
            <div className="mt-4 flex gap-4 text-[9px] text-text-muted justify-center border-t border-border/40 pt-4">
              <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-primary" /> Delhi-Rajasthan Pooling</div>
              <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-accent-secondary" /> Delhi-Mumbai Corridor</div>
              <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Out of Geofence Deviation</div>
            </div>
          </div>

          {/* Control Tower Real-Time Alert Logs Widget */}
          <div className="p-6 rounded-[2rem] bg-surface border border-border shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-xs font-black uppercase text-text tracking-widest">Cargo Tamper & Security Log</h3>
                <p className="text-[10px] text-text-muted font-bold tracking-tight uppercase">Hardware sensor integrations</p>
              </div>
              <button 
                onClick={() => refetchAlerts()}
                className="p-2 bg-surface2 border border-border rounded-xl text-text-muted hover:text-text transition-colors"
                title="Refresh Sensors"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {alerts.length > 0 ? (
                alerts.map((alert: any) => (
                  <div 
                    key={alert.id} 
                    className={clsx(
                      "p-3.5 rounded-xl border flex items-start gap-3 transition-all cursor-pointer",
                      alert.status === 'active' 
                        ? (alert.severity === 'critical' ? 'bg-red-500/5 border-red-500/20 hover:border-red-500/40' : 'bg-yellow-500/5 border-yellow-500/20 hover:border-yellow-500/40') 
                        : 'bg-surface2/40 border-border opacity-60 hover:opacity-100'
                    )}
                  >
                    <div className={clsx(
                      "p-1.5 rounded-lg text-slate-950 mt-0.5",
                      alert.status === 'active'
                        ? (alert.severity === 'critical' ? 'bg-red-500 text-text' : 'bg-yellow-500')
                        : 'bg-slate-700 text-muted'
                    )}>
                      {alert.type === 'tamper_detected' ? <LockKeyhole size={12} /> : 
                       alert.type === 'geo_fence_breach' ? <ShieldAlert size={12} /> : 
                       <Thermometer size={12} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase text-text tracking-tight">{alert.plate_number}</span>
                        <span className="text-[8px] font-mono text-text-muted">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-[11px] text-text-muted mt-1 leading-snug">{alert.message}</p>
                      
                      <div className="mt-2.5 flex justify-between items-center">
                        <span className="text-[9px] font-bold text-primary">CARGO: {alert.cargo_id}</span>
                        {alert.status === 'active' ? (
                          <button
                            onClick={() => resolveAlertMutation.mutate(alert.id)}
                            className="px-2.5 py-0.5 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 text-[9px] font-black uppercase rounded-md tracking-tighter transition-all border border-emerald-500/20"
                          >
                            Resolve Alert
                          </button>
                        ) : (
                          <span className="text-[8px] font-black uppercase text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">RESOLVED</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-text-muted text-xs uppercase font-mono tracking-widest opacity-40">No cargo monitoring events.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Tab Specific Workspace Panels (7 Columns) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* ================= TAB 1: CONTROL TOWER DASHBOARD ================= */}
          {activeTab === 'control-tower' && (
            <div className="space-y-6">
              
              {/* Fleet-wide optimization KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { title: 'Fill utilization', value: '88.4%', change: '+12%', icon: BarChart3, trend: 'up' },
                  { title: 'Backhaul matches', value: '74.2%', change: '+34%', icon: TrendingUp, trend: 'up' },
                  { title: 'Tamper frequency', value: '0.04%', change: '-90%', icon: Shield, trend: 'down' },
                  { title: 'CO2 reduced', value: '14.2 tons', change: 'Live', icon: Clock, trend: 'up' }
                ].map((kpi, i) => {
                  const Icon = kpi.icon
                  return (
                    <div key={i} className="p-4 rounded-2xl bg-surface border border-border relative overflow-hidden">
                      <div className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-2">{kpi.title}</div>
                      <div className="flex items-baseline justify-between">
                        <div className="text-xl font-black text-text font-heading">{kpi.value}</div>
                        <span className={clsx(
                          "text-[9px] font-black px-1.5 py-0.5 rounded-md",
                          kpi.trend === 'up' ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                        )}>
                          {kpi.change}
                        </span>
                      </div>
                      <div className="absolute right-2 bottom-2 opacity-5">
                        <Icon size={40} className="text-text" />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Real-time Load Matching Grid */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-black text-text uppercase tracking-tight leading-none">Dynamic Matching Engine</h2>
                    <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mt-2">Active Shipper Demands & Capacity Pairs</p>
                  </div>
                  <span className="px-3 py-1 bg-primary/10 border border-primary/20 text-primary text-[9px] font-mono rounded-full tracking-widest uppercase">
                    34 active orders
                  </span>
                </div>

                <div className="space-y-3">
                  {[
                    { shipper: 'Glaxo Pharma', weight: '2,800 kg', route: 'Surat ➔ Delhi', type: 'Cold-Chain (Pharma)', match: 98, status: 'Matching opportunity' },
                    { shipper: 'Jaipur Crafts', weight: '1,200 kg', route: 'Jaipur ➔ Ahmedabad', type: 'General Dry Bulk', match: 89, status: 'Secondary corridor fit' },
                    { shipper: 'Ajmer Textiles', weight: '3,500 kg', route: 'Ajmer ➔ Gurgaon', type: 'Dry Bulk Cargo', match: 92, status: 'Return trip match' },
                    { shipper: 'Indo-Steel Corp', weight: '12,500 kg', route: 'Vadodara ➔ Mumbai', type: 'Heavy Industrial', match: 42, status: 'Volume Limit exceeded' }
                  ].map((item, i) => (
                    <div key={i} className="p-4 rounded-2xl bg-surface2/30 border border-border flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-primary/40 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={clsx(
                          "w-11 h-11 rounded-xl flex items-center justify-center font-bold text-xs shadow-md border",
                          item.match > 90 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                          item.match > 80 ? "bg-primary/10 text-primary border-primary/20" :
                          "bg-red-500/10 text-red-400 border-red-500/20"
                        )}>
                          {item.match}%
                        </div>
                        <div>
                          <div className="text-xs font-black text-text uppercase tracking-tight">{item.shipper}</div>
                          <div className="text-[10px] text-text-muted mt-1 font-mono uppercase">{item.route} · {item.weight} · {item.type}</div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between md:justify-end gap-4">
                        <div className="text-right">
                          <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Engine Status</div>
                          <div className={clsx(
                            "text-[10px] font-bold mt-0.5",
                            item.match > 90 ? "text-emerald-400" : item.match > 80 ? "text-primary" : "text-red-400"
                          )}>
                            {item.status}
                          </div>
                        </div>
                        <button className="px-4 py-2 bg-surface2 hover:bg-surface border border-border text-text text-[10px] font-black uppercase rounded-xl tracking-tight transition-colors">
                          Inspect Match
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Smart Warehouse-to-Truck Coordination */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-black text-text uppercase tracking-tight leading-none">Smart Warehouse Coordination</h2>
                    <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mt-2">Loading Dock Scheduling & Queue Optimization</p>
                  </div>
                  <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full font-mono uppercase tracking-widest">
                    Opt-mode: Active
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { dock: 'Dock Bay 01', truck: 'HR-55A-1102', status: 'Loading', progress: 85, eta: '12m remain' },
                    { dock: 'Dock Bay 02', truck: 'MH-02Q-9908', status: 'Pre-Staging', progress: 40, eta: '28m remain' },
                    { dock: 'Dock Bay 03', truck: 'KA-51N-3421', status: 'Queued (Ready)', progress: 0, eta: 'Auto-Dock' }
                  ].map((bay, i) => (
                    <div key={i} className="p-4 rounded-xl bg-surface2/50 border border-border flex flex-col justify-between">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-xs font-black text-text uppercase">{bay.dock}</span>
                        <span className={clsx(
                          "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider",
                          bay.status === 'Loading' ? "bg-amber-500/10 text-amber-400" :
                          bay.status === 'Pre-Staging' ? "bg-primary/10 text-primary" :
                          "bg-emerald-500/10 text-emerald-400"
                        )}>
                          {bay.status}
                        </span>
                      </div>
                      
                      <div className="text-[10px] font-mono text-text-muted mb-4">
                        Truck Plate: <span className="text-text font-bold">{bay.truck}</span>
                      </div>

                      {bay.progress > 0 && (
                        <div className="space-y-1.5 mb-3">
                          <div className="flex justify-between text-[8px] text-text-muted uppercase">
                            <span>Loading Bar</span>
                            <span>{bay.progress}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden border border-border">
                            <div className="h-full bg-primary" style={{ width: `${bay.progress}%` }} />
                          </div>
                        </div>
                      )}

                      <div className="text-[9px] font-mono text-text-muted border-t border-border/40 pt-2 text-right">
                        Action ETA: <span className="text-text font-bold">{bay.eta}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 2: AI CAPACITY & POOLING SIMULATOR ================= */}
          {activeTab === 'pooling-optimizer' && (
            <div className="space-y-6">
              
              {/* Part A: BlaBlaCar for Cargo - Pooling Simulator */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl relative overflow-hidden">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-2xl font-black text-text uppercase tracking-tight flex items-center gap-2">
                      <Network className="text-primary" /> Cargo Pooling Optimizer
                    </h2>
                    <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mt-2">BlaBlaCar for Freight: Consolidate Less-Than-Truckloads (LTL)</p>
                  </div>
                  <button
                    onClick={() => {
                      if (scenarios?.pooling?.demands) {
                        optimizePoolingMutation.mutate(scenarios.pooling.demands)
                      }
                    }}
                    disabled={optimizePoolingMutation.isPending}
                    className="h-10 px-5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-slate-950 text-[10px] font-black uppercase rounded-xl tracking-widest transition-all flex items-center gap-2"
                  >
                    {optimizePoolingMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />}
                    Consolidate Pools
                  </button>
                </div>

                <p className="text-xs text-text-muted mb-6 leading-relaxed">
                  Instead of dispatching three separate small vehicles to Jaipur, Ajmer, and Udaipur, our AI engine consolidated Company A, B, and C freight loads into a single truck, routing the stops sequentially.
                </p>

                {/* Pre-Pooling Demands List */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {scenarios?.pooling?.demands?.map((dem: any) => (
                    <div key={dem.id} className="p-4 rounded-xl bg-surface2/50 border border-border flex flex-col justify-between">
                      <div>
                        <div className="text-[10px] font-black text-text uppercase tracking-wider truncate">{dem.company}</div>
                        <div className="text-[9px] text-text-muted uppercase font-bold tracking-tight mt-1">{dem.origin} ➔ {dem.destination}</div>
                      </div>
                      <div className="mt-4 flex justify-between items-baseline">
                        <span className="text-lg font-black text-primary font-heading">{dem.weight_tons}t</span>
                        <span className="text-[8px] font-mono text-text-muted uppercase">Urgency: {dem.urgency}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pooling Optimization Results Panel */}
                {poolingResult && (
                  <div className="p-6 rounded-2xl bg-surface2/80 border border-border space-y-6">
                    <div className="flex justify-between items-center border-b border-border/40 pb-4">
                      <span className="text-xs font-black uppercase text-text tracking-widest">Neural Solver Metrics</span>
                      <span className="text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full">
                        Efficiency Gain: {poolingResult.savings_pct}%
                      </span>
                    </div>

                    {/* Compare Dashboard */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 bg-surface2/30 border border-border rounded-xl">
                        <div className="text-[8px] font-black text-text-muted uppercase">Redundant Miles Saved</div>
                        <div className="text-lg font-black text-text font-heading mt-1">-{poolingResult.distance_saved_km} km</div>
                      </div>
                      <div className="p-3 bg-surface2/30 border border-border rounded-xl">
                        <div className="text-[8px] font-black text-text-muted uppercase">Consolidated Cost</div>
                        <div className="text-lg font-black text-primary font-heading mt-1">₹{poolingResult.consolidated_cost_inr.toLocaleString()}</div>
                      </div>
                      <div className="p-3 bg-surface2/30 border border-border rounded-xl">
                        <div className="text-[8px] font-black text-text-muted uppercase">Financial Savings</div>
                        <div className="text-lg font-black text-emerald-400 font-heading mt-1">₹{poolingResult.cost_saved_inr.toLocaleString()}</div>
                      </div>
                      <div className="p-3 bg-surface2/30 border border-border rounded-xl">
                        <div className="text-[8px] font-black text-text-muted uppercase">Carbon Emissions Avoided</div>
                        <div className="text-lg font-black text-emerald-400 font-heading mt-1">~{poolingResult.co2_saved_kg} kg CO2</div>
                      </div>
                    </div>

                    {/* Waypoint Routing Sequence */}
                    <div className="space-y-2">
                      <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Optimized Dispatch Sequence</div>
                      <div className="flex flex-col md:flex-row gap-2">
                        {poolingResult.stops_sequence.map((stop: any, idx: number) => (
                          <div key={idx} className="flex-1 p-3 rounded-lg bg-surface flex flex-col justify-between border border-border/60 relative">
                            <div>
                              <div className="text-[9px] font-bold text-text-muted uppercase">{stop.type}</div>
                              <div className="text-xs font-black text-text uppercase tracking-tight mt-1">{stop.name}</div>
                            </div>
                            <div className="text-[8px] font-mono text-text-muted mt-3">
                              {stop.load_in_kg ? `Load: ${stop.load_in_kg}kg` : `Unload: ${stop.unload_in_kg}kg`}
                            </div>
                            {idx < poolingResult.stops_sequence.length - 1 && (
                              <div className="hidden md:block absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-4 bg-surface-opaque border border-border rounded-full flex items-center justify-center z-20 text-[8px] font-bold text-text-muted">➔</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Shared pricing discounts */}
                    <div className="space-y-2">
                      <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">AI Collaborative Sharing Rates</div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {poolingResult.shared_pricing.map((price: any, idx: number) => (
                          <div key={idx} className="p-3 rounded-xl bg-surface border border-border/80 flex items-center justify-between">
                            <div>
                              <div className="text-[8px] font-black text-text uppercase tracking-wider truncate max-w-[120px]">{price.company}</div>
                              <div className="text-[10px] font-mono text-text-muted mt-1">
                                <span className="line-through">₹{price.original_price}</span> ➔ <span className="text-primary font-bold">₹{price.pooling_price}</span>
                              </div>
                            </div>
                            <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">-{price.savings_pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Part B: Backhaul Matching Simulator */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl relative">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-2xl font-black text-text uppercase tracking-tight flex items-center gap-2">
                      <Truck className="text-accent-secondary" /> Backhaul matching optimizer
                    </h2>
                    <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mt-2">Return-Trip Cargo Space shared-capacity utilization</p>
                  </div>
                  <button
                    onClick={() => {
                      backhaulMatchMutation.mutate({ oppId: selectedBackhaulOpp, capacity: 5000 })
                    }}
                    disabled={backhaulMatchMutation.isPending}
                    className="h-10 px-5 bg-accent-secondary hover:bg-cyan-500 disabled:opacity-50 text-slate-950 text-[10px] font-black uppercase rounded-xl tracking-widest transition-all flex items-center gap-2"
                  >
                    {backhaulMatchMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />}
                    Evaluate Match
                  </button>
                </div>

                <p className="text-xs text-text-muted mb-6 leading-relaxed">
                  A 20-ton truck carrying pharmaceuticals to Mumbai delivers 15 tons and has 5 tons of cold-chain capacity available for the Mumbai-Delhi return trip. Selecting a shipper demand automatically calculates route deviations and net profit.
                </p>

                {/* Backhaul Opportunities Grid Selection */}
                <div className="space-y-3 mb-6">
                  {scenarios?.backhaul?.opportunities?.map((opp: any) => {
                    const isSelected = selectedBackhaulOpp === opp.id
                    return (
                      <div 
                        key={opp.id}
                        onClick={() => setSelectedBackhaulOpp(opp.id)}
                        className={clsx(
                          "p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all",
                          isSelected ? "bg-accent-secondary/5 border-accent-secondary" : "bg-surface2/40 border-border hover:border-border-bright"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={clsx(
                            "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                            isSelected ? "border-accent-secondary" : "border-slate-600"
                          )}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-accent-secondary" />}
                          </div>
                          <div>
                            <div className="text-xs font-black text-text uppercase tracking-tight">{opp.shipper}</div>
                            <div className="text-[10px] text-text-muted mt-1 font-mono uppercase">
                              {opp.origin} ➔ {opp.destination} · {opp.weight_kg} kg · {opp.cargo_type}
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <div className="text-xs font-black text-text">₹{opp.revenue.toLocaleString()}</div>
                          <div className={clsx(
                            "text-[8px] font-black uppercase mt-1",
                            opp.profitability_score > 90 ? "text-emerald-400" :
                            opp.profitability_score > 70 ? "text-yellow-500" :
                            "text-red-500"
                          )}>
                            Match: {opp.profitability_score}%
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Backhaul Result Panel */}
                {backhaulResult && (
                  <div className="p-6 rounded-2xl bg-surface2/80 border border-border space-y-4">
                    {backhaulResult.status === 'accepted' ? (
                      <>
                        <div className="flex justify-between items-center border-b border-border/40 pb-3">
                          <span className="text-xs font-black uppercase text-text tracking-widest">Matched Vector Details</span>
                          <span className="text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full">
                            Profitability Index: {backhaulResult.profitability_score}%
                          </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="p-3 bg-surface2/30 border border-border rounded-xl">
                            <div className="text-[8px] font-black text-text-muted uppercase">Gross Revenue</div>
                            <div className="text-lg font-black text-text font-heading mt-1">₹{backhaulResult.revenue_gained_inr.toLocaleString()}</div>
                          </div>
                          <div className="p-3 bg-surface2/30 border border-border rounded-xl">
                            <div className="text-[8px] font-black text-text-muted uppercase">Corridor Deviation</div>
                            <div className="text-lg font-black text-primary font-heading mt-1">+{backhaulResult.added_distance_km} km</div>
                          </div>
                          <div className="p-3 bg-surface2/30 border border-border rounded-xl">
                            <div className="text-[8px] font-black text-text-muted uppercase">Estimated Fuel Cost</div>
                            <div className="text-lg font-black text-red-400 font-heading mt-1">₹{backhaulResult.fuel_cost_inr.toLocaleString()}</div>
                          </div>
                          <div className="p-3 bg-surface2/30 border border-border rounded-xl">
                            <div className="text-[8px] font-black text-text-muted uppercase">Net Backhaul Profit</div>
                            <div className="text-lg font-black text-emerald-400 font-heading mt-1">+₹{backhaulResult.net_profit_inr.toLocaleString()}</div>
                          </div>
                        </div>

                        <div className="space-y-1.5 pt-2">
                          <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Return Waypoints</div>
                          <div className="flex flex-col gap-1.5">
                            {backhaulResult.new_route_waypoints.map((point: string, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-text">
                                <span className="text-[9px] font-mono text-primary font-black bg-primary/10 px-2 py-0.5 rounded border border-primary/20">{i+1}</span>
                                <span className="font-bold">{point}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
                        <AlertTriangle className="text-red-500 shrink-0" />
                        <div>
                          <div className="text-xs font-black text-text uppercase">Match Request Denied</div>
                          <p className="text-[10px] text-text-muted mt-0.5">{backhaulResult.reason}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= TAB 3: CARGO SECURITY & POD SIMULATOR ================= */}
          {activeTab === 'security-pod' && (
            <div className="space-y-6">
              
              {/* Dynamic Freight Pricing Slider Panel */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-black text-text uppercase tracking-tight leading-none">AI Dynamic Freight Pricing</h2>
                    <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mt-2">Real-time quote optimization based on external variables</p>
                  </div>
                  <span className="p-2 bg-primary/10 border border-primary/20 text-primary rounded-xl text-xs font-bold font-mono">
                    ₹/ton-km solver
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
                  {/* Sliders */}
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-xs font-bold text-text mb-2">
                        <span>Corridor Distance</span>
                        <span className="text-primary font-mono">{pricingDistance} km</span>
                      </div>
                      <input 
                        type="range" min={100} max={1500} step={50} value={pricingDistance}
                        onChange={e => setPricingDistance(+e.target.value)}
                        className="w-full accent-primary"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-bold text-text mb-2">
                        <span>Cargo Load Weight</span>
                        <span className="text-primary font-mono">{(pricingWeight / 1000).toFixed(1)} tons</span>
                      </div>
                      <input 
                        type="range" min={1000} max={18000} step={500} value={pricingWeight}
                        onChange={e => setPricingWeight(+e.target.value)}
                        className="w-full accent-primary"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Cargo Category</label>
                        <select 
                          value={pricingCargoType}
                          onChange={e => setPricingCargoType(e.target.value)}
                          className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-bold text-text focus:outline-none focus:border-primary"
                        >
                          <option value="general">General Cargo</option>
                          <option value="cold_chain">Cold-Chain (Pharma)</option>
                          <option value="hazardous">Hazardous Chemicals</option>
                          <option value="dry_bulk">Dry Bulk Materials</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Congestion Factor</label>
                        <select 
                          value={pricingCongestion}
                          onChange={e => setPricingCongestion(+e.target.value)}
                          className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-bold text-text focus:outline-none focus:border-primary"
                        >
                          <option value="0.1">Clear Corridors (10%)</option>
                          <option value="0.4">Moderate Surcharges (40%)</option>
                          <option value="0.8">Heavy Traffic Delay (80%)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Recommendations */}
                  <div className="p-5 rounded-2xl bg-surface2/80 border border-border flex flex-col justify-between">
                    {pricingResult ? (
                      <>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center text-xs text-text-muted">
                            <span>Base Haulage Price</span>
                            <span className="text-text font-mono">₹{pricingResult.base_charge_inr.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs text-text-muted">
                            <span>Surcharges (Traffic/Weather)</span>
                            <span className="text-text font-mono">₹{(pricingResult.congestion_surcharge_inr + pricingResult.weather_surcharge_inr).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs text-text-muted border-b border-border/40 pb-2">
                            <span>Pharma/Safety Multiplier</span>
                            <span className="text-primary font-mono">x{pricingResult.cargo_type_multiplier}</span>
                          </div>
                          
                          <div className="pt-2 flex justify-between items-baseline">
                            <span className="text-xs font-black text-text uppercase">AI recommended rate</span>
                            <span className="text-2xl font-black text-primary font-heading">₹{pricingResult.recommended_freight_rate_inr.toLocaleString()}</span>
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-border/60 flex items-center gap-2 bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/10">
                          <TrendingUp className="text-emerald-400 w-8 h-8 shrink-0" />
                          <div>
                            <div className="text-[10px] font-black text-emerald-400 uppercase">Collaborative Pooling discount</div>
                            <div className="text-xs font-bold text-text font-mono">₹{pricingResult.collaborative_sharing_rate_inr.toLocaleString()} (-₹{pricingResult.estimated_savings_inr.toLocaleString()})</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                    )}
                  </div>
                </div>
              </div>

              {/* Geo-fencing, Deviations, and Tamper Control Simulator */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl relative">
                <h2 className="text-xl font-black text-text uppercase tracking-tight leading-none mb-2">Simulate Hardware Alarms</h2>
                <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mb-6">Operator intervention portal: trigger anomalies to inspect agent response</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => {
                      triggerAlertMutation.mutate({
                        type: 'tamper_detected',
                        plate_number: 'MH-12Q-4491',
                        message: 'Intrusion Alert: Lock seal breached at coordinate (19.0760, 72.8777).'
                      })
                      setMapSimulation('deviation')
                    }}
                    disabled={triggerAlertMutation.isPending}
                    className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-2xl font-black text-[11px] tracking-widest uppercase transition-all flex items-center justify-center gap-3"
                  >
                    <LockKeyhole size={16} />
                    Trigger Lock Tamper Alarm
                  </button>

                  <button
                    onClick={() => {
                      triggerAlertMutation.mutate({
                        type: 'geo_fence_breach',
                        plate_number: 'HR-55B-9022',
                        message: 'Geo-fence deviation detected: Truck shifted off highway corridor NH-48 near Vadodara.'
                      })
                      setMapSimulation('deviation')
                    }}
                    disabled={triggerAlertMutation.isPending}
                    className="p-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 hover:bg-yellow-500/20 rounded-2xl font-black text-[11px] tracking-widest uppercase transition-all flex items-center justify-center gap-3"
                  >
                    <ShieldAlert size={16} />
                    Trigger Geo-Fence Deviation
                  </button>
                </div>
              </div>

              {/* Digital Proof of Delivery Simulator Form */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl relative">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-black text-text uppercase tracking-tight leading-none">Digital Proof of Delivery (POD)</h2>
                    <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mt-2">Driver Terminal App Viewport</p>
                  </div>
                  <span className="text-[9px] text-primary bg-primary/10 px-3 py-1 rounded-full font-mono uppercase tracking-widest">
                    Blockchain Seal
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Left POD Form Inputs */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Shipment Cargo ID</label>
                        <input 
                          type="text" value={podTrackingId} onChange={e => setPodTrackingId(e.target.value)}
                          className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-bold text-text focus:outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Recipient Verification OTP</label>
                        <input 
                          type="text" placeholder="e.g. 2026 or 1234" value={podOtp} onChange={e => setPodOtp(e.target.value)}
                          className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-mono font-bold text-text focus:outline-none focus:border-primary"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Geo-Tag Latitude</label>
                        <input 
                          type="number" step="0.0001" value={podLat} onChange={e => setPodLat(+e.target.value)}
                          className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-mono font-bold text-text focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Geo-Tag Longitude</label>
                        <input 
                          type="number" step="0.0001" value={podLng} onChange={e => setPodLng(+e.target.value)}
                          className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-mono font-bold text-text focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Camera / Photo upload mock trigger */}
                    <div className="flex gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          setPodIsUploading(true)
                          setTimeout(() => {
                            setPodPhotoUploaded(true)
                            setPodIsUploading(false)
                            toast.success('Cargo offload photo verified (Image SHA-256 sealed)')
                          }, 1500)
                        }}
                        className={clsx(
                          "flex-1 h-12 rounded-xl text-xs font-black uppercase tracking-widest border transition-all flex items-center justify-center gap-2",
                          podPhotoUploaded ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-surface2 hover:bg-surface border-border text-text"
                        )}
                      >
                        {podIsUploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                        {podPhotoUploaded ? "Photo Uploaded & Tagged" : "Capture Delivery Photo"}
                      </button>
                      
                      <button
                        type="button"
                        onClick={() => {
                          setPodLat(24.5854)
                          setPodLng(73.7125)
                          toast.success('GPS Geo-tags synchronized with recipient terminal')
                        }}
                        className="px-4 h-12 bg-surface2 hover:bg-surface border border-border text-text-muted hover:text-text rounded-xl text-xs font-black uppercase tracking-wide transition-colors"
                      >
                        Sync GPS
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        verifyPodMutation.mutate({
                          tracking_id: podTrackingId,
                          otp: podOtp,
                          latitude: podLat,
                          longitude: podLng,
                          photo_uploaded: podPhotoUploaded,
                          recipient_name: 'K. R. Sharma (Udaipur Terminal Manager)'
                        })
                      }}
                      disabled={verifyPodMutation.isPending || !podOtp}
                      className="w-full h-12 bg-primary hover:bg-primary-dark disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      {verifyPodMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileCheck size={14} />}
                      Verify & Seal Delivery
                    </button>
                  </div>

                  {/* Right POD Receipt Panel */}
                  <div className="p-6 rounded-2xl bg-surface2/80 border border-border flex flex-col justify-center">
                    {podResult ? (
                      <div className="space-y-4 text-center py-4">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
                          <Check size={24} />
                        </div>
                        <h4 className="text-sm font-black text-emerald-400 uppercase tracking-wider">Proof of Delivery Sealed</h4>
                        
                        <div className="text-left bg-surface/50 p-4 rounded-xl border border-border/80 space-y-2 text-xs font-mono">
                          <div className="flex justify-between"><span className="text-text-muted">STATUS</span><span className="text-text font-bold">{podResult.status.toUpperCase()}</span></div>
                          <div className="flex justify-between"><span className="text-text-muted">RECIPIENT</span><span className="text-text font-bold truncate max-w-[150px]">{podResult.recipient_name}</span></div>
                          <div className="flex justify-between"><span className="text-text-muted">GPS OFFSET</span><span className="text-emerald-400 font-bold">{podResult.gps_match_offset_meters}m ({podResult.gps_status.split(' ')[0]})</span></div>
                          <div className="pt-2 border-t border-border/40 flex flex-col gap-1">
                            <span className="text-text-muted block text-[8px] uppercase">Ledger Receipt Hash</span>
                            <span className="text-muted break-all text-[8px] font-mono select-all leading-tight">{podResult.blockchain_receipt}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-text-muted space-y-3">
                        <FileText size={40} className="mx-auto opacity-30" />
                        <p className="text-xs uppercase font-mono tracking-widest">Awaiting dispatch verification details</p>
                        <p className="text-[10px] leading-relaxed max-w-xs mx-auto">Recipient OTP must be set to "2026" or "1234" to simulate a valid secure delivery transaction.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
      
      {/* Custom slow spin keyframe style helper */}
      <style>{`
        @keyframes spinSlow {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spinSlow 8s linear infinite;
        }
      `}</style>
    </div>
  )
}
