import { useEffect, useState } from 'react'
import { Activity, Package, CheckCircle, TrendingUp, Zap, LogOut, Plus, ArrowRight } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatEta } from '@/utils/timeFormat'
import { useNavigate } from 'react-router-dom'

export default function VendorShipmentsPage() {
  const [myBids, setMyBids] = useState<any[]>([])
  const [myRequests, setMyRequests] = useState<any[]>([])
  const userId = useAuthStore(s => s.userId)
  const navigate = useNavigate()

  useEffect(() => {
    if (!userId) return

    fetchData()

    const subB = supabase.channel('vendor_bids_shipments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData)
      .subscribe()

    const subR = supabase.channel('vendor_reqs_shipments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_shipment_requests' }, fetchData)
      .subscribe()

    return () => {
      supabase.removeChannel(subB)
      supabase.removeChannel(subR)
    }
  }, [userId])

  const fetchData = async () => {
    if (!userId) return
    try {
      const bPromise = supabase.from('capacity_bids').select('*, capacity_windows!capacity_bids_window_id_fkey(trigger_type, vehicles(plate_number, vehicle_type))').eq('vendor_id', userId).order('submitted_at', { ascending: false })
      const rPromise = supabase.from('vendor_shipment_requests').select('*, cargo_manifest(id)').eq('vendor_id', userId).order('created_at', { ascending: false })

      const [resB, resR] = await Promise.all([bPromise, rPromise])
      if (resB.data) setMyBids(resB.data)
      if (resR.data) setMyRequests(resR.data)
    } catch (e) {
      console.error(e)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <span className="bg-orange-50 text-orange-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-orange-200">⏳ Pending</span>
      case 'approved': return <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-blue-200">✓ Approved</span>
      case 'assigned': return <span className="bg-yellow-50 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-yellow-300">🚛 Vehicle Assigned</span>
      case 'won': return <span className="bg-green-50 text-green-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-green-200">Awarded</span>
      case 'lost': return <span className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-red-200">Lost</span>
      default: return <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-gray-200">{status}</span>
    }
  }

  const getTriggerLabel = (trigger: string) => {
    if (trigger === 'mid_route') {
      return <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-primary/20 flex items-center gap-1"><Zap size={10} /> Mid-Route</span>
    }
    return <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-blue-200 flex items-center gap-1"><TrendingUp size={10} /> Empty Return</span>
  }

  return (
    <div className="max-w-[1600px] mx-auto p-6 lg:p-12 w-full animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
            <Package className="text-primary" size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-display font-black tracking-tight text-text">My Shipments</h1>
            <p className="text-muted text-sm font-bold uppercase tracking-widest">Track your bids and active loads</p>
          </div>
        </div>
        <button 
          onClick={() => navigate('/vendor/request')}
          className="bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95"
        >
          <Plus size={20} />
          Create New Shipment
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Your Bids */}
        <div className="space-y-6">
          <h3 className="text-xl font-bold flex items-center gap-2 text-text">
            Active <span className="text-primary">Bids</span>
          </h3>
          <div className="bg-surface border border-border rounded-3xl p-6 min-h-[500px] shadow-xl">
             {myBids.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center text-muted space-y-4 pt-32">
                 <Activity size={48} className="opacity-20" />
                 <p className="font-bold uppercase tracking-widest text-xs">No active bids.</p>
               </div>
             )}
             <div className="space-y-4">
               {myBids.map(b => (
                  <div key={b.id} className="bg-surface2 border border-border hover:border-primary/30 rounded-2xl p-5 transition-colors cursor-pointer group shadow-sm">
                     <div className="flex justify-between items-start mb-4">
                       <div>
                         <div className="font-mono text-[10px] text-muted mb-1">{new Date(b.submitted_at).toLocaleDateString()}</div>
                         <div className="font-black text-text text-xl font-mono group-hover:text-primary transition-colors">₹{b.bid_amount}</div>
                       </div>
                       <div>{getStatusBadge(b.status)}</div>
                     </div>
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getTriggerLabel(b.capacity_windows?.trigger_type)}
                          <span className="text-xs text-muted font-mono">{b.capacity_windows?.vehicles?.plate_number}</span>
                        </div>
                        <div className="text-[10px] text-primary/70 uppercase tracking-widest font-mono font-bold bg-primary/5 border border-primary/10 px-2 py-1 rounded-md">
                          EWB: {b.eway_bill_ref}
                        </div>
                     </div>
                  </div>
               ))}
             </div>
          </div>
        </div>

        {/* Your Shipment Requests */}
        <div className="space-y-6">
          <h3 className="text-xl font-bold flex items-center gap-2 text-text">
            Shipment <span className="text-primary">Requests</span>
          </h3>
          <div className="bg-surface border border-border rounded-3xl p-6 min-h-[500px] shadow-xl">
             {myRequests.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center text-muted space-y-4 pt-32">
                 <Package size={48} className="opacity-20" />
                 <p className="font-bold uppercase tracking-widest text-xs">No active requests.</p>
               </div>
             )}
             <div className="space-y-4">
                {myRequests.map(r => {
                  const hasManifest = r.cargo_manifest && r.cargo_manifest.length > 0;
                  const trackingId = hasManifest ? `CM-${r.cargo_manifest[0].id.substring(0, 8).toUpperCase()}` : null;
                  
                  return (
                  <div key={r.id} className="bg-surface2 border border-border hover:border-primary/30 rounded-2xl p-5 transition-colors group shadow-sm">
                     <div className="flex justify-between items-start mb-4">
                       <div>
                         <div className="font-mono text-[10px] text-muted mb-1">{new Date(r.created_at).toLocaleDateString()}</div>
                         <div className="font-bold text-text text-lg flex items-center gap-2 group-hover:text-primary transition-colors">
                           {r.pickup_city || r.pickup_location?.substring(0,10)} <Zap size={14} className="text-muted" /> {r.dropoff_city || r.drop_location?.substring(0,10)}
                         </div>
                       </div>
                       <div>{getStatusBadge(r.status)}</div>
                     </div>
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted font-bold uppercase tracking-widest">{r.vehicle_type || 'ANY'}</span>
                        </div>
                        {trackingId ? (
                          <button 
                            onClick={() => navigate(`/track/${trackingId}`)}
                            className="text-[10px] text-white hover:text-white uppercase tracking-widest font-mono font-bold bg-primary hover:bg-primary-dark transition-colors px-4 py-1.5 rounded-md flex items-center gap-1 shadow-md shadow-primary/20"
                          >
                            Track Shipment <ArrowRight size={12} />
                          </button>
                        ) : (
                          <div className="text-[10px] text-primary/70 uppercase tracking-widest font-mono font-bold bg-primary/5 border border-primary/10 px-2 py-1 rounded-md flex items-center gap-1">
                            <CheckCircle size={10} /> {r.required_capacity_kg || r.weight_kg} KG
                          </div>
                        )}
                     </div>
                  </div>
                )})}
             </div>
          </div>
        </div>
      </div>
    </div>
  )
}
