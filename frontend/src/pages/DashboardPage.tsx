import { useState, useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Truck, Clock, Fuel, TrendingUp, Zap, Filter, Activity, Map, Target } from 'lucide-react'
import { dashboardAPI, vehiclesAPI, telemetryWS } from '@/services/api'
import { KPICard, Card, CardHeader, Spinner } from '@/components/ui'
import toast from 'react-hot-toast'
import LiveMap from '@/components/map/LiveMap'
import DeliveryChart from '@/components/dashboard/DeliveryChart'
import AlertFeed from '@/components/dashboard/AlertFeed'
import { AIInsightCard } from '@/components/dashboard/AIInsightCard'
import VendorRequestsAdmin from '@/components/dashboard/VendorRequestsAdmin'
import { STATUS_COLORS, CARGO_EMOJI } from '@/config/mapConfig'

export default function DashboardPage() {
  const navigate = useNavigate();
  const clearAuth = useAuthStore(state => state.clearAuth);
  const token = useAuthStore(state => state.token);
  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };
  useEffect(() => {
    if (!token) navigate('/login');
  }, [token, navigate]);
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedVehicleId = searchParams.get('vehicle')
  const [zoomFocusEvent, setZoomFocusEvent] = useState(0)
  const [filter, setFilter] = useState<'all' | 'moving' | 'idle'>('all')
  const [liveTelemetry, setLiveTelemetry] = useState<Record<string, any>>({})
  const [alerts, setAlerts] = useState<any[]>([])

  const { data: kpis, isLoading } = useQuery({
    queryKey: ['kpis'],
    queryFn: dashboardAPI.kpis,
    refetchInterval: 30_000,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles', 'live'],
    queryFn: () => vehiclesAPI.list({ limit: 20 }),
    refetchInterval: 5_000, // 5s polling for Ola/Uber-style live tracking
  })

  useEffect(() => {
    let isMounted = true;
    const ws = telemetryWS.connect((msg) => {
      if (!isMounted) return;
      if (msg.type === 'TELEMETRY_UPDATE') {
        setLiveTelemetry(prev => ({
          ...prev,
          [msg.data.vehicle_id]: msg.data
        }))
      } else if (msg.type === 'VEHICLE_OFFLINE' || msg.type === 'ALERT_CRITICAL' || msg.type === 'ALERT_WARNING') {
        const isCritical = msg.type === 'ALERT_CRITICAL' || msg.type === 'VEHICLE_OFFLINE'
        const newAlert = {
          id: Date.now(),
          type: isCritical ? 'critical' : 'warning',
          title: msg.title || (isCritical ? 'Critical Event' : 'Fleet Warning'),
          desc: msg.message || msg.data?.message || `${msg.data?.plate_number} has lost connection.`,
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        }
        setAlerts(prev => [newAlert, ...prev].slice(0, 10)) // Keep last 10
      }
    })
    return () => {
      isMounted = false;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }
  }, [])

  useEffect(() => {
    if (selectedVehicleId && vehicles.length > 0) {
      const v = vehicles.find((v: any) => v.id === selectedVehicleId)
      if (v) {
        toast.success(`Tracking vehicle ${v.plate_number}...`, { id: 'track-v' })
      }
    }
  }, [selectedVehicleId, vehicles])

  const filteredVehicles = vehicles.filter((v: any) => {
    const live = liveTelemetry[v.id]
    if (filter === 'all') return true
    if (filter === 'moving') return (live?.speed > 0 || v.status === 'on_route')
    if (filter === 'idle') return (!live || live?.speed === 0 || v.status === 'available')
    return true
  })

  const now = new Date()

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div>
          <h1 className="font-display text-6xl font-black tracking-tighter text-text uppercase leading-none">
            Nexus <span className="text-primary">Control</span> Tower
          </h1>
          <div className="text-muted font-bold tracking-tight mt-4 flex items-center gap-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
            <Activity size={16} className="text-primary" />
            Enterprise Multi-Agent AI Ecosystem
            <span className="opacity-30">|</span>
            {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST
          </div>
        </div>

        {/* Top-right: Fleet filter + Logout */}
        <div className="flex flex-col items-end gap-3">
          {/* Logout button */}
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '8px 18px', borderRadius: '12px',
              border: '1.5px solid #e5c84a',
              background: 'transparent',
              color: '#B38700',
              fontWeight: 700, fontSize: '13px',
              cursor: 'pointer',
              transition: 'background 0.2s, color 0.2s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = '#B38700';
              (e.currentTarget as HTMLButtonElement).style.color = '#fff';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = '#B38700';
            }}
          >
            <LogOut size={15} />
            Sign Out
          </button>

          {/* Fleet filter tabs */}
          <div className="flex bg-surface2 p-1.5 rounded-2xl border border-border shadow-2xl">
            {[
              { id: 'all', label: 'All Fleet' },
              { id: 'moving', label: 'In Transit' },
              { id: 'idle', label: 'Parked' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as any)}
                className={`px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  filter === f.id
                    ? 'bg-primary text-bg shadow-lg shadow-primary/20'
                    : 'text-muted hover:text-text'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          label="Active Cargo"
          value={isLoading ? '—' : String(kpis?.active_vehicles ?? 0)}
          delta={kpis?.delta_vehicles || "+0%"} deltaUp
          icon={<Truck size={22} className="text-primary" />}
          color="var(--accent)"
          progress={kpis ? (kpis.active_vehicles > 0 ? 85 : 0) : 0}
        />
        <KPICard
          label="Delivery Success"
          value={isLoading ? '—' : `${kpis?.on_time_rate_pct?.toFixed(1) ?? '—'}%`}
          delta={kpis?.delta_efficiency || "+0%"} deltaUp
          icon={<Clock size={22} className="text-text" />}
          color="#FFFFFF"
          progress={kpis?.on_time_rate_pct ?? 0}
        />
        <KPICard
          label="Operational ROI"
          value={isLoading ? '—' : `₹${((kpis?.fuel_cost_today ?? 0) / 100000).toFixed(1)}L`}
          delta={kpis?.delta_roi || "+0%"} deltaUp
          icon={<Fuel size={22} className="text-primary-dark" />}
          color="var(--accent-secondary)"
          progress={kpis ? 72 : 0}
        />
        <KPICard
          label="AI Efficiency"
          value={isLoading ? '—' : `${kpis?.fuel_saved_pct ?? '—'}%`}
          delta={kpis?.delta_fuel || "+0%"} deltaUp
          icon={<Zap size={22} className="text-accent-tertiary" />}
          color="var(--accent-tertiary)"
          progress={kpis?.fuel_saved_pct ?? 0}
        />
      </div>

      {/* Map + Fleet List */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        <div className="rounded-[40px] bg-surface border border-border flex flex-col overflow-hidden shadow-2xl relative group">
          <div className="absolute top-8 left-8 z-10 pointer-events-none">
             <div className="bg-bg/40 backdrop-blur-xl border border-border px-8 py-5 rounded-[24px] shadow-2xl">
                <h2 className="text-xl font-black text-text tracking-tight uppercase">Live <span className="text-primary">Geospatial</span> Grid</h2>
                <p className="text-muted text-[10px] font-bold uppercase tracking-[0.2em] mt-2 opacity-60">High-Density Telemetry Pipe Active</p>
             </div>
          </div>
          <div className="h-[650px]">
            <LiveMap vehicles={vehicles} selectedVehicleId={selectedVehicleId} zoomFocusEvent={zoomFocusEvent} />
          </div>
        </div>

        <div className="rounded-[40px] bg-surface border border-border flex flex-col overflow-hidden shadow-2xl">
          <div className="px-8 pt-10 pb-6 flex justify-between items-center border-b border-border">
            <div>
              <h2 className="text-2xl font-black text-text tracking-tighter uppercase">Cargo <span className="text-primary">Fleet</span></h2>
              <p className="text-muted text-[10px] font-bold uppercase tracking-[0.2em] mt-2">Real-time Telemetry</p>
            </div>
            <div className="px-5 py-2.5 rounded-2xl bg-primary/10 text-primary text-[10px] font-black tracking-widest border border-primary/20">
              {filteredVehicles.length} ONLINE
            </div>
          </div>
          <div className="px-6 pb-10 pt-4 flex-1 overflow-y-auto space-y-3 custom-scrollbar">
            {isLoading ? (
              <div className="py-20 flex justify-center"><Spinner /></div>
            ) : filteredVehicles.length === 0 ? (
              <div className="py-20 text-center text-muted text-xs font-bold uppercase">No vehicles match filter</div>
            ) : (
              filteredVehicles.map((v: any, i: number) => {
                const live = liveTelemetry[v.id]
                const dotColor = STATUS_COLORS[v.status] || '#94a3b8'
                const emoji = v.vehicle_type === 'truck' ? '🚛' : (v.vehicle_type === 'van' ? '🚐' : (v.vehicle_type === 'bike' ? '🏍️' : '🚗'))
                const speed = live?.speed || 0
                const primaryCargo = v.cargo_types?.[0] || 'general'
                const cargoEmoji = CARGO_EMOJI[primaryCargo] || ''

                return (
                  <div key={v.id} onClick={() => setSearchParams({ vehicle: v.id })} className={`group relative flex items-center gap-5 p-5 rounded-[32px] transition-all cursor-pointer ${selectedVehicleId === v.id ? 'bg-primary/5 border border-primary/30' : 'hover:bg-surface2 border border-transparent hover:border-border'}`}>
                    <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-3xl flex-shrink-0 bg-surface2 border border-border group-hover:bg-bg group-hover:scale-105 transition-all shadow-lg relative">
                      {emoji}
                      <span className="absolute -top-1 -right-1 text-[12px] bg-surface rounded-full w-6 h-6 flex items-center justify-center shadow-lg border border-border">
                        {cargoEmoji}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="font-black text-text text-base flex items-center gap-3">
                          {v.plate_number} 
                          <span className={`w-2.5 h-2.5 rounded-full ${speed > 0 ? 'animate-pulse' : ''}`} style={{ backgroundColor: dotColor, boxShadow: `0 0 12px ${dotColor}80` }} />
                        </div>
                        <div className="font-mono font-black text-[13px]" style={{ color: speed > 0 ? 'var(--success)' : 'var(--muted)' }}>
                          {speed > 0 ? `${speed.toFixed(0)} KM/H` : 'STATIONARY'}
                        </div>
                        <button onClick={() => {
                          const lat = live?.latitude || v.latitude || 0;
                          const lng = live?.longitude || v.longitude || 0;
                          const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
                          window.open(url, '_blank');
                        }} className="ml-2 flex items-center gap-1 text-xs text-primary hover:underline">
                          <Map size={14} /> Navigate
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-[12px] font-bold">
                        <div className="text-muted truncate pr-4 uppercase tracking-tight flex items-center gap-2">
                          {v.status === 'gps_off' ? (
                            <span className="text-red-500 font-black animate-pulse">GPS DISABLED BY DRIVER</span>
                          ) : v.status === 'on_route' ? 'Active Mission · Primary Route' : 'Awaiting Orders · Idle'}
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setSearchParams({ vehicle: v.id });
                            setZoomFocusEvent(Date.now());
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 bg-primary/10 hover:bg-primary/20 text-primary font-mono text-[10px] tracking-widest rounded-lg transition-all border border-primary/20 hover:border-primary/50"
                        >
                          <Target size={12} /> {live ? 'LIVE TRACK' : 'LOCATE'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Vendor Requests — full width strip */}
      <VendorRequestsAdmin />

      {/* Charts + Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <DeliveryChart />
        <AlertFeed alerts={alerts} />
        <Card className="border-slate-200 bg-white shadow-xl rounded-[40px] overflow-hidden">
          <CardHeader title="System Pulse" subtitle="Infrastructure load metrics" />
          <div className="px-8 pb-8 space-y-8">
            {[
              { label: 'Network Latency', value: 12, color: '#10b981', suffix: 'ms' },
              { label: 'Data Throughput', value: 94, color: '#0F172A', suffix: '%' },
              { label: 'ML Prediction Acc', value: 98, color: '#F9C935', suffix: '%' },
              { label: 'Fleet Sync Rate', value: 100, color: '#F59E0B', suffix: '%' },
            ].map(({ label, value, color, suffix }) => (
              <div key={label} className="group">
                <div className="flex justify-between mb-3 text-[10px] font-black uppercase tracking-widest text-muted">
                  <span>{label}</span>
                  <span style={{ color }}>{value}{suffix}</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden p-0.5">
                  <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${value}%`, background: color }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>


      {/* AI Pulse Insight */}
      <AIInsightCard 
        title="Predictive Fleet Optimization"
        insight="Our neural engine has identified a high-traffic cluster near Okhla. Rerouting 4 heavy-duty trucks to the Outer Ring Road will prevent a cumulative 82-minute delay across the cargo manifest."
        score={98.2}
        trend="up"
      />
    </div>
  )
}
