import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Building2, Users, Briefcase, Activity, Target, Zap, Clock, ShieldAlert, CheckCircle2, 
  ChevronRight, TrendingUp, AlertTriangle, ShieldCheck, Search, Filter, Calendar, 
  ChevronDown, ExternalLink, MessageSquare, Plus
} from 'lucide-react'
import { Card, CardHeader, Spinner } from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { tplAPI } from '@/services/api'
import clsx from 'clsx'

// Enhanced Mock Data
const partners = [
  { 
    id: '3PL-001', 
    name: 'Rivigo Freight', 
    gst: '07AABCR1234F1Z5', 
    status: 'active', 
    rating: 4.8,
    acceptRate: '94%',
    slaBreaches: 2,
    details: [
      { corridor: 'DEL-BOM', rate: 'Base + 12%', expiry: '2027-01-15', vehicles: ['32ft SXL', '24ft MXL'], priority: 1 },
      { corridor: 'DEL-BLR', rate: 'Base + 15%', expiry: '2026-11-30', vehicles: ['32ft SXL'], priority: 2 }
    ]
  },
  { 
    id: '3PL-002', 
    name: 'Delhivery B2B', 
    gst: '27AADCB2230M1Z8', 
    status: 'active', 
    rating: 4.5,
    acceptRate: '88%',
    slaBreaches: 5,
    details: [
      { corridor: 'BOM-BLR', rate: 'Base + 14%', expiry: '2026-12-31', vehicles: ['20ft', '24ft MXL'], priority: 1 },
      { corridor: 'PUN-HYD', rate: 'Base + 16%', expiry: '2026-12-31', vehicles: ['32ft SXL'], priority: 1 }
    ]
  },
  { 
    id: '3PL-003', 
    name: 'VRL Logistics', 
    gst: '29AAACV5678Q1Z2', 
    status: 'paused', 
    pauseReason: 'SLA breach limit exceeded in Q3',
    rating: 4.2,
    acceptRate: '65%',
    slaBreaches: 12,
    details: [
      { corridor: 'BLR-MAA', rate: 'Fixed ₹45/km', expiry: '2026-10-01', vehicles: ['20ft'], priority: 3 }
    ]
  },
]

const queueData = [
  { id: 'ORD-8821', corridor: 'DEL-BOM', reason: '0 trucks in 50km radius', type: 'Heavy Duty', status: 'Pending Approval', estClientRate: '₹42,500', age: '5m', urgency: 'high', trail: [] },
  { id: 'ORD-8819', corridor: 'PUN-HYD', reason: 'Tier 1 TTL Expired', type: 'Refrigerated', status: 'Broadcasting', estClientRate: '₹68,000', age: '22m', urgency: 'medium', trail: ['Rivigo (Declined)', 'Delhivery (Pending)'] },
  { id: 'ORD-8790', corridor: 'BOM-BLR', reason: 'Exception: All 3PLs Declined', type: 'Flatbed', status: 'Manual Intervention', estClientRate: '₹55,200', age: '2h 15m', urgency: 'critical', trail: ['Delhivery (Declined)', 'VRL (Timeout)'] },
  { id: 'ORD-8825', corridor: 'DEL-BLR', reason: 'Tier 1 TTL Expired', type: 'Heavy Duty', status: 'Pending Approval', estClientRate: '₹89,000', age: '12m', urgency: 'medium', trail: [] },
]

export default function TplNetworkPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<'management' | 'queue' | 'analytics'>('management')
  
  // Analytics State
  const [timeRange, setTimeRange] = useState('This Week')
  
  // Queue State
  const [selectedOrders, setSelectedOrders] = useState<string[]>([])
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  
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
    name: p.company_name,
    gst: p.gstin,
    status: p.status,
    rating: 4.8,
    acceptRate: '95%',
    slaBreaches: 0,
    pauseReason: '',
    details: (p.tpl_corridors || []).map((c: any) => ({
      corridor: c.corridor_name,
      rate: c.proposed_rate || 'Pending',
      expiry: '2028-12-31',
      vehicles: c.vehicle_types || [],
      priority: c.priority || 1
    }))
  }))

  // Live Timer Mock
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedOrders(queueData.map(q => q.id))
    else setSelectedOrders([])
  }

  const handleSelect = (id: string) => {
    setSelectedOrders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
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
                        <button onClick={() => navigate(`/3pl-network/verify?id=${t.id}`)} className="px-4 py-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500 hover:text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all">
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
                </Card>
              ))}
            </div>
            )}
          </div>
        )}

        {/* QUEUE TAB */}
        {activeTab === 'queue' && (
          <div className="space-y-4 relative">
            {/* Bulk Action Bar */}
            {selectedOrders.length > 0 && (
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-surface border border-primary/30 shadow-2xl shadow-primary/20 px-6 py-4 rounded-[24px] flex items-center gap-6 z-50 animate-fade-in backdrop-blur-xl">
                 <div className="text-sm font-bold text-text">
                   <span className="text-primary font-black">{selectedOrders.length}</span> orders selected
                 </div>
                 <div className="w-px h-6 bg-border" />
                 <button className="px-5 py-2 bg-primary text-bg rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary-dark transition-all">
                   Batch Approve Broadcast
                 </button>
                 <button className="px-5 py-2 bg-surface2 text-muted rounded-xl text-xs font-black uppercase tracking-widest hover:bg-border transition-all">
                   Assign Manually
                 </button>
              </div>
            )}

            <Card className="border-border bg-surface overflow-hidden">
              <CardHeader title="Escalation Queue" subtitle="Orders requiring 3PL broadcast or manual intervention" />
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-surface2/50">
                      <th className="p-4 w-12">
                        <input type="checkbox" onChange={handleSelectAll} checked={selectedOrders.length === queueData.length && queueData.length > 0} className="w-4 h-4 rounded border-border text-primary focus:ring-primary bg-bg" />
                      </th>
                      <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted">Order Info</th>
                      <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted">Time in Queue</th>
                      <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted">Escalation Reason</th>
                      <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted">Status / SLA</th>
                      <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted text-right">Client Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueData.map(q => (
                      <React.Fragment key={q.id}>
                        <tr className={clsx("border-b border-border transition-all hover:bg-surface2/30 cursor-pointer", expandedRow === q.id ? 'bg-surface2/20' : '', selectedOrders.includes(q.id) ? 'bg-primary/5' : '')} onClick={() => setExpandedRow(expandedRow === q.id ? null : q.id)}>
                          <td className="p-4" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={selectedOrders.includes(q.id)} onChange={() => handleSelect(q.id)} className="w-4 h-4 rounded border-border text-primary focus:ring-primary bg-bg" />
                          </td>
                          <td className="p-4">
                            <div className="font-mono text-sm font-bold text-text">{q.id}</div>
                            <div className="text-xs text-muted font-medium mt-1">{q.corridor} • {q.type}</div>
                          </td>
                          <td className="p-4">
                            <div className={clsx("text-sm font-bold", q.urgency === 'critical' ? 'text-red-500' : q.urgency === 'medium' ? 'text-yellow-500' : 'text-green-500')}>
                              {q.age}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="text-xs text-muted font-medium max-w-[200px] leading-tight">
                              <span className="inline-flex items-center gap-1.5"><AlertTriangle size={12} className="text-yellow-500 flex-shrink-0" /> {q.reason}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            {q.status === 'Broadcasting' ? (
                              <div>
                                <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg bg-blue-500/10 text-blue-500 inline-block mb-1">
                                  {q.status}
                                </span>
                                <div className="text-[10px] font-mono font-bold text-muted flex items-center gap-1">
                                  <Clock size={10} className="animate-pulse text-blue-500"/> {120 - Math.floor((now.getTime() % 3600000)/60000)}m remaining
                                </div>
                              </div>
                            ) : (
                              <span className={clsx('px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg', 
                                q.status === 'Pending Approval' ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-red-500/10 text-red-500'
                              )}>
                                {q.status}
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            <div className="font-mono text-sm font-bold text-text">{q.estClientRate}</div>
                            <button className="text-[10px] uppercase font-black text-primary hover:underline mt-1 flex items-center justify-end gap-1 w-full">
                              Details <ChevronDown size={12} className={clsx("transition-transform", expandedRow === q.id ? 'rotate-180' : '')} />
                            </button>
                          </td>
                        </tr>
                        {/* Expandable Contact Trail */}
                        {expandedRow === q.id && (
                          <tr className="bg-surface2/30 border-b border-border shadow-inner">
                             <td colSpan={6} className="p-6">
                               <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-3 flex items-center gap-2">
                                 <MessageSquare size={14} /> Cascade Contact Trail
                               </div>
                               {q.trail.length > 0 ? (
                                 <div className="flex items-center gap-4">
                                   {q.trail.map((t, i) => {
                                      const isDeclined = t.includes('Decline') || t.includes('Timeout');
                                      return (
                                        <div key={i} className="flex items-center gap-4">
                                          <div className={clsx("px-3 py-2 rounded-lg text-xs font-bold border", isDeclined ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-blue-500/10 border-blue-500/20 text-blue-500')}>
                                            {t}
                                          </div>
                                          {i < q.trail.length - 1 && <ChevronRight size={16} className="text-muted" />}
                                        </div>
                                      )
                                   })}
                                 </div>
                               ) : (
                                 <div className="text-xs text-muted font-medium italic">No 3PL contacted yet. Waiting for approval to initiate cascade.</div>
                               )}
                               <div className="mt-4 pt-4 border-t border-border/50 flex gap-3">
                                  {q.status === 'Pending Approval' && (
                                    <button className="px-4 py-2 bg-primary hover:bg-primary-dark text-bg rounded-lg text-xs font-black uppercase tracking-widest transition-all">
                                      Approve Cascade
                                    </button>
                                  )}
                                  <button className="px-4 py-2 bg-surface border border-border hover:bg-surface2 text-text rounded-lg text-xs font-black uppercase tracking-widest transition-all">
                                    Assign Manually Override
                                  </button>
                               </div>
                             </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ANALYTICS TAB */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="flex justify-end">
              <div className="relative">
                 <select 
                   value={timeRange} 
                   onChange={(e) => setTimeRange(e.target.value)}
                   className="appearance-none pl-4 pr-10 py-2.5 bg-surface border border-border rounded-xl text-sm font-bold text-text focus:outline-none focus:border-primary cursor-pointer shadow-sm"
                 >
                   <option>This Week</option>
                   <option>This Month</option>
                   <option>This Quarter</option>
                 </select>
                 <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Avg Broadcast Resolution</div>
                 <div className="text-3xl font-black text-text">{timeRange === 'This Week' ? '18m' : '22m'}</div>
                 <div className="text-xs text-green-500 font-bold mt-2 flex items-center gap-1"><TrendingUp size={14}/> -4m vs last period</div>
               </Card>
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Tier 2 Margin</div>
                 <div className="text-3xl font-black text-text">{timeRange === 'This Week' ? '14.2%' : '13.8%'}</div>
                 <div className="text-xs text-red-500 font-bold mt-2 flex items-center gap-1"><TrendingUp size={14} className="rotate-180"/> -1.1% vs Tier 1</div>
               </Card>
               <Card className="p-6 border-border bg-surface">
                 <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">3PL SLA Compliance</div>
                 <div className="text-3xl font-black text-text">{timeRange === 'This Week' ? '92%' : '89%'}</div>
                 <div className="text-xs text-green-500 font-bold mt-2 flex items-center gap-1"><ShieldCheck size={14} /> Target: 95%</div>
               </Card>
               <button onClick={() => setActiveTab('queue')} className="text-left">
                 <Card className="p-6 border-border bg-surface hover:border-red-500/50 hover:bg-red-500/5 transition-all cursor-pointer h-full group">
                   <div className="flex justify-between items-start">
                     <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2 group-hover:text-red-500 transition-colors">Exception Rate</div>
                     <ExternalLink size={14} className="text-muted group-hover:text-red-500 transition-colors" />
                   </div>
                   <div className="text-3xl font-black text-error">{timeRange === 'This Week' ? '4.5%' : '6.1%'}</div>
                   <div className="text-xs text-muted font-bold mt-2">Orders hitting manual queue</div>
                 </Card>
               </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
               <Card className="border-border bg-surface overflow-hidden">
                 <CardHeader title="3PL Partner Leaderboard" subtitle={`Ranked by reliability for ${timeRange}`} />
                 <table className="w-full text-left">
                   <thead>
                     <tr className="border-b border-border bg-surface2/50">
                       <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted">Partner</th>
                       <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted text-right">Accept Rate</th>
                       <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted text-right">Decline Rate</th>
                       <th className="p-4 text-[10px] font-black uppercase tracking-widest text-muted text-right">Avg SLA Response</th>
                     </tr>
                   </thead>
                   <tbody>
                     <tr className="border-b border-border hover:bg-surface2/30">
                       <td className="p-4 font-bold text-sm text-text">Rivigo Freight</td>
                       <td className="p-4 text-right font-mono text-sm text-green-500">94%</td>
                       <td className="p-4 text-right font-mono text-sm text-muted">6%</td>
                       <td className="p-4 text-right font-mono text-sm text-text">14m (vs 2H)</td>
                     </tr>
                     <tr className="border-b border-border hover:bg-surface2/30">
                       <td className="p-4 font-bold text-sm text-text">Delhivery B2B</td>
                       <td className="p-4 text-right font-mono text-sm text-green-500">88%</td>
                       <td className="p-4 text-right font-mono text-sm text-muted">12%</td>
                       <td className="p-4 text-right font-mono text-sm text-text">45m (vs 4H)</td>
                     </tr>
                     <tr className="border-b border-border hover:bg-surface2/30 opacity-60">
                       <td className="p-4 font-bold text-sm text-text">VRL Logistics <span className="text-[9px] bg-yellow-500 text-bg px-1 rounded ml-1 uppercase">Paused</span></td>
                       <td className="p-4 text-right font-mono text-sm text-yellow-500">65%</td>
                       <td className="p-4 text-right font-mono text-sm text-muted">35%</td>
                       <td className="p-4 text-right font-mono text-sm text-red-500">3.5h (vs 6H)</td>
                     </tr>
                   </tbody>
                 </table>
               </Card>

               <Card className="border-border bg-surface overflow-hidden">
                 <CardHeader title="Corridor Escalation Heatmap" subtitle={`Tier 2 dependency by lane for ${timeRange}`} />
                 <div className="p-6 space-y-4">
                    <div>
                      <div className="flex justify-between text-xs font-bold mb-1">
                        <span className="text-text">PUN-HYD</span>
                        <span className="text-muted">42 escalations (85% via TTL expiry)</span>
                      </div>
                      <div className="h-2 w-full bg-surface2 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 w-[85%] rounded-full"></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs font-bold mb-1">
                        <span className="text-text">BOM-BLR</span>
                        <span className="text-muted">28 escalations (60% via No Vehicles)</span>
                      </div>
                      <div className="h-2 w-full bg-surface2 rounded-full overflow-hidden">
                        <div className="h-full bg-yellow-500 w-[60%] rounded-full"></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs font-bold mb-1">
                        <span className="text-text">DEL-BOM</span>
                        <span className="text-muted">12 escalations (45% via No Vehicles)</span>
                      </div>
                      <div className="h-2 w-full bg-surface2 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 w-[45%] rounded-full"></div>
                      </div>
                    </div>
                    <div className="pt-4 mt-2 border-t border-border">
                      <p className="text-[11px] text-muted font-medium leading-relaxed">
                        <strong className="text-text">Insight:</strong> PUN-HYD is suffering from severe Tier 1 TTL expiries, indicating that your Tier 1 brokers are actively rejecting or ignoring loads on this lane. Consider reviewing Tier 1 pricing for PUN-HYD before relying purely on 3PL.
                      </p>
                    </div>
                 </div>
               </Card>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
