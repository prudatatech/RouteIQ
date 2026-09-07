import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Briefcase, FileText, IndianRupee, ShieldCheck, MapPin, Search, Calendar, CheckCircle2, Loader2, Download, Package, Activity, AlertTriangle, TrendingUp, Clock, Truck, ShieldAlert
} from 'lucide-react'
import { Card } from '@/components/ui'
import clsx from 'clsx'
import { tplAPI } from '@/services/api'
import { supabase } from '@/services/supabase'

export default function TplDashboardPage() {
  const { id } = useParams()
  const [activeTab, setActiveTab] = useState<'coverage' | 'requests' | 'shipments' | 'documents' | 'earnings'>('coverage')
  
  const [loading, setLoading] = useState(true)
  const [partner, setPartner] = useState<any>(null)
  const [corridors, setCorridors] = useState<any[]>([])
  const [documents, setDocuments] = useState<any[]>([])

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || !id) return
        
        // Fetch partner profile using backend API (bypasses RLS)
        const partnerData = await tplAPI.getPartner(id)
          
        if (!partnerData) throw new Error('Partner not found')
        
        // Add extra authorization check to ensure the logged-in user owns this profile
        if (partnerData.user_id !== user.id) {
          throw new Error('Unauthorized')
        }

        setPartner(partnerData)
        setCorridors(partnerData.tpl_corridors || [])
        setDocuments(partnerData.tpl_documents || [])
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [id])

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center text-muted flex-col gap-6 animate-fade-in relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/10 blur-[100px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <Loader2 size={40} className="animate-spin text-primary" />
          <div className="text-sm font-black uppercase tracking-widest text-primary animate-pulse">Syncing 3PL Matrix...</div>
        </div>
      </div>
    )
  }

  if (!partner) {
    return (
      <div className="flex h-[80vh] items-center justify-center text-red-500 flex-col gap-6 animate-fade-in relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-red-500/10 blur-[100px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center gap-4 text-center">
          <ShieldAlert size={64} className="text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
          <div className="text-lg font-black uppercase tracking-widest text-red-500">Access Denied</div>
          <div className="text-sm text-red-400/80 max-w-sm">This partner profile either does not exist or you do not have authorization to view it.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-10 animate-fade-in pb-32 relative">
      {/* Background Orbs */}
      <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-primary/5 blur-[150px] rounded-full pointer-events-none -z-10" />
      <div className="fixed bottom-0 right-0 w-[600px] h-[600px] bg-blue-500/5 blur-[150px] rounded-full pointer-events-none -z-10" />

      {/* Premium Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/50 backdrop-blur-2xl p-8 md:p-12 shadow-2xl">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-gradient-to-br from-primary/20 to-transparent blur-[80px] -translate-y-1/2 translate-x-1/3 rounded-full pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-widest shadow-[0_0_15px_rgba(79,172,254,0.15)]">
              <ShieldCheck size={14} />
              Verified Partner
            </div>
            <h1 className="font-display text-5xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-text to-text/50 uppercase leading-none drop-shadow-lg">
              {partner.company_name}
            </h1>
            <div className="flex items-center gap-4 text-xs font-bold text-muted uppercase tracking-widest">
              <span className="flex items-center gap-1.5"><MapPin size={14} /> ID: {partner.custom_id || partner.id.split('-')[0]}</span>
              <span className="flex items-center gap-1.5"><Calendar size={14} /> Joined {new Date(partner.created_at).getFullYear()}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className={clsx(
              "px-6 py-3 rounded-xl border font-black uppercase tracking-widest text-xs flex items-center gap-2 shadow-lg backdrop-blur-md transition-all hover:scale-105 cursor-default",
              partner.status === 'active' 
                ? "bg-green-500/10 border-green-500/30 text-green-500 shadow-green-500/10" 
                : "bg-yellow-500/10 border-yellow-500/30 text-yellow-500 shadow-yellow-500/10"
            )}>
              {partner.status === 'active' ? <Activity size={16} className="animate-pulse" /> : <Clock size={16} />}
              Status: {partner.status}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-6 border-border/50 bg-surface/30 backdrop-blur-md hover:bg-surface/50 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-black text-muted uppercase tracking-widest">Active Shipments</div>
            <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center group-hover:scale-110 transition-transform"><Package size={16} /></div>
          </div>
          <div className="text-3xl font-black text-text">0</div>
          <div className="text-xs text-muted font-bold mt-2 flex items-center gap-1 text-green-500"><TrendingUp size={12} /> Live now</div>
        </Card>
        
        <Card className="p-6 border-border/50 bg-surface/30 backdrop-blur-md hover:bg-surface/50 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-black text-muted uppercase tracking-widest">Approved Corridors</div>
            <div className="w-8 h-8 rounded-full bg-purple-500/10 text-purple-500 flex items-center justify-center group-hover:scale-110 transition-transform"><MapPin size={16} /></div>
          </div>
          <div className="text-3xl font-black text-text">{corridors.length}</div>
          <div className="text-xs text-muted font-bold mt-2">Active service routes</div>
        </Card>
        
        <Card className="p-6 border-border/50 bg-surface/30 backdrop-blur-md hover:bg-surface/50 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-black text-muted uppercase tracking-widest">SLA Commitment</div>
            <div className="w-8 h-8 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center group-hover:scale-110 transition-transform"><CheckCircle2 size={16} /></div>
          </div>
          <div className="text-3xl font-black text-text">{partner.sla_commitment || 'N/A'}</div>
          <div className="text-xs text-muted font-bold mt-2">Max acceptance time</div>
        </Card>
        
        <Card className="p-6 border-border/50 bg-surface/30 backdrop-blur-md hover:bg-surface/50 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-black text-muted uppercase tracking-widest">SLA Breaches</div>
            <div className="w-8 h-8 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center group-hover:scale-110 transition-transform"><AlertTriangle size={16} /></div>
          </div>
          <div className="text-3xl font-black text-text">0</div>
          <div className="text-xs text-muted font-bold mt-2 text-green-500">Excellent standing</div>
        </Card>
      </div>

      {/* Animated Tabs */}
      <div className="bg-surface/40 backdrop-blur-xl border border-border/50 p-2 rounded-2xl flex gap-2 overflow-x-auto custom-scrollbar shadow-lg">
        {[
          { id: 'coverage', icon: ShieldCheck, label: 'Coverage Profile', count: corridors.length },
          { id: 'documents', icon: FileText, label: 'KYC Documents', count: documents.length },
          { id: 'requests', icon: Briefcase, label: 'Escalation Requests' },
          { id: 'shipments', icon: Truck, label: 'Live Shipments' },
          { id: 'earnings', icon: IndianRupee, label: 'Earnings & Margins' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={clsx(
              'flex items-center gap-2 px-6 py-3.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap relative overflow-hidden group',
              activeTab === tab.id 
                ? 'bg-primary text-bg shadow-[0_0_20px_rgba(79,172,254,0.3)]' 
                : 'text-muted hover:text-text hover:bg-surface/80'
            )}
          >
            {activeTab === tab.id && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
            )}
            <tab.icon size={16} className={activeTab === tab.id ? 'text-bg' : 'text-primary/70'} />
            <span className="relative z-10">{tab.label}</span>
            {tab.count !== undefined && (
              <span className={clsx(
                "ml-2 px-2 py-0.5 rounded-md text-[10px] relative z-10", 
                activeTab === tab.id ? 'bg-bg/20 text-bg' : 'bg-surface2 text-muted'
              )}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content Areas */}
      <div className="mt-8">
        
        {activeTab === 'coverage' && (
          <div className="space-y-6 animate-fade-in">
             <Card className="border-border/50 bg-surface/30 backdrop-blur-md overflow-hidden shadow-xl">
               <div className="p-8 border-b border-border/50 bg-gradient-to-r from-surface2/40 to-transparent flex flex-col md:flex-row md:items-center justify-between gap-4">
                 <div>
                   <h3 className="font-display text-2xl font-black text-text tracking-tight flex items-center gap-3">
                     <MapPin className="text-primary" /> Approved Corridors
                   </h3>
                   <p className="text-xs text-muted font-bold mt-2 uppercase tracking-widest">Your rates and vehicle commitments are read-only. Contact admin for modifications.</p>
                 </div>
                 <div className="px-4 py-2 rounded-lg bg-surface2/50 border border-border/50 text-xs font-bold text-text flex items-center gap-2">
                   <IndianRupee size={14} className="text-muted" /> Tax: {partner.tax_treatment || 'Not Specified'}
                 </div>
               </div>
               
               <div className="overflow-x-auto">
                 <table className="w-full text-left border-collapse">
                   <thead>
                     <tr className="border-b border-border/50 bg-surface2/20">
                       <th className="p-6 text-[10px] font-black uppercase tracking-widest text-muted">Service Route</th>
                       <th className="p-6 text-[10px] font-black uppercase tracking-widest text-muted">Vehicle Fleet Types</th>
                       <th className="p-6 text-[10px] font-black uppercase tracking-widest text-muted text-right">Agreed Rate Profile</th>
                     </tr>
                   </thead>
                   <tbody>
                     {corridors.length === 0 ? (
                       <tr>
                         <td colSpan={3} className="p-12 text-center">
                           <div className="flex flex-col items-center justify-center text-muted">
                             <MapPin size={32} className="mb-4 opacity-50" />
                             <span className="text-sm font-bold uppercase tracking-widest">No corridors configured</span>
                           </div>
                         </td>
                       </tr>
                     ) : (
                       corridors.map(corridor => (
                         <tr key={corridor.id} className="border-b border-border/20 hover:bg-surface2/40 transition-colors group">
                           <td className="p-6">
                             <div className="font-black text-sm text-text flex items-center gap-2">
                               <div className="w-2 h-2 rounded-full bg-primary/50 group-hover:bg-primary transition-colors" />
                               {corridor.corridor_name}
                             </div>
                           </td>
                           <td className="p-6">
                              <div className="flex flex-wrap gap-2">
                                {(corridor.vehicle_types || []).map((vt: string, idx: number) => (
                                  <span key={idx} className="px-2.5 py-1 bg-surface2 border border-border/50 text-text text-[10px] rounded-md font-black uppercase tracking-wider shadow-sm group-hover:border-primary/30 transition-colors">
                                    {vt}
                                  </span>
                                ))}
                              </div>
                           </td>
                           <td className="p-6 text-right font-mono text-sm font-bold text-text group-hover:text-primary transition-colors">
                             {corridor.proposed_rate || 'Standard'}
                           </td>
                         </tr>
                       ))
                     )}
                   </tbody>
                 </table>
               </div>
             </Card>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="space-y-6 animate-fade-in">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {documents.length === 0 ? (
                 <div className="col-span-full py-20 flex flex-col items-center justify-center text-center bg-surface/30 backdrop-blur-md border border-border/50 border-dashed rounded-3xl">
                   <FileText size={48} className="text-muted/50 mb-4" />
                   <div className="text-sm font-bold uppercase tracking-widest text-muted">No documents uploaded</div>
                 </div>
               ) : (
                 documents.map((doc, idx) => (
                   <Card key={doc.id} className="p-6 border-border/50 bg-surface/30 backdrop-blur-md hover:bg-surface/60 transition-all hover:-translate-y-1 hover:shadow-xl group flex flex-col justify-between h-48 relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                       <FileText size={64} />
                     </div>
                     <div>
                       <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 text-primary flex items-center justify-center mb-4 shadow-[0_0_15px_rgba(79,172,254,0.1)] group-hover:scale-110 transition-transform">
                         <FileText size={20} />
                       </div>
                       <h4 className="font-black text-lg text-text leading-tight">{doc.doc_type}</h4>
                       <div className="text-[10px] text-muted font-bold uppercase tracking-widest mt-2">
                         Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                       </div>
                     </div>
                     <div className="pt-4 mt-4 border-t border-border/30">
                       <a 
                         href={doc.file_url} 
                         target="_blank" 
                         rel="noreferrer"
                         className="flex items-center justify-between text-xs font-black uppercase tracking-widest text-primary hover:text-white transition-colors w-full"
                       >
                         View Document
                         <Download size={14} className="group-hover:translate-y-0.5 transition-transform" />
                       </a>
                     </div>
                   </Card>
                 ))
               )}
             </div>
          </div>
        )}

        {/* Empty States for Future Features */}
        {(activeTab === 'requests' || activeTab === 'shipments' || activeTab === 'earnings') && (
          <div className="py-24 flex flex-col items-center justify-center text-center animate-fade-in bg-surface/30 backdrop-blur-md border border-border/50 rounded-3xl shadow-2xl relative overflow-hidden">
             <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.02]" />
             
             <div className="relative z-10 flex flex-col items-center">
               <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-surface2 to-surface border border-border/50 flex items-center justify-center text-muted mb-8 shadow-inner relative overflow-hidden">
                 <div className="absolute inset-0 bg-primary/5 animate-pulse" />
                 {activeTab === 'requests' && <Briefcase size={32} className="text-primary/50" />}
                 {activeTab === 'shipments' && <Truck size={32} className="text-blue-500/50" />}
                 {activeTab === 'earnings' && <IndianRupee size={32} className="text-green-500/50" />}
               </div>
               
               <h2 className="font-display text-3xl font-black uppercase tracking-tight text-text mb-3">
                 {activeTab === 'requests' && 'Escalation Queue'}
                 {activeTab === 'shipments' && 'Active Fleet Tracking'}
                 {activeTab === 'earnings' && 'Financial Ledger'}
               </h2>
               
               <p className="text-sm text-muted font-medium max-w-md leading-relaxed px-6">
                 {activeTab === 'requests' && "When shipments matching your approved corridors (e.g. DEL-BOM) face SLA breaches in the primary network, they will cascade to you here for immediate bidding."}
                 {activeTab === 'shipments' && "Track all your currently assigned loads in real-time. Full GPS integration and digital POD uploads will be available when you are dispatched."}
                 {activeTab === 'earnings' && "Your automated settlement ledger and margin reports. Statements are generated bi-weekly based on successfully delivered SLA commitments."}
               </p>
               
               <div className="mt-8 px-4 py-2 rounded-full bg-surface2/50 border border-border/50 text-[10px] font-black uppercase tracking-widest text-muted flex items-center gap-2">
                 <span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> System Standby
               </div>
             </div>
          </div>
        )}

      </div>
    </div>
  )
}
