import { AlertTriangle, RefreshCw, CloudRain, CheckCircle, Radio } from 'lucide-react'
import { Card, CardHeader, Badge } from '@/components/ui'

export interface Alert {
  id: string | number
  type: 'warning' | 'reroute' | 'weather' | 'success' | 'critical'
  title: string
  desc: string
  time: string
  color?: string
}

const ICON_MAP = {
  warning: AlertTriangle,
  reroute: RefreshCw,
  weather: CloudRain,
  success: CheckCircle,
  critical: Radio,
}

const COLOR_MAP = {
  warning: '#f59e0b',
  reroute: '#8b5cf6',
  weather: '#0ea5e9',
  success: '#10b981',
  critical: '#ef4444',
}

export default function AlertFeed({ alerts }: { alerts: Alert[] }) {
  return (
    <Card className="border-border bg-surface/50 backdrop-blur-xl">
      <CardHeader
        title="Live Fleet Events"
        subtitle="Dynamic telemetry & AI alerts"
        action={<Badge variant="orange">{alerts.length} NEW</Badge>}
      />
      <div className="px-6 pb-6 space-y-1 max-h-[400px] overflow-y-auto custom-scrollbar">
        {alerts.length === 0 ? (
          <div className="py-10 text-center text-muted text-[10px] font-bold uppercase tracking-widest">
            No active alerts
          </div>
        ) : (
          alerts.map(({ id, type, title, desc, time }) => {
            const Icon = ICON_MAP[type] || AlertTriangle
            const color = COLOR_MAP[type] || '#64748b'
            
            return (
              <div key={id} className="flex gap-4 py-4 border-b border-border last:border-0 group hover:bg-white/[0.02] -mx-2 px-2 rounded-xl transition-all animate-slide-in">
                <div 
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-inner" 
                  style={{ background: `${color}15`, border: `1px solid ${color}30` }}
                >
                  <Icon size={16} style={{ color }} className={type === 'critical' ? 'animate-pulse' : ''} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-black text-text text-sm tracking-tight leading-tight mb-1">{title}</div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wide leading-relaxed">{desc}</div>
                </div>
                <div className="text-[10px] font-black text-muted mono whitespace-nowrap pt-1 uppercase tracking-tighter">{time}</div>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
