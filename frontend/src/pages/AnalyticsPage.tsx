import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, ScatterChart, Scatter
} from 'recharts'
import { Card, CardHeader, Spinner } from '@/components/ui'
import { analyticsAPI, vehiclesAPI, telemetryAPI } from '@/services/api'
import { Zap, Truck, Package, Fuel, Activity, MapPin } from 'lucide-react'

const ttStyle = {
  background: '#ffffff', border: '1px solid #e2e8f0',
  borderRadius: 12, padding: '8px 12px', fontSize: 11,
  color: '#0f172a', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
}

export default function AnalyticsPage() {
  const [searchParams] = useSearchParams()
  const vehicleIdFilter = searchParams.get('vehicle')

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['fleet-metrics'],
    queryFn: () => analyticsAPI.metrics(),
    refetchInterval: 30_000,
  })

  const { data: insights = [], isLoading: insightsLoading } = useQuery({
    queryKey: ['fleet-insights'],
    queryFn: () => analyticsAPI.insights(),
    refetchInterval: 30_000,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => vehiclesAPI.list({ limit: 100 }),
  })

  const { data: telemetryHistory = [], isLoading: telemLoading } = useQuery({
    queryKey: ['telemetry-history', vehicleIdFilter],
    queryFn: () => telemetryAPI.history(vehicleIdFilter!, 200),
    enabled: !!vehicleIdFilter,
    refetchInterval: 15_000,
  })

  const selectedVehicle = vehicleIdFilter
    ? (vehicles as any[]).find((v: any) => v.id === vehicleIdFilter)
    : null

  const telemChartData = [...(telemetryHistory as any[])].reverse().map((t: any, i: number) => ({
    idx: i + 1,
    time: new Date(t.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    speed: t.speed_kmph ?? 0,
    fuel: t.fuel_level_pct ?? 0,
    lat: t.latitude,
    lng: t.longitude,
  }))

  const statusData = [
    { status: 'On Route', count: metrics?.active_vehicles ?? 0 },
    { status: 'Delivered', count: metrics?.total_deliveries ?? 0 },
  ]

  if (metricsLoading && insightsLoading && !vehicleIdFilter) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Spinner size={40} />
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="font-display text-5xl font-black text-slate-900 tracking-tighter uppercase leading-none">
            Fleet <span className="text-yellow-500">Analytics</span>
            {selectedVehicle && (
              <span className="text-2xl ml-4 text-muted normal-case font-bold tracking-normal">
                — {selectedVehicle.plate_number}
              </span>
            )}
          </h1>
          <p className="text-muted font-bold tracking-tight mt-3">
            {selectedVehicle
              ? `Live telemetry for vehicle ${selectedVehicle.plate_number}`
              : 'Real-time fleet performance from live database'}
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {[
            { label: 'On-Time Rate', value: `${metrics?.on_time_rate_pct?.toFixed(1) ?? '—'}%`, icon: Activity, color: 'text-yellow-500' },
            { label: 'Active Vehicles', value: metrics?.active_vehicles ?? '—', icon: Truck, color: 'text-blue-500' },
            { label: 'Total Delivered', value: metrics?.total_deliveries ?? '—', icon: Package, color: 'text-green-500' },
            { label: 'CO₂ Saved (kg)', value: metrics?.co2_saved_kg ?? '—', icon: Fuel, color: 'text-emerald-500' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="px-5 py-3 bg-white rounded-2xl shadow-md border border-slate-100">
              <div className={`text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-1 ${color}`}>
                <Icon size={10} /> {label}
              </div>
              <div className="text-xl font-black text-slate-900 leading-none">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Vehicle-specific telemetry */}
      {vehicleIdFilter && (
        <div className="space-y-6">
          {telemLoading ? (
            <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>
          ) : telemChartData.length === 0 ? (
            <Card className="rounded-[2.5rem] p-10 text-center">
              <Activity size={40} className="mx-auto text-muted mb-4" />
              <p className="text-muted font-bold">No telemetry data yet for this vehicle.</p>
              <p className="text-xs text-muted mt-2">
                Feed GPS data via <code className="bg-slate-100 px-2 py-0.5 rounded">POST /api/v1/telemetry/</code>
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="rounded-[2.5rem] p-4">
                <CardHeader title="Speed Over Time" subtitle={`Last ${telemChartData.length} telemetry pings`} />
                <div className="px-4 pb-4">
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={telemChartData}>
                      <defs>
                        <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#F9C935" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#F9C935" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis unit=" km/h" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={ttStyle} />
                      <Area type="monotone" dataKey="speed" stroke="#F9C935" fill="url(#speedGrad)" strokeWidth={3} name="Speed (km/h)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="rounded-[2.5rem] p-4">
                <CardHeader title="Fuel Level %" subtitle="Real-time fuel depletion" />
                <div className="px-4 pb-4">
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={telemChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} unit="%" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={ttStyle} />
                      <Line type="monotone" dataKey="fuel" stroke="#22c55e" strokeWidth={3} dot={false} name="Fuel %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="rounded-[2.5rem] p-4 lg:col-span-2">
                <CardHeader title="GPS Trail" subtitle={`Route path from ${telemChartData.length} coordinates`} />
                <div className="px-4 pb-4">
                  <ResponsiveContainer width="100%" height={250}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="lng" name="Longitude" type="number" domain={['dataMin - 0.01', 'dataMax + 0.01']} tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toFixed(3)} />
                      <YAxis dataKey="lat" name="Latitude" type="number" domain={['dataMin - 0.01', 'dataMax + 0.01']} tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toFixed(3)} />
                      <Tooltip contentStyle={ttStyle} cursor={{ strokeDasharray: '3 3' }} formatter={(v: any) => v.toFixed(5)} />
                      <Scatter data={telemChartData} fill="#F9C935" opacity={0.7} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Fleet-wide charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-[2.5rem] p-4">
          <CardHeader title="Live Fleet Status" subtitle="Real counts from database" />
          <div className="px-4 pb-4">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="status" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={ttStyle} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="count" fill="#F9C935" radius={[8, 8, 0, 0]} name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="rounded-[2.5rem] p-4">
          <CardHeader title="Live AI Insights" subtitle="From real telemetry & route analysis" />
          <div className="p-4 space-y-3 max-h-[280px] overflow-y-auto">
            {insightsLoading ? (
              <div className="flex items-center justify-center py-10"><Spinner size={24} /></div>
            ) : (insights as any[]).length === 0 ? (
              <div className="text-center py-8 text-muted text-sm font-bold">
                No active insights. Feed telemetry data to generate real insights.
              </div>
            ) : (
              (insights as any[]).map((insight: any) => (
                <div key={insight.id} className={`p-4 rounded-2xl border ${
                  insight.severity === 'high' ? 'bg-red-50 border-red-200' :
                  insight.severity === 'medium' ? 'bg-orange-50 border-orange-200' :
                  'bg-green-50 border-green-200'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Zap size={12} className={
                      insight.severity === 'high' ? 'text-red-500' :
                      insight.severity === 'medium' ? 'text-orange-500' : 'text-green-500'
                    } />
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">{insight.title}</span>
                    <span className={`ml-auto text-[10px] font-black px-2 py-0.5 rounded-full ${
                      insight.severity === 'high' ? 'bg-red-100 text-red-600' :
                      insight.severity === 'medium' ? 'bg-orange-100 text-orange-600' :
                      'bg-green-100 text-green-600'
                    }`}>{insight.score?.toFixed(1)}</span>
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">{insight.insight}</p>
                  {insight.vehicle_id && (
                    <div className="flex items-center gap-1 mt-2">
                      <MapPin size={10} className="text-muted" />
                      <span className="text-[9px] font-bold text-muted font-mono">{insight.vehicle_id.substring(0, 8)}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Efficiency Metrics */}
      <Card className="rounded-[2.5rem] p-8">
        <CardHeader title="Fleet Efficiency Metrics" subtitle="Computed from real delivery & vehicle data" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-4">
          {[
            { label: 'Fuel Saved', value: `${metrics?.fuel_saved_pct ?? '—'}%`, delta: metrics?.delta_fuel, color: 'text-yellow-500' },
            { label: 'Routing ROI Today', value: `₹${(metrics?.fuel_cost_today ?? 0).toLocaleString('en-IN')}`, delta: metrics?.delta_roi, color: 'text-green-500' },
            { label: 'Fleet Efficiency Δ', value: metrics?.delta_efficiency ?? '—', delta: null, color: 'text-blue-500' },
            { label: 'CO₂ Saved', value: `${metrics?.co2_saved_kg ?? 0} kg`, delta: null, color: 'text-emerald-500' },
          ].map(({ label, value, delta, color }) => (
            <div key={label} className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
              <div className={`text-[10px] font-black uppercase tracking-widest mb-2 ${color}`}>{label}</div>
              <div className="text-2xl font-black text-slate-900 leading-none">{value}</div>
              {delta && <div className="text-[10px] font-bold text-green-600 mt-1">{delta} vs baseline</div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

