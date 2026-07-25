import { useState, useEffect } from 'react'
import { Gavel, Clock, MapPin, Truck, CheckCircle2, TrendingUp, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

export default function LiveBiddingPage() {
  const [bids, setBids] = useState<any[]>([])
  const [activeAuction, setActiveAuction] = useState<any>(null)
  
  // Dummy data for an active freight auction
  useEffect(() => {
    setActiveAuction({
      id: 'AUCT-9081',
      origin: 'Delhi Hub',
      destination: 'Mumbai Port',
      cargo: '18 Tons - Steel Coils',
      basePrice: 85000,
      timeRemaining: 120, // 2 minutes
    })
    
    // Simulate incoming bids
    const interval = setInterval(() => {
      setBids(prev => {
        if (prev.length > 5) return prev
        const newBid = {
          id: `BID-${Math.floor(Math.random() * 10000)}`,
          driver: `Fleet Operator ${Math.floor(Math.random() * 100)}`,
          amount: 85000 - (prev.length * 1500) - Math.floor(Math.random() * 500),
          rating: (4.2 + Math.random() * 0.8).toFixed(1),
          timestamp: new Date().toLocaleTimeString()
        }
        return [newBid, ...prev]
      })
    }, 4500)
    
    return () => clearInterval(interval)
  }, [])
  
  // Countdown timer
  useEffect(() => {
    if (!activeAuction || activeAuction.timeRemaining <= 0) return
    const timer = setInterval(() => {
      setActiveAuction((prev: any) => ({ ...prev, timeRemaining: prev.timeRemaining - 1 }))
    }, 1000)
    return () => clearInterval(timer)
  }, [activeAuction])

  const acceptBid = (bidId: string) => {
    toast.success(`Bid ${bidId} accepted successfully! Dispatching assignment...`)
    setActiveAuction(null)
  }

  return (
    <div className="space-y-8 pb-16">
      <div className="relative p-10 rounded-[2.5rem] bg-surface border border-border overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 p-8">
          <Gavel className="w-28 h-28 text-primary/10 animate-pulse" />
        </div>
        
        <div className="relative z-10">
          <span className="px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[10px] font-black tracking-[0.2em] uppercase border border-primary/20">
            Live Marketplace
          </span>
          <h1 className="text-5xl font-black text-text font-heading tracking-tighter uppercase mt-4 mb-4">
            Live Freight <span className="text-primary">Bidding Engine</span>
          </h1>
          <p className="max-w-3xl text-text-muted font-bold text-sm leading-relaxed tracking-tight">
            Real-time auction marketplace for unassigned cargo loads. Watch fleet operators competitively bid for shipments.
          </p>
        </div>
      </div>

      {activeAuction ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Auction Details */}
          <div className="lg:col-span-5 space-y-6">
            <div className="p-8 rounded-[2rem] bg-surface border border-primary/30 shadow-[0_0_30px_rgba(212,154,0,0.1)]">
               <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-black uppercase text-text tracking-widest">Active Auction</h3>
                  <div className="flex items-center gap-2 bg-red-500/10 text-red-500 px-3 py-1.5 rounded-lg border border-red-500/20">
                    <Clock size={16} className="animate-pulse" />
                    <span className="font-mono font-bold">{Math.floor(activeAuction.timeRemaining / 60)}:{(activeAuction.timeRemaining % 60).toString().padStart(2, '0')}</span>
                  </div>
               </div>
               
               <div className="space-y-6">
                 <div className="flex items-start gap-4 p-4 bg-surface2 rounded-xl">
                   <Truck className="text-primary mt-1" />
                   <div>
                     <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Cargo Specifications</div>
                     <div className="text-sm font-bold text-text">{activeAuction.cargo}</div>
                     <div className="text-xs text-text-muted mt-1">{activeAuction.id}</div>
                   </div>
                 </div>
                 
                 <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    <div className="relative">
                      <div className="absolute -left-[27px] w-3 h-3 bg-surface border-2 border-primary rounded-full" />
                      <div className="text-[10px] font-black text-text-muted uppercase tracking-widest">Origin</div>
                      <div className="font-bold text-text">{activeAuction.origin}</div>
                    </div>
                    <div className="relative">
                      <div className="absolute -left-[27px] w-3 h-3 bg-primary rounded-full shadow-[0_0_10px_rgba(212,154,0,0.5)]" />
                      <div className="text-[10px] font-black text-text-muted uppercase tracking-widest">Destination</div>
                      <div className="font-bold text-text">{activeAuction.destination}</div>
                    </div>
                 </div>
                 
                 <div className="pt-4 border-t border-border">
                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Base Starting Price</div>
                    <div className="text-3xl font-black text-text font-heading">₹{activeAuction.basePrice.toLocaleString()}</div>
                 </div>
               </div>
            </div>
          </div>
          
          {/* Bids Feed */}
          <div className="lg:col-span-7">
             <div className="p-8 rounded-[2rem] bg-surface border border-border h-full flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-xl font-black uppercase text-text tracking-widest">Live Incoming Bids</h3>
                    <p className="text-[10px] text-text-muted uppercase font-bold tracking-widest mt-1">Lowest bid automatically wins if not manually accepted</p>
                  </div>
                  <span className="px-3 py-1 bg-surface2 text-text text-xs font-bold rounded-lg border border-border">
                    {bids.length} Bids
                  </span>
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto pr-2">
                   {bids.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-text-muted opacity-50 space-y-4">
                       <Gavel size={48} />
                       <p className="text-xs font-bold uppercase tracking-widest">Waiting for first bid...</p>
                     </div>
                   ) : (
                     bids.map((bid, i) => (
                       <div key={bid.id} className={clsx(
                         "p-4 rounded-xl border flex items-center justify-between transition-all animate-fade-in",
                         i === 0 ? "bg-primary/5 border-primary/30 shadow-[0_0_15px_rgba(212,154,0,0.05)]" : "bg-surface2/50 border-border"
                       )}>
                         <div className="flex items-center gap-4">
                           <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center border border-border font-bold text-primary">
                             {bid.driver.split(' ')[2]}
                           </div>
                           <div>
                             <div className="text-sm font-black text-text">{bid.driver}</div>
                             <div className="text-[10px] text-text-muted uppercase tracking-widest mt-0.5">
                               Rating: <span className="text-accent-secondary">{bid.rating}★</span> • {bid.timestamp}
                             </div>
                           </div>
                         </div>
                         
                         <div className="flex items-center gap-6">
                           <div className="text-right">
                             <div className="text-xl font-black text-text font-heading">₹{bid.amount.toLocaleString()}</div>
                             {i === 0 && <div className="text-[10px] font-bold text-success uppercase tracking-widest">Current Lowest</div>}
                           </div>
                           <button 
                             onClick={() => acceptBid(bid.id)}
                             className="h-10 px-4 bg-primary hover:bg-primary-dark text-black text-xs font-black uppercase rounded-lg tracking-widest transition-all"
                           >
                             Accept
                           </button>
                         </div>
                       </div>
                     ))
                   )}
                </div>
             </div>
          </div>
        </div>
      ) : (
        <div className="p-16 text-center bg-surface border border-border rounded-[2.5rem]">
          <CheckCircle2 size={64} className="text-success mx-auto mb-6" />
          <h2 className="text-2xl font-black text-text uppercase tracking-widest mb-2">Auction Concluded</h2>
          <p className="text-text-muted font-bold">The winning bid has been assigned to the driver. The cargo is now awaiting pickup.</p>
        </div>
      )}
    </div>
  )
}
