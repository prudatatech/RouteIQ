import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { adminOrgsAPI } from '@/services/api'
import {
  Button, DataTable, Drawer, EmptyState, ExportCsvButton, Page, PageHeader, Select, StatusPill, TabPanel, Tabs, useConfirm, useTabParam,
  type Column,
} from '@/components/ui'
import { errorMessage, formatDate } from '@/utils/display'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import { isPlatformActor } from '@/utils/orgAccess'
import type { OrgKind, OrgRow } from '@/utils/orgs'
import {
  decisionReason, decisionsFor, listParams, ORG_CSV_COLUMNS, ORG_STATUS_LABELS, orgCsvRows, pageRange, pendingFirst, PAGE_SIZE,
  PLATFORM_ORG_TABS, STATUS_FILTERS, type Decision, type StatusFilter,
} from '@/utils/platformOrgs'

const TAB_IDS = PLATFORM_ORG_TABS.map(t => t.id)
const STATUS_TONE = { pending: 'warning', active: 'success', suspended: 'danger', rejected: 'danger' } as const

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-text">{value || '–'}</dd>
    </div>
  )
}

function OrgDrawer({ org, onClose, onDecide, deciding }: {
  org: OrgRow | null
  onClose: () => void
  onDecide: (org: OrgRow, decision: Decision) => void
  deciding: boolean
}) {
  const reason = org ? decisionReason(org) : null
  const actions = org ? decisionsFor(org.status, org.kind) : []
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
              <Detail label="GSTIN" value={org.gstin} />
              <Detail label="PAN" value={org.pan} />
              <Detail label="Phone" value={org.phone} />
              <Detail label="Email" value={org.email} />
              <Detail label="City" value={org.city} />
              <Detail label="State" value={org.state} />
              <Detail label="Pincode" value={org.pincode} />
              <div className="sm:col-span-2"><Detail label="Address" value={org.address} /></div>
            </dl>
          </section>
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
        actions={<ExportCsvButton name={`organisations-${kind}`} rows={orgCsvRows(rows)} columns={ORG_CSV_COLUMNS} />}
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
      <OrgDrawer org={open} onClose={() => setOpenId(null)} onDecide={onDecide} deciding={decide.isPending} />
    </Page>
  )
}
