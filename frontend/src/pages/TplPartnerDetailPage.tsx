import { errorMessage } from '@/utils/display'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Download, FileText, ShieldCheck, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { tplAPI } from '@/services/api'
import { getKycDocumentUrl } from '@/services/kycDocuments'
import {
  Alert, Button, Card, CardHeader, DetailList, EmptyState, ErrorState, Page, PageHeader, Spinner, StatusPill, useConfirm,
} from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'

interface TplDocument { id: string; doc_type: string; file_url: string }
interface TplCorridor { id: string; corridor_name: string; vehicle_types: string[] | null; proposed_rate: string | null; priority: number | null }
interface PendingCorridor { id?: string; name: string; vehicles: string; rate: string; priority: string | number }
interface PendingUpdates {
  sla_commitment?: string
  tax_treatment?: string
  corridors?: PendingCorridor[]
}
interface TplPartnerDetail {
  id: string
  custom_id: string | null
  company_name: string
  email: string | null
  status: string
  rejection_reason?: string | null
  created_at: string
  pan_number: string | null
  gstin: string | null
  tax_treatment: string | null
  msme_status: string | null
  sla_commitment: string | null
  bank_account_no: string | null
  bank_ifsc: string | null
  tpl_documents?: TplDocument[]
  tpl_corridors?: TplCorridor[]
  pending_updates?: PendingUpdates | null
}

type DiffKind = 'added' | 'modified' | 'unchanged'
interface DiffRow { key: string; kind: DiffKind; next: PendingCorridor; prev?: TplCorridor }

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
      || (prev.proposed_rate ?? '') !== (next.rate ?? '')
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
            <span className="text-muted">Rate: {r.prev ? <Was from={r.prev.proposed_rate} to={r.next.rate} /> : (r.next.rate || 'none')}</span>
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
            {[vehiclesText(c.vehicle_types), c.proposed_rate, c.priority != null ? `Priority ${c.priority}` : ''].filter(Boolean).join(' · ')}
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
  const [preview, setPreview] = useState<{ url: string, name: string } | null>(null)

  const { data: partner, isLoading, error, refetch } = useQuery<TplPartnerDetail>({
    queryKey: ['tpl-partner', id],
    queryFn: () => tplAPI.getPartner(id!),
    enabled: !!id,
  })

  const approve = useMutation({
    mutationFn: () => tplAPI.approve(id!),
    onSuccess: () => {
      toast.success('Partner approved.')
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    },
    onError: (err: unknown) => toast.error(errorMessage(err, 'Approval failed.')),
  })

  const reject = useMutation({
    mutationFn: (reason: string) => tplAPI.reject(id!, reason),
    onSuccess: () => {
      toast.success('Application rejected.')
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    },
    onError: (err: unknown) => toast.error(errorMessage(err, 'Rejection failed.')),
  })

  const togglePause = useMutation({
    mutationFn: () => (partner?.status === 'active' ? tplAPI.pause(id!) : tplAPI.resume(id!)),
    onSuccess: () => {
      toast.success(partner?.status === 'active' ? 'Partner paused.' : 'Partner resumed.')
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      queryClient.invalidateQueries({ queryKey: ['tpl-partner', id] })
    },
    onError: () => toast.error('Failed to update status.'),
  })

  const remove = useMutation({
    mutationFn: () => tplAPI.delete(id!),
    onSuccess: () => {
      toast.success('Partner deleted.')
      queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
      navigate('/3pl-partners')
    },
    onError: () => toast.error('Failed to delete partner.'),
  })

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this partner?',
      message: 'This permanently removes the partner and cannot be undone.',
      confirmLabel: 'Delete',
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
      confirmLabel: 'Approve',
    })
    if (ok) approve.mutate()
  }

  const handleReject = async () => {
    const reason = await prompt({
      title: 'Reject this application',
      inputLabel: 'Reason for rejection',
      placeholder: 'What needs to change before this can be approved?',
      confirmLabel: 'Reject',
      tone: 'danger',
      required: true,
    })
    if (reason) reject.mutate(reason)
  }

  const viewDocument = async (doc: TplDocument) => {
    try {
      const url = await getKycDocumentUrl(doc.file_url)
      setPreview({ url, name: doc.doc_type })
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open document.'))
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
        <ErrorState title="Can't load this partner" description={error ? 'Something went wrong.' : 'This application could not be found.'} onRetry={() => refetch()} />
      </Page>
    )
  }

  const busy = approve.isPending || reject.isPending

  return (
    <Page>
      <PageHeader
        title={partner.company_name}
        description={`Submitted ${partner.created_at ? new Date(partner.created_at).toLocaleString('en-IN') : '—'}${partner.email ? ` by ${partner.email}` : ''}`}
        back={{ to: '/3pl-partners', label: 'Back to 3PL partners' }}
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
          <CardHeader title="Identity and KYC" className="-mx-4 -mt-4 sm:-mx-6" actions={<ShieldCheck size={18} className="text-brand" />} />
          <div className="pt-6">
            <DetailList
              columns={2}
              items={[
                { label: 'Company PAN', value: <span className="font-mono">{partner.pan_number}</span> },
                { label: '3PL ID', value: <span className="font-mono">{partner.custom_id || partner.id.split('-')[0]}</span> },
                { label: 'GSTIN', value: <span className="font-mono">{partner.gstin}</span> },
                { label: 'GTA tax treatment', value: partner.tax_treatment || '—' },
                { label: 'MSME status', value: partner.msme_status || '—' },
                { label: 'Bank account', value: partner.bank_account_no ? <span className="font-mono">{partner.bank_account_no}</span> : '—' },
                { label: 'IFSC code', value: partner.bank_ifsc ? <span className="font-mono">{partner.bank_ifsc}</span> : '—' },
              ]}
            />
            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-3 text-xs text-muted">Uploaded documents ({partner.tpl_documents?.length ?? 0})</p>
              {!partner.tpl_documents || partner.tpl_documents.length === 0 ? (
                <EmptyState compact title="No documents uploaded" />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {partner.tpl_documents.map(doc => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => viewDocument(doc)}
                      className="flex items-center gap-3 rounded-control border border-border p-3 text-left hover:bg-surface-subtle"
                    >
                      <FileText size={20} className="shrink-0 text-brand" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text">{doc.doc_type}</span>
                        <span className="block text-xs text-muted">View document</span>
                      </span>
                      <Download size={14} className="shrink-0 text-muted" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card padded>
          <CardHeader title="Operational profile" className="-mx-4 -mt-4 sm:-mx-6" actions={<Building2 size={18} className="text-brand" />} />
          <div className="pt-6">
            <DetailList
              columns={2}
              items={[
                { label: 'SLA commitment', value: partner.sla_commitment || '—' },
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
                              <span key={v} className="rounded-full bg-neutral-soft px-2 py-0.5 text-xs text-neutral">{v}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-sm text-text">{c.proposed_rate || '—'}</p>
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

      {partner.status === 'pending' && (
        <Card padded className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-sm text-muted">
            {partner.pending_updates
              ? 'Review the requested updates above before approving or rejecting them.'
              : 'Review the KYC documents and operational terms above before approving or rejecting this application.'}
          </p>
          <div className="flex shrink-0 gap-3">
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
            <Button variant="secondary" onClick={() => navigate('/3pl-partners')}>Back to 3PL partners</Button>
          </div>
        </Card>
      )}

      {(partner.status === 'active' || partner.status === 'paused') && (
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

      {preview && (
        <DocumentViewerModal isOpen={!!preview} onClose={() => setPreview(null)} fileUrl={preview.url} fileName={preview.name} />
      )}
    </Page>
  )
}
