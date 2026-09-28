import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import {
  Building2, Users, Briefcase, Activity, Search, Calendar, ExternalLink, Plus, Inbox, BarChart3
} from 'lucide-react'
import { Card, CardHeader, Spinner } from '@/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tplAPI } from '@/services/api'
import clsx from 'clsx'

export default function TplNetworkPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<'management' | 'queue' | 'analytics'>('management')

  // Partner Management State
  const [searchTerm, setSearchTerm] = useState('')
  const [managementFilter, setManagementFilter] = useState<'all' | 'active' | 'paused' | 'pending'>('all')

  useEffect(() => {
    if (searchParams.get('tab') === 'verification') {
      setActiveTab('management')
      setManagementFilter('pending')
    }
  }, [searchParams])


  const { data: dbPartners = [], isLoading } = useQuery<any[]>({
    queryKey: ['tpl-queue', 'all'],
    queryFn: () => tplAPI.queue('all').then((d: any) => Array.isArray(d) ? d : []),
    refetchInterval: 5000
  })

  const mergedPartners = (Array.isArray(dbPartners) ? dbPartners : []).map(p => ({
    id: p.id,
    customId: p.custom_id,
    name: p.company_name,
    gst: p.gstin,
    status: p.status,
    rating: 4.8,
    acceptRate: '95%',
    slaBreaches: 0,
    pauseReason: '',
    details: (p.tpl_corridors || []).map((c: any) => ({
      corridor: c.corridor_name,
      vehicles: c.vehicle_types || [],
      rate: c.proposed_rate || 'Pending',
      expiry: '2028-12-31', // Placeholder for now
      priority: c.priority?.replace('Priority ', '') || 1
    }))
  }))

  const queryClient = useQueryClient()

  const handleTogglePause = async (id: string, currentStatus: string) => {
    try {
      if (currentStatus === 'active') {
        await tplAPI.pause(id)
        toast.success('Partner paused')
      } else {
        await tplAPI.resume(id)
        toast.success('Partner resumed')
      }
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
    } catch(_e) {
      toast.error('Failed to update status')
    }
  }

  const handleDeletePartner = async (id: string) => {
    if (confirm('Are you sure you want to permanently delete this partner?')) {
      try {
        await tplAPI.delete(id)
        toast.success('Partner deleted')
        queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      } catch(_e) {
        toast.error('Failed to delete partner')
      }
    }
  }

  return (
    <div className="space-y-8 animate-fade-in pb-32">
      {/* Header */}
      <div>
        <h1 className="font-display text-5xl font-black tracking-tighter text-text uppercase leading-none">
          3PL <span className="text-primary">Network</span>
        </h1>
        <div className="text-muted font-bold tracking-tight mt-4 flex items-center gap-3 text-sm">
          <Building2 size={16} className="text-primary" />
          Third-Party Logistics & Escalation Cascade
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border pb-4 overflow-x-auto custom-scrollbar">
        {[
          { id: 'management', icon: Users, label: 'Partner Management' },
          { id: 'queue', icon: Briefcase, label: 'Order Queue' },
          { id: 'analytics', icon: Activity, label: 'Analytics & Margins' }
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
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="mt-8">
        
        {/* MANAGEMENT TAB */}
        {activeTab === 'management' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-4 w-full md:w-auto">
                <div className="flex gap-2 p-1 bg-surface2 rounded-xl">
                  {['all', 'active', 'paused', 'pending'].map(f => (
                    <button
                      key={f}
                      onClick={() => setManagementFilter(f as any)}
                      className={clsx("px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all", managementFilter === f ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
                    >
                      {f === 'pending' ? 'Pending' : f}
                    </button>
                  ))}
                </div>
                <div className="w-px h-6 bg-border mx-2" />
                <div className="relative w-full md:w-64">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input 
                    type="text" 
                    placeholder="Search..." 
                    className="w-full pl-10 pr-4 py-2.5 bg-surface2 border border-border rounded-xl text-sm focus:outline-none focus:border-primary text-text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
              <button 
                onClick={() => navigate('/3pl/onboard')}
                className="px-5 py-2.5 bg-primary/10 text-primary hover:bg-primary hover:text-bg transition-all rounded-xl text-sm font-bold flex items-center gap-2 border border-primary/20 whitespace-nowrap"
              >
                <Plus size={16} /> Generate Invite Link
              </button>
            </div>

            {managementFilter === 'pending' ? (
              <Card className="border-border shadow-2xl overflow-hidden bg-surface">
                <table className="w-full text-left">
                  <thead className="bg-surface2 border-b border-border">
                    <tr>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-muted">ID</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-muted">Partner Name</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-muted">Time in Queue</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-muted">Corridors</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-muted">Status</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-muted text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mergedPartners.filter(p => p.status === 'pending').map((t, idx) => (
                    <tr key={idx} className="hover:bg-surface2/50 transition-colors">
                      <td className="p-4 font-mono text-xs text-muted">{(t.id as string).substring(0,8).toUpperCase()}</td>
                      <td className="p-4 font-bold text-sm text-text">{t.name}</td>
                      <td className="p-4 text-xs font-bold text-green-500">Just Now</td>
                      <td className="p-4 text-xs text-muted">{t.details.map((d: any) => d.corridor).join(', ')}</td>
                      <td className="p-4 text-xs text-yellow-500">Pending Review</td>
                      <td className="p-4 text-right">
                        <button onClick={() => navigate(`/3pl-network/verify?id=${t.customId || t.id}`)} className="px-4 py-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500 hover:text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all">
                          Review
                        </button>
                      </td>
                    </tr>
                    ))}
                    {mergedPartners.filter(p => p.status === 'pending').length === 0 && (
                      <tr><td colSpan={6} className="p-8 text-center text-muted">No pending verifications.</td></tr>
                    )}
                  </tbody>
                </table>
              </Card>
            ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {isLoading ? <Spinner size={24} /> : mergedPartners
                .filter(p => managementFilter === 'all' || p.status === managementFilter)
                .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
                .map(p => (
                <Card key={p.id} className="border-border bg-surface hover:border-primary/50 transition-all group overflow-hidden">
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="font-black text-xl text-text flex items-center gap-2">
                          {p.name}
                          <a href="#" className="text-primary hover:underline text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 ml-2">
                            <ExternalLink size={12} /> View KYC Record
                          </a>
                        </h3>
                        <p className="text-xs font-mono text-muted mt-1">{p.id} • GST: {p.gst}</p>
                      </div>
                      <div className="text-right">
                        <div className={clsx('px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg inline-block mb-2', 
                          p.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
                        )}>
                          {p.status}
                        </div>
                        {p.status === 'paused' && p.pauseReason && (
                          <div className="text-[10px] text-yellow-500/80 font-bold max-w-[150px] leading-tight">
                            Reason: {p.pauseReason}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Reliability Snapshot */}
                    <div className="grid grid-cols-3 gap-4 mb-6 bg-surface2 rounded-xl p-4 border border-border">
                       <div>
                         <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Accept Rate</div>
                         <div className="font-mono text-lg font-black text-text">{p.acceptRate}</div>
                       </div>
                       <div>
                         <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">SLA Breaches</div>
                         <div className={clsx("font-mono text-lg font-black", p.slaBreaches > 3 ? 'text-red-500' : 'text-green-500')}>{p.slaBreaches} <span className="text-xs text-muted font-medium">this Qtr</span></div>
                       </div>
                       <div>
                         <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Rating</div>
                         <div className="font-mono text-lg font-black text-primary">{p.rating} / 5.0</div>
                       </div>
                    </div>

                    <div className="space-y-4">
                      <div className="text-[10px] font-bold text-muted uppercase tracking-widest border-b border-border pb-2">Operational Corridors</div>
                      <div className="space-y-3">
                        {p.details.map((d: any, i: number) => (
                          <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border/50 bg-bg hover:bg-surface2 transition-all">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-text">{d.corridor}</span>
                                <span className="px-1.5 py-0.5 bg-surface text-[9px] font-black uppercase text-muted rounded">Pri {d.priority}</span>
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {d.vehicles.map((v: string) => <span key={v} className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] rounded font-bold uppercase">{v}</span>)}
                              </div>
                            </div>
                            <div className="text-left sm:text-right">
                              <div className="font-mono text-sm text-text font-bold">{d.rate}</div>
                              <div className={clsx("text-[9px] font-bold uppercase tracking-wider mt-1 flex items-center sm:justify-end gap-1", new Date(d.expiry) < new Date(new Date().setMonth(new Date().getMonth() + 1)) ? 'text-red-500' : 'text-muted')}>
                                <Calendar size={10} /> Exp: {d.expiry}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 p-4 bg-surface2 border-t border-border mt-auto">
                    {(p.status === 'active' || p.status === 'paused') && (
                       <>
                         <button onClick={() => handleTogglePause(p.id, p.status)} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted hover:text-text bg-surface border border-border hover:border-primary rounded-lg transition-colors">
                           {p.status === 'active' ? 'Pause Partner' : 'Resume Partner'}
                         </button>
                         <button onClick={() => handleDeletePartner(p.id)} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-white bg-red-500/10 hover:bg-red-500 rounded-lg transition-colors">
                           Delete
                         </button>
                       </>
                    )}
                  </div>
                </Card>
              ))}
            </div>
            )}
          </div>
        )}

        {/* QUEUE TAB */}
        {activeTab === 'queue' && (
          <Card className="border-border bg-surface overflow-hidden">
            <CardHeader title="Escalation Queue" subtitle="Orders requiring 3PL broadcast or manual intervention" />
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <Inbox size={40} className="text-muted opacity-50" />
              <p className="text-sm font-bold text-text">No escalation queue feed is wired up yet.</p>
              <p className="text-xs text-muted max-w-md">
                The 3PL escalation/broadcast cascade isn't backed by an API yet, so there's nothing live to show here.
              </p>
            </div>
          </Card>
        )}

        {/* ANALYTICS TAB */}
        {activeTab === 'analytics' && (
          <Card className="border-border bg-surface overflow-hidden">
            <CardHeader title="Analytics & Margins" subtitle="3PL network performance" />
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <BarChart3 size={40} className="text-muted opacity-50" />
              <p className="text-sm font-bold text-text">No 3PL analytics data source yet.</p>
              <p className="text-xs text-muted max-w-md">
                Broadcast resolution time, margins, SLA compliance and the partner leaderboard aren't tracked by the backend yet.
              </p>
            </div>
          </Card>
        )}

      </div>
    </div>
  )
}
