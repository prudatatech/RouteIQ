import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { tplAPI } from '@/services/api'
import {
  Button, DataTable, Page, PageHeader, SearchInput, StatusPill, Tabs, parseSort, serializeSort, useTabParam, useUrlState,
} from '@/components/ui'
import type { Column } from '@/components/ui'

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

/**
 * The single 3PL partners area: directory of every application and partner,
 * grouped by status. Selecting a row opens the detail page, which is where
 * verification (documents, approve/reject) happens.
 */
export default function TplPartnersPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useTabParam<StatusTab>(TABS, 'pending')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [sortParam, setSortParam] = useUrlState('sort')
  const sort = parseSort(sortParam)

  const { data: partners = [], isLoading, error, refetch } = useQuery<TplPartner[]>({
    queryKey: ['tpl-queue', 'all'],
    queryFn: () => tplAPI.queue('all').then((d: unknown) => (Array.isArray(d) ? d : [])),
    refetchInterval: 15000,
  })

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
        sort={sort}
        onSortChange={s => setSortParam(serializeSort(s))}
        empty={{ title: tab === 'pending' ? 'No pending applications' : 'No partners here yet', description: 'Applications appear here once submitted.' }}
      />
    </Page>
  )
}
