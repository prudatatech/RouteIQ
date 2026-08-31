import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Zap, Play, CheckCircle, Clock, Activity, CloudRain, Cpu, Navigation, Map } from 'lucide-react'
import { formatEta } from '@/utils/timeFormat'
import { optimizationAPI, vehiclesAPI, deliveryPointsAPI, api } from '@/services/api'
import LiveMap from '@/components/map/LiveMap'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function OptimizePage() {
  const queryClient = useQueryClient()
  const [algo, setAlgo] = useState('ortools')
  const [traffic, setTraffic] = useState(true)
  const [weather, setWeather] = useState(true)
  const [solveTime, setSolveTime] = useState(30)

  // Fetch depots
  const { data: depots = [] } = useQuery({
    queryKey: ['depots'],
    queryFn: () => api.get('/depots/').then(r => r.data),
  })
  const depotId: string = depots[0]?.id ?? ''

  // Fetch vehicles
  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles', 'available', 'idle', 'on_route', 'offline'],
    queryFn: () => vehiclesAPI.list({ limit: 50 }).then((list: any[]) =>
      list.filter((v: any) => ['available', 'idle', 'on_route', 'offline'].includes(v.status))
    )
  })

  // Fetch pending shipments (Cargo Manifest)
  const { data: pendingStops = [] } = useQuery({
    queryKey: ['shipments', 'pending'],
    queryFn: () => api.get('/shipments/').then(r => r.data.filter((s: any) => s.status === 'created' && !s.vehicle_id))
  })

  const [error, setError] = useState<string | null>(null)
  
  const { mutate: runOptimization, data: result, isPending } = useMutation({
    mutationFn: () => {
      setError(null)
      const payload = {
        depot_id: depotId || undefined,
        vehicle_ids: vehicles.slice(0, 5).map((v: any) => v.id),
        shipment_ids: pendingStops.slice(0, 20).map((s: any) => s.id),
        algorithm: algo,
        consider_traffic: traffic,
        consider_weather: weather,
        max_solve_time_seconds: solveTime,
      };
      console.log('Sending Optimization Payload:', payload);
      return optimizationAPI.optimize(payload);
    },
    onSuccess: (data) => {
      toast.success(`Optimized ${data.routes?.length ?? 0} routes in ${(data.solve_time_seconds || 0).toFixed(2)}s`)
      queryClient.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: any) => {
      console.error('OPTIMIZATION ERROR:', err, err.response?.data);
      const msg = err.response?.data?.detail
      setError(Array.isArray(msg) ? msg.map((e: any) => e.msg).join(', ') : (msg || 'Optimization failed'))
      toast.error(`Optimization failed: ${err.message || 'Check resource availability'}`)
    },
  })

  const canOptimize = vehicles.length > 0 && pendingStops.length > 0

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col space-y-6">
      {/* Title Header */}
      <div className="relative p-8 rounded-[2.5rem] bg-surface border border-border overflow-hidden shadow-2xl shrink-0">
        <div className="absolute top-0 right-0 p-8">
          <Navigation className="w-24 h-24 text-primary/10 animate-pulse" />
        </div>
        <div className="relative z-10">
          <h1 className="text-3xl font-black text-text uppercase tracking-tight leading-none mb-2">
            AI Route Grid
          </h1>
          <p className="text-xs text-text-muted font-bold tracking-[0.2em] uppercase max-w-2xl">
            Intelligent fleet dispatch. Currently evaluating <b>{vehicles.length}</b> vehicles and <b>{pendingStops.length}</b> shipments.
          </p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        
        {/* Left Pane: Config & Actions */}
        <div className="lg:col-span-4 flex flex-col space-y-6 overflow-y-auto pr-2 custom-scrollbar">
          
          <div className="p-6 rounded-[2rem] bg-surface border border-border shadow-xl">
            <h2 className="text-sm font-black text-text uppercase tracking-widest mb-6 flex items-center gap-2">
              <Cpu className="text-primary" size={18} />
              Solver Core
            </h2>

            <div className="space-y-3 mb-8">
              {[
                { value: 'ortools', label: 'Google OR-Tools', desc: 'Constraint programming' },
                { value: 'genetic', label: 'Machine Learning (GA)', desc: 'Evolutionary algorithm' },
                { value: 'reinforcement', label: 'Reinforcement Learning', desc: 'Deep RL history' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setAlgo(opt.value)}
                  className={clsx(
                    "w-full text-left p-4 rounded-2xl border transition-all flex items-start gap-4",
                    algo === opt.value 
                      ? "bg-primary/10 border-primary/30" 
                      : "bg-background border-border hover:border-primary/20 hover:bg-surface-hover"
                  )}
                >
                  <div className={clsx(
                    "w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 transition-colors",
                    algo === opt.value ? "border-primary bg-primary" : "border-muted bg-transparent"
                  )} />
                  <div>
                    <div className={clsx("text-sm font-bold uppercase tracking-wider", algo === opt.value ? "text-primary" : "text-text")}>
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-text-muted uppercase tracking-widest mt-1">
                      {opt.desc}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <h2 className="text-sm font-black text-text uppercase tracking-widest mb-6 flex items-center gap-2">
              <Activity className="text-accent-secondary" size={18} />
              Live Telemetry Multipliers
            </h2>

            <div className="space-y-4 mb-8">
              {[
                { label: 'Real-time Traffic', value: traffic, set: setTraffic, desc: 'Mappls Traffic API', icon: Map },
                { label: 'Weather Conditions', value: weather, set: setWeather, desc: 'OpenWeather Maps', icon: CloudRain },
              ].map(({ label, value, set, desc, icon: Icon }) => (
                <div key={label} className="flex items-center justify-between p-4 rounded-2xl bg-background border border-border">
                  <div className="flex items-center gap-3">
                    <Icon className="text-text-muted" size={16} />
                    <div>
                      <div className="text-xs font-bold text-text uppercase tracking-wider">{label}</div>
                      <div className="text-[9px] text-text-muted uppercase tracking-widest mt-1">{desc}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => set(!value)}
                    className={clsx(
                      "w-10 h-6 rounded-full relative transition-colors duration-300",
                      value ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <div className={clsx(
                      "absolute top-1 w-4 h-4 rounded-full bg-background transition-all duration-300 shadow-sm",
                      value ? "left-5" : "left-1"
                    )} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mb-8">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Max Solve Time</label>
                <span className="font-mono text-xs text-primary font-bold">{solveTime}s</span>
              </div>
              <input
                type="range" min={5} max={300} value={solveTime}
                onChange={e => setSolveTime(+e.target.value)}
                className="w-full accent-primary h-1 bg-muted rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {!canOptimize && !isPending && (
              <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 mb-6 flex items-start gap-3">
                <Zap className="text-red-400 shrink-0 mt-0.5" size={16} />
                <div>
                  <div className="text-xs font-bold text-red-400 uppercase tracking-wider">Insufficient Resources</div>
                  <div className="text-[10px] text-red-400/80 uppercase tracking-widest mt-1">
                    {vehicles.length === 0 ? 'No vehicles available.' : ''} {pendingStops.length === 0 ? 'No shipments.' : ''}
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => runOptimization()}
              disabled={isPending || !canOptimize}
              className="w-full h-12 bg-primary hover:bg-primary-dark disabled:opacity-50 text-slate-950 text-xs font-black uppercase rounded-xl tracking-widest transition-all flex items-center justify-center gap-3"
            >
              <Play size={16} className={clsx("fill-current", isPending && "animate-pulse")} />
              {isPending ? 'Generating Routes...' : 'Initialize Dispatch AI'}
            </button>
            
            {error && (
              <div className="mt-4 text-xs text-red-400 font-bold text-center">
                {error}
              </div>
            )}
          </div>
          
        </div>

        {/* Right Pane: Map & Results */}
        <div className="lg:col-span-8 flex flex-col space-y-6">
          <div className="h-[400px] rounded-[2rem] overflow-hidden border border-border shadow-2xl relative bg-black/20">
            <LiveMap vehicles={vehicles} customPendingStops={pendingStops} />
            
            <div className="absolute top-4 left-4 z-10">
              <div className="bg-surface/80 backdrop-blur-md border border-border/50 p-3 rounded-2xl shadow-xl flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-widest text-text">Mappls Network Active</span>
              </div>
            </div>
          </div>

          <div className="flex-1 bg-surface border border-border rounded-[2rem] p-6 shadow-xl flex flex-col">
            <h2 className="text-sm font-black text-text uppercase tracking-widest mb-6 flex items-center gap-2">
              <CheckCircle className="text-green-500" size={18} />
              Route Assignments
            </h2>
            
            {!result ? (
               <div className="flex-1 flex flex-col items-center justify-center text-text-muted opacity-50">
                 <Navigation size={48} className="mb-4" />
                 <p className="text-xs font-bold uppercase tracking-widest">Awaiting AI Dispatch Generation</p>
               </div>
            ) : (
              <div className="flex flex-col space-y-6 overflow-y-auto custom-scrollbar pr-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
                  {[
                    { label: 'Active Routes', value: result.routes?.length ?? 0 },
                    { label: 'Total Distance', value: `${(result.total_distance_km || 0).toFixed(1)} km` },
                    { label: 'Estimated Fuel', value: `${(result.total_fuel_liters || 0).toFixed(1)} L` },
                    { label: 'Network Savings', value: `${(result.estimated_savings_pct || 0).toFixed(1)}%` },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-4 rounded-2xl bg-background border border-border">
                      <div className="text-xl font-black text-primary font-mono">{value}</div>
                      <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-2">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-4">
                  {(result.routes ?? []).map((r: any, i: number) => (
                    <div key={r.id ?? i} className="p-4 rounded-2xl bg-background border border-border flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black">
                          #{i + 1}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-text uppercase tracking-widest">
                            Vehicle {(r.vehicle_id || '').toString().slice(0,8)}
                          </div>
                          <div className="text-[10px] text-text-muted uppercase tracking-widest mt-1">
                            {r.stop_ids?.length || 0} Assignments • Origin Depot
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-[10px] font-black uppercase tracking-widest">
                          {formatEta(r.total_duration_minutes || 0)}
                        </span>
                        <span className="px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full text-[10px] font-black uppercase tracking-widest">
                          {(r.total_distance_km || 0).toFixed(1)} km
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
