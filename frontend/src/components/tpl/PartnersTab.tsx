import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Plus, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { tplAPI, tplNetworkAPI } from '@/services/api'
import { formatPercent } from '@/components/tpl/stats'
import {
  BulkActionBar, Button, DataTable, IconButton, SearchInput, StatusPill, Tabs,
  parseSort, serializeSort, useConfirm, useRowSelection, useTabParam, useUrlState,
} from '@/components/ui'
import { useAuthStore } from '@/store/authStore'
import type { Column } from '@/components/ui'
import { errorMessage, formatDate, formatMinutes } from '@/utils/display'

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
 * The 3PL partners tab of Return trips: every application and partner, grouped by status. Selecting a row opens
 * the detail page, which is where verification (documents, approve/reject) happens. Admins can view; only a
 * superadmin can approve or reject, so pending rows get inline approve/reject and a bulk approve for them alone.
 */
export default function PartnersTab() {
  const canDecide = useAuthStore(s => s.role) === 'superadmin'
  const navigate = useNavigate()
  // Opened from a link (a notification, global search): ?open=<partner id> goes straight to the partner
  const [searchParams] = useSearchParams()
  const openId = searchParams.get('open')
  useEffect(() => {
    if (openId) navigate(`/3pl-partners/${encodeURIComponent(openId)}`, { replace: true })
  }, [openId, navigate])
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const [tab, setTab] = useTabParam<StatusTab>(TABS, 'pending', 'status')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [sortParam, setSortParam] = useUrlState('sort')
  const sort = parseSort(sortParam)
  const [bulkBusy, setBulkBusy] = useState(false)

  const { data: partners = [], isLoading, error, refetch } = useQuery<TplPartner[]>({
    queryKey: ['tpl-queue', 'all'],
    queryFn: () => tplAPI.queue('all').then((d: unknown) => (Array.isArray(d) ? d : [])),
    refetchInterval: 15000,
  })

  const stats = useQuery({ queryKey: ['tpl-partner-stats'], queryFn: tplNetworkAPI.allStats, refetchInterval: 30000 })
  const statsFor = (p: TplPartner) => stats.data?.[p.id]

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tpl-queue'] })
    queryClient.invalidateQueries({ queryKey: ['tpl-partners-pending-count'] })
  }

  const approve = useMutation({
    mutationFn: (id: string) => tplAPI.approve(id),
    onSuccess: () => { toast.success('Partner approved'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not approve this partner. Try again.')),
  })

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => tplAPI.reject(id, reason),
    onSuccess: () => { toast.success('Application rejected'); refresh() },
    onError: err => toast.error(errorMessage(err, 'We could not reject this application. Try again.')),
  })

  const askApprove = async (p: TplPartner) => {
    const ok = await confirm({
      title: 'Approve this 3PL partner?',
      message: 'This activates the partner and lets them set up their account.',
      confirmLabel: 'Approve partner',
    })
    if (ok) approve.mutate(p.id)
  }

  const askReject = async (p: TplPartner) => {
    const reason = await prompt({
      title: `Reject ${p.company_name}?`,
      inputLabel: 'Reason for rejection',
      placeholder: 'What needs to change before this can be approved?',
      confirmLabel: 'Reject application',
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
      .filter(p => {
        const q = search.trim().toLowerCase()
        return !q || p.company_name.toLowerCase().includes(q) || (p.custom_id ?? '').toLowerCase().includes(q)
      })
  }, [partners, tab, search])

  const selection = useRowSelection(filtered, p => p.id)

  const bulkApprove = async () => {
    const targets = selection.selectedRows.filter(isPending)
    if (targets.length === 0) return
    const ok = await confirm({
      title: `Approve ${targets.length} ${targets.length === 1 ? 'partner' : 'partners'}?`,
      message: 'Each partner is activated and can set up their account.',
      confirmLabel: 'Approve partners',
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
    if (failures.length === 0) toast.success(`Approved ${approved} ${approved === 1 ? 'partner' : 'partners'}`)
    else toast.error(`Approved ${approved}, ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`)
  }

  const columns: Column<TplPartner>[] = [
    {
      key: 'name', header: 'Partner', sortValue: p => p.company_name, cell: p => (
        <div>
          <Link to={`/3pl-partners/${encodeURIComponent(p.id)}`} onClick={e => e.stopPropagation()} className="font-medium text-text underline decoration-border underline-offset-2 hover:decoration-text">{p.company_name}</Link>
          <p className="font-mono text-xs text-muted">{p.custom_id || 'No 3PL ID yet'}</p>
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
      key: 'accept', header: 'Acceptance', align: 'right', hideBelow: 'lg',
      cell: p => {
        const st = statsFor(p)
        return <span className="tabular" title={st ? `${st.offers_accepted} accepted, ${st.offers_declined} declined` : undefined}>{formatPercent(st?.acceptance_rate)}</span>
      },
      sortValue: p => statsFor(p)?.acceptance_rate ?? null,
    },
    {
      key: 'response', header: 'Response time', align: 'right', hideBelow: 'xl',
      cell: p => <span className="tabular">{formatMinutes(statsFor(p)?.avg_response_minutes)}</span>,
      sortValue: p => statsFor(p)?.avg_response_minutes ?? null,
    },
    {
      key: 'completed', header: 'Delivered', align: 'right', hideBelow: 'xl',
      cell: p => <span className="tabular">{statsFor(p) ? statsFor(p)!.orders_completed.toLocaleString('en-IN') : '—'}</span>,
      sortValue: p => statsFor(p)?.orders_completed ?? null,
    },
    {
      key: 'breaches', header: 'SLA breaches', align: 'right', hideBelow: 'xl',
      cell: p => <span className="tabular">{statsFor(p) ? statsFor(p)!.sla_breaches.toLocaleString('en-IN') : '—'}</span>,
      sortValue: p => statsFor(p)?.sla_breaches ?? null,
    },
    {
      key: 'rating', header: 'Rating', align: 'right', hideBelow: 'xl',
      cell: p => <span className="tabular">{statsFor(p)?.rating_avg != null ? statsFor(p)!.rating_avg!.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'}</span>,
      sortValue: p => statsFor(p)?.rating_avg ?? null,
    },
    {
      key: 'created_at', header: 'Submitted', hideBelow: 'md', sortValue: p => p.created_at,
      cell: p => <span className="text-sm text-muted">{formatDate(p.created_at)}</span>,
    },
    { key: 'status', header: 'Status', cell: p => <StatusPill status={p.status} /> },
    {
      key: 'actions', header: 'Actions', align: 'right', cell: p => (
        canDecide && isPending(p) ? (
          <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <IconButton
              label={`Approve ${p.company_name}`}
              icon={<Check size={16} />}
              size="sm"
              disabled={(approve.isPending && approve.variables === p.id) || (reject.isPending && reject.variables?.id === p.id)}
              onClick={() => askApprove(p)}
            />
            <IconButton
              label={`Reject ${p.company_name}`}
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
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          label="Filter partners by status"
          value={tab}
          onChange={setTab}
          tabs={TABS.map(t => ({ id: t, label: t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1), count: counts[t] ?? 0 }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name or 3PL ID" className="sm:w-64" />
          <Button variant="secondary" icon={<Plus size={16} />} onClick={() => navigate('/3pl/onboard')}>Invite a partner</Button>
        </div>
      </div>

      <DataTable
        caption="3PL partners"
        columns={columns}
        rows={filtered}
        rowKey={p => p.id}
        loading={isLoading}
        error={error ? 'We could not load 3PL partners.' : undefined}
        onRetry={() => refetch()}
        onRowClick={p => navigate(`/3pl-partners/${p.id}`)}
        sort={sort}
        onSortChange={s => setSortParam(serializeSort(s))}
        empty={search.trim()
          ? { title: 'No partners match your search', action: <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> }
          : { title: tab === 'pending' ? 'No pending applications' : 'No partners here yet', description: 'Applications appear here once submitted.' }}
        selection={!canDecide ? undefined : {
          selectedKeys: selection.selectedKeys,
          onToggleRow: key => selection.toggleRow(key),
          onToggleAll: (pageRows, checked) => selection.toggleAll(pageRows, checked),
          isRowSelectable: isPending,
        }}
      />

      {canDecide && (
        <BulkActionBar count={selection.count} onClear={selection.clear}>
          <Button size="sm" disabled={bulkBusy} loading={bulkBusy} onClick={bulkApprove}>Approve selected</Button>
        </BulkActionBar>
      )}
    </div>
  )
}
