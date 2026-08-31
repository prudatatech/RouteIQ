import React, { useState } from 'react'
import {
  Building2, Briefcase, FileText, IndianRupee, ShieldCheck, MapPin, Search, Calendar, ChevronDown, CheckCircle2
} from 'lucide-react'
import { Card } from '@/components/ui'
import clsx from 'clsx'

export default function TplDashboardPage() {
  const [activeTab, setActiveTab] = useState<'requests' | 'shipments' | 'documents' | 'earnings' | 'coverage'>('requests')

  return (
    <div className="space-y-8 animate-fade-in pb-32">
      {/* 3PL Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-display text-4xl font-black tracking-tighter text-text uppercase leading-none">
            Safexpress <span className="text-primary">Portal</span>
          </h1>
          <div className="text-muted font-bold tracking-tight mt-4 flex items-center gap-3 text-sm">
            <ShieldCheck size={16} className="text-green-500" />
            Verified Tier 2 Partner
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border pb-4 overflow-x-auto custom-scrollbar">
        {[
          { id: 'requests', icon: Briefcase, label: 'Incoming Requests', count: 0 },
          { id: 'shipments', icon: MapPin, label: 'Active Shipments', count: 0 },
          { id: 'documents', icon: FileText, label: 'Documents' },
          { id: 'earnings', icon: IndianRupee, label: 'Earnings' },
          { id: 'coverage', icon: ShieldCheck, label: 'Approved Coverage' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={clsx(
              'flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap',
              activeTab === tab.id 
                ? 'bg-primary text-bg shadow-lg shadow-primary/20' 
                : 'text-muted hover:text-text hover:bg-surface2'
            )}
          >
            <tab.icon size={18} />
            {tab.label}
            {tab.count !== undefined && (
              <span className={clsx("ml-2 px-2 py-0.5 rounded text-[10px]", activeTab === tab.id ? 'bg-bg/20' : 'bg-surface2 text-muted')}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="mt-8">
        
        {activeTab === 'requests' && (
          <div className="py-20 flex flex-col items-center justify-center text-center animate-fade-in bg-surface border border-border border-dashed rounded-3xl">
             <div className="w-16 h-16 rounded-full bg-surface2 flex items-center justify-center text-muted mb-6">
               <Search size={24} />
             </div>
             <h2 className="text-xl font-black uppercase tracking-widest text-text">No Active Requests Yet</h2>
             <p className="text-sm text-muted font-medium mt-2 max-w-md leading-relaxed">
               You're all set! When a shipment matching your approved coverage (DEL-BOM, BOM-BLR) needs escalation, it will appear here.
             </p>
          </div>
        )}

        {activeTab === 'coverage' && (
          <div className="space-y-6 animate-fade-in">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">SLA Commitment</div>
                 <div className="text-2xl font-black text-green-500">2 Hours</div>
                 <div className="text-xs text-muted font-bold mt-2">Max time to accept broadcast</div>
               </Card>
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">GTA Tax Treatment</div>
                 <div className="text-2xl font-black text-text">12% ITC</div>
                 <div className="text-xs text-muted font-bold mt-2">Forward Charge</div>
               </Card>
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Status</div>
                 <div className="text-2xl font-black text-primary">Active</div>
                 <div className="text-xs text-muted font-bold mt-2 flex items-center gap-1"><CheckCircle2 size={12} /> Live in cascade</div>
               </Card>
             </div>

             <Card className="border-border bg-surface overflow-hidden">
               <div className="p-6 border-b border-border bg-surface2/30">
                 <h3 className="font-black text-text uppercase tracking-widest">Approved Corridors</h3>
                 <p className="text-xs text-muted font-medium mt-1">Your rates and vehicle commitments are read-only. Contact Super Admin to request changes.</p>
               </div>
               <table className="w-full text-left">
                 <thead>
                   <tr className="border-b border-border bg-surface2/50">
                     <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted">Corridor</th>
                     <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted">Vehicle Types</th>
                     <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted text-right">Approved Rate</th>
                   </tr>
                 </thead>
                 <tbody>
                   <tr className="border-b border-border hover:bg-surface2/30">
                     <td className="p-4 font-bold text-sm text-text">DEL-BOM</td>
                     <td className="p-4">
                        <div className="flex gap-1">
                          <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] rounded font-bold uppercase">32ft SXL</span>
                          <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] rounded font-bold uppercase">24ft MXL</span>
                        </div>
                     </td>
                     <td className="p-4 text-right font-mono text-sm font-bold text-text">Base + 11%</td>
                   </tr>
                   <tr className="border-b border-border hover:bg-surface2/30">
                     <td className="p-4 font-bold text-sm text-text">BOM-BLR</td>
                     <td className="p-4">
                        <div className="flex gap-1">
                          <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] rounded font-bold uppercase">32ft SXL</span>
                        </div>
                     </td>
                     <td className="p-4 text-right font-mono text-sm font-bold text-text">Base + 14%</td>
                   </tr>
                 </tbody>
               </table>
             </Card>
          </div>
        )}

      </div>
    </div>
  )
}
