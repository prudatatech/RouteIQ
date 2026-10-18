import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FlagTriangleRight, UserPlus } from 'lucide-react'
import { adminOrgsAPI } from '@/services/api'
import { uploadAdminOrgKycDocument } from '@/services/kycDocuments'
import {
  Button, DataTable, Drawer, EmptyState, ExportCsvButton, FileButton, Page, PageHeader, Select, StatusPill, TabPanel, Tabs, useConfirm, useTabParam,
  type Column,
} from '@/components/ui'
import { errorMessage, formatDate } from '@/utils/display'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import { isPlatformActor } from '@/utils/orgAccess'
import { useDocumentViewer } from '@/components/admin/useDocumentViewer'
import { FlagDocumentsModal } from '@/components/admin/FlagDocumentsModal'
import RegisterCompanyModal from '@/components/admin/RegisterCompanyModal'
import type { OrgKind, OrgRow } from '@/utils/orgs'
import {
  decisionReason, decisionsFor, listParams, ORG_CSV_COLUMNS, ORG_KYC_DOCUMENTS, ORG_STATUS_LABELS, orgCsvRows, pageRange, pendingFirst,
  PAGE_SIZE, PLATFORM_ORG_TABS, STATUS_FILTERS, type Decision, type StatusFilter,
} from '@/utils/platformOrgs'

const TAB_IDS = PLATFORM_ORG_TABS.map(t => t.id)
const STATUS_TONE = { pending: 'warning', active: 'success', suspended: 'danger', rejected: 'danger' } as const

/** The KYC state shown in the list column: flagged beats submitted beats not-submitted. Logistic companies only. */
function kycState(org: OrgRow): { label: string; tone: 'warning' | 'success' | 'neutral' } | null {
  if (org.kind !== 'logistic_company') return null
  if (Object.keys(org.kyc_document_issues ?? {}).length > 0) return { label: 'Flagged', tone: 'warning' }
  if (org.kyc_submitted_at) return { label: 'Submitted', tone: 'success' }
  return { label: 'Not submitted', tone: 'neutral' }
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-text">{value || '–'}</dd>
    </div>
  )
}

/** A logistic company's uploaded KYC documents, each flaggable with its own reason. Platform only. */
function OrgDocumentsSection({ org, onFlag, onResume, onUpload, uploadingKey, viewer }: {
  org: OrgRow
  onFlag: () => void
  /** Reopens RegisterCompanyModal to finish this company's registration (staff-entered or self-serve). */
  onResume: () => void
  /** Uploads (or renews) one document, at any status - the company does not need to re-register. */
  onUpload: (key: string, file: File) => void
  uploadingKey: string | null
  viewer: ReturnType<typeof useDocumentViewer>
}) {
  const docUrls = org.kyc_documents?.docUrls ?? {}
  const issues = org.kyc_document_issues ?? {}
  const canFlag = org.status === 'pending' && !!org.kyc_submitted_at
  // Not yet submitted: whoever started this registration (staff on someone's behalf, or the
  // applicant self-serve) never finished it. Staff can always step in and finish it for them.
  const canResume = org.status === 'pending' && !org.kyc_submitted_at
  const hasAnyDoc = Object.keys(docUrls).length > 0
  return (
    <section aria-label="Documents">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Documents</h3>
        <div className="flex gap-2">
          {canFlag && <Button variant="ghost" size="sm" icon={<FlagTriangleRight size={14} />} onClick={onFlag}>Flag documents</Button>}
          {canResume && <Button variant="ghost" size="sm" icon={<UserPlus size={14} />} onClick={onResume}>Finish registration</Button>}
        </div>
      </div>
      {org.status === 'pending' && (
        <p className="mb-2 text-xs text-muted">
          {org.kyc_submitted_at ? 'Submitted for review.' : hasAnyDoc ? 'Waiting for the company to fix and resubmit.' : 'The company has not submitted its KYC documents yet.'}
        </p>
      )}
      <ul className="divide-y divide-border rounded-control border border-border">
        {ORG_KYC_DOCUMENTS.map(d => {
          const path = docUrls[d.key]
          const issue = issues[d.key]
          return (
            <li key={d.key} className={`px-3 py-2 ${issue ? 'bg-warning/5' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">{d.label}</span>
                {issue && <StatusPill tone="warning" dot={false}>Fix requested</StatusPill>}
              </div>
              <div className="mt-1 flex items-center gap-3">
                {path ? (
                  <button type="button" onClick={() => viewer.open(d.label, path, d.key)} disabled={viewer.opening === d.key} className="text-xs font-medium text-brand hover:underline">
                    {viewer.opening === d.key ? 'Opening…' : 'View'}
                  </button>
                ) : (
                  <span className="text-xs text-muted">Not uploaded</span>
                )}
                <FileButton
                  variant="link"
                  size="sm"
                  accept=".pdf,.jpg,.jpeg,.png"
                  disabled={uploadingKey === d.key}
                  onFile={file => onUpload(d.key, file)}
                >
                  {uploadingKey === d.key ? 'Uploading…' : path ? 'Replace' : 'Upload'}
                </FileButton>
              </div>
              {issue && <p className="mt-1 text-sm text-warning">{issue}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function OrgDrawer({ org, onClose, onDecide, deciding, onFlag, onResume, onUploadDoc, uploadingKey, viewer }: {
  org: OrgRow | null
  onClose: () => void
  onDecide: (org: OrgRow, decision: Decision) => void
  deciding: boolean
  onFlag: () => void
  onResume: (org: OrgRow) => void
  onUploadDoc: (org: OrgRow, key: string, file: File) => void
  uploadingKey: string | null
  viewer: ReturnType<typeof useDocumentViewer>
}) {
  const reason = org ? decisionReason(org) : null
  const actions = org ? decisionsFor(org.status, org.kind, !!org.kyc_submitted_at) : []
  return (
    <Drawer
      open={!!org}
      onClose={onClose}
      title={org?.name ?? ''}
      description={org && <StatusPill status={org.status} tone={STATUS_TONE[org.status]}>{ORG_STATUS_LABELS[org.status]}</StatusPill>}
      footer={actions.length > 0 && (
        <>
          {actions.map(a => (
            <Button key={a.decision} variant={a.decision === 'approve' ? 'primary' : 'secondary'} loading={deciding} onClick={() => org && onDecide(org, a.decision)}>
              {a.label}
            </Button>
          ))}
        </>
      )}
    >
      {org && (
        <div className="space-y-6">
          <section aria-label="Profile">
            <h3 className="mb-2 text-sm font-semibold">Profile</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Legal name" value={org.legal_name} />
              <Detail label="Entity type" value={org.entity_type} />
              <Detail label="GSTIN" value={org.gstin} />
              <Detail label="PAN" value={org.pan} />
              <Detail label="CIN" value={org.cin} />
              <Detail label="Authorized signatory" value={org.authorized_signatory_name} />
              <Detail label="Phone" value={org.phone} />
              <Detail label="Email" value={org.email} />
              <Detail label="City" value={org.city} />
              <Detail label="State" value={org.state} />
              <Detail label="Pincode" value={org.pincode} />
              <div className="sm:col-span-2"><Detail label="Address" value={org.address} /></div>
            </dl>
          </section>
          {org.kind === 'logistic_company' && (
            <section aria-label="Bank details">
              <h3 className="mb-2 text-sm font-semibold">Bank details</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Bank name" value={typeof org.profile?.bank_name === 'string' ? org.profile.bank_name : null} />
                <Detail label="Account number" value={typeof org.profile?.bank_account_no === 'string' ? org.profile.bank_account_no : null} />
                <Detail label="IFSC" value={typeof org.profile?.bank_ifsc === 'string' ? org.profile.bank_ifsc : null} />
              </dl>
            </section>
          )}
          {org.kind === 'logistic_company' && (
            <OrgDocumentsSection
              org={org}
              onFlag={onFlag}
              onResume={() => onResume(org)}
              onUpload={(key, file) => onUploadDoc(org, key, file)}
              uploadingKey={uploadingKey}
              viewer={viewer}
            />
          )}
          <section aria-label="History">
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            <ul className="space-y-2 text-sm">
              <li>Registered {org.created_at ? formatDate(org.created_at) : 'on an unknown date'}</li>
              {org.approved_at && <li>Approved {formatDate(org.approved_at)}</li>}
              {reason && <li>{org.status === 'rejected' ? 'Rejected' : 'Suspended'}: {reason}</li>}
              {org.status !== 'pending' && org.updated_at && <li className="text-muted">Last changed {formatDate(org.updated_at)}</li>}
            </ul>
            <p className="mt-2 text-xs text-muted">The full list of decisions is in the audit log.</p>
          </section>
        </div>
      )}
    </Drawer>
  )
}

/** The platform owner's list of organisations: approve, reject, suspend and reinstate. */
export default function PlatformOrganisationsPage() {
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const active = useOrgStore(selectActiveMembership)
  const allowed = isPlatformActor(active)
  const [kind, setKind] = useTabParam<Exclude<OrgKind, 'platform'>>(TAB_IDS, 'logistic_company')
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [flagOpen, setFlagOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  /** A not-yet-submitted company whose registration staff is finishing on its behalf, or null when the modal is closed or is creating a brand-new company (`registerOpen`). */
  const [resumeOrg, setResumeOrg] = useState<OrgRow | null>(null)
  const viewer = useDocumentViewer()

  const list = useQuery({
    queryKey: ['platform-orgs', kind, status, page],
    queryFn: () => adminOrgsAPI.list(listParams(kind, status, page)),
    enabled: allowed,
    placeholderData: keepPreviousData,
  })
  const rows = status === 'all' ? pendingFirst(list.data?.items ?? []) : list.data?.items ?? []
  const open = rows.find(r => r.id === openId) ?? null
  const range = pageRange(list.data?.total ?? 0, list.data?.limit ?? PAGE_SIZE, list.data?.offset ?? 0)

  const decide = useMutation({
    mutationFn: (v: { org: OrgRow; decision: Decision; reason?: string }) => adminOrgsAPI.decide(v.org.id, v.decision, v.reason),
    onSuccess: (_row, v) => {
      toast.success({ approve: v.org.status === 'suspended' ? 'Company reinstated' : 'Approved', reject: 'Rejected', suspend: 'Suspended' }[v.decision])
      void queryClient.invalidateQueries({ queryKey: ['platform-orgs'] })
      void queryClient.invalidateQueries({ queryKey: ['platform-orgs-pending'] })
      setOpenId(null)
    },
    onError: err => toast.error(errorMessage(err, 'We could not save this decision. Try again.')),
  })

  const flagDocuments = useMutation({
    mutationFn: (v: { id: string; issues: Record<string, string> }) => adminOrgsAPI.flagDocuments(v.id, v.issues),
    onSuccess: () => {
      toast.success('The company has been told which documents to fix.')
      void queryClient.invalidateQueries({ queryKey: ['platform-orgs'] })
      setFlagOpen(false)
    },
    onError: err => toast.error(errorMessage(err, 'We could not flag these documents. Try again.')),
  })

  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  // Works at any status, including an already-active company - renewing a document (e.g. an expired
  // GST certificate) should never need the company to go through registration again.
  const uploadDocument = async (org: OrgRow, key: string, file: File) => {
    setUploadingKey(key)
    try {
      const path = await uploadAdminOrgKycDocument(org.id, key, file)
      const docUrls = { ...(org.kyc_documents?.docUrls ?? {}), [key]: path }
      await adminOrgsAPI.saveKycDocuments(org.id, { docUrls })
      toast.success('Document updated')
      void queryClient.invalidateQueries({ queryKey: ['platform-orgs'] })
    } catch (err) {
      toast.error(errorMessage(err, 'We could not update this document. Try again.'))
    } finally {
      setUploadingKey(null)
    }
  }

  const onDecide = async (org: OrgRow, decision: Decision) => {
    if (decision === 'reject') {
      const reason = await prompt({
        title: `Reject ${org.name}?`, message: 'The reason is shown to the company.', inputLabel: 'Reason for rejection',
        required: true, confirmLabel: 'Reject', tone: 'danger',
      })
      if (reason) decide.mutate({ org, decision, reason })
    } else if (decision === 'suspend') {
      const reason = await prompt({
        title: `Suspend ${org.name}?`, message: 'The company cannot work until you reinstate it.', inputLabel: 'Reason (optional)',
        confirmLabel: 'Suspend', tone: 'danger',
      })
      if (reason !== null) decide.mutate({ org, decision, reason: reason.trim() || undefined })
    } else {
      const reinstate = org.status === 'suspended'
      const ok = await confirm({
        title: `${reinstate ? 'Reinstate' : 'Approve'} ${org.name}?`,
        message: reinstate ? 'The company can work again.' : 'The company can start using MargixIndia.',
        confirmLabel: reinstate ? 'Reinstate' : 'Approve',
      })
      if (ok) decide.mutate({ org, decision })
    }
  }

  const columns: Column<OrgRow>[] = [
    {
      key: 'name', header: 'Name', sortValue: r => r.name,
      cell: r => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.name}</div>
          {r.legal_name && r.legal_name !== r.name && <div className="truncate text-xs text-muted">{r.legal_name}</div>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortValue: r => r.status, cell: r => <StatusPill status={r.status} tone={STATUS_TONE[r.status]}>{ORG_STATUS_LABELS[r.status]}</StatusPill> },
    {
      key: 'kyc', header: 'KYC',
      cell: r => {
        const k = kycState(r)
        return k ? <StatusPill tone={k.tone} dot={false}>{k.label}</StatusPill> : '–'
      },
    },
    { key: 'gstin', header: 'GSTIN', hideBelow: 'lg', cell: r => r.gstin ?? '–' },
    { key: 'city', header: 'City', hideBelow: 'md', sortValue: r => r.city, cell: r => [r.city, r.state].filter(Boolean).join(', ') || '–' },
    { key: 'registered', header: 'Registered', hideBelow: 'md', sortValue: r => r.created_at, cell: r => (r.created_at ? formatDate(r.created_at) : '–') },
  ]

  if (!allowed) {
    return (
      <Page>
        <PageHeader title="Organisations" />
        <EmptyState title="Platform owners only" description="Switch to the platform organisation to manage organisations." />
      </Page>
    )
  }

  const changeKind = (id: Exclude<OrgKind, 'platform'>) => { setKind(id); setPage(0) }

  return (
    <Page>
      <PageHeader
        title="Organisations"
        description="Companies, vendors and 3PL partners on MargixIndia. Approve new ones and suspend any that should stop."
        actions={(
          <>
            {kind === 'logistic_company' && (
              <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => setRegisterOpen(true)}>Register a company for someone</Button>
            )}
            <ExportCsvButton name={`organisations-${kind}`} rows={orgCsvRows(rows)} columns={ORG_CSV_COLUMNS} />
          </>
        )}
      >
        <Tabs label="Kind of organisation" value={kind} onChange={changeKind} tabs={PLATFORM_ORG_TABS.map(t => ({ id: t.id, label: t.label }))} />
      </PageHeader>
      <TabPanel id={kind}>
        <div className="mb-4 max-w-xs">
          <Select
            label="Status"
            value={status}
            options={STATUS_FILTERS.map(f => ({ value: f.value, label: f.label }))}
            onChange={e => { setStatus(e.target.value as StatusFilter); setPage(0) }}
          />
        </div>
        <DataTable
          caption="Organisations"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          loading={list.isLoading}
          error={list.isError ? errorMessage(list.error, 'We could not load the organisations.') : undefined}
          onRetry={() => list.refetch()}
          onRowClick={r => setOpenId(r.id)}
          selectedKey={openId}
          pageSize={PAGE_SIZE}
          empty={{ title: status === 'pending' ? 'Nothing waiting for approval' : 'No organisations here', description: 'Change the status filter to see others.' }}
        />
        {range.to > 0 && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>Showing {range.from}-{range.to} of {list.data?.total}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={!range.hasPrev} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={!range.hasNext} onClick={() => setPage(p => p + 1)}>Next</Button>
            </span>
          </div>
        )}
      </TabPanel>
      <OrgDrawer
        org={open}
        onClose={() => setOpenId(null)}
        onDecide={onDecide}
        deciding={decide.isPending}
        onFlag={() => setFlagOpen(true)}
        onResume={org => { setOpenId(null); setResumeOrg(org) }}
        onUploadDoc={uploadDocument}
        uploadingKey={uploadingKey}
        viewer={viewer}
      />
      {flagOpen && open && (
        <FlagDocumentsModal
          open entityName={open.name} documents={ORG_KYC_DOCUMENTS.filter(d => open.kyc_documents?.docUrls?.[d.key])}
          noneUploadedLabel="This company has not uploaded any documents yet."
          busy={flagDocuments.isPending}
          onClose={() => setFlagOpen(false)}
          onSubmit={issues => flagDocuments.mutate({ id: open.id, issues })}
        />
      )}
      {viewer.modal}
      {(registerOpen || resumeOrg) && (
        <RegisterCompanyModal
          open
          resumeOrg={resumeOrg}
          onClose={() => { setRegisterOpen(false); setResumeOrg(null) }}
          onRegistered={() => void queryClient.invalidateQueries({ queryKey: ['platform-orgs'] })}
        />
      )}
    </Page>
  )
}
