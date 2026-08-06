import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, BarChart3, Users, Building2 } from 'lucide-react'
import FleetOverviewTab from '@/components/analytics/FleetOverviewTab'
import AdvancedAnalyticsTab from '@/components/analytics/AdvancedAnalyticsTab'
import LiveTelemetryTab from '@/components/analytics/LiveTelemetryTab'

type Tab = 'overview' | 'live' | 'driver' | 'vendor'

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [searchParams] = useSearchParams()
  // Keep for backwards-compat if someone links to ?vehicle=xxx — it auto-selects live tab
  const vehicleIdFilter = searchParams.get('vehicle')
  if (vehicleIdFilter && activeTab !== 'live') {
    // silent redirect to live tab when vehicle param is present
    setTimeout(() => setActiveTab('live'), 0)
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Fleet Overview', icon: BarChart3 },
    { id: 'live',     label: 'Live Telemetry', icon: Activity },
    { id: 'driver',   label: 'Driver Analytics', icon: Users },
    { id: 'vendor',   label: 'Vendor Analytics', icon: Building2 },
  ]

  return (
    <div style={{
      minHeight: '100vh',
      background: '#ffffff',
      padding: '32px 0',
      animation: 'fadeIn 0.4s ease',
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
        @keyframes pulse-dot { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px' }}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          {/* Live badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#10b981', boxShadow: '0 0 8px #10b981',
              display: 'inline-block',
              animation: 'pulse-dot 2s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: 11, color: '#10b981', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              LIVE
            </span>
          </div>

          {/* Title */}
          <h1 style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 'clamp(38px, 5vw, 58px)',
            fontWeight: 900,
            margin: 0,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            color: '#0f172a',
          }}>
            Analytics{' '}
            <span style={{
              background: 'linear-gradient(90deg, #f97316 0%, #ea580c 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              Dashboard
            </span>
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 8, fontWeight: 500 }}>
            Complete fleet intelligence
          </p>
        </div>

        {/* ── TABS ───────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 28,
          background: '#f1f5f9',
          border: '1px solid #e2e8f0',
          borderRadius: 16, padding: 4,
          width: 'fit-content',
        }}>
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                id={`tab-${id}`}
                onClick={() => setActiveTab(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '9px 20px',
                  borderRadius: 12,
                  border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700,
                  fontFamily: "'Inter', sans-serif",
                  transition: 'all 0.2s',
                  background: active
                    ? 'linear-gradient(135deg, #fef3c7, #ffedd5)'
                    : 'transparent',
                  color: active ? '#b45309' : '#64748b',
                  boxShadow: active ? 'inset 0 0 0 1.5px #f59e0b80' : 'none',
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            )
          })}
        </div>

        {/* ── TAB CONTENT ────────────────────────────────────────────── */}
        <div style={{ animation: 'fadeIn 0.25s ease' }} key={activeTab}>
          {activeTab === 'overview' && <FleetOverviewTab />}
          {activeTab === 'live'     && <LiveTelemetryTab />}
          {activeTab === 'driver'   && <AdvancedAnalyticsTab mode="driver" />}
          {activeTab === 'vendor'   && <AdvancedAnalyticsTab mode="vendor" />}
        </div>

      </div>
    </div>
  )
}
