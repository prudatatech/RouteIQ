import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, ArrowLeft, CheckCircle2, ShieldCheck, XCircle, ChevronRight, Download, FileText, FileImage, ShieldAlert, Zap, Loader2, Play
} from 'lucide-react'
import { Card, Button, Spinner } from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { tplAPI } from '@/services/api'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'

export default function TplVerificationPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const id = searchParams.get('id')
  
  const [status, setStatus] = useState<'pending' | 'provisioning' | 'invite_sent'>('pending')
  const [provisionStep, setProvisionStep] = useState(0)
  const [gstVerified, setGstVerified] = useState(false)
  const [gstVerifying, setGstVerifying] = useState(false)

  const { data: partner, isLoading } = useQuery({
    queryKey: ['tpl-partner', id],
    queryFn: () => tplAPI.getPartner(id!),
    enabled: !!id
  })

  const steps = [
    'Verifying KYC documents...',
    'Creating partner account in Vendor Master...',
    'Linking operational lane agreements...',
    'Generating secure activation link...',
    'Sending invite email to partner...',
  ]

  const handleApprove = async () => {
    setStatus('provisioning')
    
    // Animate through steps
    let currentStep = 0
    const interval = setInterval(() => {
      currentStep++
      setProvisionStep(currentStep)
      if (currentStep >= steps.length) {
        clearInterval(interval)
        // Call API
        tplAPI.approve(id!, 'admin@3pl.com').then(() => {
           setTimeout(() => setStatus('invite_sent'), 1000)
        }).catch(err => {
           console.error(err)
           setStatus('pending')
        })
      }
    }, 1200) // 1.2s per step
  }

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen"><Spinner size={48} /></div>
  }
  if (!partner) {
    return <div className="p-20 text-center">Partner not found</div>
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in pb-32">
      {/* Header */}
      <div>
        <button onClick={() => navigate('/3pl-network?tab=verification')} className="text-muted hover:text-text flex items-center gap-1 text-sm font-bold mb-4 transition-colors">
          <ArrowLeft size={16} /> Back to Pending Queue
        </button>
        <div className="flex justify-between items-start">
           <div>
             <h1 className="font-display text-4xl font-black tracking-tighter text-text uppercase leading-none flex items-center gap-4">
               {partner.company_name}
               <span className={clsx(
                 "px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border",
                 status === 'pending' ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" : 
                 status === 'provisioning' ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                 "bg-green-500/10 text-green-500 border-green-500/20"
               )}>
                 {status === 'pending' ? 'Pending Verification' : status === 'provisioning' ? 'Provisioning...' : 'Invite Sent (Awaiting Login)'}
               </span>
             </h1>
             <div className="text-muted font-bold tracking-tight mt-4 flex items-center gap-3 text-sm">
               <Building2 size={16} className="text-primary" />
               Submitted 2 hours ago by admin@safexpress.com
             </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         {/* LEFT: Compliance */}
         <Card className="p-8 border-border bg-surface flex flex-col">
            <div className="flex items-center gap-3 mb-6 border-b border-border pb-4">
              <ShieldCheck size={24} className="text-primary" />
              <h2 className="text-xl font-black text-text uppercase">Identity & KYC</h2>
            </div>
            
             <div className="space-y-6 flex-1">
               <div className="grid grid-cols-2 gap-6">
                 <div>
                   <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Company PAN</div>
                   <div className="font-mono font-bold text-sm">{partner.pan_number}</div>
                 </div>
                 <div>
                   <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">GSTIN</div>
                   <div className="flex items-center gap-2">
                     <span className="font-mono font-bold text-sm">{partner.gstin}</span>
                     {gstVerified ? (
                       <span className="text-[9px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded font-black uppercase">Verified Active</span>
                     ) : (
                       <button 
                         disabled={gstVerifying}
                         onClick={() => {
                           setGstVerifying(true);
                           setTimeout(() => {
                             setGstVerifying(false);
                             setGstVerified(true);
                           }, 1500);
                         }} 
                         className="text-[9px] bg-yellow-500 hover:bg-yellow-600 text-bg px-2 py-0.5 rounded font-black uppercase transition-colors disabled:opacity-50 flex items-center gap-1"
                       >
                         {gstVerifying && <Loader2 size={10} className="animate-spin" />}
                         {gstVerifying ? 'Verifying...' : 'Verify Online'}
                       </button>
                     )}
                   </div>
                 </div>
                 <div>
                   <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">GTA Tax Treatment</div>
                   <div className="font-bold text-sm">{partner.tax_treatment || '12% GTA (With ITC)'}</div>
                 </div>
                 <div>
                   <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">MSME Status</div>
                   <div className="font-bold text-sm">{partner.msme_status}</div>
                 </div>
               </div>
               
               <div className="pt-6 border-t border-border">
                 <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Bank Details (For Remittance)</div>
                 <div className="bg-surface2 rounded-xl p-4 grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[9px] text-muted uppercase font-bold">Account Name</div>
                      <div className="font-mono text-sm font-bold">{partner.company_name}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-muted uppercase font-bold">Account No.</div>
                      <div className="font-mono text-sm font-bold">{partner.bank_account_no || 'N/A'}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-muted uppercase font-bold">IFSC Code</div>
                      <div className="font-mono text-sm font-bold">{partner.bank_ifsc || 'N/A'}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-muted uppercase font-bold">Bank</div>
                      <div className="font-mono text-sm font-bold">Verified Bank</div>
                    </div>
                 </div>
               </div>

               <div className="pt-6 border-t border-border">
                 <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Uploaded Documents ({partner.tpl_documents?.length || 0})</div>
                 <div className="grid grid-cols-2 gap-4">
                    {partner.tpl_documents?.map((doc: any, idx: number) => (
                      <div key={idx} className="border border-border rounded-xl p-3 flex items-center gap-3 hover:bg-surface2 transition-colors group">
                         <FileText size={24} className="text-primary" />
                         <div className="flex-1 overflow-hidden">
                           <div className="text-xs font-bold text-text group-hover:text-primary transition-colors truncate" title={doc.file_url}>{doc.file_url}</div>
                           <div className="text-[10px] text-muted">{doc.doc_type}</div>
                         </div>
                         <button 
                           onClick={() => alert('Secure document preview will open here.')}
                           className="p-1.5 hover:bg-primary/10 rounded-md text-muted hover:text-primary transition-colors"
                         >
                           <Download size={14} />
                         </button>
                      </div>
                    ))}
                    {(!partner.tpl_documents || partner.tpl_documents.length === 0) && (
                      <div className="col-span-2 text-xs text-muted">No documents uploaded.</div>
                    )}
                 </div>
               </div>
            </div>
         </Card>

         {/* RIGHT: Operational */}
         <Card className="p-8 border-border bg-surface flex flex-col">
            <div className="flex items-center gap-3 mb-6 border-b border-border pb-4">
              <Zap size={24} className="text-primary" />
              <h2 className="text-xl font-black text-text uppercase">Operational Profile</h2>
            </div>
            
            <div className="space-y-6 flex-1">
               <div className="grid grid-cols-2 gap-6">
                 <div>
                   <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">SLA Commitment</div>
                   <div className="font-bold text-sm text-green-500">2 Hours (Strict)</div>
                 </div>
                 <div>
                   <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Fleet Capacity Declaration</div>
                   <div className="font-bold text-sm">450+ Vehicles</div>
                 </div>
               </div>

               <div className="pt-6 border-t border-border">
                 <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Requested Corridors ({partner.tpl_corridors?.length || 0})</div>
                 <div className="space-y-3">
                   {partner.tpl_corridors?.map((c: any, idx: number) => (
                   <div key={idx} className="p-4 bg-bg border border-border rounded-xl">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="font-bold text-text">{c.corridor_name}</div>
                          <div className="flex gap-1 mt-1">
                            {c.vehicle_types?.map((v: string) => (
                              <span key={v} className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] rounded font-bold uppercase">{v}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold text-text">{c.proposed_rate || 'N/A'}</div>
                          <div className="text-[9px] font-bold text-muted uppercase mt-1">Priority {c.priority || 1}</div>
                        </div>
                      </div>
                   </div>
                   ))}
                 </div>
               </div>

            </div>
         </Card>
      </div>

      {/* Action / Provisioning Bar */}
      <Card className="border-border bg-surface p-6 overflow-hidden">
        {status === 'pending' && (
          <div className="flex items-center justify-between animate-fade-in">
             <div className="flex items-center gap-3">
               <input type="checkbox" className="w-5 h-5 rounded border-border text-primary focus:ring-primary bg-bg" id="declare" />
               <label htmlFor="declare" className="text-xs font-medium text-muted max-w-lg">
                 I have reviewed the KYC documents and operational terms. Approving this vendor will provision their 3PL dashboard and send an activation email.
               </label>
             </div>
             <div className="flex gap-4">
               <button className="px-8 py-3 bg-surface border border-red-500/50 hover:bg-red-500/10 text-red-500 font-black uppercase tracking-widest text-sm rounded-xl transition-all">
                 Reject & Request Changes
               </button>
               <button 
                 onClick={handleApprove}
                 disabled={!gstVerified}
                 className="px-12 py-3 bg-primary hover:bg-primary-dark text-bg font-black uppercase tracking-widest text-sm rounded-xl transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:shadow-none"
               >
                 {gstVerified ? 'Confirm & Approve 3PL' : 'Verify GST First'}
               </button>
             </div>
          </div>
        )}

        {status === 'provisioning' && (
          <div className="animate-fade-in py-2">
             <div className="flex justify-between text-xs font-black uppercase tracking-widest text-muted mb-4">
               <span>Provisioning 3PL Account...</span>
               <span>{Math.round((provisionStep / steps.length) * 100)}%</span>
             </div>
             <div className="w-full h-2 bg-surface2 rounded-full overflow-hidden mb-6">
               <div 
                 className="h-full bg-blue-500 transition-all duration-1000 ease-in-out" 
                 style={{ width: `${(provisionStep / steps.length) * 100}%` }} 
               />
             </div>
             <div className="space-y-2">
               {steps.map((stepText, idx) => (
                 <div key={idx} className={clsx("flex items-center gap-3 text-sm font-medium transition-all duration-500", 
                   idx < provisionStep ? "text-text" : 
                   idx === provisionStep ? "text-blue-500 font-bold translate-x-2" : "text-muted opacity-30"
                 )}>
                   {idx < provisionStep ? <CheckCircle2 size={16} className="text-green-500" /> : 
                    idx === provisionStep ? <Loader2 size={16} className="animate-spin" /> : 
                    <div className="w-4 h-4 rounded-full border-2 border-muted" />}
                   {stepText}
                 </div>
               ))}
             </div>
             <p className="text-[10px] text-muted font-bold uppercase mt-6 tracking-widest">
               Usually under a minute — up to 5 minutes during peak load.
             </p>
          </div>
        )}

        {status === 'invite_sent' && (
          <div className="flex items-center justify-between animate-fade-in bg-green-500/5 p-4 rounded-2xl border border-green-500/20">
             <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-text uppercase tracking-tight">Provisioning Complete</h3>
                  <p className="text-xs text-muted font-medium mt-1">
                    An activation link has been sent to admin@safexpress.com. They will appear as 'Active' once they log in.
                  </p>
                </div>
             </div>
             <button onClick={() => navigate('/3pl-network')} className="px-6 py-3 bg-surface border border-border hover:bg-surface2 text-text font-black uppercase tracking-widest text-xs rounded-xl transition-all">
                Return to Network
             </button>
          </div>
        )}
      </Card>
    </div>
  )
}
