import { useMemo } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { vendorAPI } from '@/services/api'
import { useEffectiveRole } from '@/store/effectiveRole'
import {
  Alert, Button, DataTable, Page, PageHeader, SearchInput, StatusPill, statusToLabel, Tabs, TabPanel,
  buttonClasses, parseSort, serializeSort, useOpenOnWork, useTabParam, useUrlState, type Column,
} from '@/components/ui'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatDateTime, formatRelative } from '@/utils/display'
import type { KycStatus, RegistryRow } from '@/components/admin/vendor-review/types'

const TAB_IDS = ['submitted', 'info_requested', 'approved', 'rejected', 'pending', 'all'] as const
type TabId = typeof TAB_IDS[number]

const vendorName = (v: RegistryRow) => v.name || v.email || 'Unnamed vendor'

async function countPendingPartners() {
  const { count, error } = await supabase.from('tpl_partners').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

export default function KycReviewPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'submitted')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [sortParam, setSortParam] = useUrlState('sort', { fallback: tab === 'submitted' ? 'updated:asc' : 'updated:desc' })
  const sort = parseSort(sortParam)
  const [searchParams] = useSearchParams()
  // 3PL applications are decided on a page only superadmin can open
  const isSuperadmin = useEffectiveRole().role === 'superadmin'

  const vendors = useQuery({ queryKey: ['vendor-registry'], queryFn: () => vendorAPI.registryAll() })
  const partners = useQuery({ queryKey: ['tpl-partners-pending-count'], queryFn: countPendingPartners, enabled: isSuperadmin })
  useRealtimeRefresh('kyc_review_page', ['vendor_profiles'], [['vendor-registry']])
  useRealtimeRefresh('kyc_review_page_partners', ['tpl_partners'], [['tpl-partners-pending-count']])

  const all = useMemo(() => vendors.data?.items ?? [], [vendors.data])
  const counts = useMemo(() => {
    const c: Record<TabId, number> = { submitted: 0, info_requested: 0, approved: 0, rejected: 0, pending: 0, all: all.length }
    for (const v of all) if (v.kyc_status in c) c[v.kyc_status as KycStatus]++
    return c
  }, [all])

  useOpenOnWork(['submitted', 'info_requested', 'approved', 'rejected', 'pending'] as const, vendors.isLoading ? {} : counts, tab, setTab)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(v => (tab === 'all' || v.kyc_status === tab)
      && (!q || [v.name, v.email, v.phone, v.gstin, v.city].some(x => (x ?? '').toLowerCase().includes(q))))
  }, [all, tab, search])

  // Old links and notifications open a vendor with ?open=<id>: that is now a page of its own.
  const openId = searchParams.get('open')
  if (openId) return <Navigate to={`/admin/kyc/${encodeURIComponent(openId)}`} replace />

  const columns: Column<RegistryRow>[] = [
    {
      key: 'vendor', header: 'Vendor',
      sortValue: v => vendorName(v).toLowerCase(),
      cell: v => (
        <div className="min-w-0">
          <p className="font-medium text-text">{vendorName(v)}</p>
          <p className="font-mono text-xs text-muted">{v.gstin && v.gstin !== 'PENDING' ? `GST ${v.gstin}` : 'No GST number'}</p>
        </div>
      ),
    },
    {
      key: 'status', header: 'Status',
      sortValue: v => statusToLabel(v.kyc_status, 'kyc'),
      cell: v => (
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill status={v.kyc_status} kind="kyc" />
          {v.kyc_status === 'submitted' && v.kyc_reviewed_at && <span className="text-xs text-muted">Resubmitted</span>}
          {v.open_requests > 0 && <span className="text-xs text-muted">{v.open_requests} open {v.open_requests === 1 ? 'request' : 'requests'}</span>}
        </span>
      ),
    },
    { key: 'city', header: 'City', hideBelow: 'lg', sortValue: v => (v.city ?? '').toLowerCase(), cell: v => v.city || '—' },
    {
      key: 'updated', header: 'Updated',
      sortValue: v => (v.updated_at ? new Date(v.updated_at).getTime() : 0),
      cell: v => <span title={formatDateTime(v.updated_at)}>{v.updated_at ? formatRelative(v.updated_at) : '—'}</span>,
    },
    {
      key: 'reviewed', header: 'Last reviewed', hideBelow: 'lg',
      sortValue: v => (v.kyc_reviewed_at ? new Date(v.kyc_reviewed_at).getTime() : 0),
      cell: v => (v.kyc_reviewed_at ? formatDateTime(v.kyc_reviewed_at) : 'Never'),
    },
  ]

  const tabs = [
    { id: 'submitted' as const, label: 'Waiting for review', count: counts.submitted },
    { id: 'info_requested' as const, label: 'More details asked', count: counts.info_requested },
    { id: 'approved' as const, label: 'Approved', count: counts.approved },
    { id: 'rejected' as const, label: 'Rejected', count: counts.rejected },
    { id: 'pending' as const, label: 'Not submitted', count: counts.pending },
    { id: 'all' as const, label: 'All', count: counts.all },
  ]

  const emptyTitle: Record<TabId, string> = {
    submitted: 'Nothing waiting for review',
    info_requested: 'No vendor is being asked for more details',
    approved: 'No approved vendors yet',
    rejected: 'No rejected KYC',
    pending: 'Every vendor has submitted KYC',
    all: 'No vendors yet',
  }

  const pendingPartners = isSuperadmin ? (partners.data ?? 0) : 0

  return (
    <Page>
      <PageHeader
        title="KYC review"
        description="Every vendor who signed up, where they are in KYC, and a full page to check, approve, reject or ask for more details. Vendors can bid only after approval."
      >
        <div className="space-y-4">
          {pendingPartners > 0 && (
            <Alert
              tone="info"
              title={`${pendingPartners.toLocaleString('en-IN')} 3PL partner ${pendingPartners === 1 ? 'application is' : 'applications are'} waiting`}
              action={<Link to="/3pl-partners?tab=pending" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Review 3PL partners</Link>}
            >
              3PL partners are verified with their lanes and rates, on the 3PL partners page.
            </Alert>
          )}
          <Tabs label="Filter by KYC status" tabs={vendors.isLoading ? tabs.map(t => ({ ...t, count: undefined })) : tabs} value={tab} onChange={setTab} />
          <SearchInput value={search} onChange={setSearch} label="Search vendors" placeholder="Search by name, email, phone, GST or city" className="max-w-sm" />
        </div>
      </PageHeader>

      <TabPanel id={tab}>
        <DataTable
          caption="Vendors"
          columns={columns}
          rows={rows}
          rowKey={v => v.id}
          loading={vendors.isLoading}
          error={vendors.error ? 'We could not load vendors. Check your connection and try again.' : undefined}
          onRetry={() => vendors.refetch()}
          onRowClick={v => navigate(`/admin/kyc/${encodeURIComponent(v.id)}`)}
          sort={sort}
          onSortChange={s => setSortParam(serializeSort(s))}
          empty={search
            ? { title: 'No vendors match your search', action: <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> }
            : { title: emptyTitle[tab] }}
        />
      </TabPanel>
    </Page>
  )
}
