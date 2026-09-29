import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Plus, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { tplAPI } from '@/services/api'
import {
  BulkActionBar, Button, DataTable, IconButton, Page, PageHeader, SearchInput, StatusPill, Tabs, useConfirm, useRowSelection, useTabParam,
} from '@/components/ui'
import type { Column } from '@/components/ui'
import { errorMessage } from '@/utils/display'

interface TplPartner {
  id: string
  custom_id: string | null
  company_name: string
  gstin: string | null
  status: string
  created_at: string
  tpl_corridors?: { corridor_name: string }[]
}

const TABS = ['pending', 'active', 'paused', 'rejected', 'all'] as const
type StatusTab = typeof TABS[number]

const isPending = (p: TplPartner) => p.status === 'pending'

/**
 * The single 3PL partners area: directory of every application and partner,
 * grouped by status. Selecting a row opens the detail page, which is where
 * verification (documents, approve/reject) happens; pending rows also get
 * inline approve/reject here, plus a bulk approve for the queue.
 */
export default function TplPartnersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const [tab, setTab] = useTabParam<StatusTab>(TABS, 'pending')
  const [search, setSearch] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const { data: partners = [], isLoading, error, refetch } = useQuery<TplPartner[]>({
    queryKey: ['tpl-queue', 'all'],
    queryFn: () => tplAPI.queue('all').then((d: unknown) => (Array.isArray(d) ? d : [])),
    refetchInterval: 15000,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })

  const approve = useMutation({
    mutationFn: (id: string) => tplAPI.approve(id),
    onSuccess: () => { toast.success('Partner approved.'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not approve this partner. Try again.')),
  })

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => tplAPI.reject(id, reason),
    onSuccess: () => { toast.success('Application rejected.'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not reject this application. Try again.')),
  })

  const askApprove = async (p: TplPartner) => {
    const ok = await confirm({
      title: 'Approve this 3PL partner?',
      message: 'This activates the partner and lets them set up their account.',
      confirmLabel: 'Approve',
    })
    if (ok) approve.mutate(p.id)
  }

  const askReject = async (p: TplPartner) => {
    const reason = await prompt({
      title: `Reject ${p.company_name}?`,
      inputLabel: 'Reason for rejection',
      placeholder: 'What needs to change before this can be approved?',
      confirmLabel: 'Reject',
      tone: 'danger',
      required: true,
    })
    if (reason) reject.mutate({ id: p.id, reason })
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, active: 0, paused: 0, rejected: 0, all: partners.length }
    for (const p of partners) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [partners])

  const filtered = useMemo(() => {
    return partners
      .filter(p => tab === 'all' || p.status === tab)
      .filter(p => !search || p.company_name.toLowerCase().includes(search.toLowerCase()) || (p.custom_id ?? '').includes(search.toLowerCase()))
  }, [partners, tab, search])

  const selection = useRowSelection(filtered, p => p.id)

  const bulkApprove = async () => {
    const targets = selection.selectedRows.filter(isPending)
    if (targets.length === 0) return
    const ok = await confirm({
      title: `Approve ${targets.length} ${targets.length === 1 ? 'partner' : 'partners'}?`,
      message: 'Each partner is activated and can set up their account.',
      confirmLabel: 'Approve all',
    })
    if (!ok) return
    setBulkBusy(true)
    let approved = 0
    const failures: string[] = []
    for (const p of targets) {
      try {
        await tplAPI.approve(p.id)
        approved++
      } catch (err) {
        failures.push(`${p.company_name}: ${errorMessage(err, 'failed')}`)
      }
    }
    setBulkBusy(false)
    selection.clear()
    refresh()
    if (failures.length === 0) toast.success(`Approved ${approved} ${approved === 1 ? 'partner' : 'partners'}.`)
    else toast.error(`Approved ${approved}, ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`)
  }

  const columns: Column<TplPartner>[] = [
    {
      key: 'name', header: 'Partner', sortValue: p => p.company_name, cell: p => (
        <div>
          <p className="font-medium text-text">{p.company_name}</p>
          <p className="font-mono text-xs text-muted">{p.custom_id || p.id.slice(0, 8)}</p>
        </div>
      ),
    },
    {
      key: 'corridors', header: 'Corridors', hideBelow: 'md', cell: p => (
        <span className="text-sm text-muted">{(p.tpl_corridors ?? []).map(c => c.corridor_name).join(', ') || '—'}</span>
      ),
    },
    { key: 'gstin', header: 'GSTIN', hideBelow: 'lg', cell: p => <span className="font-mono text-sm">{p.gstin || '—'}</span> },
    {
      key: 'created_at', header: 'Submitted', hideBelow: 'md', sortValue: p => p.created_at,
      cell: p => <span className="text-sm text-muted">{new Date(p.created_at).toLocaleDateString('en-IN')}</span>,
    },
    { key: 'status', header: 'Status', cell: p => <StatusPill status={p.status} /> },
    {
      key: 'actions', header: 'Actions', align: 'right', cell: p => (
        isPending(p) ? (
          <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <IconButton
              label="Approve"
              icon={<Check size={16} />}
              size="sm"
              disabled={(approve.isPending && approve.variables === p.id) || (reject.isPending && reject.variables?.id === p.id)}
              onClick={() => askApprove(p)}
            />
            <IconButton
              label="Reject"
              icon={<X size={16} />}
              size="sm"
              disabled={(approve.isPending && approve.variables === p.id) || (reject.isPending && reject.variables?.id === p.id)}
              onClick={() => askReject(p)}
            />
          </span>
        ) : null
      ),
    },
  ]

  return (
    <Page>
      <PageHeader
        title="3PL partners"
        description="Every 3PL application, from review to active partner."
        actions={<Button icon={<Plus size={16} />} onClick={() => navigate('/3pl/onboard')}>Invite a partner</Button>}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            label="Filter by status"
            value={tab}
            onChange={setTab}
            tabs={TABS.map(t => ({ id: t, label: t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1), count: counts[t] ?? 0 }))}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name or 3PL ID" className="sm:max-w-xs" />
        </div>
      </PageHeader>

      <DataTable
        caption="3PL partners"
        columns={columns}
        rows={filtered}
        rowKey={p => p.id}
        loading={isLoading}
        error={error ? 'We could not load 3PL partners.' : undefined}
        onRetry={() => refetch()}
        onRowClick={p => navigate(`/3pl-partners/${p.id}`)}
        empty={{ title: tab === 'pending' ? 'No pending applications' : 'No partners here yet', description: 'Applications appear here once submitted.' }}
        selection={{
          selectedKeys: selection.selectedKeys,
          onToggleRow: key => selection.toggleRow(key),
          onToggleAll: (pageRows, checked) => selection.toggleAll(pageRows, checked),
          isRowSelectable: isPending,
        }}
      />

      <div className="mt-3">
        <BulkActionBar count={selection.count} onClear={selection.clear}>
          <Button size="sm" disabled={bulkBusy} loading={bulkBusy} onClick={bulkApprove}>Approve selected</Button>
        </BulkActionBar>
      </div>
    </Page>
  )
}
