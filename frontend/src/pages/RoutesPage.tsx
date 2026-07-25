import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { routesAPI } from '@/services/api'
import { Card, Badge, StatusDot } from '@/components/ui'
import { format } from 'date-fns'
import { formatEta } from '@/utils/timeFormat'
import toast from 'react-hot-toast'

export default function RoutesPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [editingRoute, setEditingRoute] = useState<any>(null)

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['routes'],
    queryFn: () => routesAPI.list({ limit: 50 }),
    refetchInterval: 20_000,
  })

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: '#0F172A' }}>
          Routes
        </h1>
        <p style={{ color: '#64748B', fontSize: 13, marginTop: 2 }}>
          All active and completed routes
        </p>
      </div>

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
              {['Route ID', 'Vehicle', 'Status', 'Distance', 'Duration', 'Fuel Est.', 'Score', 'Created', 'Actions'].map(h => (
                <th key={h} style={{
                  padding: '12px 16px', textAlign: 'left',
                  fontSize: 11, color: '#64748B',
                  textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>Loading routes...</td></tr>
            ) : routes.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
                No routes yet. Run the optimizer to create routes.
              </td></tr>
            ) : routes.map((r: any) => (
              <tr key={r.id}
                style={{ borderBottom: '1px solid #E2E8F0', cursor: 'pointer', transition: 'background 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: '#0F172A', fontWeight: 500 }}>
                  {r.id.slice(0, 8)}...
                </td>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: '#0F172A', fontWeight: 500 }}>
                  {r.vehicle_id.slice(0, 8)}...
                </td>
                <td style={{ padding: '12px 16px', color: '#0F172A', fontWeight: 500 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusDot status={r.status === 'active' ? 'on_route' : r.status === 'completed' ? 'available' : 'idle'} />
                    <span style={{ fontSize: 12 }}>{r.status}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 16px', color: '#0F172A', fontWeight: 500 }}>{r.total_distance_km?.toFixed(1)} km</td>
                <td style={{ padding: '12px 16px', color: '#0F172A', fontWeight: 500 }}>{formatEta(r.total_duration_minutes || 0)}</td>
                <td style={{ padding: '12px 16px', color: '#0F172A', fontWeight: 500 }}>{r.estimated_fuel_liters?.toFixed(1)} L</td>
                <td style={{ padding: '12px 16px' }}>
                  {r.optimization_score
                    ? <Badge variant="green">{(r.optimization_score * 100).toFixed(0)}%</Badge>
                    : '—'}
                </td>
                <td style={{ padding: '12px 16px', color: '#64748B', fontSize: 11, fontWeight: 500 }}>
                  {format(new Date(r.created_at), 'dd MMM, HH:mm')}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.status === 'pending' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          routesAPI.updateStatus(r.id, 'active').then(() => {
                            toast.success('Route dispatched! Vehicle marked as on_route.');
                            queryClient.invalidateQueries({ queryKey: ['routes'] });
                            queryClient.invalidateQueries({ queryKey: ['vehicles'] });
                          });
                        }}
                        style={{
                          padding: '6px 12px', borderRadius: 8, fontSize: 10,
                          fontWeight: 800, textTransform: 'uppercase',
                          background: '#10b981', color: '#FFFFFF', border: 'none',
                          cursor: 'pointer', boxShadow: '0 2px 4px rgba(16,185,129,0.2)'
                        }}
                      >
                        Dispatch
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/routes/${r.id}`);
                      }}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}
                      title="Navigate Details"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingRoute(r);
                      }}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}
                      title="Edit"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Are you sure you want to delete this route?')) {
                          routesAPI.delete(r.id).then(() => {
                            toast.success('Route deleted successfully');
                            queryClient.invalidateQueries({ queryKey: ['routes'] });
                          }).catch(() => toast.error('Failed to delete route'));
                        }
                      }}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 4 }}
                      title="Delete"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {editingRoute && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{ background: '#FFF', padding: 24, borderRadius: 12, width: 400, boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Edit Route Status</h2>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Status</label>
              <select
                value={editingRoute.status}
                onChange={(e) => setEditingRoute({ ...editingRoute, status: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', outline: 'none' }}
              >
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
              <button
                onClick={() => setEditingRoute(null)}
                style={{ padding: '8px 16px', background: '#F1F5F9', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: '#475569' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  routesAPI.update(editingRoute.id, { status: editingRoute.status }).then(() => {
                    toast.success('Route updated successfully');
                    queryClient.invalidateQueries({ queryKey: ['routes'] });
                    setEditingRoute(null);
                  }).catch(() => toast.error('Failed to update route'));
                }}
                style={{ padding: '8px 16px', background: '#3B82F6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: '#FFF' }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
