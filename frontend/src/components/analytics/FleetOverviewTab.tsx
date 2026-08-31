import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { analyticsAPI } from '@/services/api'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Truck, IndianRupee, Fuel, Wrench,
  Package, Activity, Zap, AlertTriangle, CheckCircle, Clock,
  ArrowRight, RefreshCw, BarChart3, Star, Route, Battery,
  ShieldCheck, Droplets,
} from 'lucide-react'

// ─── Health score SVG ring ─────────────────────────────────────────────────
function HealthRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const fill = (score / 100) * circ
  const color = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={7} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={7}
        strokeDasharray={`${fill} ${circ - fill}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 1s ease' }}
      />
      <text
        x={size / 2} y={size / 2 + 6}
        textAnchor="middle"
        fill={color}
        fontSize={size < 70 ? 14 : 18}
        fontWeight="800"
        fontFamily="'Space Grotesk', sans-serif"
        style={{ transform: `rotate(90deg) translate(0, -${size}px)`, transformOrigin: `${size / 2}px ${size / 2}px` }}
      >
        {score}
      </text>
    </svg>
  )
}

// ─── KPI Metric Card ───────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, icon: Icon, color, bgColor, loading
}: {
  label: string; value: string | number; sub?: string
  icon: any; color: string; bgColor: string; loading?: boolean
}) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 20,
      padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: 14,
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      transition: 'border-color 0.2s, transform 0.2s, box-shadow 0.2s',
      cursor: 'default',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d97706'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(217,119,6,0.15)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: 10, padding: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={16} color="#d97706" />
          </div>
          <span style={{ fontSize: 13, color: '#334155', fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>
            {label}
          </span>
        </div>
        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          LIVE
        </span>
      </div>
      {loading ? (
        <div style={{ height: 36, background: '#f1f5f9', borderRadius: 8, animation: 'shimmer 1.5s infinite' }} />
      ) : (
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1 }}>
            {value}
          </div>
          {sub && (
            <div style={{ fontSize: 11, color: '#d97706', fontWeight: 700, marginTop: 4 }}>
              {sub}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── AI Insight Card ───────────────────────────────────────────────────────
const insightMeta: Record<string, { color: string; bg: string; label: string }> = {
  delay_risk:            { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', label: 'DELAY RISK' },
  fuel_efficiency:       { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'FUEL ALERT' },
  backhaul_opportunity:  { color: '#10b981', bg: 'rgba(16,185,129,0.1)', label: 'OPPORTUNITY' },
  idle_vehicle:          { color: '#6366f1', bg: 'rgba(99,102,241,0.1)', label: 'IDLE ALERT' },
  maintenance_due:       { color: '#f97316', bg: 'rgba(249,115,22,0.1)', label: 'MAINTENANCE' },
  reroute_suggestion:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', label: 'REROUTE' },
  efficiency:            { color: '#10b981', bg: 'rgba(16,185,129,0.1)', label: 'FLEET OK' },
}
const insightIcon: Record<string, any> = {
  delay_risk: AlertTriangle,
  fuel_efficiency: Fuel,
  backhaul_opportunity: TrendingUp,
  idle_vehicle: Clock,
  maintenance_due: Wrench,
  reroute_suggestion: Route,
  efficiency: CheckCircle,
}

function InsightCard({ insight }: { insight: any }) {
  const meta = insightMeta[insight.type] || insightMeta.efficiency
  const Icon = insightIcon[insight.type] || Zap

  return (
    <div style={{
      background: meta.bg,
      border: `1px solid ${meta.color}30`,
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <div style={{ marginTop: 2, flexShrink: 0 }}>
        <Icon size={16} color={meta.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
            color: meta.color, textTransform: 'uppercase',
            background: meta.bg, padding: '2px 6px', borderRadius: 20,
            border: `1px solid ${meta.color}40`,
          }}>{meta.label}</span>
          {insight.plate_number && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: "'IBM Plex Mono', monospace" }}>
              {insight.plate_number}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: meta.color }}>
            {insight.score?.toFixed(0)}
          </span>
        </div>
        <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, margin: 0 }}>
          {insight.insight}
        </p>
      </div>
    </div>
  )
}

// ─── Component health bar ───────────────────────────────────────────────────
function ComponentBar({ label, status, score, icon: Icon, color }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <Icon size={13} color={color} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: '#64748b', minWidth: 90, fontWeight: 500 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: '#f1f5f9', borderRadius: 99 }}>
        <div style={{
          height: '100%', width: `${score}%`,
          background: score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444',
          borderRadius: 99, transition: 'width 1s ease',
        }} />
      </div>
      <span style={{ fontSize: 10, color: '#94a3b8', minWidth: 100, textAlign: 'right' }}>{status}</span>
    </div>
  )
}

// ─── Vehicle Health Card ───────────────────────────────────────────────────
function VehicleHealthCard({ vehicle }: { vehicle: any }) {
  const [expanded, setExpanded] = useState(false)
  const score = vehicle.health_score
  const statusColor = vehicle.status === 'on_route' ? '#10b981' : vehicle.status === 'idle' ? '#f59e0b' : '#6366f1'
  const c = vehicle.components

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0',
      borderRadius: 20, padding: '20px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      transition: 'border-color 0.2s, transform 0.2s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#cbd5e1'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)' }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
        <HealthRing score={score} size={72} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a', fontFamily: "'Space Grotesk', sans-serif" }}>
            {vehicle.plate_number}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
            {vehicle.vehicle_type}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{
              background: statusColor + '15', color: statusColor,
              fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>{vehicle.status?.replace('_', ' ')}</span>
            <span style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Route size={10} /> {vehicle.total_distance_km?.toLocaleString('en-IN')} km
            </span>
          </div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444', fontFamily: "'Space Grotesk', sans-serif" }}>
          {score}<span style={{ fontSize: 12, color: '#cbd5e1' }}>/100</span>
        </div>
      </div>

      {/* Quick status row */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {[
          { icon: Droplets, label: 'Fuel', val: `${c.fuel?.level_pct}%`, ok: c.fuel?.score > 30 },
          { icon: Battery, label: 'Battery', val: c.battery?.status, ok: c.battery?.score > 50 },
          { icon: ShieldCheck, label: 'Insurance', val: `${c.insurance?.days_remaining}d`, ok: c.insurance?.days_remaining > 30 },
        ].map(({ icon: I, label, val, ok }) => (
          <span key={label} style={{
            background: ok ? '#ecfdf5' : '#fef2f2',
            color: ok ? '#10b981' : '#ef4444',
            border: `1px solid ${ok ? '#d1fae5' : '#fee2e2'}`,
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 12,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <I size={10} />{label}: {val}
          </span>
        ))}
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(p => !p)}
        style={{
          width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0',
          borderRadius: 10, padding: '7px', color: '#64748b', fontSize: 11, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          transition: '0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
        onMouseLeave={e => (e.currentTarget.style.background = '#f8fafc')}
      >
        {expanded ? 'Hide Details' : 'Show Component Breakdown'}
        <ArrowRight size={10} style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: '0.2s' }} />
      </button>

      {expanded && (
        <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
          <ComponentBar label="Oil Change" status={c.oil_change?.status} score={c.oil_change?.score} icon={Droplets} color="#f59e0b" />
          <ComponentBar label="Brake Pads" status={c.brake_pads?.status} score={c.brake_pads?.score} icon={Activity} color="#ef4444" />
          <ComponentBar label="Battery" status={c.battery?.status} score={c.battery?.score} icon={Battery} color="#3b82f6" />
          <ComponentBar label="Tyres" status={c.tyres?.status} score={c.tyres?.score} icon={Route} color="#10b981" />
          <ComponentBar label="Insurance" status={c.insurance?.status} score={c.insurance?.score} icon={ShieldCheck} color="#6366f1" />
          <ComponentBar label="Fuel" status={c.fuel?.status} score={c.fuel?.score} icon={Fuel} color="#f59e0b" />
        </div>
      )}
    </div>
  )
}

// ─── Custom chart tooltip ──────────────────────────────────────────────────
const DarkTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0',
      borderRadius: 10, padding: '10px 14px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    }}>
      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: ₹{p.value?.toLocaleString('en-IN')}
        </div>
      ))}
    </div>
  )
}

// ─── Section header ────────────────────────────────────────────────────────
function SectionHeader({ title, sub, icon: Icon, accent = '#d97706' }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
      <div style={{
        background: accent + '15', color: accent, padding: 10,
        borderRadius: 12, display: 'flex', alignItems: 'center',
      }}>
        <Icon size={18} />
      </div>
      <div>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a', fontFamily: "'Space Grotesk', sans-serif" }}>
          {title}
        </h3>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</p>
      </div>
    </div>
  )
}

// ─── Spinner ────────────────────────────────────────────────────────────────
function Spin() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <RefreshCw size={28} color="#F9C935" style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function FleetOverviewTab() {
  const REFETCH = 30_000

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ['fleet-overview'], queryFn: () => analyticsAPI.fleetOverview(), refetchInterval: REFETCH,
  })
  const { data: vehicleHealth = [], isLoading: vhLoading } = useQuery({
    queryKey: ['vehicle-health'], queryFn: () => analyticsAPI.vehicleHealth().then((d: any) => Array.isArray(d) ? d : []), refetchInterval: REFETCH,
  })
  const { data: profRoutes = [], isLoading: prLoading } = useQuery({
    queryKey: ['profitable-routes'], queryFn: () => analyticsAPI.profitableRoutes().then((d: any) => Array.isArray(d) ? d : []), refetchInterval: REFETCH,
  })
  const { data: insights = [], isLoading: insLoading } = useQuery({
    queryKey: ['fleet-insights'], queryFn: () => analyticsAPI.insights().then((d: any) => Array.isArray(d) ? d : []), refetchInterval: REFETCH,
  })
  const { data: drivers = [], isLoading: drvLoading } = useQuery({
    queryKey: ['driver-performance'], queryFn: () => analyticsAPI.driverPerformance().then((d: any) => Array.isArray(d) ? d : []), refetchInterval: REFETCH,
  })
  const { data: financials = [], isLoading: finLoading } = useQuery({
    queryKey: ['financials'], queryFn: () => analyticsAPI.financials().then((d: any) => Array.isArray(d) ? d : []), refetchInterval: REFETCH,
  })

  const ov = overview as any
  const fmt = (n: number) => `₹${n?.toLocaleString('en-IN') ?? '—'}`

  const kpiCards = [
    { label: 'Daily Revenue', value: fmt(ov?.daily_revenue), icon: IndianRupee, color: '#d97706', bgColor: 'rgba(217,119,6,0.1)' },
    { label: 'Trips Today', value: ov?.trips_today ?? '—', icon: Route, color: '#2563eb', bgColor: 'rgba(37,99,235,0.1)' },
    { label: 'Running Vehicles', value: ov?.running_vehicles ?? '—', icon: Truck, color: '#059669', bgColor: 'rgba(5,150,105,0.1)' },
    { label: 'Idle Vehicles', value: ov?.idle_vehicles ?? '—', icon: Clock, color: '#d97706', bgColor: 'rgba(217,119,6,0.1)' },
    { label: 'Fleet Utilisation', value: `${ov?.fleet_utilisation_pct ?? '—'}%`, icon: Activity, color: '#7c3aed', bgColor: 'rgba(124,58,237,0.1)' },
    { label: 'Profit / Truck', value: fmt(ov?.profit_per_truck), sub: 'today', icon: TrendingUp, color: '#059669', bgColor: 'rgba(5,150,105,0.1)' },
    { label: 'Cost / KM', value: `₹${ov?.cost_per_km ?? '—'}`, icon: BarChart3, color: '#dc2626', bgColor: 'rgba(220,38,38,0.1)' },
    { label: 'Fuel Expenses', value: fmt(ov?.fuel_expenses), icon: Fuel, color: '#ea580c', bgColor: 'rgba(234,88,12,0.1)' },
    { label: 'Maintenance', value: fmt(ov?.maintenance_expenses), icon: Wrench, color: '#6d28d9', bgColor: 'rgba(109,40,217,0.1)' },
    { label: 'Backhaul Revenue', value: fmt(ov?.backhaul_revenue), sub: 'today', icon: Package, color: '#059669', bgColor: 'rgba(5,150,105,0.1)' },
  ]

  return (
    <div style={{ color: '#0f172a', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @keyframes shimmer { 0%,100% { opacity: 0.4 } 50% { opacity: 0.8 } }
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse-dot { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }
        .live-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #10b981;
          animation: pulse-dot 2s ease-in-out infinite;
          display: inline-block; margin-right: 6px;
        }
      `}</style>

      {/* ── KPI GRID ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader title="Fleet Command Centre" sub="Live operational metrics · refreshes every 30s" icon={Activity} accent="#F9C935" />
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 14,
        }}>
          {kpiCards.map(c => (
            <KpiCard key={c.label} {...c} loading={ovLoading} />
          ))}
        </div>

        {/* Profit / Cost summary bar */}
        {!ovLoading && ov && (
          <div style={{
            marginTop: 14,
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: 16, padding: '14px 20px',
            display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Today's Summary
            </span>
            {[
              { label: 'Total Revenue', val: fmt(ov.daily_revenue + ov.backhaul_revenue), color: '#10b981' },
              { label: 'Total Cost', val: fmt(ov.total_cost), color: '#ef4444' },
              { label: 'Net Profit', val: fmt(ov.total_profit), color: ov.total_profit >= 0 ? '#10b981' : '#ef4444' },
              { label: 'Distance Covered', val: `${ov.total_distance_km?.toLocaleString('en-IN')} km`, color: '#3b82f6' },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'Space Grotesk', sans-serif" }}>{val}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── REVENUE CHART + AI INSIGHTS side by side ─────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
        {/* 7-day financial chart */}
        <div style={{
          background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 20, padding: '24px',
        }}>
          <SectionHeader title="7-Day P&L" sub="Revenue vs Cost vs Profit trend" icon={TrendingUp} accent="#10b981" />
          {finLoading ? <Spin /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={financials as any[]} margin={{ top: 5, right: 0, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                <Tooltip content={<DarkTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revGrad)" name="Revenue" />
                <Area type="monotone" dataKey="cost" stroke="#ef4444" strokeWidth={2} fill="url(#costGrad)" name="Cost" />
                <Line type="monotone" dataKey="profit" stroke="#F9C935" strokeWidth={2.5} dot={false} name="Profit" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* AI Fleet Intelligence */}
        <div style={{
          background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 20, padding: '24px',
        }}>
          <SectionHeader title="AI Fleet Intelligence" sub="Live system alerts · auto-generated from telemetry" icon={Zap} accent="#F9C935" />
          {insLoading ? <Spin /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
              {(insights as any[]).length === 0 ? (
                <div style={{ textAlign: 'center', padding: 30, color: '#cbd5e1', fontSize: 13 }}>
                  No active alerts. Fleet is operating normally.
                </div>
              ) : (
                (insights as any[]).map((ins: any) => <InsightCard key={ins.id} insight={ins} />)
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── VEHICLE HEALTH ────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader title="Vehicle Health Monitor" sub="Dynamic health scores computed from telemetry & route data" icon={Activity} accent="#10b981" />
        {vhLoading ? <Spin /> : (vehicleHealth as any[]).length === 0 ? (
          <div style={{
            textAlign: 'center', padding: 40,
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 20,
            color: '#94a3b8', fontSize: 13,
          }}>No vehicles found. Add vehicles to see health scores.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {(vehicleHealth as any[]).map((v: any) => <VehicleHealthCard key={v.id} vehicle={v} />)}
          </div>
        )}
      </div>

      {/* ── DRIVERS + ROUTES side by side ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 16 }}>

        {/* Top Performing Drivers */}
        <div style={{
          background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 20, padding: '24px',
        }}>
          <SectionHeader title="Top Performing Drivers" sub="Ranked by route completion & rating" icon={Star} accent="#F9C935" />
          {drvLoading ? <Spin /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(drivers as any[]).slice(0, 8).map((d: any, i: number) => (
                <div key={d.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  borderRadius: 12, background: i < 3 ? '#fffbeb' : 'transparent',
                  border: i < 3 ? '1px solid #fde68a' : '1px solid transparent',
                  transition: 'background 0.2s',
                }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%', fontSize: 11, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: i === 0 ? '#F9C935' : i === 1 ? '#e2e8f0' : i === 2 ? '#fb923c' : '#f1f5f9',
                    color: i < 2 ? '#0d0d14' : '#fff', flexShrink: 0,
                  }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.name !== 'Unassigned' ? d.name : d.plate_number}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      {d.plate_number} · {d.completed_routes} trips
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#d97706', fontSize: 13, fontWeight: 800 }}>
                      <Star size={11} fill="#d97706" />{d.rating}
                    </div>
                    <div style={{ fontSize: 10, color: '#10b981' }}>{d.on_time_pct}% on-time</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Most Profitable Routes */}
        <div style={{
          background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 20, padding: '24px',
        }}>
          <SectionHeader title="Most Profitable Routes" sub="By net profit from completed routes" icon={TrendingUp} accent="#10b981" />
          {prLoading ? <Spin /> : (profRoutes as any[]).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: '#cbd5e1', fontSize: 13 }}>
              No completed routes with revenue data yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(profRoutes as any[]).map((r: any, i: number) => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.label}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                      {r.distance_km} km · Rev: {fmt(r.revenue)} · Cost: {fmt(r.cost)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: r.profit >= 0 ? '#10b981' : '#ef4444', fontFamily: "'Space Grotesk', sans-serif" }}>
                      {fmt(r.profit)}
                    </div>
                    <div style={{
                      fontSize: 10, fontWeight: 600, marginTop: 2,
                      color: r.profit_margin_pct >= 20 ? '#10b981' : r.profit_margin_pct >= 0 ? '#f59e0b' : '#ef4444',
                    }}>
                      {r.profit_margin_pct}% margin
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── FLEET UTILISATION BAR CHART ───────────────────────── */}
      {!ovLoading && ov && (
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20, padding: '24px',
        }}>
          <SectionHeader title="Fleet Composition" sub="Vehicle status breakdown" icon={Truck} accent="#3b82f6" />
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { label: 'On Route', count: ov.running_vehicles, color: '#10b981' },
              { label: 'Idle', count: ov.idle_vehicles, color: '#f59e0b' },
              { label: 'Other', count: Math.max(0, ov.total_vehicles - ov.running_vehicles - ov.idle_vehicles), color: '#6366f1' },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ flex: 1, minWidth: 140 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{label}</span>
                  <span style={{ fontSize: 12, color, fontWeight: 800 }}>{count}</span>
                </div>
                <div style={{ height: 8, background: '#f1f5f9', borderRadius: 99 }}>
                  <div style={{
                    height: '100%', borderRadius: 99, background: color,
                    width: `${ov.total_vehicles > 0 ? (count / ov.total_vehicles) * 100 : 0}%`,
                    transition: 'width 1s ease',
                  }} />
                </div>
              </div>
            ))}
            <div style={{ textAlign: 'center', padding: '10px 20px', background: 'rgba(255,255,255,0.04)', borderRadius: 14 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', fontFamily: "'Space Grotesk', sans-serif" }}>
                {ov.fleet_utilisation_pct}%
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Fleet Utilisation</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
