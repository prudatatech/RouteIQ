import { errorMessage } from '@/utils/display'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  FileText, IndianRupee, MapPin, Calendar, CheckCircle2,
  Package, AlertTriangle, Truck, Building2, Hash, CreditCard, Eye, UploadCloud, LogOut,
} from 'lucide-react'
import {
  Button, Card, CardHeader, DataTable, EmptyState, ErrorState, Page, PageHeader, SearchInput, Spinner, Stat, StatusPill, Tabs, useConfirm, useTabParam,
} from '@/components/ui'
import type { Column } from '@/components/ui'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { tplAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { openKycDocument } from '@/services/kycDocuments'
import { uploadTplDocument } from '@/services/tplDocuments'
import { CorridorEditor } from '@/components/tpl/CorridorEditor'
import { OperationalTermsFields } from '@/components/tpl/OperationalTermsFields'
import { emptyCorridorRow, type CorridorFormRow } from '@/components/tpl/constants'

const TABS = ['overview', 'coverage', 'documents', 'shipments', 'earnings', 'settings'] as const
type Tab = typeof TABS[number]

interface Corridor {
  id: string
  corridor_name: string
  vehicle_types: string[] | string | null
  proposed_rate: string | null
  priority: number | string | null
}

interface TplDocument {
  id: string
  doc_type: string
  file_url: string
  uploaded_at: string
}

interface TplPendingUpdates {
  sla_commitment?: string
  tax_treatment?: string
  corridors?: CorridorFormRow[]
}

interface TplPartner {
  id: string
  company_name: string
  custom_id?: string | null
  gstin?: string | null
  pan_number?: string | null
  msme_status?: string | null
  bank_account_no?: string | null
  bank_ifsc?: string | null
  status: string
  created_at: string
  sla_commitment?: string | null
  tax_treatment?: string | null
  pending_updates?: TplPendingUpdates | null
}

export default function TplDashboardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { confirm } = useConfirm()
  const [tab, setTab] = useTabParam<Tab>(TABS, 'overview')
  const [corridorSearch, setCorridorSearch] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [partner, setPartner] = useState<TplPartner | null>(null)
  const [corridors, setCorridors] = useState<Corridor[]>([])
  const [documents, setDocuments] = useState<TplDocument[]>([])
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null)

  const filteredCorridors = useMemo(() => {
    const q = corridorSearch.trim().toLowerCase()
    if (!q) return corridors
    return corridors.filter(c => [
      c.corridor_name, Array.isArray(c.vehicle_types) ? c.vehicle_types.join(', ') : c.vehicle_types,
    ].some(v => v?.toLowerCase().includes(q)))
  }, [corridors, corridorSearch])

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
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
        if (!uuidRegex.test(id)) throw new Error('Invalid partner ID format')

        const partnerData = await tplAPI.getPartner(id)
        if (!partnerData) throw new Error('Partner not found')
        // The backend only shows the full record (and accepts changes) to the partner's own
        // account, so anyone else would see a dashboard they cannot use.
        if (partnerData.user_id !== useAuthStore.getState().userId) {
          throw new Error('This dashboard belongs to another partner account. Sign in with the partner account to open it.')
        }

        setPartner(partnerData)
        setCorridors(partnerData.tpl_corridors || [])
        setDocuments(partnerData.tpl_documents || [])
      } catch (err) {
        console.error('Dashboard fetch error:', err)
        setError(errorMessage(err, 'Failed to load dashboard'))
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()

    const channel = supabase.channel(`public:tpl_partners:id=eq.${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tpl_partners', filter: `id=eq.${id}` }, payload => {
        if (payload.new) {
          setPartner(payload.new as TplPartner)
          supabase.from('tpl_corridors').select('*').eq('partner_id', id).then(({ data }) => {
            if (data) setCorridors(data)
          })
          if (payload.new.status === 'active' && !payload.new.pending_updates) {
            toast.success('Your pending updates have been approved.')
          }
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id])

  const handleReplaceDocument = async (doc: TplDocument, file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File must be under 2 MB.')
      return
    }
    const ok = await confirm({
      title: 'Replace this document?',
      message: `Uploading a new ${doc.doc_type} will send your profile back for approval and pause any active operations until it's reviewed again.`,
      confirmLabel: 'Replace and resubmit',
      tone: 'danger',
    })
    if (!ok) return

    try {
      setUploadingDoc(doc.id)
      const fileName = await uploadTplDocument(file, doc.doc_type, { applicationId: id! })
        .catch((err: Error) => { throw new Error(`Upload failed: ${err.message}`) })

      // The backend checks the file, sends the partner back to review and tells staff.
      await tplAPI.replaceDocument(id!, doc.id, fileName)

      setPartner((p) => p && ({ ...p, status: 'pending' }))
      setDocuments(docs => docs.map(d => (d.id === doc.id ? { ...d, file_url: fileName, uploaded_at: new Date().toISOString() } : d)))
      toast.success(`${doc.doc_type} updated. Status changed to pending approval.`)
    } catch (err) {
      console.error('Document update error:', err)
      toast.error(errorMessage(err, 'Failed to update document.'))
    } finally {
      setUploadingDoc(null)
    }
  }

  // ─── Settings form ───────────────────────────────
  const [settingsForm, setSettingsForm] = useState<{ slaCommitment: string, taxTreatment: string, corridors: CorridorFormRow[] } | null>(null)
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false)

  useEffect(() => {
    if (!partner || settingsForm) return
    const pending = partner.pending_updates
    setSettingsForm({
      slaCommitment: pending?.sla_commitment || partner.sla_commitment || '2 Hours',
      taxTreatment: pending?.tax_treatment || partner.tax_treatment || '12% GTA (With ITC) - Forward Charge',
      corridors: pending?.corridors && pending.corridors.length > 0
        ? pending.corridors
        : corridors.length > 0
          ? corridors.map((c, i) => ({
              id: i,
              name: c.corridor_name,
              vehicles: Array.isArray(c.vehicle_types) ? c.vehicle_types.join(', ') : (c.vehicle_types || ''),
              rate: c.proposed_rate || '',
              priority: String(c.priority || '1'),
            }))
          : [emptyCorridorRow()],
    })
  }, [partner, corridors, settingsForm])

  const handleSaveSettings = async () => {
    if (!settingsForm) return
    const ok = await confirm({
      title: 'Save these settings?',
      message: "Saving these changes will send your profile back for approval and pause any active operations until it's reviewed again.",
      confirmLabel: 'Save and resubmit',
      tone: 'danger',
    })
    if (!ok) return

    setIsSubmittingSettings(true)
    try {
      const requested = {
        sla_commitment: settingsForm.slaCommitment,
        tax_treatment: settingsForm.taxTreatment,
        corridors: settingsForm.corridors.filter(c => c.name.trim()),
      }
      const updates = { ...requested, requested_at: new Date().toISOString() }
      // Nothing changes until staff approve; the backend validates the request and tells staff.
      await tplAPI.requestSettings(id!, requested)

      setPartner((p) => p && ({ ...p, pending_updates: updates, status: 'pending' }))
      toast.success('Settings update requested. Awaiting approval.')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to submit the settings update.'))
    } finally {
      setIsSubmittingSettings(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner size={32} />
      </div>
    )
  }

  if (error || !partner) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="w-full max-w-md">
          <ErrorState
            title="Can't open this dashboard"
            description={error || 'This partner profile either does not exist or you do not have access to it.'}
          />
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" icon={<LogOut size={16} />} onClick={handleLogout}>Sign out and retry</Button>
          </div>
        </div>
      </div>
    )
  }

  const corridorColumns: Column<Corridor>[] = [
    { key: 'name', header: 'Route', cell: c => <span className="font-medium">{c.corridor_name}</span>, sortValue: c => c.corridor_name },
    {
      key: 'vehicles', header: 'Vehicle types', cell: c => (
        <div className="flex flex-wrap gap-1">
          {(Array.isArray(c.vehicle_types) ? c.vehicle_types : []).map(v => (
            <span key={v} className="rounded-full bg-neutral-soft px-2 py-0.5 text-xs text-neutral">{v}</span>
          ))}
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', cell: c => <span>P{c.priority ?? '—'}</span>, sortValue: c => c.priority ?? null },
    { key: 'rate', header: 'Rate', align: 'right', cell: c => <span className="tabular">₹{c.proposed_rate || '—'}</span>, sortValue: c => c.proposed_rate ?? null },
  ]

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-control bg-brand-fill text-text">
              <Truck size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text leading-none">MargixIndia 3PL</p>
              <p className="mt-0.5 text-xs text-muted leading-none">Partner portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-control border border-border px-3 py-1.5 text-xs text-muted sm:flex">
              <Building2 size={12} /> {partner.company_name}
            </span>
            <StatusPill status={partner.status} className="hidden sm:inline-flex" />
            <Button variant="ghost" size="sm" icon={<LogOut size={14} />} onClick={handleLogout}>Sign out</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-content space-y-6 px-4 py-6 sm:px-6">
        <Page>
          <PageHeader
            title={partner.company_name}
            description={
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5"><Hash size={12} /> {partner.custom_id || partner.id.split('-')[0]}</span>
                <span className="flex items-center gap-1.5"><CreditCard size={12} /> GST: {partner.gstin}</span>
                <span className="flex items-center gap-1.5"><Calendar size={12} /> Since {new Date(partner.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
              </span>
            }
            actions={<StatusPill status={partner.status} />}
          >
            <Tabs
              label="Dashboard sections"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'coverage', label: 'Corridors', count: corridors.length },
                { id: 'documents', label: 'Documents', count: documents.length },
                { id: 'shipments', label: 'Shipments' },
                { id: 'earnings', label: 'Earnings' },
                { id: 'settings', label: 'Settings' },
              ]}
            />
          </PageHeader>

          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Active shipments" value="—" icon={<Package size={16} />} hint="Not tracked yet" />
                <Stat label="Approved corridors" value={corridors.length} icon={<MapPin size={16} />} hint="Active routes" />
                <Stat label="SLA commitment" value={partner.sla_commitment || '—'} icon={<CheckCircle2 size={16} />} hint="Max response" />
                <Stat label="SLA breaches" value="—" icon={<AlertTriangle size={16} />} hint="Not tracked yet" />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card padded>
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-text"><Building2 size={16} className="text-brand" /> Company details</h3>
                  <dl className="space-y-3 text-sm">
                    {[['PAN', partner.pan_number], ['GSTIN', partner.gstin], ['MSME status', partner.msme_status],
                      ['Bank A/C', partner.bank_account_no ? `****${String(partner.bank_account_no).slice(-4)}` : '—'],
                      ['IFSC', partner.bank_ifsc]].map(([label, val]) => (
                      <div key={label} className="flex items-center justify-between">
                        <dt className="text-muted">{label}</dt>
                        <dd className="font-mono text-text">{val || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
                <Card padded>
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-text"><MapPin size={16} className="text-brand" /> Active corridors</h3>
                  {corridors.length === 0 ? (
                    <EmptyState compact title="No corridors configured" />
                  ) : (
                    <div className="space-y-2">
                      {corridors.map(c => (
                        <div key={c.id} className="flex items-center justify-between rounded-control border border-border bg-surface-subtle px-3 py-2 text-sm">
                          <div>
                            <p className="font-medium text-text">{c.corridor_name}</p>
                            <p className="text-xs text-muted">{Array.isArray(c.vehicle_types) ? c.vehicle_types.join(', ') : c.vehicle_types}</p>
                          </div>
                          <span className="font-mono text-brand">₹{c.proposed_rate || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {tab === 'coverage' && (
            <div className="space-y-3">
              <SearchInput value={corridorSearch} onChange={setCorridorSearch} placeholder="Search by route or vehicle type" className="max-w-xs" />
              <DataTable
                caption="Approved corridors"
                columns={corridorColumns}
                rows={filteredCorridors}
                rowKey={c => c.id}
                empty={{ title: 'No corridors configured', description: 'Contact an admin to modify your operational corridors.' }}
              />
            </div>
          )}

          {tab === 'documents' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {documents.length === 0 && (
                  <div className="md:col-span-2 lg:col-span-3">
                    <EmptyState title="No documents uploaded" />
                  </div>
                )}
                {documents.map(doc => (
                  <Card key={doc.id} padded>
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-medium text-text">{doc.doc_type}</h4>
                        <p className="mt-0.5 text-xs text-muted">{new Date(doc.uploaded_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Eye size={14} />}
                        onClick={async () => {
                          try { await openKycDocument(doc.file_url) } catch (err) {
                            toast.error(errorMessage(err, 'Could not open document.'))
                          }
                        }}
                      >
                        View
                      </Button>
                      <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium text-text hover:bg-surface-subtle">
                        {uploadingDoc === doc.id ? <Spinner size={14} /> : <UploadCloud size={14} />}
                        Update
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg"
                          className="hidden"
                          disabled={uploadingDoc === doc.id}
                          onChange={e => { handleReplaceDocument(doc, e.target.files?.[0]); e.target.value = '' }}
                        />
                      </label>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {(tab === 'shipments' || tab === 'earnings') && (
            <Card padded>
              <EmptyState
                icon={tab === 'shipments' ? <Truck size={22} /> : <IndianRupee size={22} />}
                title={tab === 'shipments' ? 'Live shipment tracking' : 'Financial ledger'}
                description={tab === 'shipments'
                  ? 'Track your assigned loads in real time once you receive your first dispatch.'
                  : 'Your settlement ledger and margin reports will appear here once available.'}
              />
            </Card>
          )}

          {tab === 'settings' && settingsForm && (
            <Card padded>
              <CardHeader title="Operational settings" />
              <div className="space-y-8 pt-6">
                {partner.pending_updates && (
                  <div className="rounded-control border border-warning/30 bg-warning-soft p-4 text-sm">
                    <p className="font-medium text-warning">Update pending approval</p>
                    <p className="mt-1 text-text">You have changes awaiting review. A new request replaces the pending one.</p>
                  </div>
                )}
                <OperationalTermsFields
                  slaCommitment={settingsForm.slaCommitment}
                  taxTreatment={settingsForm.taxTreatment}
                  onSlaChange={v => setSettingsForm(f => f && { ...f, slaCommitment: v })}
                  onTaxChange={v => setSettingsForm(f => f && { ...f, taxTreatment: v })}
                />
                <div className="border-t border-border pt-8">
                  <CorridorEditor
                    corridors={settingsForm.corridors}
                    onChange={rows => setSettingsForm(f => f && { ...f, corridors: rows })}
                  />
                </div>
                <div className="flex justify-end border-t border-border pt-6">
                  <Button loading={isSubmittingSettings} onClick={handleSaveSettings}>Submit for approval</Button>
                </div>
              </div>
            </Card>
          )}
        </Page>
      </div>
    </div>
  )
}
