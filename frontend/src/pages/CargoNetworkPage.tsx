import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Network, Truck, Shield, Zap, TrendingUp, BarChart3,
  AlertTriangle, FileCheck, RefreshCw, Play, Check,
  FileText, Loader2, Thermometer,
  ShieldAlert, LockKeyhole
} from 'lucide-react'
import { cargoAPI, vehiclesAPI } from '@/services/api'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import LiveMap from '@/components/map/LiveMap'
import { useAuthStore } from '@/store/authStore'

interface CargoVehicle {
  id: string
  plate_number: string
  latitude?: number | null
  longitude?: number | null
  status: string
  vehicle_type?: string
  cargo_types?: string[]
}

export default function CargoNetworkPage() {
  const queryClient = useQueryClient()
  const role = useAuthStore(s => s.role)
  const [activeTab, setActiveTab] = useState<'control-tower' | 'pooling-optimizer' | 'security-pod'>('control-tower')
  
  // Simulation Map State
  const [mapSimulation, setMapSimulation] = useState<'idle' | 'pooling' | 'backhaul' | 'deviation'>('idle')
  const [simulationStep, setSimulationStep] = useState(0)

  // 1. Fetch default scenarios
  const { data: scenarios } = useQuery({
    queryKey: ['cargo-scenarios'],
    queryFn: cargoAPI.scenarios,
  })

  // Fetch live vehicles for the map
  const { data: vehiclesData = [] } = useQuery<CargoVehicle[]>({
    queryKey: ['live-vehicles'],
    queryFn: vehiclesAPI.list,
    refetchInterval: 10000,
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

  // 4. Mutation: Trigger a manual security alert against a real vehicle
  const [alertVehicleId, setAlertVehicleId] = useState('')
  useEffect(() => {
    if (vehiclesData.length > 0 && !alertVehicleId) {
      setAlertVehicleId(vehiclesData[0].id)
    }
  }, [vehiclesData])
  const triggerAlertMutation = useMutation({
    mutationFn: (payload: { type: string, vehicle_id: string, message: string }) =>
      cargoAPI.triggerAlert(payload.type, payload.vehicle_id, payload.message),
    onSuccess: (data) => {
      toast.error(`Control Tower Alert: ${data.alert.message}`)
      queryClient.invalidateQueries({ queryKey: ['cargo-alerts'] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Failed to trigger alert')
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
  const [selectedBackhaulOpp, setSelectedBackhaulOpp] = useState<string>('')
  
  // Update default selected backhaul opportunity when scenarios load
  useEffect(() => {
    if (scenarios?.backhaul?.opportunities?.length > 0 && !selectedBackhaulOpp) {
      setSelectedBackhaulOpp(scenarios.backhaul.opportunities[0].id)
    }
  }, [scenarios])
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

  // 7. Delivery confirmation (staff)
  const [podTrackingId, setPodTrackingId] = useState('')
  const [podRecipient, setPodRecipient] = useState('')
  const [podResult, setPodResult] = useState<any>(null)

  const verifyPodMutation = useMutation({
    mutationFn: (payload: { tracking_id: string, recipient_name: string }) => cargoAPI.verifyPod(payload),
    onSuccess: (data) => {
      setPodResult(data)
      toast.success('Delivery confirmed')
    },
    onError: (err: any) => {
      setPodResult(null)
      toast.error(err.response?.data?.detail || 'Failed to confirm delivery')
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

            {/* Interactive Live Map Area */}
            <div className="flex-1 w-full bg-surface2/80 rounded-2xl border border-border relative flex items-center justify-center p-0 overflow-hidden min-h-[350px]">
              <LiveMap 
                vehicles={vehiclesData || []} 
              />
              
              {/* Live Overlay Panel */}
              <div className="absolute bottom-4 left-4 right-4 bg-surface/90 border border-border p-3 rounded-xl backdrop-blur-md">
                <div className="flex justify-between text-[8px] font-black text-text-muted tracking-widest uppercase">
                  <span>Live Tracking Telemetry</span>
                  <span className="text-primary animate-pulse">Live link active</span>
                </div>
                <div className="mt-1.5 flex justify-between items-center text-xs font-bold text-text">
                  <span>Active Network:</span>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent-secondary">
                    {vehiclesData.length} Live Assets Connected
                  </span>
                </div>
              </div>
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
                      
                      <div className="mt-2.5 flex justify-end items-center">
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
              
              {/* Live fleet & cargo-security KPIs — computed from real, already-fetched data */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { title: 'Live vehicles', value: String(vehiclesData.length), icon: Truck },
                  { title: 'Active security alerts', value: String(alerts.length), icon: Shield },
                  { title: 'Critical alerts', value: String(alerts.filter((a: any) => a.severity === 'critical').length), icon: AlertTriangle },
                  { title: 'Pooling demands (live)', value: String(scenarios?.pooling?.demands?.length || 0), icon: Network }
                ].map((kpi, i) => {
                  const Icon = kpi.icon
                  return (
                    <div key={i} className="p-4 rounded-2xl bg-surface border border-border relative overflow-hidden">
                      <div className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-2">{kpi.title}</div>
                      <div className="text-xl font-black text-text font-heading">{kpi.value}</div>
                      <div className="absolute right-2 bottom-2 opacity-5">
                        <Icon size={40} className="text-text" />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Real-time backhaul opportunities, sourced from live shipment data */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-black text-text uppercase tracking-tight leading-none">Live Backhaul Opportunities</h2>
                    <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mt-2">Pending shipments eligible for return-trip matching</p>
                  </div>
                  <span className="px-3 py-1 bg-primary/10 border border-primary/20 text-primary text-[9px] font-mono rounded-full tracking-widest uppercase">
                    {scenarios?.backhaul?.opportunities?.length || 0} open
                  </span>
                </div>

                {scenarios?.backhaul?.opportunities?.length ? (
                  <div className="space-y-3">
                    {scenarios.backhaul.opportunities.map((item: any) => (
                      <div key={item.id} className="p-4 rounded-2xl bg-surface2/30 border border-border flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-primary/40 transition-colors">
                        <div>
                          <div className="text-xs font-black text-text uppercase tracking-tight">{item.shipper}</div>
                          <div className="text-[10px] text-text-muted mt-1 font-mono uppercase">{item.origin} ➔ {item.destination} · {item.weight_kg} kg · {item.cargo_type}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Est. Revenue</div>
                          <div className="text-xs font-bold text-primary">₹{item.revenue?.toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-text-muted text-xs uppercase font-mono tracking-widest opacity-40">No pending shipments available for backhaul matching.</div>
                )}
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
                          <div className="text-[8px] font-black uppercase mt-1 text-text-muted">
                            {opp.weight_kg} kg
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
                            Net Profit: ₹{backhaulResult.net_profit_inr?.toLocaleString()}
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

              {/* Manual security alert — a real operator action against a real vehicle */}
              {(role === 'admin' || role === 'superadmin') && (
                <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl relative">
                  <h2 className="text-xl font-black text-text uppercase tracking-tight leading-none mb-2">Raise Manual Security Alert</h2>
                  <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mb-6">Operator intervention: log a tamper or geo-fence anomaly against a live vehicle</p>

                  {vehiclesData.length === 0 ? (
                    <div className="py-6 text-center text-text-muted text-xs uppercase font-mono tracking-widest opacity-40">No live vehicles available</div>
                  ) : (
                    <>
                      <div className="mb-4">
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Vehicle</label>
                        <select
                          value={alertVehicleId}
                          onChange={e => setAlertVehicleId(e.target.value)}
                          className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-bold text-text focus:outline-none focus:border-primary"
                        >
                          {vehiclesData.map((v: CargoVehicle) => (
                            <option key={v.id} value={v.id}>{v.plate_number}</option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                          onClick={() => {
                            triggerAlertMutation.mutate({
                              type: 'tamper_detected',
                              vehicle_id: alertVehicleId,
                              message: 'Lock tamper alarm raised by operator.'
                            })
                          }}
                          disabled={triggerAlertMutation.isPending || !alertVehicleId}
                          className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-50 rounded-2xl font-black text-[11px] tracking-widest uppercase transition-all flex items-center justify-center gap-3"
                        >
                          <LockKeyhole size={16} />
                          Log Lock Tamper Alert
                        </button>

                        <button
                          onClick={() => {
                            triggerAlertMutation.mutate({
                              type: 'geo_fence_breach',
                              vehicle_id: alertVehicleId,
                              message: 'Geo-fence breach raised by operator.'
                            })
                          }}
                          disabled={triggerAlertMutation.isPending || !alertVehicleId}
                          className="p-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 hover:bg-yellow-500/20 disabled:opacity-50 rounded-2xl font-black text-[11px] tracking-widest uppercase transition-all flex items-center justify-center gap-3"
                        >
                          <ShieldAlert size={16} />
                          Log Geo-Fence Alert
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Delivery confirmation */}
              <div className="p-8 rounded-[2.5rem] bg-surface border border-border shadow-2xl relative">
                <div className="mb-6">
                  <h2 className="text-xl font-black text-text uppercase tracking-tight leading-none">Confirm Delivery</h2>
                  <p className="text-[10px] text-text-muted font-bold tracking-[0.2em] uppercase mt-2">Mark a shipment delivered and record who received it</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Tracking ID</label>
                      <input
                        type="text" value={podTrackingId} onChange={e => setPodTrackingId(e.target.value)}
                        placeholder="e.g. RTX-1A2B3C4D"
                        className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-bold text-text focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Received By</label>
                      <input
                        type="text" value={podRecipient} onChange={e => setPodRecipient(e.target.value)}
                        placeholder="Recipient's full name"
                        className="w-full h-11 bg-surface2 border border-border rounded-xl px-3 text-xs font-bold text-text focus:outline-none focus:border-primary"
                      />
                    </div>

                    <button
                      onClick={() => verifyPodMutation.mutate({ tracking_id: podTrackingId.trim(), recipient_name: podRecipient.trim() })}
                      disabled={verifyPodMutation.isPending || !podTrackingId.trim() || !podRecipient.trim()}
                      className="w-full h-12 bg-primary hover:bg-primary-dark disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      {verifyPodMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileCheck size={14} />}
                      Confirm Delivery
                    </button>
                  </div>

                  <div className="p-6 rounded-2xl bg-surface2/80 border border-border flex flex-col justify-center">
                    {podResult ? (
                      <div className="space-y-4 text-center py-4">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
                          <Check size={24} />
                        </div>
                        <h4 className="text-sm font-black text-emerald-400 uppercase tracking-wider">Delivery Confirmed</h4>

                        <div className="text-left bg-surface/50 p-4 rounded-xl border border-border/80 space-y-2 text-xs font-mono">
                          <div className="flex justify-between"><span className="text-text-muted">TRACKING ID</span><span className="text-text font-bold">{podResult.tracking_id}</span></div>
                          <div className="flex justify-between"><span className="text-text-muted">RECIPIENT</span><span className="text-text font-bold truncate max-w-[150px]">{podResult.recipient_name}</span></div>
                          <div className="flex justify-between"><span className="text-text-muted">DELIVERED</span><span className="text-text font-bold">{new Date(podResult.delivered_at).toLocaleString()}</span></div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-text-muted space-y-3">
                        <FileText size={40} className="mx-auto opacity-30" />
                        <p className="text-xs uppercase font-mono tracking-widest">No delivery confirmed yet</p>
                        <p className="text-[10px] leading-relaxed max-w-xs mx-auto">Drivers confirm deliveries from the driver app; use this when a delivery has to be recorded by the control tower.</p>
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
