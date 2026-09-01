import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Map, Navigation, Edit2, Trash2, ArrowRight } from 'lucide-react'
import { routesAPI, vehiclesAPI, deliveryPointsAPI, shipmentsAPI, optimizationAPI } from '@/services/api'
import { StatusDot } from '@/components/ui'
import { format } from 'date-fns'
import { formatEta } from '@/utils/timeFormat'
import { getRouteDistance, getRouteDuration, getRouteFuel } from '@/utils/routeHelpers'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function RoutesPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [editingRoute, setEditingRoute] = useState<any>(null)

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['routes'],
    queryFn: () => routesAPI.list({ limit: 50 }),
    refetchInterval: 20_000,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => vehiclesAPI.list({ limit: 100 }),
  })

  const { data: pendingStops = [] } = useQuery({
    queryKey: ['shipments', 'pending'],
    queryFn: () => shipmentsAPI.list().then((raw: any) => { const list = Array.isArray(raw) ? raw : []; return list.filter(s => (s.status === 'created' || s.status === 'pending') && !s.vehicle_id) })
  })

  const handleDispatch = (routeId: string) => {
    routesAPI.updateStatus(routeId, 'active').then(() => {
      toast.success('Route dispatched successfully!')
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    }).catch((err) => toast.error('Failed to dispatch route'))
  }

  const handleDelete = (routeId: string) => {
    if (window.confirm('Are you sure you want to delete this route?')) {
      routesAPI.delete(routeId).then(() => {
        toast.success('Route deleted')
        queryClient.invalidateQueries({ queryKey: ['routes'] })
      }).catch(() => toast.error('Failed to delete route'))
    }
  }

  const handleStatusSave = () => {
    if (!editingRoute) return
    routesAPI.update(editingRoute.id, { status: editingRoute.status }).then(() => {
      toast.success('Route status updated')
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      setEditingRoute(null)
    }).catch(() => toast.error('Failed to update status'))
  }

  const { mutate: handleReoptimize, isPending: isOptimizing } = useMutation({
    mutationFn: (routeId: string) => optimizationAPI.reoptimizeRoute(routeId),
    onSuccess: (data: any) => {
      toast.success(data.message || 'Route re-optimized successfully')
      queryClient.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to re-optimize route')
    }
  })

  const onRunOptimizerClick = () => {
    const optimizableRoute = routes.find((r: any) => ['active', 'pending'].includes(r.status));
    if (optimizableRoute) {
      handleReoptimize(optimizableRoute.id);
    } else {
      toast.error('No active or pending routes to optimize');
    }
  }

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col space-y-6">
      <div className="relative p-8 rounded-[2.5rem] bg-surface border border-border overflow-hidden shadow-2xl shrink-0">
        <div className="absolute top-0 right-0 p-8">
          <Map className="w-24 h-24 text-primary/10 animate-pulse" />
        </div>
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-text uppercase tracking-tight leading-none mb-2">
              Dispatch Grid
            </h1>
            <p className="text-xs text-text-muted font-bold tracking-[0.2em] uppercase max-w-2xl">
              Active routes and historical logistics data.
            </p>
          </div>
          <button 
            onClick={onRunOptimizerClick}
            disabled={isOptimizing}
            className="h-12 px-6 bg-primary hover:bg-primary-dark text-slate-950 text-xs font-black uppercase rounded-xl tracking-widest transition-all flex items-center justify-center gap-3 shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {isOptimizing ? 'Optimizing...' : 'Run Optimizer'}
            {!isOptimizing && <ArrowRight size={16} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col space-y-6 pb-6">
        {pendingStops.length > 0 && (
          <div className="flex-none bg-surface border border-border rounded-[2.5rem] shadow-xl overflow-hidden flex flex-col p-8">
            <div className="flex justify-between items-center mb-6 px-2">
              <div>
                <h2 className="text-xl font-black text-text uppercase tracking-tight">Cargo Manifest (Pending Shipments)</h2>
                <p className="text-xs text-text-muted font-bold tracking-[0.2em] uppercase mt-1">Shipments waiting to be routed</p>
              </div>
              <span className="text-xs font-black bg-orange-500/10 border border-orange-500/20 text-orange-500 px-4 py-2 rounded-xl uppercase tracking-widest">{pendingStops.length} Shipments Ready</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-widest border-b border-border">Shipment ID</th>
                    <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-widest border-b border-border">Destination</th>
                    <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-widest border-b border-border">Load</th>
                    <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-widest border-b border-border">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingStops.map((stop: any) => (
                    <tr key={stop.id} className="border-b border-border/30 hover:bg-background transition-colors">
                      <td className="px-6 py-4 font-mono text-xs font-black text-text uppercase tracking-widest">{stop.tracking_id || (stop.id || '').slice(0, 8)}</td>
                      <td className="px-6 py-4 text-xs font-bold text-text">{stop.delivery_point?.address || stop.delivery_point?.name || stop.origin_name || 'Pending Destination'}</td>
                      <td className="px-6 py-4 text-xs font-bold text-text">{stop.total_weight_kg || stop.weight_kg || 0} kg <span className="text-text-muted mx-1">|</span> {stop.total_items || 1} items</td>
                      <td className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-widest">
                        {stop.priority || 'Medium'} Priority
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex-1 bg-surface border border-border rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col min-h-[500px]">
          <div className="p-8 pb-4 border-b border-border/50">
            <h2 className="text-xl font-black text-text uppercase tracking-tight">Planned Routes</h2>
          </div>
          <div className="overflow-x-auto flex-1 custom-scrollbar relative">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-20 bg-surface/80 backdrop-blur-md shadow-sm">
              <tr>
                {['Route ID', 'Vehicle', 'Status', 'Distance', 'ETA', 'Fuel Est.', 'Score', 'Created', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-widest border-b border-border">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-20">
                    <div className="flex flex-col items-center justify-center text-text-muted opacity-50">
                      <Navigation size={48} className="mb-4 animate-spin-slow" />
                      <p className="text-xs font-bold uppercase tracking-widest">Loading Network Routes...</p>
                    </div>
                  </td>
                </tr>
              ) : (!Array.isArray(routes) || routes.length === 0) ? (
                <tr>
                  <td colSpan={9} className="text-center py-20">
                    <div className="flex flex-col items-center justify-center text-text-muted opacity-50">
                      <Map size={48} className="mb-4" />
                      <p className="text-xs font-bold uppercase tracking-widest">No routes exist in the database.</p>
                      {!Array.isArray(routes) && <p className="text-xs text-red-500 mt-2">API Error: {String(routes?.detail || JSON.stringify(routes))}</p>}
                    </div>
                  </td>
                </tr>
              ) : routes.map((r: any) => {
                const vehicle = Array.isArray(vehicles) ? vehicles.find((v: any) => v.id === r.vehicle_id) : null
                const routeWithVehicle = { ...r, vehicles: vehicle || r.vehicles }
                const computedDist = getRouteDistance(routeWithVehicle)
                const computedDuration = getRouteDuration(routeWithVehicle, computedDist)
                const computedFuel = getRouteFuel(routeWithVehicle, computedDist)

                return (
                  <tr 
                    key={r.id} 
                    className="group border-b border-border/50 hover:bg-background transition-colors cursor-pointer"
                    onClick={() => navigate(`/routes/${r.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="font-mono text-xs font-black text-text uppercase tracking-widest">
                        {(r.id || '').slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                          <span className="text-[10px] font-black text-primary">TRK</span>
                        </div>
                        <div>
                          <div className="font-mono text-xs font-black text-text uppercase">
                            {vehicle?.plate_number || (r.vehicle_id || '').slice(0, 8)}
                          </div>
                          <div className="text-[9px] text-text-muted font-bold tracking-widest uppercase">
                            {vehicle?.model || 'Unknown'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <StatusDot status={r.status === 'active' ? 'on_route' : r.status === 'completed' ? 'available' : 'idle'} />
                        <span className="text-xs font-bold text-text uppercase tracking-widest">{r.status}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-text uppercase tracking-widest">
                      {computedDist.toFixed(1)} km
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-text uppercase tracking-widest">
                      {formatEta(computedDuration)}
                    </td>
                    <td className="py-4 px-6 text-sm font-bold text-slate-700">
                      {computedFuel.toFixed(1)} L
                    </td>
                    <td className="px-6 py-4">
                      {r.optimization_score ? (
                        <div className="px-2 py-1 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-black tracking-widest inline-block">
                          {(r.optimization_score * 100).toFixed(0)}%
                        </div>
                      ) : (
                        <span className="text-text-muted text-xs font-bold">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-widest">
                      {r.created_at ? format(new Date(r.created_at), 'MMM dd, HH:mm') : 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {r.status === 'pending' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDispatch(r.id); }}
                            className="px-3 py-1 bg-primary text-slate-950 text-[9px] font-black uppercase tracking-widest rounded-md hover:bg-primary-dark transition-colors"
                          >
                            Dispatch
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingRoute(r); }}
                          className="w-7 h-7 rounded-md hover:bg-background border border-transparent hover:border-border flex items-center justify-center text-text-muted transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                          className="w-7 h-7 rounded-md hover:bg-red-500/10 border border-transparent hover:border-red-500/20 flex items-center justify-center text-red-400 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {editingRoute && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="w-[400px] bg-surface border border-border rounded-3xl p-8 shadow-2xl">
            <h2 className="text-xl font-black text-text uppercase tracking-tight mb-6 flex items-center gap-3">
              <Edit2 className="text-primary" size={24} />
              Edit Route Status
            </h2>
            <div className="mb-8">
              <label className="text-xs font-bold text-text-muted uppercase tracking-widest block mb-2">Status</label>
              <select
                value={editingRoute.status}
                onChange={(e) => setEditingRoute({ ...editingRoute, status: e.target.value })}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm font-bold text-text uppercase tracking-wider outline-none focus:border-primary/50"
              >
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setEditingRoute(null)}
                className="flex-1 h-12 bg-background border border-border hover:border-text-muted text-text-muted text-xs font-black uppercase rounded-xl tracking-widest transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleStatusSave}
                className="flex-1 h-12 bg-primary hover:bg-primary-dark text-slate-950 text-xs font-black uppercase rounded-xl tracking-widest transition-all"
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
