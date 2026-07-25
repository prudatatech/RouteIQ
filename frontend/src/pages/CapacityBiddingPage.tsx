import { useEffect, useState } from 'react'
import { Briefcase, Clock, FileCheck, XCircle, AlertTriangle, CheckCircle, Smartphone } from 'lucide-react'
import { supabase } from '@/services/supabase'

export default function CapacityBiddingPage() {
  const [windows, setWindows] = useState<any[]>([])
  const [bids, setBids] = useState<any[]>([])
  const [confirmations, setConfirmations] = useState<any[]>([])
  
  useEffect(() => {
    // 1. Initial fetches
    fetchData()

    // 2. Realtime Subscriptions
    const subW = supabase.channel('cap_windows')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_windows' }, fetchData)
      .subscribe()
      
    const subB = supabase.channel('cap_bids')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData)
      .subscribe()
      
    const subC = supabase.channel('cap_confs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_confirmations' }, fetchData)
      .subscribe()

    const subV = supabase.channel('cap_vehicles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, fetchData)
      .subscribe()

    return () => {
      supabase.removeChannel(subW)
      supabase.removeChannel(subB)
      supabase.removeChannel(subC)
      supabase.removeChannel(subV)
    }
  }, [])

  const fetchData = async () => {
    const [resW, resB, resC] = await Promise.all([
      supabase.from('capacity_windows').select('*, vehicles(plate_number)').order('opens_at', { ascending: false }),
      supabase.from('capacity_bids').select('*, vendor_profiles(company_name)'),
      supabase.from('driver_confirmations').select('*, route_stops(location_name), vehicles(plate_number)')
    ])
    
    if (resW.data) setWindows(resW.data)
    if (resB.data) setBids(resB.data)
    if (resC.data) setConfirmations(resC.data)
  }

  const handleApproveBid = async (bidId: string) => {
    try {
      const res = await fetch(`/api/v1/capacity/bids/${bidId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` }
      })
      if (!res.ok) throw new Error('Failed to approve bid')
      fetchData()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const getStatusBadge = (w: any) => {
    if (!w.winning_bid_id && !w.fallback_used && new Date(w.closes_at) > new Date()) {
      return <span className="bg-blue-500/10 text-blue-500 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Open</span>
    }
    if (w.fallback_used) {
      return <span className="bg-orange-500/10 text-orange-500 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Fallback</span>
    }
    if (w.winning_bid_id) {
      return <span className="bg-green-500/10 text-green-500 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Won</span>
    }
    return <span className="bg-gray-500/10 text-gray-500 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Closed</span>
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-black text-text tracking-tight uppercase flex items-center gap-3">
            <Briefcase className="text-primary" size={32} />
            Capacity Bidding Control
          </h1>
          <p className="text-muted text-sm mt-1">Live tracking of open windows, vendor bids, and driver safety confirmations.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Capacity Windows */}
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-surface2 flex items-center gap-2">
            <Clock size={16} className="text-primary" />
            <h3 className="font-bold text-text">Capacity Windows</h3>
          </div>
          <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
            {windows.length === 0 && <div className="text-muted text-sm text-center py-10">No windows found.</div>}
            
            {windows.map(w => {
              const windowBids = bids.filter(b => b.window_id === w.id)
              const highestCompliant = windowBids.filter(b => b.eway_bill_ref).sort((a,b) => b.bid_amount - a.bid_amount)[0]

              return (
                <div key={w.id} className="bg-bg rounded-xl border border-border p-4 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-black text-lg text-text uppercase flex items-center gap-2">
                        {w.vehicles?.plate_number || 'Unknown Vehicle'}
                        {w.trigger_type === 'mid_route' ? (
                           <span className="bg-[#F26122]/10 text-[#F26122] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Mid-Route</span>
                        ) : (
                           <span className="bg-[#009688]/10 text-[#009688] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Return Trip</span>
                        )}
                      </div>
                      <div className="text-xs text-muted font-mono mt-1">ID: {w.id.slice(0,8)}...</div>
                    </div>
                    {getStatusBadge(w)}
                  </div>
                  
                  <div className="flex gap-4 text-sm text-muted">
                    <div><strong className="text-text">Floor:</strong> ₹{w.floor_price}</div>
                    <div><strong className="text-text">Bids:</strong> {windowBids.length}</div>
                    <div><strong className="text-text">Closes:</strong> {new Date(w.closes_at).toLocaleTimeString()}</div>
                  </div>

                  {/* Bids List */}
                  {windowBids.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <div className="text-xs font-bold text-muted uppercase tracking-wider mb-2">Bids Received</div>
                      <div className="space-y-2">
                        {windowBids.map(b => (
                          <div key={b.id} className={`flex items-center justify-between p-2 rounded ${b.id === highestCompliant?.id ? 'bg-primary/5 border border-primary/20' : 'bg-surface2'}`}>
                            <div className="flex items-center gap-2">
                              {b.eway_bill_ref ? <span title="E-Way Bill OK"><FileCheck size={14} className="text-green-500" /></span> : <span title="Missing E-Way Bill"><XCircle size={14} className="text-error" /></span>}
                              <span className="font-medium text-sm">{b.vendor_profiles?.company_name || 'Vendor'}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="font-mono text-sm font-bold">₹{b.bid_amount}</div>
                              {!w.winning_bid_id && (
                                <button 
                                  onClick={() => handleApproveBid(b.id)}
                                  className="bg-primary hover:bg-primary-dark text-white text-xs px-3 py-1 rounded shadow-sm font-bold transition-colors"
                                >
                                  Accept
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {w.fallback_used && (
                    <div className="mt-2 text-xs text-orange-500 bg-orange-500/10 p-2 rounded">
                      Fallback shipment {w.fallback_shipment_id?.slice(0,8)} assigned.
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Driver Confirmations */}
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-surface2 flex items-center gap-2">
            <Smartphone size={16} className="text-primary" />
            <h3 className="font-bold text-text">Trust Safety Valve (Driver ACKs)</h3>
          </div>
          <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
            {confirmations.length === 0 && <div className="text-muted text-sm text-center py-10">No confirmations active.</div>}
            
            {confirmations.map(c => (
              <div key={c.id} className="bg-bg rounded-xl border border-border p-4 flex items-center justify-between">
                <div>
                  <div className="font-bold text-text">{c.vehicles?.plate_number}</div>
                  <div className="text-xs text-muted mt-1">Stop: {c.route_stops?.location_name || 'Inserted Stop'}</div>
                  <div className="text-xs text-muted mt-1 font-mono">Sent: {new Date(c.prompted_at).toLocaleTimeString()}</div>
                </div>
                
                <div className="text-right">
                  {!c.action && c.delivered_at && (
                     <div className="flex items-center gap-1 text-xs font-bold text-blue-500 bg-blue-500/10 px-2 py-1 rounded">
                       <Clock size={12}/> 2-Min Timer Active
                     </div>
                  )}
                  {!c.action && !c.delivered_at && (
                     <div className="flex items-center gap-1 text-xs font-bold text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">
                       <Clock size={12}/> Awaiting Delivery
                     </div>
                  )}
                  
                  {c.action === 'confirmed' && (
                    <div className="flex items-center gap-1 text-xs font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded">
                      <CheckCircle size={12}/> Confirmed
                    </div>
                  )}
                  
                  {c.action === 'flagged' && (
                    <div className="flex items-center gap-1 text-xs font-bold text-error bg-error/10 px-2 py-1 rounded">
                      <XCircle size={12}/> Flagged
                    </div>
                  )}

                  {c.action === 'auto_accepted' && (
                    <div className="flex items-center gap-1 text-xs font-bold text-purple-500 bg-purple-500/10 px-2 py-1 rounded">
                      <Clock size={12}/> Auto (Online)
                    </div>
                  )}

                  {c.action === 'auto_accepted_offline' && (
                    <div className="flex items-center gap-1 text-xs font-bold text-orange-500 bg-orange-500/10 px-2 py-1 rounded border border-orange-500/30">
                      <AlertTriangle size={12}/> Auto (Offline)
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
