import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Truck, Clock, Plus, Search, Filter, AlertTriangle, AlertCircle,
  WifiOff, Wifi, ChevronRight, MapIcon, List, Eye, Calendar, ChevronDown,
  Package, Activity
} from 'lucide-react'
import { dashboardAPI, vehiclesAPI, shipmentsAPI } from '@/services/api'
import { Spinner } from '@/components/ui'
import LiveMap from '@/components/map/LiveMap'
import LiveTelemetryTab from '@/components/analytics/LiveTelemetryTab'
import VendorRequestsAdmin from '@/components/dashboard/VendorRequestsAdmin'
import { supabase } from '@/services/supabase'
import { useDraftStore } from '@/store/draftStore'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import clsx from 'clsx'

export default function DashboardPage() {
  const navigate = useNavigate()
  const token = useAuthStore(state => state.token)
  const openModal = useDraftStore(s => s.openModal)

  useEffect(() => {
    if (!token) navigate('/login')
  }, [token, navigate])

  const [searchParams, setSearchParams] = useSearchParams()
  const selectedVehicleId = searchParams.get('vehicle')
  const [zoomFocusEvent, setZoomFocusEvent] = useState(0)
  const [mapView, setMapView] = useState<'map' | 'list'>('map')
  const [fleetSearch, setFleetSearch] = useState('')
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // Auto-animate refs
  const [needsAttentionRef] = useAutoAnimate()
  const [tableRef] = useAutoAnimate()

  // ── Data Queries ──────────────────────────────────────────────
  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['kpis'],
    queryFn: dashboardAPI.kpis,
    refetchInterval: 30_000,
  })

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles', 'live'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }),
    refetchInterval: 5_000,
  })

  const { data: summary } = useQuery({
    queryKey: ['fleet-summary'],
    queryFn: vehiclesAPI.summary,
    refetchInterval: 30_000,
  })

  const { data: shipments = [] } = useQuery({
    queryKey: ['shipments', 'active'],
    queryFn: () => shipmentsAPI.list({ status: 'in_transit', limit: 200 }),
    refetchInterval: 30_000,
  })

  const { data: sosAlerts = [] } = useQuery({
    queryKey: ['sos-alerts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sos_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)
      return data || []
    },
    refetchInterval: 15_000,
  })

  // Update refresh timestamp
  useEffect(() => {
    const interval = setInterval(() => setLastRefresh(new Date()), 30_000)
    return () => clearInterval(interval)
  }, [])

  // ── Derived Data ──────────────────────────────────────────────
  const reportingVehicles = vehicles.filter((v: any) => v.status !== 'offline' && v.status !== 'maintenance')
  const offlineVehicles = vehicles.filter((v: any) => v.status === 'offline')
  const incidentVehicles = vehicles.filter((v: any) => v.status === 'maintenance')
  const activeShipmentCount = shipments.length || kpis?.active_vehicles || 0
  const onTimeRate = kpis?.on_time_rate_pct?.toFixed(0) || '95'
  const openIncidents = sosAlerts.filter((a: any) => a.status !== 'resolved').length

  // Needs attention items
  const attentionItems: Array<{
    id: string; type: 'incident' | 'warning' | 'offline' | 'online';
    title: string; subtitle: string; time: string; action: string; actionFn: () => void
  }> = []

  // Add SOS alerts
  sosAlerts.filter((a: any) => a.status !== 'resolved').forEach((alert: any) => {
    const v = vehicles.find((veh: any) => veh.id === alert.vehicle_id)
    attentionItems.push({
      id: alert.id,
      type: 'incident',
      title: alert.alert_type === 'accident' ? 'Serious accident' : (alert.alert_type || 'Emergency Alert'),
      subtitle: `${v?.plate_number || 'Unknown'} · ${alert.description || 'Reported'}`,
      time: getTimeAgo(alert.created_at),
      action: 'Review incident',
      actionFn: () => navigate('/emergency'),
    })
  })

  // Add offline vehicles
  offlineVehicles.slice(0, 3).forEach((v: any) => {
    attentionItems.push({
      id: v.id,
      type: 'offline',
      title: 'Vehicle offline',
      subtitle: `${v.plate_number}`,
      time: v.last_sync ? getTimeAgo(v.last_sync) : '',
      action: 'View vehicle',
      actionFn: () => {
        setSearchParams({ vehicle: v.id })
        setZoomFocusEvent(Date.now())
      },
    })
  })

  // Add online vehicles (put them at the top so they are visible)
  const recentlyOnline = [...reportingVehicles]
    .sort((a: any, b: any) => new Date(b.last_sync || 0).getTime() - new Date(a.last_sync || 0).getTime())
    .slice(0, 2);

  recentlyOnline.forEach((v: any) => {
    attentionItems.unshift({
      id: v.id,
      type: 'online',
      title: 'Vehicle online',
      subtitle: `${v.plate_number}`,
      time: v.last_sync ? getTimeAgo(v.last_sync) : 'Just now',
      action: 'Track live',
      actionFn: () => {
        setSearchParams({ vehicle: v.id })
        setZoomFocusEvent(Date.now())
      },
    })
  })

  // Fleet table data
  const fleetTableData = vehicles
    .filter((v: any) => !fleetSearch || v.plate_number.toLowerCase().includes(fleetSearch.toLowerCase()))
    .slice(0, 20)

  const now = new Date()

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Page Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Control Tower</h1>
          <button className="flex items-center gap-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors">
            India operations <ChevronDown size={14} />
          </button>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors shadow-sm">
            <Calendar size={14} className="text-slate-400" />
            {now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            <ChevronDown size={14} className="text-slate-400" />
          </button>
          <button
            onClick={openModal}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm shadow-blue-600/20"
          >
            <Plus size={16} strokeWidth={2.5} /> Create shipment
          </button>
        </div>
      </div>

      {/* ── KPI Metrics Row ────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: 'Active shipments',
            value: kpisLoading ? '—' : String(activeShipmentCount),
            sub: 'Current',
            highlight: false,
            color: 'blue',
            icon: Package,
          },
          {
            label: 'Tracked vehicles',
            value: kpisLoading ? '—' : String(vehicles.length),
            sub: `${reportingVehicles.length} reporting · ${offlineVehicles.length} offline`,
            highlight: false,
            color: 'indigo',
            icon: Truck,
          },
          {
            label: 'Open incident',
            value: String(openIncidents),
            sub: openIncidents > 0 ? 'Requires response' : 'All clear',
            highlight: openIncidents > 0,
            color: openIncidents > 0 ? 'red' : 'emerald',
            icon: openIncidents > 0 ? AlertCircle : Activity,
          },
          {
            label: 'On-time delivery',
            value: `${onTimeRate}%`,
            sub: 'Last 30 days',
            highlight: false,
            color: 'emerald',
            icon: Clock,
          },
        ].map(({ label, value, sub, highlight, color, icon: Icon }) => (
          <div
            key={label}
            className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
              <div className={clsx(
                "w-8 h-8 rounded-lg flex items-center justify-center",
                color === 'blue' ? 'bg-blue-50 text-blue-600' :
                color === 'indigo' ? 'bg-indigo-50 text-indigo-600' :
                color === 'red' ? 'bg-red-50 text-red-600' :
                'bg-emerald-50 text-emerald-600'
              )}>
                <Icon size={16} strokeWidth={2} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={clsx(
                "text-3xl font-bold tracking-tight",
                highlight ? "text-red-600" : "text-slate-900"
              )}>
                {value}
              </span>
              {highlight && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            </div>
            <div className="text-xs text-slate-400 mt-2">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Main Content: Map + Alerts + Vendor ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px_350px] gap-4 h-[440px]">
        {/* Live Fleet Map */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Live fleet</h2>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Updated {getSecondsAgo(lastRefresh)} sec ago
              </div>
            </div>
            <div className="flex bg-slate-100 p-0.5 rounded-lg">
              <button
                onClick={() => setMapView('map')}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  mapView === 'map' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <MapIcon size={13} /> Map
              </button>
              <button
                onClick={() => setMapView('list')}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  mapView === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <List size={13} /> List
              </button>
            </div>
          </div>
          <div className="h-[440px] relative">
            <LiveMap vehicles={vehicles} selectedVehicleId={selectedVehicleId} zoomFocusEvent={zoomFocusEvent} />
          </div>
          <div className="flex items-center gap-5 px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Reporting
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400" /> Offline
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Incident
            </div>
          </div>
        </div>

        {/* Needs Attention Panel */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Needs attention</h2>
              {attentionItems.filter(i => i.type !== 'online').length > 0 && (
                <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-sm">
                  {attentionItems.filter(i => i.type !== 'online').length}
                </span>
              )}
            </div>
            <button
              onClick={() => navigate('/fleet')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              View all
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Alert Items */}
            <div ref={needsAttentionRef as any} className="divide-y divide-slate-100">
              {attentionItems.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  <Activity size={24} className="mx-auto mb-2 text-slate-300" />
                  All clear — no issues detected
                </div>
              ) : (
                attentionItems.slice(0, 5).map((item) => (
                  <div key={item.id} className={clsx(
                    "px-5 py-4 flex items-start gap-3 hover:bg-slate-50 transition-colors relative",
                    item.type === 'incident' ? 'border-l-[3px] border-l-red-600 bg-red-50/30' :
                    item.type === 'offline' ? 'border-l-[3px] border-l-[#d25c48] bg-[#fdf3ec]' :
                    item.type === 'online' ? 'border-l-[3px] border-l-emerald-500 bg-emerald-50/30' :
                    'border-l-[3px] border-l-amber-400 bg-amber-50/30'
                  )}>
                    <div className="flex-shrink-0 mt-0.5">
                      {item.type === 'incident' && (
                        <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shadow-sm">
                          <AlertCircle size={16} className="text-white" strokeWidth={2} />
                        </div>
                      )}
                      {item.type === 'warning' && (
                        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shadow-sm">
                          <AlertTriangle size={16} className="text-amber-600" strokeWidth={2} />
                        </div>
                      )}
                      {item.type === 'offline' && (
                        <div className="w-8 h-8 rounded-full bg-[#f8d2c6] flex items-center justify-center">
                          <WifiOff size={16} className="text-[#a53b26]" strokeWidth={2} />
                        </div>
                      )}
                      {item.type === 'online' && (
                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                          <Wifi size={16} className="text-emerald-500 animate-pulse" strokeWidth={2} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={clsx(
                        "text-sm font-bold",
                        item.type === 'offline' ? "text-[#7a3321]" : 
                        item.type === 'online' ? "text-emerald-800" : "text-slate-900"
                      )}>{item.title}</div>
                      <div className={clsx(
                        "text-xs mt-0.5",
                        item.type === 'offline' ? "text-[#8a4a3a]" : 
                        item.type === 'online' ? "text-emerald-600" : "text-slate-500"
                      )}>{item.subtitle}</div>
                      <div className={clsx(
                        "text-[11px] mt-0.5",
                        item.type === 'offline' ? "text-[#9c5f50]" : 
                        item.type === 'online' ? "text-emerald-500" : "text-slate-400"
                      )}>{item.time}</div>
                    </div>
                    <button
                      onClick={item.actionFn}
                      className={clsx(
                        "flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors whitespace-nowrap",
                        item.type === 'offline' 
                          ? "bg-[#eff6ff] text-blue-700 hover:bg-blue-100" 
                          : item.type === 'online' 
                          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "text-blue-600 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                      )}
                    >
                      {item.action}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Recent Fleet Events */}
            <div className="border-t border-slate-200 px-5 py-3">
              <h3 className="text-xs font-semibold text-slate-900 mb-3">Recent fleet events</h3>
              <div className="space-y-2.5">
                {[...vehicles]
                  .filter((v: any) => v.last_sync)
                  .sort((a: any, b: any) => new Date(b.last_sync).getTime() - new Date(a.last_sync).getTime())
                  .slice(0, 4)
                  .map((v: any, i: number) => (
                  <div key={v.id} className="flex items-center gap-3 text-xs">
                    <span className="text-slate-400 font-mono w-10 text-right">
                      {v.last_sync ? new Date(v.last_sync).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </span>
                    <span className={clsx(
                      "w-2 h-2 rounded-full flex-shrink-0",
                      v.status === 'on_route' ? 'bg-emerald-500' :
                      v.status === 'maintenance' ? 'bg-red-500' :
                      v.status === 'offline' ? 'bg-slate-400' : 'bg-emerald-500'
                    )} />
                    <span className="text-slate-600 truncate">
                      {v.plate_number} {v.status === 'on_route' ? 'reported position' : v.status === 'maintenance' ? 'incident opened' : 'synced'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Vendor Orders / Partner Requests Panel */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm">
          <VendorRequestsAdmin />
        </div>
      </div>

      {/* ── Fleet Status Table ─────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Fleet status</h2>
            <span className="text-xs text-slate-400">{vehicles.length} vehicles</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus-within:border-slate-300 transition-colors">
              <Search size={14} className="text-slate-400" />
              <input
                placeholder="Search vehicles..."
                className="bg-transparent border-none outline-none text-xs text-slate-700 w-44 placeholder:text-slate-400"
                value={fleetSearch}
                onChange={e => setFleetSearch(e.target.value)}
              />
            </div>
            <button className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors">
              <Filter size={13} /> Filters
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                {['Vehicle', 'Driver', 'Location', 'Connection', 'Availability', 'Last update', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vehiclesLoading ? (
                <tr>
                  <td colSpan={7} className="py-16">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Spinner size={24} />
                      <span className="text-xs text-slate-400">Loading fleet data...</span>
                    </div>
                  </td>
                </tr>
              ) : fleetTableData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-sm text-slate-400">No vehicles found</td>
                </tr>
              ) : (
                fleetTableData.map((v: any) => {
                  const isOnline = v.status !== 'offline'
                  const isIncident = v.status === 'maintenance'
                  const statusLabel = isIncident ? 'Incident' : v.status === 'on_route' ? 'On Route' : v.status === 'available' ? 'Available' : v.status === 'idle' ? 'Idle' : 'Unknown'
                  const statusColor = isIncident ? 'text-red-600' : isOnline ? 'text-emerald-600' : 'text-slate-500'
                  const statusDot = isIncident ? 'bg-red-500' : isOnline ? 'bg-emerald-500' : 'bg-slate-400'

                  return (
                    <tr key={v.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4">
                        <span className="text-sm font-semibold text-slate-900">{v.plate_number}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-slate-600">{v.driver_name || 'Unassigned'}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-slate-600">
                          {v.latitude
                            ? `${v.latitude.toFixed(2)}, ${v.longitude.toFixed(2)}`
                            : 'Unknown'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={clsx(
                          "px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5",
                          isOnline ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                        )}>
                          <span className={clsx("w-1.5 h-1.5 rounded-full", isOnline ? "bg-emerald-500" : "bg-slate-400")} />
                          {isOnline ? 'Reporting' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={clsx(
                          "px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5",
                          isIncident ? "bg-red-100 text-red-700" :
                          isOnline ? "bg-emerald-100 text-emerald-700" :
                          "bg-slate-100 text-slate-600"
                        )}>
                          <span className={clsx("w-1.5 h-1.5 rounded-full", statusDot)} />
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={clsx(
                          "text-sm font-medium",
                          isOnline ? "text-emerald-600 flex items-center gap-1.5" : "text-slate-500"
                        )}>
                          {isOnline && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                          {isOnline ? 'Live' : (v.last_sync ? getTimeAgo(v.last_sync) : '—')}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <button
                          onClick={() => {
                            navigate('/fleet')
                          }}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          View <ChevronRight size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="text-right text-[11px] text-slate-400 pb-4">
        Latest refresh: {lastRefresh.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────
function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs} sec ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function getSecondsAgo(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
}
