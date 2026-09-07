import React, { useState, useEffect } from 'react'
import {
  Building2, Briefcase, FileText, IndianRupee, ShieldCheck, MapPin, Search, Calendar, ChevronDown, CheckCircle2, Loader2, Download
} from 'lucide-react'
import { Card } from '@/components/ui'
import clsx from 'clsx'
import { supabase } from '@/services/supabase'

export default function TplDashboardPage() {
  const [activeTab, setActiveTab] = useState<'requests' | 'shipments' | 'documents' | 'earnings' | 'coverage'>('coverage')
  
  const [loading, setLoading] = useState(true)
  const [partner, setPartner] = useState<any>(null)
  const [corridors, setCorridors] = useState<any[]>([])
  const [documents, setDocuments] = useState<any[]>([])

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        
        // Fetch partner profile (RLS ensures we only get our own)
        const { data: partnerData, error: pErr } = await supabase
          .from('tpl_partners')
          .select('*')
          .eq('user_id', user.id)
          .single()
          
        if (pErr) throw pErr
        setPartner(partnerData)
        
        if (partnerData) {
          // Fetch Corridors
          const { data: corridorsData } = await supabase
            .from('tpl_corridors')
            .select('*')
            .eq('partner_id', partnerData.id)
          setCorridors(corridorsData || [])

          // Fetch Documents
          const { data: docsData } = await supabase
            .from('tpl_documents')
            .select('*')
            .eq('partner_id', partnerData.id)
          setDocuments(docsData || [])
        }
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [])

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted flex-col gap-4">
        <Loader2 size={32} className="animate-spin text-primary" />
        <div className="text-sm font-bold uppercase tracking-widest">Loading 3PL Profile...</div>
      </div>
    )
  }

  if (!partner) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-red-500 flex-col gap-4">
        <ShieldCheck size={32} />
        <div className="text-sm font-bold uppercase tracking-widest">Profile Not Found or Unauthorized</div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in pb-32">
      {/* 3PL Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-display text-4xl font-black tracking-tighter text-text uppercase leading-none">
            {partner.company_name} <span className="text-primary">Portal</span>
          </h1>
          <div className="text-muted font-bold tracking-tight mt-4 flex items-center gap-3 text-sm">
            <ShieldCheck size={16} className={partner.status === 'active' ? "text-green-500" : "text-yellow-500"} />
            Status: <span className="capitalize">{partner.status}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border pb-4 overflow-x-auto custom-scrollbar">
        {[
          { id: 'requests', icon: Briefcase, label: 'Incoming Requests', count: 0 },
          { id: 'shipments', icon: MapPin, label: 'Active Shipments', count: 0 },
          { id: 'documents', icon: FileText, label: 'Documents', count: documents.length },
          { id: 'earnings', icon: IndianRupee, label: 'Earnings' },
          { id: 'coverage', icon: ShieldCheck, label: 'Approved Coverage', count: corridors.length }
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
               You're all set! When a shipment matching your approved coverage needs escalation, it will appear here.
             </p>
          </div>
        )}

        {activeTab === 'coverage' && (
          <div className="space-y-6 animate-fade-in">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">SLA Commitment</div>
                 <div className="text-2xl font-black text-text">{partner.sla_commitment || 'N/A'}</div>
                 <div className="text-xs text-muted font-bold mt-2">Max time to accept broadcast</div>
               </Card>
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">GTA Tax Treatment</div>
                 <div className="text-2xl font-black text-text">{partner.tax_treatment || 'N/A'}</div>
                 <div className="text-xs text-muted font-bold mt-2">Current tax configuration</div>
               </Card>
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Status</div>
                 <div className={clsx("text-2xl font-black capitalize", partner.status === 'active' ? "text-green-500" : "text-yellow-500")}>{partner.status}</div>
                 <div className="text-xs text-muted font-bold mt-2 flex items-center gap-1">
                   {partner.status === 'active' ? <><CheckCircle2 size={12} /> Live in cascade</> : 'Pending Review'}
                 </div>
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
                   {corridors.length === 0 ? (
                     <tr>
                       <td colSpan={3} className="p-8 text-center text-muted text-sm font-bold">No corridors configured</td>
                     </tr>
                   ) : (
                     corridors.map(corridor => (
                       <tr key={corridor.id} className="border-b border-border hover:bg-surface2/30">
                         <td className="p-4 font-bold text-sm text-text">{corridor.corridor_name}</td>
                         <td className="p-4">
                            <div className="flex flex-wrap gap-1">
                              {(corridor.vehicle_types || []).map((vt: string, idx: number) => (
                                <span key={idx} className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] rounded font-bold uppercase">{vt}</span>
                              ))}
                            </div>
                         </td>
                         <td className="p-4 text-right font-mono text-sm font-bold text-text">{corridor.proposed_rate || 'Standard'}</td>
                       </tr>
                     ))
                   )}
                 </tbody>
               </table>
             </Card>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="space-y-6 animate-fade-in">
             <Card className="border-border bg-surface overflow-hidden">
               <div className="p-6 border-b border-border bg-surface2/30">
                 <h3 className="font-black text-text uppercase tracking-widest">KYC Documents</h3>
                 <p className="text-xs text-muted font-medium mt-1">Documents you submitted during onboarding.</p>
               </div>
               <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                 {documents.length === 0 ? (
                   <div className="col-span-full py-8 text-center text-muted text-sm font-bold">No documents uploaded</div>
                 ) : (
                   documents.map(doc => (
                     <div key={doc.id} className="flex items-center justify-between p-4 rounded-xl border border-border bg-bg hover:bg-surface2/30 transition-colors">
                       <div className="flex items-center gap-3">
                         <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                           <FileText size={20} />
                         </div>
                         <div>
                           <div className="font-bold text-sm text-text">{doc.doc_type}</div>
                           <div className="text-[10px] text-muted font-medium mt-0.5">Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}</div>
                         </div>
                       </div>
                       <a 
                         href={doc.file_url} 
                         target="_blank" 
                         rel="noreferrer"
                         className="p-2 rounded-lg bg-surface2 text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                       >
                         <Download size={16} />
                       </a>
                     </div>
                   ))
                 )}
               </div>
             </Card>
          </div>
        )}

        {(activeTab === 'shipments' || activeTab === 'earnings') && (
          <div className="py-20 flex flex-col items-center justify-center text-center animate-fade-in bg-surface border border-border border-dashed rounded-3xl">
             <div className="w-16 h-16 rounded-full bg-surface2 flex items-center justify-center text-muted mb-6">
               <Briefcase size={24} />
             </div>
             <h2 className="text-xl font-black uppercase tracking-widest text-text">Under Construction</h2>
             <p className="text-sm text-muted font-medium mt-2 max-w-md leading-relaxed">
               This tab is currently being built and will be available in a future update.
             </p>
          </div>
        )}

      </div>
    </div>
  )
}
