import { errorMessage, formatDateTime } from '@/utils/display'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Download, Edit2, FileText, FlagTriangleRight, RefreshCw, ShieldCheck, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { tplAPI } from '@/services/api'
import { useEffectiveRole } from '@/store/effectiveRole'
import { getKycDocumentUrl } from '@/services/kycDocuments'
import { uploadTplDocument } from '@/services/tplDocuments'
import {
  Alert, Button, Card, CardHeader, DetailList, EmptyState, ErrorState, FileButton, IfscVerifiedHint, Page, PageHeader, Spinner, StatusPill, humanize, useConfirm,
} from '@/components/ui'
import { DocUploadField } from '@/components/kyc/DocUploadField'
import RulesEditor from '@/components/tpl/RulesEditor'
import StatementsPanel from '@/components/tpl/StatementsPanel'
import { TplPartnerPerformance } from '@/components/tpl/TplPartnerPerformance'
import { TPL_DOCUMENT_TYPES, corridorRateText, rateText, type RateUnit } from '@/components/tpl/constants'
import { GstinStatus } from '@/components/tpl/GstinStatus'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { FlagDocumentsModal } from '@/components/admin/FlagDocumentsModal'
import { HistorySection } from '@/components/admin/vendor-review/ReviewSections'
import { EditTplPartnerModal } from '@/components/tpl/EditTplPartnerModal'

interface TplDocument { id: string; doc_type: string; file_url: string }
interface TplCorridor { id: string; corridor_name: string; vehicle_types: string[] | null; proposed_rate: string | null; rate_amount?: number | null; rate_unit?: RateUnit | null; priority: number | null }
interface PendingCorridor { id?: string; name: string; vehicles: string; rate: string; rate_unit?: RateUnit; legacy_rate?: string; priority: string | number }
interface PendingUpdates {
  sla_commitment?: string
  tax_treatment?: string
  corridors?: PendingCorridor[]
}
interface TplPartnerDetail {
  id: string
  custom_id: string | null
  company_name: string
  contact_name?: string | null
  email: string | null
  phone?: string | null
  status: string
  rejection_reason?: string | null
  created_at: string
  pan_number: string | null
  gstin: string | null
  entity_type?: string | null
  cin?: string | null
  authorized_signatory_name?: string | null
  tax_treatment: string | null
  msme_status: string | null
  sla_commitment: string | null
  bank_account_no: string | null
  bank_ifsc: string | null
  bank_name?: string | null
  bank_branch?: string | null
  bank_ifsc_verified_at?: string | null
  tpl_documents?: TplDocument[]
  tpl_corridors?: TplCorridor[]
  document_issues?: Record<string, string> | null
  pending_updates?: PendingUpdates | null
  fleet_size?: string | null
  truck_type?: string | null
  operating_from?: string | null
}

type DiffKind = 'added' | 'modified' | 'unchanged'
interface DiffRow { key: string; kind: DiffKind; next: PendingCorridor; prev?: TplCorridor }

/** The list of partners, a tab of Return trips. */
const PARTNERS_TAB = '/return-trips?tab=partners'

const vehiclesText = (v: string[] | string | null | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '')

/** Compares the live corridors with the requested ones: added, modified, unchanged, and removed. */
function diffCorridors(current: TplCorridor[], requested: PendingCorridor[]) {
  const matchOf = (n: PendingCorridor) =>
    current.find(c => (n.id ? c.id === n.id : c.corridor_name === n.name))
  const matched = new Set<string>()
  const rows: DiffRow[] = requested.map((next, i) => {
    const prev = matchOf(next)
    if (!prev) return { key: `n${i}`, kind: 'added', next }
    matched.add(prev.id)
    const changed = prev.corridor_name !== next.name
      || corridorRateText(prev) !== rateText(next.rate, next.rate_unit, next.legacy_rate)
      || String(prev.priority ?? '') !== String(next.priority ?? '')
      || vehiclesText(prev.vehicle_types) !== (next.vehicles ?? '')
    return { key: `n${i}`, kind: changed ? 'modified' : 'unchanged', next, prev }
  })
  const removed = current.filter(c => !matched.has(c.id))
  return { rows, removed }
}

const Was = ({ from, to }: { from?: string | number | null; to?: string | number | null }) => (
  String(from ?? '') !== String(to ?? '')
    ? <><span className="text-muted line-through">{from || 'none'}</span> <span className="text-muted" aria-hidden="true">to</span> <span className="font-medium text-text">{to || 'none'}</span></>
    : <span className="text-text">{to || 'none'}</span>
)

function CorridorDiff({ current, requested }: { current: TplCorridor[]; requested: PendingCorridor[] }) {
  const { rows, removed } = diffCorridors(current, requested)
  if (rows.length === 0 && removed.length === 0) return <p className="text-sm text-muted">No corridor changes requested.</p>
  return (
    <ul className="space-y-2">
      {rows.map(r => (
        <li key={r.key} className="rounded-control border border-border bg-surface px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text">{r.next.name}</span>
            {r.kind === 'added' && <StatusPill tone="success" dot={false}>Added</StatusPill>}
            {r.kind === 'modified' && <StatusPill tone="warning" dot={false}>Modified</StatusPill>}
          </div>
          <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
            <span className="text-muted">Vehicles: {r.prev ? <Was from={vehiclesText(r.prev.vehicle_types)} to={r.next.vehicles} /> : (r.next.vehicles || 'none')}</span>
            <span className="text-muted">Rate: {r.prev ? <Was from={corridorRateText(r.prev)} to={rateText(r.next.rate, r.next.rate_unit, r.next.legacy_rate)} /> : rateText(r.next.rate, r.next.rate_unit, r.next.legacy_rate)}</span>
            <span className="text-muted">Priority: {r.prev ? <Was from={r.prev.priority} to={r.next.priority} /> : (r.next.priority || 'none')}</span>
          </div>
        </li>
      ))}
      {removed.map(c => (
        <li key={c.id} className="rounded-control border border-border bg-surface px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-muted line-through">{c.corridor_name}</span>
            <StatusPill tone="danger" dot={false}>Removed</StatusPill>
          </div>
          <div className="mt-1 text-xs text-muted line-through">
            {[vehiclesText(c.vehicle_types), corridorRateText(c), c.priority != null ? `Priority ${c.priority}` : ''].filter(Boolean).join(' · ')}
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function TplPartnerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  // Admins can view a partner; only a superadmin approves, rejects, pauses or deletes (the API says the same)
  const canDecide = useEffectiveRole().role === 'superadmin'
  const [preview, setPreview] = useState<{ url: string, name: string } | null>(null)
  const [flagOpen, setFlagOpen] = useState(false)
  const [editKycOpen, setEditKycOpen] = useState(false)
  const [uploadingType, setUploadingType] = useState<string | null>(null)
  const [replacingDocId, setReplacingDocId] = useState<string | null>(null)

  const { data: partner, isLoading, error, refetch } = useQuery<TplPartnerDetail>({
    queryKey: ['tpl-partner', id],
    queryFn: () => tplAPI.getPartner(id!),
    enabled: !!id,
  })

  const { data: history = [] } = useQuery({
    queryKey: ['tpl-partner-history', id],
    queryFn: () => tplAPI.getPartnerHistory(id!),
    enabled: !!id && canDecide,
  })

  const approve = useMutation({
    mutationFn: () => tplAPI.approve(id!),
    onSuccess: () => {
      toast.success('Partner approved')
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-pending-partners'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    },
    onError: (err: unknown) => toast.error(errorMessage(err, 'We could not approve this partner. Try again.')),
  })

  const reject = useMutation({
    mutationFn: (reason: string) => tplAPI.reject(id!, reason),
    onSuccess: () => {
      toast.success('Application rejected')
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-pending-partners'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    },
    onError: (err: unknown) => toast.error(errorMessage(err, 'We could not reject this application. Try again.')),
  })

  const flagDocuments = useMutation({
    mutationFn: (issues: Record<string, string>) => tplAPI.flagDocuments(id!, issues),
    onSuccess: () => {
      toast.success('The applicant has been told which documents to fix.')
      setFlagOpen(false)
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    },
    onError: (err: unknown) => toast.error(errorMessage(err, 'We could not flag these documents. Try again.')),
  })

  // Attaches one newly uploaded document to the application. `updateApplication`'s `documents` field is the
  // desired final list (see tpl.service.ts), so every existing document is carried over alongside the new one -
  // otherwise this call would delete every document not freshly re-sent.
  const addDocument = useMutation({
    mutationFn: (doc: { type: string; url: string }) => tplAPI.updateApplication(id!, {
      documents: [...(partner?.tpl_documents ?? []).map(d => ({ type: d.doc_type, url: d.file_url })), doc],
    }),
    onSuccess: () => {
      toast.success('Document added')
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    },
    onError: (err: unknown) => toast.error(errorMessage(err, 'We could not add this document. Try again.')),
  })

  const togglePause = useMutation({
    mutationFn: () => (partner?.status === 'active' ? tplAPI.pause(id!) : tplAPI.resume(id!)),
    onSuccess: () => {
      toast.success(partner?.status === 'active' ? 'Partner paused.' : 'Partner resumed.')
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-pending-partners'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    },
    onError: err => toast.error(errorMessage(err, 'We could not update the partner. Try again.')),
  })

  const remove = useMutation({
    mutationFn: () => tplAPI.delete(id!),
    onSuccess: () => {
      toast.success('Partner deleted')
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-pending-partners'] })
      navigate(PARTNERS_TAB)
    },
    onError: err => toast.error(errorMessage(err, 'We could not delete the partner. Try again.')),
  })

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this partner?',
      message: 'This permanently removes the partner and cannot be undone.',
      confirmLabel: 'Delete partner',
      tone: 'danger',
    })
    if (ok) remove.mutate()
  }

  const handleApprove = async () => {
    const ok = await confirm({
      title: partner?.pending_updates ? 'Approve these updates?' : 'Approve this 3PL partner?',
      message: partner?.pending_updates
        ? 'This merges the requested changes and clears them from the queue.'
        : 'This activates the partner and lets them set up their account.',
      confirmLabel: partner?.pending_updates ? 'Approve updates' : 'Approve partner',
    })
    if (ok) approve.mutate()
  }

  const handleReject = async () => {
    const reason = await prompt({
      title: 'Reject this application',
      inputLabel: 'Reason for rejection',
      placeholder: 'What needs to change before this can be approved?',
      confirmLabel: 'Reject application',
      tone: 'danger',
      required: true,
    })
    if (reason) reject.mutate(reason)
  }

  const viewDocument = async (doc: TplDocument) => {
    try {
      const url = await getKycDocumentUrl(doc.file_url)
      setPreview({ url, name: humanize(doc.doc_type) })
    } catch (err) {
      toast.error(errorMessage(err, 'We could not open this document. Try again.'))
    }
  }

  const uploadDocument = async (docType: string, file: File) => {
    setUploadingType(docType)
    try {
      const path = await uploadTplDocument(file, docType, { applicationId: id! })
      await addDocument.mutateAsync({ type: docType, url: path })
    } catch (err) {
      toast.error(errorMessage(err, 'We could not upload this document. Try again.'))
    } finally {
      setUploadingType(null)
    }
  }

  // Lets staff renew a document (e.g. an expired PAN scan) at any status, including an active partner -
  // without this, there was no way to update an active partner's documents at all. Unlike the partner's
  // own self-service replace, this never sends an active partner back to review (staff already reviewed it).
  const replaceExistingDocument = async (doc: TplDocument, file: File) => {
    setReplacingDocId(doc.id)
    try {
      const path = await uploadTplDocument(file, doc.doc_type, { applicationId: id! })
      await tplAPI.replaceDocument(id!, doc.id, path)
      toast.success('Document updated')
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    } catch (err) {
      toast.error(errorMessage(err, 'We could not update this document. Try again.'))
    } finally {
      setReplacingDocId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={32} />
      </div>
    )
  }

  if (error || !partner) {
    return (
      <Page>
        <ErrorState title="We could not load this partner" description={error ? 'Check your connection and try again.' : 'This application could not be found.'} onRetry={() => refetch()} />
      </Page>
    )
  }

  const busy = approve.isPending || reject.isPending

  const isQuickOnboard = !!partner.fleet_size
  const missingKyc: string[] = []
  if (!partner.pan_number) missingKyc.push('PAN')
  if (!partner.gstin) missingKyc.push('GSTIN')
  if (!partner.bank_account_no || !partner.bank_ifsc) missingKyc.push('Bank details')
  if (!partner.entity_type) missingKyc.push('Entity type')
  if (!partner.authorized_signatory_name) missingKyc.push('Authorized signatory')

  return (
    <Page>
      <PageHeader
        title={partner.company_name}
        description={`Submitted ${partner.created_at ? formatDateTime(partner.created_at) : '—'}${partner.email ? ` by ${partner.email}` : ''}${partner.phone ? ` · ${partner.phone}` : ''}`}
        back={{ to: PARTNERS_TAB, label: 'Back to 3PL partners' }}
        actions={<StatusPill status={partner.status} />}
      />

      {partner.status === 'rejected' && partner.rejection_reason && (
        <Alert tone="danger" title="Application rejected">{partner.rejection_reason}</Alert>
      )}

      {partner.pending_updates && (
        <Card padded className="border-warning/30 bg-warning-soft">
          <div className="mb-4 flex items-center gap-2 text-warning">
            <Zap size={18} />
            <h2 className="text-sm font-medium">Pending profile updates</h2>
          </div>
          <p className="mb-4 text-sm text-text">This partner has requested operational changes that need your approval.</p>
          <DetailList
            columns={2}
            items={[
              { label: 'Requested SLA commitment', value: partner.pending_updates.sla_commitment || 'No change' },
              { label: 'Requested tax treatment', value: partner.pending_updates.tax_treatment || 'No change' },
            ]}
          />
          {partner.pending_updates.corridors && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted">Requested corridor changes</p>
              <CorridorDiff current={partner.tpl_corridors ?? []} requested={partner.pending_updates.corridors} />
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card padded>
          <CardHeader
            title="Identity and KYC"
            className="-mx-4 -mt-4 sm:-mx-6"
            actions={(
              <div className="flex items-center gap-2">
                {canDecide && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Edit2 size={14} />}
                    onClick={() => setEditKycOpen(true)}
                  >
                    Edit KYC & Details
                  </Button>
                )}
                <ShieldCheck size={18} className="text-brand" />
              </div>
            )}
          />
          <div className="pt-6">
            {missingKyc.length > 0 && (partner.status === 'pending' || partner.status === 'rejected') && (
              <div className="mb-4 rounded-control border border-warning/30 bg-warning/5 p-3.5 text-xs text-warning">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-semibold">{isQuickOnboard ? 'Quick Onboard — KYC Pending' : 'Incomplete KYC'}:</span> Missing{' '}
                    {missingKyc.join(', ')}. {isQuickOnboard ? 'You can approve to talk to them, or enter their details manually.' : 'Please complete these compliance details.'}
                  </div>
                  {canDecide && (
                    <Button variant="secondary" size="sm" onClick={() => setEditKycOpen(true)} className="shrink-0">
                      Enter KYC Details
                    </Button>
                  )}
                </div>
              </div>
            )}
            <DetailList
              columns={2}
              items={[
                { label: 'Contact person', value: partner.contact_name || '—' },
                { label: 'Company PAN', value: partner.pan_number ? <span className="font-mono">{partner.pan_number}</span> : '—' },
                { label: '3PL ID', value: <span className="font-mono">{partner.custom_id || 'Not assigned yet'}</span> },
                { label: 'GSTIN', value: partner.gstin ? <div><span className="font-mono">{partner.gstin}</span><GstinStatus gstin={partner.gstin} pan={partner.pan_number ?? undefined} /></div> : '—' },
                { label: 'Entity type', value: partner.entity_type || '—' },
                { label: 'CIN', value: partner.cin ? <span className="font-mono">{partner.cin}</span> : '—' },
                { label: 'Authorized signatory', value: partner.authorized_signatory_name || '—' },
                { label: 'GTA tax treatment', value: partner.tax_treatment || '—' },
                { label: 'MSME status', value: partner.msme_status || '—' },
                { label: 'Bank account', value: partner.bank_account_no ? <span className="font-mono">{partner.bank_account_no}</span> : '—' },
                { label: 'IFSC code', value: partner.bank_ifsc ? <div><span className="font-mono">{partner.bank_ifsc}</span> <IfscVerifiedHint verifiedAt={partner.bank_ifsc_verified_at} /></div> : '—' },
                { label: 'Bank and branch', value: [partner.bank_name, partner.bank_branch].filter(Boolean).join(', ') || '—' },
              ]}
            />
            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-3 text-xs text-muted">Uploaded documents ({partner.tpl_documents?.length ?? 0})</p>
              {!partner.tpl_documents || partner.tpl_documents.length === 0 ? (
                <EmptyState compact title="No documents uploaded" />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {partner.tpl_documents.map(doc => {
                    const issue = partner.document_issues?.[doc.doc_type]
                    return (
                      <div key={doc.id} className={`rounded-control border p-3 ${issue ? 'border-warning bg-warning/5' : 'border-border'}`}>
                        <button type="button" onClick={() => viewDocument(doc)} className="flex w-full items-center gap-3 text-left">
                          <FileText size={20} className="shrink-0 text-brand" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-text">{humanize(doc.doc_type)}</span>
                            <span className="block text-xs text-muted">View document</span>
                          </span>
                          <Download size={14} className="shrink-0 text-muted" />
                        </button>
                        {issue && (
                          <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                            <StatusPill tone="warning" dot={false}>Fix requested</StatusPill> {issue}
                          </p>
                        )}
                        {canDecide && (
                          <div className="mt-2">
                            <FileButton
                              variant="link"
                              icon={<RefreshCw size={14} />}
                              accept=".pdf,.jpg,.jpeg,.png"
                              disabled={replacingDocId === doc.id}
                              onFile={file => replaceExistingDocument(doc, file)}
                            >
                              {replacingDocId === doc.id ? 'Updating…' : 'Replace (e.g. renewed document)'}
                            </FileButton>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {canDecide && (partner.status === 'pending' || partner.status === 'rejected') && (
              <div className="mt-6 border-t border-border pt-4">
                <p className="mb-3 text-xs text-muted">
                  Add a document the applicant left out, or one more if it is still missing. This is the only way to
                  finish an application that has none yet - documents are optional when an application is entered,
                  but required before it can be approved.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {TPL_DOCUMENT_TYPES.map(docType => (
                    <DocUploadField
                      key={docType}
                      label={docType}
                      busy={uploadingType === docType}
                      onUpload={file => uploadDocument(docType, file)}
                      onRemove={() => {}}
                      onView={() => {}}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card padded>
          <CardHeader title="Operational profile" className="-mx-4 -mt-4 sm:-mx-6" actions={<Building2 size={18} className="text-brand" />} />
          <div className="pt-6">
            <DetailList
              columns={2}
              items={[
                { label: 'SLA commitment', value: partner.sla_commitment || '—' },
                { label: 'Base operating location', value: partner.operating_from || '—' },
                { label: 'Fleet size declared', value: partner.fleet_size ? (partner.fleet_size === 'single' ? 'Single truck' : 'Multiple trucks') : '—' },
                { label: 'Truck type / fleet breakdown', value: partner.truck_type || '—' },
              ]}
            />
            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-3 text-xs text-muted">Requested corridors ({partner.tpl_corridors?.length ?? 0})</p>
              {!partner.tpl_corridors || partner.tpl_corridors.length === 0 ? (
                <EmptyState compact title="No corridors requested" />
              ) : (
                <div className="space-y-2">
                  {partner.tpl_corridors.map(c => (
                    <div key={c.id} className="rounded-control border border-border p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-text">{c.corridor_name}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(c.vehicle_types ?? []).map(v => (
                              <span key={v} className="rounded-full bg-neutral-soft px-2 py-0.5 text-xs text-neutral">{humanize(v)}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-sm text-text">{corridorRateText(c)}</p>
                          <p className="text-xs text-muted">Priority {c.priority ?? 1}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {(partner.status === 'active' || partner.status === 'paused') && (
        <TplPartnerPerformance partnerId={partner.id} slaCommitment={partner.sla_commitment} />
      )}

      {!canDecide && (partner.status === 'active' || partner.status === 'paused') && (
        <>
          <RulesEditor tplId={partner.id} corridors={(partner.tpl_corridors ?? []).map(c => ({ id: c.id, corridor_name: c.corridor_name }))} />
          <StatementsPanel tplId={partner.id} />
        </>
      )}

      {partner.status === 'pending' && !canDecide && (
        <Alert tone="info" title="Waiting for a superadmin">
          Only a superadmin can approve or reject a 3PL partner. You can review the details above.
        </Alert>
      )}

      {partner.status === 'pending' && canDecide && (
        <Card padded className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm text-muted">
              {partner.pending_updates
                ? 'Review the requested updates above before approving or rejecting them.'
                : isQuickOnboard
                  ? 'Quick onboard application: Talk to the partner and approve, or enter their compliance details manually.'
                  : 'Review the KYC documents and operational terms above before approving or rejecting this application.'}
            </p>
            {isQuickOnboard && missingKyc.length > 0 && (
              <p className="mt-1 text-xs text-warning">
                Compliance fields pending ({missingKyc.join(', ')}). You can approve now and collect details, or click &ldquo;Edit KYC &amp; Details&rdquo; above.
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-3">
            {!partner.pending_updates && (
              <Button variant="secondary" icon={<FlagTriangleRight size={16} />} disabled={busy} onClick={() => setFlagOpen(true)}>Flag documents</Button>
            )}
            <Button variant="danger" disabled={busy} onClick={handleReject}>Reject</Button>
            <Button loading={approve.isPending} disabled={busy} onClick={handleApprove}>
              {partner.pending_updates ? 'Approve updates' : 'Approve partner'}
            </Button>
          </div>
        </Card>
      )}

      {partner.status === 'rejected' && (
        <Card padded>
          <p className="text-sm text-text">This application was rejected.</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => navigate(PARTNERS_TAB)}>Back to 3PL partners</Button>
          </div>
        </Card>
      )}

      {canDecide && (partner.status === 'active' || partner.status === 'paused') && (
        <Card padded className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-sm text-muted">Pause a partner to stop new work from being routed to them, or remove them from the network.</p>
          <div className="flex shrink-0 gap-3">
            <Button variant="secondary" loading={togglePause.isPending} onClick={() => togglePause.mutate()}>
              {partner.status === 'active' ? 'Pause partner' : 'Resume partner'}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={handleDelete}>Delete</Button>
          </div>
        </Card>
      )}

      {canDecide && <HistorySection history={history} />}

      {preview && (
        <DocumentViewerModal isOpen={!!preview} onClose={() => setPreview(null)} fileUrl={preview.url} fileName={preview.name} />
      )}
      {flagOpen && (
        <FlagDocumentsModal
          open entityName={partner.company_name}
          documents={(partner.tpl_documents ?? []).map(d => ({ key: d.doc_type, label: humanize(d.doc_type) }))}
          noneUploadedLabel="This applicant has not uploaded any documents yet."
          busy={flagDocuments.isPending}
          onClose={() => setFlagOpen(false)}
          onSubmit={issues => flagDocuments.mutate(issues)}
        />
      )}
      {editKycOpen && (
        <EditTplPartnerModal
          open
          partner={partner}
          onClose={() => setEditKycOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
            refetch()
          }}
        />
      )}
    </Page>
  )
}
