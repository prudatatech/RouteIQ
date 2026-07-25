import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardHeader, Badge } from '@/components/ui'

const data = [
  { hour: '8am', completed: 28, failed: 2 },
  { hour: '9am', completed: 42, failed: 1 },
  { hour: '10am', completed: 61, failed: 3 },
  { hour: '11am', completed: 72, failed: 0 },
  { hour: '12pm', completed: 55, failed: 2 },
  { hour: '1pm', completed: 46, failed: 1 },
  { hour: '2pm', completed: 28, failed: 0 },
]

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <div style={{ fontFamily: 'Space Mono, monospace', color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ color: 'var(--accent)' }}>✓ {payload[0]?.value} completed</div>
      {payload[1]?.value > 0 && <div style={{ color: 'var(--accent2)' }}>✗ {payload[1]?.value} failed</div>}
    </div>
  )
}

export default function DeliveryChart() {
  const total = data.reduce((s, d) => s + d.completed, 0)
  return (
    <Card className="border-slate-200">
      <CardHeader
        title="Deliveries Today"
        subtitle="Hourly completion"
        action={<Badge variant="blue">{total} TOTAL</Badge>}
      />
      <div className="px-5 pb-5">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 10, right: 0, left: -25, bottom: 0 }} barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fill: '#4B5563', fontSize: 10, fontWeight: 900, fontFamily: 'Space Grotesk, sans-serif' }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              tick={{ fill: '#4B5563', fontSize: 10, fontWeight: 900 }}
              axisLine={false} tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(249,201,53,0.05)' }} />
            <Bar dataKey="completed" fill="#F9C935" radius={[4, 4, 0, 0]} opacity={0.9} />
            <Bar dataKey="failed" fill="#6B7280" radius={[4, 4, 0, 0]} opacity={0.4} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
