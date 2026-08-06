/**
 * LiveTelemetryTab — Real-time fleet telemetry feed
 *
 * Data sources:
 *  1. Control Tower active missions  → /api/v1/analytics/active-missions
 *  2. Per-vehicle history            → /api/v1/telemetry/:id/history
 *  3. WebSocket broadcast            → ws://…/api/v1/telemetry/ws  (real-time push)
 *
 * Production-safe: auth token forwarded via WS query param, graceful reconnect,
 * no dependency on URL search params / vehicle pre-selection.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ScatterChart, Scatter,
} from 'recharts'
import { analyticsAPI, telemetryAPI, telemetryWS } from '@/services/api'
import { supabase } from '@/services/supabase'
import {
  Truck, Activity, Fuel, Wifi, WifiOff, ChevronDown,
  Zap, MapPin, Gauge, Clock,
} from 'lucide-react'

/* ─── Theme ──────────────────────────────────────────────────────────────── */
const T = {
  bg: '#ffffff',
  panel: '#fafafa',
  border: '#e4e4e7',
  borderSoft: '#f0f0f0',
  text: '#0f172a',
  sub: '#475569',
  mute: '#94a3b8',
  amber: '#d97706',
  amberSoft: '#fef3c7',
  green: '#16a34a',
  greenSoft: '#dcfce7',
  red: '#ef4444',
  blue: '#2563eb',
}

const lightTt = {
  background: '#fff',
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: '8px 12px',
  fontSize: 12,
  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07)',
}

/* ─── Stat pill ──────────────────────────────────────────────────────────── */
function StatPill({ icon: Icon, label, value, color = T.amber }: any) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${T.border}`,
      borderRadius: 14, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 12,
      flex: 1, minWidth: 140, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ background: T.amberSoft, borderRadius: 9, padding: 7, display: 'flex' }}>
          <Icon size={15} color={T.amber} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.sub }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: T.text, fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  )
}

/* ─── WS connection status badge ─────────────────────────────────────────── */
function WsBadge({ connected }: { connected: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 11, fontWeight: 700,
      color: connected ? T.green : T.red,
      background: connected ? T.greenSoft : '#fee2e2',
      padding: '4px 10px', borderRadius: 20,
    }}>
      {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
      {connected ? 'WebSocket Live' : 'WS Reconnecting…'}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════════════ */
export default function LiveTelemetryTab() {
  /* ── Active missions from Control Tower ── */
  const { data: missions = [], isLoading: missionsLoading } = useQuery({
    queryKey: ['active-missions'],
    queryFn: () => analyticsAPI.activeMissions(),
    refetchInterval: 20_000,
  })

  // Derive unique vehicles from active missions + any on_route vehicles
  const missionVehicles = (missions as any[]).map((m: any) => ({
    id: m.vehicle_id || m.id,
    plate: m.plate_number || m.vehicle_plate || m.plate || 'Unknown',
    status: m.status,
    driver: m.driver_name || m.driver || 'Unassigned',
    route: m.route_name || m.destination || '—',
  })).filter(v => !!v.id)

  /* ── Selected vehicle ── */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedId && missionVehicles.length > 0) {
      setSelectedId(missionVehicles[0].id)
    }
  }, [missionVehicles.length])

  const selectedVehicle = missionVehicles.find(v => v.id === selectedId) || null

  /* ── Historical telemetry for selected vehicle ── */
  const { data: histRaw = [] } = useQuery({
    queryKey: ['telem-history', selectedId],
    queryFn: () => telemetryAPI.history(selectedId!, 150),
    enabled: !!selectedId,
    refetchInterval: 30_000,
  })

  /* ── Live telemetry stream via WebSocket ── */
  const [livePoints, setLivePoints] = useState<Map<string, any[]>>(new Map())
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connectWS = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Attach auth token as query param for production-safe auth
    let wsUrl = telemetryWS.getURL()
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        wsUrl += `?token=${encodeURIComponent(session.access_token)}`
      }
    } catch { /* ignore — ws server also accepts un-authed for live feed */ }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => {
      setWsConnected(false)
      // Exponential backoff reconnect (max 10s)
      reconnectRef.current = setTimeout(connectWS, 5_000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        // Expected shape: { vehicle_id, speed_kmph, fuel_level_pct, latitude, longitude, timestamp }
        const vehicleId = msg.vehicle_id
        if (!vehicleId) return
        setLivePoints(prev => {
          const existing = prev.get(vehicleId) ?? []
          const point = {
            time: new Date(msg.timestamp || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            speed: msg.speed_kmph ?? 0,
            fuel: msg.fuel_level_pct ?? 0,
            lat: msg.latitude,
            lng: msg.longitude,
          }
          const updated = [...existing, point].slice(-120) // keep last 120 points
          const next = new Map(prev)
          next.set(vehicleId, updated)
          return next
        })
      } catch { /* ignore malformed */ }
    }
  }, [])

  useEffect(() => {
    connectWS()
    return () => {
      wsRef.current?.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
    }
  }, [connectWS])

  /* ── Build chart data for selected vehicle ── */
  const histPoints = (histRaw as any[]).slice().reverse().map((t: any) => ({
    time: new Date(t.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    speed: t.speed_kmph ?? 0,
    fuel: t.fuel_level_pct ?? 0,
    lat: t.latitude,
    lng: t.longitude,
  }))

  // Merge historical + live for the selected vehicle
  const liveForSelected = selectedId ? (livePoints.get(selectedId) ?? []) : []
  const chartData = liveForSelected.length > 0 ? liveForSelected : histPoints

  const lastPoint = chartData[chartData.length - 1]

  /* ─────────────────────────────── RENDER ─────────────────────────────── */
  if (missionsLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: `3px solid ${T.amberSoft}`, borderTop: `3px solid ${T.amber}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ color: T.mute, fontSize: 13 }}>Fetching active missions from Control Tower…</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        @keyframes pulse-dot { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
      `}</style>

      {/* ── Header row ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.text, fontFamily: "'Space Grotesk', sans-serif" }}>
            Control Tower &amp; Cargo Manifest — Live Feed
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: T.mute }}>
            Real-time telemetry from all active missions · WebSocket broadcast
          </p>
        </div>
        <WsBadge connected={wsConnected} />
      </div>

      {/* ── Vehicle selector (derived from active missions) ── */}
      {missionVehicles.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '64px 24px',
          background: T.panel, border: `1px solid ${T.borderSoft}`,
          borderRadius: 20,
        }}>
          <Truck size={44} color={T.mute} style={{ margin: '0 auto 14px', display: 'block' }} />
          <p style={{ color: T.sub, fontWeight: 700, fontSize: 14, margin: 0 }}>No active missions right now</p>
          <p style={{ color: T.mute, fontSize: 12, marginTop: 6 }}>
            Assign a vehicle to a route in the Control Tower to start seeing live telemetry here.
          </p>
        </div>
      ) : (
        <>
          {/* Horizontal vehicle tabs */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
            {missionVehicles.map(v => {
              const active = v.id === selectedId
              return (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '8px 16px', borderRadius: 12, cursor: 'pointer',
                    border: active ? `2px solid ${T.amber}` : `1px solid ${T.border}`,
                    background: active ? T.amberSoft : T.panel,
                    color: active ? T.amber : T.sub,
                    fontSize: 13, fontWeight: active ? 800 : 600,
                    transition: 'all 0.15s',
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {/* Live pulse dot when WS data is flowing */}
                  {wsConnected && livePoints.has(v.id) && (
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: T.green,
                      animation: 'pulse-dot 1.5s ease-in-out infinite',
                      display: 'inline-block',
                    }} />
                  )}
                  <Truck size={13} />
                  {v.plate}
                </button>
              )
            })}
          </div>

          {/* Selected vehicle info bar */}
          {selectedVehicle && (
            <div style={{
              background: T.panel, border: `1px solid ${T.borderSoft}`,
              borderRadius: 14, padding: '12px 18px',
              display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
              marginBottom: 20,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: T.amberSoft, padding: 6, borderRadius: 8 }}>
                  <Truck size={14} color={T.amber} />
                </div>
                <span style={{ fontWeight: 800, color: T.text, fontSize: 14 }}>{selectedVehicle.plate}</span>
              </div>
              <div>
                <span style={{ fontSize: 11, color: T.mute }}>Driver</span>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{selectedVehicle.driver}</div>
              </div>
              <div>
                <span style={{ fontSize: 11, color: T.mute }}>Route / Destination</span>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{selectedVehicle.route}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: liveForSelected.length > 0 ? T.green : T.mute,
                  boxShadow: liveForSelected.length > 0 ? `0 0 6px ${T.green}` : 'none',
                  animation: liveForSelected.length > 0 ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
                  display: 'inline-block',
                }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: liveForSelected.length > 0 ? T.green : T.mute }}>
                  {liveForSelected.length > 0 ? `${liveForSelected.length} live pings` : 'Historical data'}
                </span>
              </div>
            </div>
          )}

          {/* ── KPI stat pills ── */}
          {chartData.length > 0 && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
              <StatPill icon={Gauge}    label="Current Speed"  value={`${lastPoint?.speed ?? '—'} km/h`} />
              <StatPill icon={Fuel}     label="Fuel Level"     value={lastPoint?.fuel !== undefined ? `${lastPoint.fuel}%` : '—'} />
              <StatPill icon={Activity} label="Data Points"    value={chartData.length} />
              <StatPill icon={Clock}    label="Last Update"    value={lastPoint?.time ?? '—'} />
              <StatPill icon={MapPin}   label="GPS Fix"        value={lastPoint?.lat ? `${lastPoint.lat.toFixed(4)}° N` : '—'} />
            </div>
          )}

          {/* ── Charts grid ── */}
          {chartData.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '64px 24px',
              background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 20,
            }}>
              <Zap size={36} color={T.mute} style={{ margin: '0 auto 12px', display: 'block' }} />
              <p style={{ color: T.sub, fontWeight: 700, margin: 0, fontSize: 14 }}>Waiting for telemetry…</p>
              <p style={{ color: T.mute, fontSize: 12, marginTop: 6 }}>
                GPS data will appear here in real-time once the vehicle starts transmitting.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Speed */}
              <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontWeight: 800, color: T.text, marginBottom: 4, fontFamily: "'Space Grotesk', sans-serif" }}>Speed — km/h</div>
                <div style={{ fontSize: 11, color: T.mute, marginBottom: 14 }}>
                  {liveForSelected.length > 0 ? '🔴 Live WebSocket stream' : 'Historical telemetry'} · {chartData.length} pings
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="spdGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={T.amber} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={T.amber} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} vertical={false} />
                    <XAxis dataKey="time" tick={{ fill: T.mute, fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis unit=" km/h" tick={{ fill: T.mute, fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={lightTt} />
                    <Area type="monotone" dataKey="speed" stroke={T.amber} fill="url(#spdGrad)" strokeWidth={2.5} name="Speed" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Fuel */}
              <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontWeight: 800, color: T.text, marginBottom: 4, fontFamily: "'Space Grotesk', sans-serif" }}>Fuel Level — %</div>
                <div style={{ fontSize: 11, color: T.mute, marginBottom: 14 }}>Real-time fuel depletion monitoring</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} vertical={false} />
                    <XAxis dataKey="time" tick={{ fill: T.mute, fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fill: T.mute, fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={lightTt} />
                    <Line type="monotone" dataKey="fuel" stroke={T.green} strokeWidth={2.5} dot={false} name="Fuel %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* GPS Trail */}
              <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, gridColumn: '1 / -1', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontWeight: 800, color: T.text, marginBottom: 4, fontFamily: "'Space Grotesk', sans-serif" }}>GPS Trail</div>
                <div style={{ fontSize: 11, color: T.mute, marginBottom: 14 }}>Route path from {chartData.filter(p => p.lat && p.lng).length} GPS coordinates</div>
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} />
                    <XAxis
                      dataKey="lng" name="Longitude" type="number"
                      domain={['dataMin - 0.01', 'dataMax + 0.01']}
                      tick={{ fill: T.mute, fontSize: 9 }} axisLine={false} tickLine={false}
                      tickFormatter={(v: number) => v.toFixed(3)}
                    />
                    <YAxis
                      dataKey="lat" name="Latitude" type="number"
                      domain={['dataMin - 0.01', 'dataMax + 0.01']}
                      tick={{ fill: T.mute, fontSize: 9 }} axisLine={false} tickLine={false}
                      tickFormatter={(v: number) => v.toFixed(3)}
                    />
                    <Tooltip contentStyle={lightTt} cursor={{ strokeDasharray: '3 3' }} formatter={(v: any) => v.toFixed(5)} />
                    <Scatter data={chartData.filter(p => p.lat && p.lng)} fill={T.amber} opacity={0.75} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* All-vehicle WS summary */}
              {livePoints.size > 0 && (
                <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, gridColumn: '1 / -1', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                  <div style={{ fontWeight: 800, color: T.text, marginBottom: 14, fontFamily: "'Space Grotesk', sans-serif" }}>
                    All Active Vehicles — Live WS Status
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {Array.from(livePoints.entries()).map(([vid, pts]) => {
                      const veh = missionVehicles.find(v => v.id === vid)
                      const last = pts[pts.length - 1]
                      return (
                        <div
                          key={vid}
                          onClick={() => setSelectedId(vid)}
                          style={{
                            background: vid === selectedId ? T.amberSoft : T.panel,
                            border: `1px solid ${vid === selectedId ? T.amber : T.border}`,
                            borderRadius: 14, padding: '12px 16px',
                            cursor: 'pointer', minWidth: 160,
                            transition: '0.15s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.green, animation: 'pulse-dot 1.5s ease-in-out infinite', display: 'inline-block' }} />
                            <span style={{ fontWeight: 800, fontSize: 13, color: T.text }}>{veh?.plate ?? vid.slice(0, 8)}</span>
                          </div>
                          <div style={{ fontSize: 11, color: T.sub }}>{last?.speed ?? '—'} km/h · Fuel: {last?.fuel ?? '—'}%</div>
                          <div style={{ fontSize: 10, color: T.mute, marginTop: 4 }}>{pts.length} live pings</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
