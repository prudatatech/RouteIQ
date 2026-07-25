import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, BarChart, AlertTriangle, Loader2, Zap, RotateCw, ShieldCheck } from 'lucide-react';
import { AIInsightCard } from '../components/dashboard/AIInsightCard';
import { analyticsAPI, routesAPI, trafficAPI, optimizationAPI } from '@/services/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import LiveMapPage from '@/pages/LiveMapPage';

export default function AIHubPage() {
  const queryClient = useQueryClient();
  const [showDriverMap, setShowDriverMap] = useState(false);
  const { data: insights = [], isLoading } = useQuery({
    queryKey: ['ai-insights'],
    queryFn: () => analyticsAPI.insights(),
    refetchInterval: 5_000, // Faster refresh during Phase 5 testing
  });

  const rerouteMutation = useMutation({
    mutationFn: ({ routeId, newSequence }: { routeId: string, newSequence: string[] }) => 
      routesAPI.reroute(routeId, newSequence),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] });
      toast.success('Dynamic Reroute Applied Successfully');
    }
  });

  const trafficMutation = useMutation({
    mutationFn: () => {
      // Pick an active mission's current location to inject traffic, 
      // otherwise fallback to a generic region if no missions are active.
      const mission = activeMissions.length > 0 
        ? activeMissions[Math.floor(Math.random() * activeMissions.length)]
        : null;
        
      const lat = mission?.last_location ? mission.last_location[0] : 28.6139;
      const lng = mission?.last_location ? mission.last_location[1] : 77.2090;
      
      // Inject traffic anomaly near the vehicle (within ~1km radius)
      const eventLat = lat + (Math.random() - 0.5) * 0.01;
      const eventLng = lng + (Math.random() - 0.5) * 0.01;
      
      return trafficAPI.simulateEvent(eventLat, eventLng, 'accident', 0.8);
    },
    onSuccess: (data: any) => {
      toast.success(`Traffic Anomaly Injected! Agents calculating reroute...`);
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] });
    }
  });

  const { data: activeMissions = [] } = useQuery({
    queryKey: ['active-missions'],
    queryFn: () => analyticsAPI.activeMissions(),
    refetchInterval: 10_000,
  });

  const incubateMutation = useMutation({
    mutationFn: (vehicleId: string) => optimizationAPI.incubate(vehicleId),
    onSuccess: (data: any) => {
      if (data.status === 'suggested') {
        toast.success(data.message);
        queryClient.invalidateQueries({ queryKey: ['ai-insights'] });
      } else {
        toast(data.message, { icon: 'ℹ️' });
      }
    }
  });

  const syncMutation = useMutation({
    mutationFn: () => analyticsAPI.syncSparkGPS(),
    onSuccess: (data: any) => {
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ['active-missions'] });
    }
  });

  const riskMutation = useMutation({
    mutationFn: (vehicleId: string) => optimizationAPI.runRiskAnalysis(vehicleId),
    onSuccess: (data: any) => {
      toast.success('Risk Analysis Complete');
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] });
    }
  });

  const cargoMutation = useMutation({
    mutationFn: (shipmentId: string) => optimizationAPI.runCargoMonitoring(shipmentId),
    onSuccess: (data: any) => {
      toast.success('Cargo Integrity Verified');
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] });
    }
  });

  const tickerAlerts = insights.length > 0 
    ? insights.map((ins: any) => ins.insight) 
    : [
        "SYSTEM: Synchronizing route clusters for zone BX-04...",
        "FLEET: Predictive maintenance vector applied to vehicle ID #4002",
        "GLOBAL: Calibrating demand distribution model v2.4"
      ];
  
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const isSparkGPSActive = !!activeMissions.length;

  const rerouteSuggestions = insights.filter((ins: any) => ins.type === 'reroute_suggestion');

  if (isLoading && insights.length === 0) {
    return (
      <div className="py-40 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-12 h-12 text-yellow-500 animate-spin" />
        <p className="text-[10px] font-black uppercase text-muted tracking-[0.3em] animate-pulse">Initialized Neural Core...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Mapbox Token Alert */}
      {!mapboxToken && (
        <div className="w-full bg-red-500/10 border border-red-500/20 rounded-3xl p-6 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-red-500 text-text shadow-lg">
              <ShieldCheck size={20} className="rotate-180" />
            </div>
            <div>
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Geospatial Textures Restricted</h4>
              <p className="text-xs text-muted font-bold tracking-tight">Mapbox Token missing. Simulation layer active. High-fidelity rendering requires VITE_MAPBOX_TOKEN.</p>
            </div>
          </div>
          <button className="px-5 py-2 rounded-xl bg-surface text-text text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all">
            Configuration Guide
          </button>
        </div>
      )}

      {/* News-Style Alert Ticker */}
      <div className="w-full bg-surface border-y border-primary/30 overflow-hidden py-4 flex items-center shadow-2xl relative z-20">
        <div className="flex items-center gap-4 px-8 border-r border-primary/30 bg-surface z-10 shrink-0">
          <div className={clsx(
            "w-2.5 h-2.5 rounded-full shadow-[0_0_12px_rgba(79,172,254,0.8)]",
            isSparkGPSActive ? "bg-primary animate-pulse" : "bg-error"
          )} />
          <span className="text-primary text-[10px] font-black tracking-[0.3em] uppercase">
            {isSparkGPSActive ? "NEURAL STREAM // LIVE" : "AGENT CORE // STANDBY"}
          </span>
        </div>
        <div className="flex animate-infinite-scroll whitespace-nowrap gap-16 items-center px-12">
          {tickerAlerts.concat(tickerAlerts).map((alert: string, i: number) => (
            <span key={i} className="text-text/90 text-xs font-bold tracking-tight flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              {alert}
            </span>
          ))}
        </div>
      </div>

      {/* Header with Pulse Animation */}
      <div className="relative p-12 rounded-[3rem] bg-surface border border-border overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 p-12">
          <Cpu className="w-32 h-32 text-primary/10 animate-pulse" />
        </div>
        
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-6">
            <span className="px-5 py-2 rounded-full bg-primary/10 text-primary text-[10px] font-black tracking-[0.2em] uppercase border border-primary/20">
              Nexus AI Core // Level 3 Agentic
            </span>
            <button 
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-surface2 text-text text-[10px] font-black tracking-[0.1em] uppercase border border-border hover:border-primary transition-all disabled:opacity-50"
            >
              <RotateCw size={12} className={clsx(syncMutation.isPending && "animate-spin")} />
              Sync Fleet
            </button>
            <button 
              onClick={() => trafficMutation.mutate()}
              disabled={trafficMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-error/10 text-error text-[10px] font-black tracking-[0.1em] uppercase border border-error/20 hover:bg-error/20 transition-all disabled:opacity-50"
            >
              <Zap size={12} className="fill-current" />
              Inject Traffic Anomaly
            </button>
            <button 
              onClick={() => setShowDriverMap(prev => !prev)}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-primary/10 text-primary text-[10px] font-black tracking-[0.1em] uppercase border border-primary hover:bg-primary/20 transition-all"
            >
              {showDriverMap ? 'Hide' : 'Show'} Driver GPS
            </button>
          </div>
          
          <h1 className="text-7xl font-black text-text font-display tracking-tighter uppercase mb-6 leading-none">
            Nexus <span className="text-primary">Intelligence</span> Hub
          </h1>
          <p className="max-w-2xl text-muted font-bold text-lg leading-relaxed tracking-tight">
            Orchestrating multi-agent autonomous logistics operations. Real-time neural synthesis processing live telemetry across the global manifest.
          </p>
        </div>

        {/* 3D Grid Overlay Effect */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(var(--accent) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      </div>

      {/* Driver GPS Map Section */}
      {showDriverMap && (
        <div className="rounded-[2rem] bg-surface border border-border p-6 shadow-2xl">
          <LiveMapPage />
        </div>
      )}

      {/* Dynamic Reroute Center */}
      {rerouteSuggestions.length > 0 && (
        <div className="grid grid-cols-1 gap-6">
          <h3 className="text-[10px] font-black text-muted uppercase tracking-[0.3em] flex items-center gap-4">
            Dynamic Reroute Center
            <div className="flex-1 h-px bg-slate-200" />
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rerouteSuggestions.map((s: any) => (
              <div key={s.id} className="p-8 rounded-[2rem] bg-surface border border-yellow-500/30 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 transition-transform">
                  <RotateCw className="w-32 h-32 text-yellow-500" />
                </div>
                
                <div className="relative z-10 flex flex-col h-full">
                  <div className="flex items-center justify-between mb-6">
                    <div className="px-3 py-1 rounded-full bg-yellow-500 text-black text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                      <Zap size={10} className="fill-current" /> High ROI Decision
                    </div>
                    <span className="text-yellow-500/50 font-mono text-[10px]">VEHICLE: {s.vehicle_id.slice(0,8)}</span>
                  </div>

                  <h4 className="text-2xl font-black text-text uppercase tracking-tight leading-none mb-2">
                    Potential Savings: <span className="text-yellow-500">-{s.saved_mins} Mins</span>
                  </h4>
                  <p className="text-muted font-bold text-sm mb-8">{s.insight}</p>

                  <div className="mt-auto flex gap-3">
                    <button 
                      onClick={() => rerouteMutation.mutate({ routeId: s.route_id, newSequence: s.new_sequence })}
                      disabled={rerouteMutation.isPending}
                      className="flex-1 h-14 bg-yellow-500 text-black font-black uppercase tracking-widest text-xs rounded-2xl shadow-lg shadow-yellow-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      {rerouteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply New Vector"}
                    </button>
                    <button className="flex-1 h-14 bg-surface2 text-text/50 border border-border font-black uppercase tracking-widest text-xs rounded-2xl hover:bg-surface2 transition-all">
                      Ignore
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Primary Intelligence Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {insights.length > 0 ? (
          insights.filter((i: any) => i.type !== 'reroute_suggestion').slice(0, 3).map((ins: any) => (
            <AIInsightCard 
              key={ins.id}
              title={ins.title}
              insight={ins.insight}
              score={ins.score}
              trend={ins.trend}
            />
          ))
        ) : (
          <>
            <AIInsightCard 
              title="Global Optimization"
              insight="Analyzing route clusters for efficiency leaks. Current aggregate performance: 94.2%."
              score={94.2}
              trend="up"
            />
            <div className="rounded-[2.5rem] bg-slate-50 border border-slate-200 border-dashed p-10 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-8 h-8 text-muted animate-spin mb-3" />
              <p className="text-[10px] font-bold text-muted uppercase tracking-widest">Scanning next sector...</p>
            </div>
          </>
        )}
      </div>

      {/* System Status Table */}
      <div className="rounded-[3rem] bg-surface border border-border p-10 shadow-2xl">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-5">
            <div className="p-4 rounded-[20px] bg-primary/10 text-primary shadow-lg border border-primary/20">
              <BarChart className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-text font-display tracking-tight uppercase">Decision Stream</h2>
              <p className="text-muted text-[10px] font-bold tracking-[0.2em] uppercase mt-1">Live Heuristic Logs</p>
            </div>
          </div>
          <button className="px-8 py-3 rounded-2xl bg-surface2 border border-border text-muted text-xs font-black hover:text-text hover:bg-bg transition-all uppercase tracking-widest">
            Export Model Data
          </button>
        </div>

        <div className="space-y-4">
          {insights.length > 0 ? insights.map((log: any, i: number) => (
            <div key={i} className="flex items-center justify-between p-5 rounded-[24px] bg-surface2/40 border border-border group hover:border-primary/50 transition-all cursor-pointer">
              <div className="flex items-center gap-6">
                <span className={clsx(
                  "font-mono text-[9px] font-black px-3 py-1 rounded-full border tracking-widest uppercase",
                  log.severity === 'high' ? "bg-error/10 text-error border-error/20" : 
                  log.severity === 'medium' ? "bg-accent/10 text-accent border-accent/20" :
                  "bg-success/10 text-success border-success/20"
                )}
                >
                  {log.type.toUpperCase()}
                </span>
                <span className="text-muted font-bold text-sm tracking-tight group-hover:text-text transition-colors">{log.insight}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                <span className="text-muted font-mono text-[10px] uppercase tracking-widest opacity-50">verified</span>
              </div>
            </div>
          )) : (
            <p className="text-center py-16 text-muted uppercase font-black text-[10px] tracking-[0.3em] opacity-30">No active anomalies detected.</p>
          )}
        </div>
      </div>

      {/* Mission Control: Real-time Incubator */}
      <div className="space-y-6">
          <h3 className="text-[10px] font-black text-muted uppercase tracking-[0.3em] flex items-center gap-4 px-2">
            Mission Control: Real-time Incubator
            <div className="flex-1 h-px bg-slate-200" />
          </h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {activeMissions.length > 0 ? activeMissions.map((mission: any) => (
              <ActiveMissionCard 
                key={mission.vehicle_id} 
                mission={mission} 
                onIncubate={() => incubateMutation.mutate(mission.vehicle_id)}
                isPending={incubateMutation.isPending && incubateMutation.variables === mission.vehicle_id}
              />
            )) : (
              <div className="lg:col-span-2 py-12 rounded-[2.5rem] bg-slate-50 border border-slate-200 border-dashed flex flex-col items-center justify-center text-center">
                <Loader2 className="w-8 h-8 text-muted animate-spin mb-3" />
                <p className="text-[10px] font-bold text-muted uppercase tracking-widest">Awaiting Active Ground Vectors...</p>
              </div>
            )}
          </div>
      </div>

      {/* Custom Styles for Animation */}
      <style>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 3s linear infinite;
        }
        @keyframes infiniteScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .animate-infinite-scroll {
          animation: infiniteScroll 60s linear infinite;
        }
      `}</style>
    </div>
  );
}

function ActiveMissionCard({ mission, onIncubate, isPending }: { mission: any, onIncubate: () => void, isPending: boolean }) {
  const isOptimizable = mission.has_suggestion || mission.status === 'optimization_available';
  
  return (
    <div className={clsx(
      "p-8 rounded-[2.5rem] bg-surface border border-border transition-all group overflow-hidden relative",
      isOptimizable ? "ring-2 ring-primary shadow-2xl shadow-primary/10 border-primary/20" : "hover:shadow-xl hover:border-primary/20"
    )}>
      <div className="flex items-center justify-between mb-8 relative z-10">
        <div className="flex items-center gap-4">
          <div className={clsx(
            "w-14 h-14 rounded-2xl flex items-center justify-center transition-all relative",
            isOptimizable ? "bg-primary text-bg shadow-lg shadow-primary/30" : "bg-surface2 text-primary border border-border"
          )}>
            <Zap size={22} className={clsx((mission.sync_pulse === 'active' || isOptimizable) && "animate-pulse")} />
            {mission.last_sync && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-success rounded-full border-2 border-surface shadow-lg" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <div className="text-base font-black text-text uppercase tracking-tight">{mission.plate_number}</div>
              {mission.last_sync && (
                <span className="px-2.5 py-0.5 rounded-full text-[8px] font-black bg-success/10 text-success border border-success/20 uppercase tracking-widest">
                  Live Hardware
                </span>
              )}
            </div>
            <div className={clsx(
              "text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2 mt-1",
              isOptimizable ? "text-primary" : "text-muted"
            )}>
              {isOptimizable ? "Optimization Available" : (mission.status === 'on_route' ? 'LIVE // IN TRANSIT' : 'PENDING')}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={clsx(
            "text-2xl font-black leading-none",
            isOptimizable ? "text-primary" : "text-text"
          )}>
            {mission.ai_efficiency_score.toFixed(1)}%
          </div>
          <div className="text-[9px] font-black text-muted uppercase tracking-widest mt-1">
            AI Efficiency
          </div>
        </div>
      </div>

      <div className="space-y-6 relative z-10">
        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em]">
          <span className="text-muted">Mission Progress</span>
          <span className="text-text">{Math.round(mission.progress_pct)}%</span>
        </div>
        <div className="h-2 w-full bg-surface2 rounded-full overflow-hidden border border-border">
          <div 
            className={clsx("h-full transition-all duration-1000", isOptimizable ? "bg-primary shadow-[0_0_8px_rgba(79,172,254,0.6)]" : "bg-white/40")} 
            style={{ width: `${mission.progress_pct}%` }} 
          />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="p-4 rounded-2xl bg-surface2/50 border border-border">
            <div className="text-[9px] font-black text-muted uppercase tracking-widest mb-1.5">
              Speed
            </div>
            <div className="text-base font-black text-text">
              {mission.speed} <span className="text-[10px] text-muted ml-1">KM/H</span>
            </div>
          </div>
          <div className={clsx(
            "p-4 rounded-2xl border transition-colors",
            isOptimizable ? "bg-primary/5 border-primary/20" : "bg-surface2/50 border-border"
          )}>
            <div className="text-[9px] font-black text-muted uppercase tracking-widest mb-1.5">
              {isOptimizable ? "Savings" : "Stops Left"}
            </div>
            <div className={clsx(
              "text-base font-black",
              isOptimizable ? "text-primary" : "text-text"
            )}>
              {isOptimizable ? `~${mission.potential_savings} MIN` : mission.remaining_stops}
            </div>
          </div>
        </div>

        <button 
          onClick={onIncubate}
          disabled={isPending}
          className={clsx(
            "w-full h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 border",
            isOptimizable 
              ? "bg-primary text-bg border-primary hover:bg-primary-dark shadow-xl shadow-primary/20" 
              : "bg-surface2 text-text border-border hover:border-primary/40 disabled:opacity-50"
          )}
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            isOptimizable ? <RotateCw size={16} className="animate-spin-slow" /> : <ShieldCheck size={16} className="text-primary" />
          )}
          {isOptimizable ? "Apply Neural Reroute" : "Incubate Planning"}
        </button>
      </div>

      {isOptimizable && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16" />
      )}
    </div>
  );
}
