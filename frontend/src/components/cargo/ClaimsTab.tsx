import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { DataTable, Select, StatusPill, statusToLabel, useUrlState, type Column } from '@/components/ui'
import { CLAIM_STATUSES, cargoKeys, claimsAPI, type CargoClaim } from '@/services/cargo'
import { formatRelative, formatRupees } from '@/utils/display'
import { ConsignmentLink } from './CargoBits'
import ClaimDrawer from './ClaimDrawer'
import { claimTypeLabel } from './logic'

const money = (n: number | null) => (n != null ? formatRupees(n) : '—')
const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...CLAIM_STATUSES.map(s => ({ value: s, label: statusToLabel(s) }))]

const columns: Column<CargoClaim>[] = [
  { key: 'code', header: 'Claim', sortValue: c => c.code, cell: c => <span className="font-mono font-medium">{c.code}</span> },
  { key: 'consignment', header: 'Consignment', cell: c => <span onClick={e => e.stopPropagation()}><ConsignmentLink c={c} /></span> },
  { key: 'type', header: 'Type', hideBelow: 'md', sortValue: c => c.claim_type, cell: c => claimTypeLabel(c.claim_type) },
  { key: 'status', header: 'Status', sortValue: c => c.status, cell: c => <StatusPill status={c.status} /> },
  { key: 'claimed', header: 'Claimed', align: 'right', sortValue: c => c.claimed_amount ?? 0, cell: c => <span className="tabular">{money(c.claimed_amount)}</span> },
  { key: 'approved', header: 'Approved', align: 'right', hideBelow: 'lg', sortValue: c => c.approved_amount ?? 0, cell: c => <span className="tabular">{money(c.approved_amount)}</span> },
  { key: 'settled', header: 'Settled', align: 'right', hideBelow: 'lg', sortValue: c => c.settled_amount ?? 0, cell: c => <span className="tabular">{money(c.settled_amount)}</span> },
  {
    key: 'raised', header: 'Raised', hideBelow: 'md', sortValue: c => c.created_at,
    cell: c => <span className="capitalize">{c.raised_by_role}<span className="block text-xs normal-case text-muted">{formatRelative(c.created_at)}</span></span>,
  },
]

/** All cargo claims, filtered by status; a row opens the claim drawer. */
export default function ClaimsTab() {
  const [status, setStatus] = useUrlState('claim_status')
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const claims = useQuery({
    queryKey: cargoKeys.claims({ status }),
    queryFn: () => claimsAPI.list({ status: status || undefined }),
  })
  const rows = useMemo(() => claims.data ?? [], [claims.data])
  const selected = rows.find(c => c.id === selectedId) ?? null

  // Opened from a link elsewhere: ?open=<claimId>, dropped from the URL once handled.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || claims.isLoading) return
    if (rows.some(c => c.id === openId)) setSelectedId(openId)
    setSearchParams(params => { const next = new URLSearchParams(params); next.delete('open'); return next }, { replace: true })
  }, [searchParams, setSearchParams, rows, claims.isLoading])

  return (
    <div className="space-y-4">
      <Select label="Status" options={STATUS_OPTIONS} value={status} onChange={e => setStatus(e.target.value)} className="sm:max-w-xs" />
      <DataTable
        caption="Cargo claims"
        columns={columns}
        rows={rows}
        rowKey={c => c.id}
        loading={claims.isLoading}
        error={claims.isError ? 'We could not load the claims.' : undefined}
        onRetry={() => claims.refetch()}
        onRowClick={c => setSelectedId(c.id)}
        selectedKey={selectedId}
        initialSort={{ key: 'raised', direction: 'desc' }}
        pageSize={15}
        empty={status
          ? { icon: <ShieldCheck size={22} />, title: 'No claims with this status', description: 'Choose another status to see more.' }
          : { icon: <ShieldCheck size={22} />, title: 'No claims yet', description: 'Claims are raised from an exception case, when goods are damaged, short or lost.' }}
      />
      <ClaimDrawer claim={selected} onClose={() => setSelectedId(null)} />
    </div>
  )
}
