import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { routesAPI } from '@/services/api'
import { Card, Badge, StatusDot } from '@/components/ui'
import { format } from 'date-fns'
import { formatEta } from '@/utils/timeFormat'

export default function RouteDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data: route, isLoading, isError } = useQuery({
    queryKey: ['route', id],
    queryFn: () => routesAPI.get(id as string),
    enabled: !!id,
  })

  if (isLoading) {
    return <div style={{ padding: 40, color: '#64748B', textAlign: 'center' }}>Loading route details...</div>
  }

  if (isError || !route) {
    return <div style={{ padding: 40, color: '#EF4444', textAlign: 'center' }}>Failed to load route or route not found.</div>
  }

  return (
    <div>
      <button 
        onClick={() => navigate('/routes')} 
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, fontSize: 13, fontWeight: 500 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        Back to Routes
      </button>

      <div style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', color: '#0F172A', display: 'flex', alignItems: 'center', gap: 12 }}>
            Route Details
            <Badge variant="blue">{route.id.slice(0, 8)}</Badge>
          </h1>
          <p style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>
            Created on {format(new Date(route.created_at), 'dd MMM yyyy, HH:mm')}
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot status={route.status === 'active' ? 'on_route' : route.status === 'completed' ? 'available' : 'idle'} />
          <span style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize', color: '#0F172A' }}>{route.status}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Card className="p-4">
          <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#64748B', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 4 }}>Total Distance</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{route.total_distance_km?.toFixed(1)} km</p>
        </Card>
        <Card className="p-4">
          <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#64748B', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 4 }}>Est. Duration</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{formatEta(route.total_duration_minutes || 0)}</p>
        </Card>
        <Card className="p-4">
          <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#64748B', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 4 }}>Vehicle Assigned</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', fontFamily: 'monospace' }}>{route.vehicle_id}</p>
        </Card>
        <Card className="p-4">
          <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#64748B', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 4 }}>Optimization Score</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#10B981' }}>{route.optimization_score ? `${(route.optimization_score * 100).toFixed(0)}%` : 'N/A'}</p>
        </Card>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>Delivery Sequence</h2>
      <Card>
        {route.stops && route.stops.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Seq</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Point ID</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Address</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {route.stops.sort((a: any, b: any) => a.sequence - b.sequence).map((stop: any) => (
                <tr key={stop.id} style={{ borderBottom: '1px solid #E2E8F0' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0F172A' }}>{stop.sequence}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#64748B' }}>{stop.delivery_point_id.slice(0,8)}...</td>
                  <td style={{ padding: '12px 16px', color: '#0F172A' }}>
                    {stop.delivery_point?.address || `${stop.delivery_point?.lat.toFixed(4)}, ${stop.delivery_point?.lng.toFixed(4)}`}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <Badge variant={stop.status === 'completed' ? 'green' : stop.status === 'pending' ? 'blue' : 'muted'}>
                      {stop.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: '#64748B' }}>No stops assigned to this route.</div>
        )}
      </Card>
    </div>
  )
}
