import { useEffect, useState } from 'react'
import { Zap, TrendingUp, ArrowRight, ChevronRight, ShieldCheck, MapPin } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { formatEta } from '@/utils/timeFormat'
import toast from 'react-hot-toast'

export default function VendorCorridorPage() {
  const [windows, setWindows] = useState<any[]>([])
  const [passingRoutes, setPassingRoutes] = useState<any[]>([])
  const [myBids, setMyBids] = useState<any[]>([])
  
  const userId = useAuthStore(s => s.userId)
  const session = useAuthStore(s => s.session)
  const navigate = useNavigate()
  
  const { vendorProfile } = useOutletContext<any>() || {}

  useEffect(() => {
    fetchData()

    const subW = supabase.channel('vendor_corr_win')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_windows' }, fetchData)
      .subscribe()
      
    const subB = supabase.channel('vendor_corr_bids')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData)
      .subscribe()

    return () => {
      supabase.removeChannel(subW)
      supabase.removeChannel(subB)
    }
  }, [userId])

  const fetchData = async () => {
    try {
      const wPromise = supabase.from('capacity_windows').select('*, vehicles(plate_number, available_capacity_kg, vehicle_type)').gt('closes_at', new Date().toISOString()).is('winning_bid_id', null).order('opens_at', { ascending: false })
      let bPromise: any = Promise.resolve({ data: [] })
      let pPromise = fetch(`${import.meta.env.VITE_API_URL || '/api/v1'}/vendor/passing-routes`, { 
        headers: session ? { 'Authorization': `Bearer ${session.access_token}` } : {} 
      }).then(r => r.json().catch(() => []))

      if (userId) {
        bPromise = supabase.from('capacity_bids').select('window_id').eq('vendor_id', userId)
      }

      const [resW, resB, resP] = await Promise.all([wPromise, bPromise, pPromise])
      if (resW.data) setWindows(resW.data)
      if (resB.data) setMyBids(resB.data)
      if (Array.isArray(resP)) setPassingRoutes(resP)
    } catch (e) {
      console.error(e)
    }
  }

  const getTriggerLabel = (trigger: string) => {
    if (trigger === 'mid_route') {
      return <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-primary/20 flex items-center gap-1"><Zap size={10} /> Mid-Route Fill</span>
    }
    return <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-blue-200 flex items-center gap-1"><TrendingUp size={10} /> Empty Return</span>
  }

  const handlePlaceBid = (w: any) => {
    if (!session) {
      toast('Please log in to place a bid.', { icon: '🔒' })
      navigate('/vendor/login')
      return
    }
    if (vendorProfile && vendorProfile.kycStatus !== 'approved') {
      toast.error('Your KYC is pending. Please complete KYC to bid.')
      navigate('/vendor/documents')
      return
    }
    // We could implement an inline modal here, or navigate to a dedicated bid page. 
    // For now, we will navigate to request page with the capacity window context
    navigate(`/vendor/request?query=${encodeURIComponent('Current')}`)
  }

  return (
    <div className="max-w-[1600px] mx-auto p-6 lg:p-12 w-full animate-fade-in">
      <div className="flex items-center gap-3 mb-10">
        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
          <MapPin className="text-primary" size={24} />
        </div>
        <div>
          <h1 className="text-3xl font-display font-black tracking-tight text-text">Live Corridors</h1>
          <p className="text-muted text-sm font-bold uppercase tracking-widest">Real-time passing trucks and bid markets</p>
        </div>
      </div>

      <div className="space-y-16">
        {/* Passing Routes */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold flex items-center gap-2 text-text">
              Live Capacity <span className="text-primary">Near You</span>
            </h3>
          </div>
          
          {passingRoutes.length === 0 ? (
            <div className="w-full h-48 border border-dashed border-border rounded-3xl flex items-center justify-center text-muted font-bold uppercase tracking-widest bg-surface/30">
               No passing routes matched right now
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {passingRoutes.map(pr => (
                <div key={pr.id} className="h-[220px] rounded-3xl bg-surface border border-border overflow-hidden relative shadow-xl hover:shadow-[0_20px_40px_rgba(0,0,0,0.5)] hover:border-primary/50 group-hover:bg-surface2 transition-all p-6 flex flex-col justify-between group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-[50px] rounded-full group-hover:bg-primary/20 transition-all pointer-events-none" />
                  
                  <div className="flex justify-between items-start relative z-10">
                    <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border border-primary/20 flex items-center gap-1.5 backdrop-blur-sm">
                      <Zap size={12} /> Route Match
                    </div>
                    <div className="bg-surface/80 backdrop-blur-md px-2 py-1 rounded-lg text-xs font-mono font-bold border border-border">
                      {formatEta(pr.eta_minutes)} away
                    </div>
                  </div>
                  
                  <div className="relative z-10 mt-auto space-y-2">
                    <div className="text-xs text-muted font-mono uppercase">{pr.routes?.vehicles?.vehicle_type || 'Truck'} • {pr.routes?.vehicles?.plate_number}</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-4xl font-display font-black tracking-tighter text-text">{pr.available_capacity_kg}</span>
                      <span className="text-primary font-bold text-sm">KG</span>
                    </div>
                    <button 
                       onClick={() => navigate(`/vendor/request?query=${encodeURIComponent(pr.city || 'Location')}`)}
                       className="w-full mt-4 bg-surface hover:bg-primary text-text hover:text-white py-3 rounded-xl font-bold transition-colors border border-border group-hover:border-primary/50 text-sm flex items-center justify-center gap-2 shadow-sm"
                    >
                       Claim Capacity <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Bid Markets */}
        <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-bold flex items-center gap-2 text-text">
                Trending Bid <span className="text-primary">Markets</span>
              </h3>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-bold text-muted uppercase tracking-widest">Live Updates</span>
              </div>
            </div>
            
            {windows.length === 0 ? (
               <div className="w-full h-48 border border-dashed border-border rounded-3xl flex items-center justify-center text-muted font-bold uppercase tracking-widest bg-surface/30">
                  No active markets right now
               </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                 {windows.map(w => {
                    const alreadyBid = myBids.find(b => b.window_id === w.id)

                    return (
                      <div key={w.id} className="rounded-3xl bg-surface border border-border overflow-hidden relative shadow-xl hover:shadow-[0_20px_40px_rgba(0,0,0,0.5)] hover:border-primary/30 transition-all p-6 flex flex-col group min-h-[260px]">
                        
                        <div className="flex justify-between items-start mb-6">
                           <div className="flex flex-col gap-2">
                             {getTriggerLabel(w.trigger_type)}
                             <span className="text-xs text-muted font-mono bg-surface2 px-2 py-1 rounded-md inline-block w-fit border border-border shadow-sm">
                               {w.vehicles?.plate_number}
                             </span>
                           </div>
                           <div className="text-right flex flex-col items-end">
                             <div className="text-xs text-muted font-medium mb-1">Closes In</div>
                             <div className="text-error font-mono font-bold animate-pulse bg-error/10 px-2 py-1 rounded-md border border-error/20 w-fit">
                               {new Date(w.closes_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                             </div>
                           </div>
                        </div>
                        
                        <div className="mb-6">
                          <div className="text-[10px] uppercase tracking-widest text-muted font-bold mb-1">Available Load</div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-display font-black tracking-tight text-text">{w.vehicles?.available_capacity_kg}</span>
                            <span className="text-primary font-bold">KG</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-auto pt-4 border-t border-border">
                           <div>
                             <div className="text-[10px] text-muted uppercase tracking-widest font-bold">Floor Price</div>
                             <div className="text-lg font-mono font-black text-text">₹{w.floor_price}</div>
                           </div>
                           {alreadyBid ? (
                              <div className="bg-primary/10 text-primary px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 border border-primary/20 shadow-sm">
                                <ShieldCheck size={16} /> Bid Active
                              </div>
                            ) : (
                              <button 
                                onClick={() => handlePlaceBid(w)}
                                className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-[0_10px_20px_rgba(79,172,254,0.2)] group-hover:shadow-[0_10px_25px_rgba(79,172,254,0.4)] active:scale-95"
                              >
                                Place Bid <ArrowRight size={16} />
                              </button>
                            )}
                        </div>
                      </div>
                    )
                 })}
              </div>
            )}
        </section>
      </div>
    </div>
  )
}
