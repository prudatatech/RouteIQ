import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Briefcase, FileText, IndianRupee, ShieldCheck, MapPin, Calendar, CheckCircle2,
  Loader2, Download, Package, Activity, AlertTriangle, TrendingUp, Truck, ShieldAlert,
  LogOut, Building2, User, Bell, Settings, Hash, CreditCard, BarChart3, Eye, UploadCloud, Plus, Trash2
} from 'lucide-react'
import { Card } from '@/components/ui'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'

function AutocompleteInput({ label, value, onChange, options, placeholder, className, labelClass }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [filtered, setFiltered] = useState(options);

  return (
    <div className="relative w-full">
      {label && <label className={labelClass || "text-xs font-bold text-muted mb-1 block"}>{label}</label>}
      <input 
        type="text" 
        value={value}
        onChange={e => {
          onChange(e.target.value);
          setFiltered(options.filter((o: string) => o.toLowerCase().includes(e.target.value.toLowerCase())));
          setIsOpen(true);
        }}
        onFocus={() => {
           setFiltered(options.filter((o: string) => o.toLowerCase().includes(value.toLowerCase())));
           setIsOpen(true);
        }}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        className={className}
        placeholder={placeholder}
      />
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-md shadow-xl max-h-48 overflow-y-auto animate-fade-in origin-top text-left">
          {filtered.map((opt: string) => (
            <div 
              key={opt}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setIsOpen(false);
              }}
              className="px-4 py-2 text-sm hover:bg-primary/10 hover:text-primary cursor-pointer transition-colors"
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const CORRIDOR_RECOMMENDATIONS = [
  "DEL-BOM", "BOM-BLR", "DEL-CCU", "MAA-BLR", "DEL-HYD", "PNQ-BLR", "AMD-BOM", "DEL-MAA"
]

const VEHICLE_RECOMMENDATIONS = [
  "32ft SXL", "32ft MXL", "24ft SXL", "20ft", "14ft Eicher", 
  "17ft Eicher", "19ft Eicher", "Tata Ace", "Ashok Leyland Dost",
  "Bolero Pickup", "40ft Trailer", "40ft Flatbed", "Refrigerated Van"
];

export default function TplDashboardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'overview' | 'coverage' | 'documents' | 'shipments' | 'earnings' | 'settings'>('overview')
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [partner, setPartner] = useState<any>(null)
  const [corridors, setCorridors] = useState<any[]>([])
  const [documents, setDocuments] = useState<any[]>([])
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null)

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

    // Realtime subscription for approval updates
    const channel = supabase.channel(`public:tpl_partners:id=eq.${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tpl_partners', filter: `id=eq.${id}` }, (payload) => {
        // If status changed or pending_updates was cleared (approved)
        if (payload.new) {
          setPartner(payload.new)
          // Refetch corridors in case they were updated
          supabase.from('tpl_corridors').select('*').eq('partner_id', id).then(({ data }) => {
            if (data) setCorridors(data)
          })
          if (payload.new.status === 'active' && !payload.new.pending_updates) {
             toast.success('Your pending updates have been approved by the Superadmin!')
          }
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [id])

  const handleUpdateDocument = async (docId: string, docType: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 2 * 1024 * 1024) {
      toast.error('File must be less than 2MB')
      return
    }

    try {
      setUploadingDoc(docId)
      
      // Sanitize filename to prevent 400 Bad Request
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_')
      const fileName = `${id}/${docType.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}_${cleanFileName}`
      
      // Upload to storage with upsert and explicit content type
      const { error: uploadError } = await supabase.storage
        .from('kyc_documents')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type
        })
        
      if (uploadError) {
        console.error('Supabase upload error details:', uploadError)
        throw new Error(`Upload failed: ${uploadError.message}`)
      }

      // Update document record
      const { error: docError } = await supabase
        .from('tpl_documents')
        .update({ file_url: fileName, uploaded_at: new Date().toISOString() })
        .eq('id', docId)

      if (docError) throw new Error('Failed to update document record')

      // Set partner status back to pending
      const { error: partnerError } = await supabase
        .from('tpl_partners')
        .update({ status: 'pending' })
        .eq('id', id)

      if (partnerError) throw new Error('Failed to update partner status')

      // Update local state
      setPartner({ ...partner, status: 'pending' })
      setDocuments(docs => docs.map(d => d.id === docId ? { ...d, file_url: fileName, uploaded_at: new Date().toISOString() } : d))
      
      toast.success(`${docType} updated successfully. Status changed to pending approval.`)
    } catch (err: any) {
      console.error('Document update error:', err)
      toast.error(err.message || 'Failed to update document')
    } finally {
      setUploadingDoc(null)
      e.target.value = ''
    }
  }

  // ─── Settings Submission ───────────────────────────────
  const [settingsForm, setSettingsForm] = useState<any>(null)
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false)

  // Initialize settings form once data loads
  useEffect(() => {
    if (partner && corridors) {
      if (!settingsForm) {
        if (partner.pending_updates) {
          setSettingsForm({
            slaCommitment: partner.pending_updates.sla_commitment || partner.sla_commitment || '2 Hours',
            taxTreatment: partner.pending_updates.tax_treatment || partner.tax_treatment || '12% GTA (With ITC) - Forward Charge',
            corridors: partner.pending_updates.corridors || []
          })
        } else {
          setSettingsForm({
            slaCommitment: partner.sla_commitment || '2 Hours',
            taxTreatment: partner.tax_treatment || '12% GTA (With ITC) - Forward Charge',
            corridors: corridors.length > 0 
              ? corridors.map(c => ({
                  id: c.id,
                  name: c.corridor_name,
                  vehicles: Array.isArray(c.vehicle_types) ? c.vehicle_types.join(', ') : (c.vehicle_types || ''),
                  rate: c.proposed_rate || '',
                  priority: c.priority || '1'
                }))
              : [{ id: Date.now(), name: '', vehicles: '', rate: '', priority: '1' }]
          })
        }
      }
    }
  }, [partner, corridors])

  const addCorridor = () => setSettingsForm({ ...settingsForm, corridors: [...settingsForm.corridors, { id: Date.now(), name: '', vehicles: '', rate: '', priority: '1' }] })
  
  const removeCorridor = (id: number) => {
    setSettingsForm({ ...settingsForm, corridors: settingsForm.corridors.filter((c: any) => c.id !== id) })
  }

  const handleSaveSettings = async () => {
    setIsSubmittingSettings(true)
    try {
      const updates = {
        sla_commitment: settingsForm.slaCommitment,
        tax_treatment: settingsForm.taxTreatment,
        corridors: settingsForm.corridors,
        requested_at: new Date().toISOString()
      }
      
      const { error: updateError } = await supabase
        .from('tpl_partners')
        .update({ 
          pending_updates: updates,
          status: 'pending' 
        })
        .eq('id', id)

      if (updateError) throw updateError
      
      setPartner({ ...partner, pending_updates: updates, status: 'pending' })
      toast.success('Settings update requested. Awaiting Superadmin approval.')
      setSettingsForm({ fleet: '', routes: '', percentage: '' })
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit settings update')
    } finally {
      setIsSubmittingSettings(false)
    }
  }

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
    { id: 'earnings', icon: IndianRupee, label: 'Earnings' },
    { id: 'settings', icon: Settings, label: 'Settings' }
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
                              {Array.isArray(c.vehicle_types) ? c.vehicle_types.join(', ') : (c.vehicle_types || '')}
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
                      <div className="mt-4 pt-3 border-t border-border/30 grid grid-cols-2 gap-2">
                        <a 
                          href={supabase.storage.from('kyc_documents').getPublicUrl(doc.file_url).data.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-surface2 hover:bg-surface border border-border text-text text-[10px] font-black uppercase tracking-widest transition-colors"
                        >
                          <Eye size={12} className="text-muted" /> View
                        </a>
                        <label className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-widest transition-colors cursor-pointer">
                          {uploadingDoc === doc.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <>
                              <UploadCloud size={12} /> Update
                            </>
                          )}
                          <input 
                            type="file" 
                            accept=".pdf,.png,.jpg,.jpeg" 
                            className="hidden" 
                            disabled={uploadingDoc === doc.id}
                            onChange={(e) => handleUpdateDocument(doc.id, doc.doc_type, e)} 
                          />
                        </label>
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

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <Card className="p-8 border-border/50 bg-surface/30 backdrop-blur-md">
                <div className="flex items-center gap-3 mb-6 border-b border-border/50 pb-4">
                  <Settings size={24} className="text-primary" />
                  <h3 className="text-xl font-black text-text uppercase tracking-tight">Operational Settings</h3>
                </div>

                {partner.pending_updates && (
                  <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3 animate-fade-in">
                    <AlertTriangle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-black text-yellow-500 uppercase tracking-widest">Update Pending Approval</h4>
                      <p className="text-xs text-yellow-500/80 mt-1 font-bold">
                        You have submitted changes that are currently being reviewed by the Superadmin. New requests will overwrite the pending ones.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-8">
                   {/* SLA & Tax Options */}
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-8 border-b border-border/50">
                      <div>
                        <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">Default SLA Commitment</label>
                        <select 
                          value={settingsForm?.slaCommitment || ''}
                          onChange={e => setSettingsForm({ ...settingsForm, slaCommitment: e.target.value })}
                          className="w-full p-3 bg-surface2/50 border border-border rounded-xl text-sm focus:outline-none focus:border-primary text-text font-bold"
                        >
                          <option>2 Hours</option>
                          <option>4 Hours</option>
                          <option>6 Hours</option>
                          <option>12 Hours</option>
                        </select>
                        <p className="text-[10px] text-muted font-bold mt-2">Max time to respond to a broadcast request.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">GTA Tax Treatment</label>
                        <select 
                          value={settingsForm?.taxTreatment || ''}
                          onChange={e => setSettingsForm({ ...settingsForm, taxTreatment: e.target.value })}
                          className="w-full p-3 bg-surface2/50 border border-border rounded-xl text-sm focus:outline-none focus:border-primary text-text font-bold"
                        >
                          <option>12% GTA (With ITC) - Forward Charge</option>
                          <option>5% GTA (No ITC) - Reverse Charge</option>
                        </select>
                        <p className="text-[10px] text-yellow-500 font-bold mt-2 flex items-center gap-1">
                          <AlertTriangle size={12}/> Determines reverse charge liability on your invoices.
                        </p>
                      </div>
                   </div>

                   {/* Corridor Configurations */}
                   <div>
                      <div className="flex justify-between items-center mb-4">
                        <label className="text-xs font-bold text-muted uppercase tracking-widest">Corridor & Rate Declarations</label>
                        <button onClick={addCorridor} className="text-[10px] text-primary hover:underline font-black uppercase flex items-center gap-1">
                          <Plus size={14} /> Add Corridor
                        </button>
                      </div>

                      <div className="space-y-4">
                        {settingsForm?.corridors?.map((c: any, idx: number) => (
                          <div key={c.id} className="p-4 bg-surface2/30 border border-border/50 rounded-xl relative group">
                            {settingsForm.corridors.length > 1 && (
                              <button onClick={() => removeCorridor(c.id)} className="absolute -right-2 -top-2 w-6 h-6 bg-red-500 text-bg rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                                <Trash2 size={12} />
                              </button>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                               <AutocompleteInput
                                 label="Corridor (e.g. DEL-BOM)"
                                 labelClass="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1"
                                 value={c.name}
                                 onChange={(val: string) => {
                                   const newC = [...settingsForm.corridors];
                                   newC[idx].name = val.toUpperCase();
                                   setSettingsForm({ ...settingsForm, corridors: newC });
                                 }}
                                 options={CORRIDOR_RECOMMENDATIONS}
                                 className="w-full p-2.5 bg-surface border border-border/50 rounded-lg text-sm focus:outline-none focus:border-primary font-bold uppercase text-text"
                               />
                               <AutocompleteInput
                                 label="Vehicle Types"
                                 labelClass="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1"
                                 value={c.vehicles}
                                 onChange={(val: string) => {
                                   const newC = [...settingsForm.corridors];
                                   newC[idx].vehicles = val;
                                   setSettingsForm({ ...settingsForm, corridors: newC });
                                 }}
                                 options={VEHICLE_RECOMMENDATIONS}
                                 placeholder="e.g. 32ft SXL, 20ft"
                                 className="w-full p-2.5 bg-surface border border-border/50 rounded-lg text-sm focus:outline-none focus:border-primary font-bold text-text"
                               />
                               <div>
                                 <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Proposed Rate</label>
                                 <input 
                                   type="text" 
                                   value={c.rate}
                                   onChange={e => {
                                     const newC = [...settingsForm.corridors];
                                     newC[idx].rate = e.target.value;
                                     setSettingsForm({ ...settingsForm, corridors: newC });
                                   }}
                                   placeholder="e.g. Base + 12%" 
                                   className="w-full p-2.5 bg-surface border border-border/50 rounded-lg text-sm focus:outline-none focus:border-primary font-mono text-text" 
                                 />
                               </div>
                               <div>
                                 <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Requested Priority</label>
                                 <select 
                                   value={c.priority}
                                   onChange={e => {
                                     const newC = [...settingsForm.corridors];
                                     newC[idx].priority = e.target.value;
                                     setSettingsForm({ ...settingsForm, corridors: newC });
                                   }}
                                   className="w-full p-2.5 bg-surface border border-border/50 rounded-lg text-sm focus:outline-none focus:border-primary font-bold text-text"
                                 >
                                   <option value="1">Priority 1 (Primary)</option>
                                   <option value="2">Priority 2 (Secondary)</option>
                                   <option value="3">Priority 3 (Backup)</option>
                                 </select>
                               </div>
                            </div>
                          </div>
                        ))}
                      </div>
                   </div>
                </div>

                <div className="mt-8 pt-6 border-t border-border/50 flex justify-end">
                  <button 
                    disabled={isSubmittingSettings || !settingsForm}
                    onClick={handleSaveSettings}
                    className="px-6 py-3 bg-primary hover:bg-primary-dark text-bg text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isSubmittingSettings ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    Submit for Approval
                  </button>
                </div>
              </Card>
            </div>
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
