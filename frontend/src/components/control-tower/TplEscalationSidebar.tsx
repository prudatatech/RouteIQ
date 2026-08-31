import React, { useState } from 'react'
import { X, AlertTriangle, ChevronRight, ShieldCheck, Zap } from 'lucide-react'
import { Card } from '@/components/ui'
import clsx from 'clsx'

interface TplEscalationSidebarProps {
  isOpen: boolean
  onClose: () => void
  orderId?: string
}

const eligiblePartners = [
  { id: '3PL-001', name: 'Rivigo Freight', sla: '2H', ratePreview: '₹41,200', rating: 4.8 },
  { id: '3PL-002', name: 'Delhivery B2B', sla: '4H', ratePreview: '₹43,500', rating: 4.5 },
]

export default function TplEscalationSidebar({ isOpen, onClose, orderId = 'ORD-8821' }: TplEscalationSidebarProps) {
  const [broadcasting, setBroadcasting] = useState(false)

  const handleBroadcast = () => {
    setBroadcasting(true)
    setTimeout(() => {
      setBroadcasting(false)
      onClose()
    }, 2000)
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-[200] transition-opacity" 
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div 
        className={clsx(
          "fixed top-0 right-0 h-full w-[450px] bg-surface border-l border-border z-[210] shadow-2xl transition-transform duration-300 ease-out flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex justify-between items-center p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-black uppercase text-text tracking-tight">Escalation Panel</h2>
            <div className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">Tier 2 Broadcast Control</div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-muted hover:text-text hover:bg-border transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-[20px] p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 text-yellow-500">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-sm font-black text-yellow-500 uppercase tracking-tight">Trigger: No Vehicle in Zone</h3>
                <p className="text-xs text-muted mt-1 font-medium">Availability Scoring Engine found 0 idle vehicles within 50km radius for Corridor DEL-BOM.</p>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-3">Order Specs ({orderId})</div>
            <Card className="border-border bg-bg p-5 grid grid-cols-2 gap-4">
               <div>
                 <div className="text-[10px] text-muted font-bold uppercase tracking-widest mb-1">Cargo</div>
                 <div className="font-medium text-sm">Heavy Duty (15T)</div>
               </div>
               <div>
                 <div className="text-[10px] text-muted font-bold uppercase tracking-widest mb-1">TTL</div>
                 <div className="font-medium text-sm text-red-400">Expired</div>
               </div>
               <div>
                 <div className="text-[10px] text-muted font-bold uppercase tracking-widest mb-1">Computed Client Rate</div>
                 <div className="font-mono font-bold text-lg text-primary">₹45,500</div>
               </div>
            </Card>
          </div>

          <div>
            <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-3">Eligible 3PL Cascade</div>
            <div className="space-y-3">
              {eligiblePartners.map((p, idx) => (
                <div key={p.id} className="p-4 rounded-xl border border-border bg-surface2 flex items-center gap-4">
                  <div className="w-6 h-6 rounded-full bg-bg border border-border flex items-center justify-center text-[10px] font-black text-muted">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-sm">{p.name}</div>
                    <div className="text-[10px] text-muted uppercase tracking-wider mt-1">{p.sla} SLA • {p.rating} Rating</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-bold text-text">{p.ratePreview}</div>
                    <div className="text-[9px] text-green-500 uppercase font-black">Est. Margin 9%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-border bg-surface2/50 backdrop-blur-xl">
           <button 
             onClick={handleBroadcast}
             disabled={broadcasting}
             className="w-full py-4 rounded-2xl bg-primary hover:bg-primary-dark text-bg font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-xl shadow-primary/20 disabled:opacity-50"
           >
             {broadcasting ? (
               <><Zap size={18} className="animate-pulse" /> Initiating Cascade...</>
             ) : (
               <>Escalate to 3PL <ChevronRight size={18} /></>
             )}
           </button>
           <p className="text-center text-[10px] text-muted font-bold uppercase mt-3 tracking-wider">
             System will auto-negotiate sequentially
           </p>
        </div>
      </div>
    </>
  )
}
