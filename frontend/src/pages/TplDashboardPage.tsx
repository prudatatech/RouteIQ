import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Briefcase, FileText, IndianRupee, ShieldCheck, MapPin, Calendar, CheckCircle2,
  Loader2, Download, Package, Activity, AlertTriangle, TrendingUp, Truck, ShieldAlert,
  LogOut, Building2, User, Bell, Settings, Hash, CreditCard, BarChart3
} from 'lucide-react'
import { Card } from '@/components/ui'
import clsx from 'clsx'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'

export default function TplDashboardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'overview' | 'coverage' | 'documents' | 'shipments' | 'earnings'>('overview')
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [partner, setPartner] = useState<any>(null)
  const [corridors, setCorridors] = useState<any[]>([])
  const [documents, setDocuments] = useState<any[]>([])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    useAuthStore.getState().clearAuth()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true)
      setError(null)
      try {
        if (!id) throw new Error('No partner ID provided')

        // Validate that the ID is a proper UUID before querying
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
        if (!uuidRegex.test(id)) throw new Error('Invalid partner ID format')

        // Query each table separately to avoid RLS policy conflicts on joins
        const { data: partnerData, error: pErr } = await supabase
          .from('tpl_partners')
          .select('*')
          .eq('id', id)
          .single()

        if (pErr) throw new Error(pErr.message)
        if (!partnerData) throw new Error('Partner not found')

        setPartner(partnerData)

        // Fetch corridors separately
        const { data: corridorsData } = await supabase
          .from('tpl_corridors')
          .select('*')
          .eq('partner_id', id)
        setCorridors(corridorsData || [])

        // Fetch documents separately
        const { data: docsData } = await supabase
          .from('tpl_documents')
          .select('*')
          .eq('partner_id', id)
        setDocuments(docsData || [])
      } catch (err: any) {
        console.error('Dashboard fetch error:', err)
        setError(err.message || 'Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [id])

  // ─── Loading State ─────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="relative flex flex-col items-center gap-6">
          <div className="absolute w-80 h-80 bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
          <div className="relative z-10 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
              <Loader2 size={28} className="animate-spin text-primary" />
            </div>
            <div className="text-sm font-black uppercase tracking-[0.2em] text-primary animate-pulse">Loading Dashboard...</div>
            <div className="text-xs text-muted">Fetching your partner profile</div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Error State ───────────────────────────────────────
  if (error || !partner) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="relative max-w-md w-full">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-red-500/10 blur-[120px] rounded-full pointer-events-none" />
          <div className="relative z-10 text-center space-y-6">
            <div className="w-20 h-20 mx-auto rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <ShieldAlert size={36} className="text-red-500" />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-widest text-red-500 mb-2">Access Denied</h2>
              <p className="text-sm text-muted max-w-xs mx-auto leading-relaxed">
                {error || 'This partner profile either does not exist or you do not have authorization to view it.'}
              </p>
            </div>
            <button 
              onClick={handleLogout}
              className="px-6 py-3 rounded-xl bg-surface border border-border/50 text-text text-xs font-black uppercase tracking-widest hover:bg-surface2 transition-colors inline-flex items-center gap-2"
            >
              <LogOut size={14} /> Sign Out & Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Main Dashboard ────────────────────────────────────
  const tabs = [
    { id: 'overview', icon: BarChart3, label: 'Overview' },
    { id: 'coverage', icon: MapPin, label: 'Corridors', count: corridors.length },
    { id: 'documents', icon: FileText, label: 'Documents', count: documents.length },
    { id: 'shipments', icon: Truck, label: 'Shipments' },
    { id: 'earnings', icon: IndianRupee, label: 'Earnings' }
  ]

  return (
    <div className="min-h-screen bg-bg">
      {/* ── Top Navigation Bar ──────────────────────────── */}
      <header className="sticky top-0 z-50 bg-bg/80 backdrop-blur-2xl border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/20">
              <Truck size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black uppercase tracking-widest text-text leading-none">Margix 3PL</h1>
              <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-0.5">Partner Portal</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border/50 text-xs text-muted">
              <Building2 size={12} />
              <span className="font-bold">{partner.company_name}</span>
            </div>
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-500">
              <Activity size={12} className="animate-pulse" />
              <span className="font-bold uppercase">{partner.status}</span>
            </div>
            <button className="w-9 h-9 rounded-lg bg-surface border border-border/50 flex items-center justify-center text-muted hover:text-text hover:bg-surface2 transition-colors">
              <Bell size={16} />
            </button>
            <button 
              onClick={handleLogout}
              className="h-9 px-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20 transition-colors flex items-center gap-2 text-xs font-bold"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* ── Hero Card ─────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-surface/80 to-surface2/30 backdrop-blur-2xl p-8 md:p-10 shadow-xl">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-br from-primary/15 to-transparent blur-[100px] -translate-y-1/2 translate-x-1/4 rounded-full pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-[200px] h-[200px] bg-gradient-to-tr from-blue-500/10 to-transparent blur-[80px] translate-y-1/2 -translate-x-1/4 rounded-full pointer-events-none" />
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-[0.2em]">
                <ShieldCheck size={12} />
                Verified 3PL Partner
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight text-text leading-none">
                {partner.company_name}
              </h2>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                <span className="flex items-center gap-1.5 font-bold">
                  <Hash size={12} className="text-primary/60" />
                  {partner.custom_id || partner.id.split('-')[0]}
                </span>
                <span className="flex items-center gap-1.5 font-bold">
                  <CreditCard size={12} className="text-primary/60" />
                  GST: {partner.gstin}
                </span>
                <span className="flex items-center gap-1.5 font-bold">
                  <Calendar size={12} className="text-primary/60" />
                  Since {new Date(partner.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="px-5 py-2.5 rounded-xl bg-surface border border-border/50 text-xs font-bold text-text flex items-center gap-2">
                <IndianRupee size={14} className="text-primary/60" />
                {partner.tax_treatment || 'Standard'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab Navigation ────────────────────────────── */}
        <div className="bg-surface/40 backdrop-blur-xl border border-border/50 p-1.5 rounded-xl flex gap-1 overflow-x-auto custom-scrollbar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={clsx(
                'flex items-center gap-2 px-5 py-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap',
                activeTab === tab.id 
                  ? 'bg-primary text-white shadow-lg shadow-primary/20' 
                  : 'text-muted hover:text-text hover:bg-surface/80'
              )}
            >
              <tab.icon size={14} />
              {tab.label}
              {tab.count !== undefined && (
                <span className={clsx(
                  "ml-1 px-2 py-0.5 rounded text-[10px] font-black", 
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-surface2 text-muted'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Content ───────────────────────────────── */}
        <div className="animate-fade-in">
          
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* KPI Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { label: 'Active Shipments', value: '0', icon: Package, color: 'blue', sub: 'Live now' },
                  { label: 'Approved Corridors', value: String(corridors.length), icon: MapPin, color: 'purple', sub: 'Active routes' },
                  { label: 'SLA Commitment', value: partner.sla_commitment || 'N/A', icon: CheckCircle2, color: 'green', sub: 'Max response' },
                  { label: 'SLA Breaches', value: '0', icon: AlertTriangle, color: 'emerald', sub: 'Excellent standing' },
                ].map((kpi, i) => (
                  <Card key={i} className="p-5 border-border/50 bg-surface/30 backdrop-blur-md hover:bg-surface/50 transition-all group">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-black text-muted uppercase tracking-widest">{kpi.label}</span>
                      <div className={`w-8 h-8 rounded-lg bg-${kpi.color}-500/10 text-${kpi.color}-500 flex items-center justify-center group-hover:scale-110 transition-transform`}>
                        <kpi.icon size={16} />
                      </div>
                    </div>
                    <div className="text-2xl font-black text-text">{kpi.value}</div>
                    <div className="text-[10px] text-muted font-bold mt-1 flex items-center gap-1">
                      <TrendingUp size={10} className="text-green-500" /> {kpi.sub}
                    </div>
                  </Card>
                ))}
              </div>

              {/* Quick Info Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-6 border-border/50 bg-surface/30 backdrop-blur-md">
                  <h3 className="text-xs font-black uppercase tracking-widest text-muted mb-4 flex items-center gap-2">
                    <Building2 size={14} className="text-primary" /> Company Details
                  </h3>
                  <div className="space-y-3">
                    {[
                      ['PAN', partner.pan_number],
                      ['GSTIN', partner.gstin],
                      ['MSME Status', partner.msme_status],
                      ['Bank A/C', partner.bank_account_no ? `****${partner.bank_account_no.slice(-4)}` : 'N/A'],
                      ['IFSC', partner.bank_ifsc],
                    ].map(([label, val]) => (
                      <div key={label as string} className="flex items-center justify-between text-sm">
                        <span className="text-muted font-medium">{label}</span>
                        <span className="font-bold text-text font-mono">{val || 'N/A'}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                
                <Card className="p-6 border-border/50 bg-surface/30 backdrop-blur-md">
                  <h3 className="text-xs font-black uppercase tracking-widest text-muted mb-4 flex items-center gap-2">
                    <MapPin size={14} className="text-primary" /> Active Corridors
                  </h3>
                  {corridors.length === 0 ? (
                    <div className="text-sm text-muted py-4 text-center">No corridors configured</div>
                  ) : (
                    <div className="space-y-3">
                      {corridors.map(c => (
                        <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-surface2/30 border border-border/30">
                          <div>
                            <div className="text-sm font-bold text-text">{c.corridor_name}</div>
                            <div className="text-[10px] text-muted font-bold mt-0.5">
                              {(c.vehicle_types || []).join(', ')}
                            </div>
                          </div>
                          <div className="text-xs font-mono font-bold text-primary">₹{c.proposed_rate || '—'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* Corridors Tab */}
          {activeTab === 'coverage' && (
            <Card className="border-border/50 bg-surface/30 backdrop-blur-md overflow-hidden shadow-xl">
              <div className="p-6 border-b border-border/50 bg-gradient-to-r from-surface2/40 to-transparent flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black text-text tracking-tight flex items-center gap-2">
                    <MapPin size={18} className="text-primary" /> Approved Corridors
                  </h3>
                  <p className="text-[10px] text-muted font-bold mt-1 uppercase tracking-widest">Your rates and vehicle commitments. Contact admin for modifications.</p>
                </div>
                <div className="px-4 py-2 rounded-lg bg-surface2/50 border border-border/50 text-xs font-bold text-text flex items-center gap-2">
                  <IndianRupee size={12} className="text-muted" /> Tax: {partner.tax_treatment || 'Not Specified'}
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border/50 bg-surface2/20">
                      <th className="p-5 text-[10px] font-black uppercase tracking-widest text-muted">Route</th>
                      <th className="p-5 text-[10px] font-black uppercase tracking-widest text-muted">Vehicle Types</th>
                      <th className="p-5 text-[10px] font-black uppercase tracking-widest text-muted">Priority</th>
                      <th className="p-5 text-[10px] font-black uppercase tracking-widest text-muted text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corridors.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-12 text-center">
                          <MapPin size={28} className="mx-auto mb-3 text-muted/40" />
                          <span className="text-sm font-bold text-muted">No corridors configured</span>
                        </td>
                      </tr>
                    ) : (
                      corridors.map(c => (
                        <tr key={c.id} className="border-b border-border/20 hover:bg-surface2/30 transition-colors">
                          <td className="p-5">
                            <div className="font-bold text-sm text-text flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-primary" />
                              {c.corridor_name}
                            </div>
                          </td>
                          <td className="p-5">
                            <div className="flex flex-wrap gap-1.5">
                              {(c.vehicle_types || []).map((vt: string, idx: number) => (
                                <span key={idx} className="px-2 py-0.5 bg-surface2 border border-border/50 text-text text-[10px] rounded font-bold uppercase tracking-wider">
                                  {vt}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-5">
                            <span className="px-2.5 py-1 bg-primary/10 text-primary text-[10px] rounded font-black uppercase">
                              P{c.priority || '—'}
                            </span>
                          </td>
                          <td className="p-5 text-right font-mono text-sm font-bold text-text">
                            ₹{c.proposed_rate || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Documents Tab */}
          {activeTab === 'documents' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-text flex items-center gap-2">
                  <FileText size={18} className="text-primary" /> KYC Documents
                </h3>
                <span className="text-xs text-muted font-bold">{documents.length} file{documents.length !== 1 ? 's' : ''} uploaded</span>
              </div>
              
              {documents.length === 0 ? (
                <Card className="p-12 border-border/50 bg-surface/30 backdrop-blur-md text-center">
                  <FileText size={40} className="mx-auto mb-4 text-muted/40" />
                  <div className="text-sm font-bold text-muted">No documents uploaded</div>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {documents.map(doc => (
                    <Card key={doc.id} className="p-5 border-border/50 bg-surface/30 backdrop-blur-md hover:bg-surface/50 transition-all hover:-translate-y-0.5 hover:shadow-lg group">
                      <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-primary flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                          <FileText size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-sm text-text truncate">{doc.doc_type}</h4>
                          <div className="text-[10px] text-muted font-bold uppercase tracking-widest mt-1">
                            {new Date(doc.uploaded_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </div>
                          <div className="text-[10px] text-muted truncate mt-0.5">{doc.file_url}</div>
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t border-border/30">
                        <div className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-500 text-xs font-bold uppercase tracking-widest">
                          <CheckCircle2 size={12} /> Uploaded & Verified
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Shipments & Earnings Empty States */}
          {(activeTab === 'shipments' || activeTab === 'earnings') && (
            <Card className="p-16 border-border/50 bg-surface/30 backdrop-blur-md text-center">
              <div className="max-w-sm mx-auto space-y-5">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-surface2/50 border border-border/50 flex items-center justify-center">
                  {activeTab === 'shipments' && <Truck size={28} className="text-muted/50" />}
                  {activeTab === 'earnings' && <IndianRupee size={28} className="text-muted/50" />}
                </div>
                <div>
                  <h3 className="text-xl font-black uppercase tracking-wide text-text mb-2">
                    {activeTab === 'shipments' ? 'Live Shipment Tracking' : 'Financial Ledger'}
                  </h3>
                  <p className="text-sm text-muted leading-relaxed">
                    {activeTab === 'shipments' 
                      ? 'Track your assigned loads in real-time with GPS integration and digital POD uploads. This feature activates when you receive your first dispatch.'
                      : 'Your automated settlement ledger and margin reports will appear here. Statements are generated bi-weekly based on delivered shipments.'
                    }
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface2/50 border border-border/50 text-[10px] font-black uppercase tracking-widest text-muted">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> Coming Soon
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────── */}
        <footer className="pt-8 pb-6 border-t border-border/30 text-center">
          <p className="text-[10px] text-muted font-bold uppercase tracking-widest">
            Margix 3PL Partner Portal • Partner ID: {partner.custom_id || partner.id.split('-')[0]} • © {new Date().getFullYear()}
          </p>
        </footer>
      </div>
    </div>
  )
}
