import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowRightLeft } from 'lucide-react'
import { DataTable, Select, StatusPill, useUrlState, type Column } from '@/components/ui'
import { cargoKeys, transfersAPI, TRANSFER_STATUSES, type CargoTransfer, type TransferStatus } from '@/services/cargo'
import { formatRelative } from '@/utils/display'
import { transferItemCount } from './logic'

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const pieces = (t: CargoTransfer) => t.items.reduce((total, i) => total + i.pieces_planned, 0)
const hasMismatch = (t: CargoTransfer) => t.items.some(i => transferItemCount(i).mismatch)
const partBDue = (t: CargoTransfer) => t.eway_part_b_required && !t.eway_part_b_ref
const stamp = (t: CargoTransfer) => t.created_at ?? t.planned_at ?? ''

export default function TransfersTab() {
  const navigate = useNavigate()
  const [raw, setStatus] = useUrlState('transfer_status')
  const status = (TRANSFER_STATUSES as readonly string[]).includes(raw) ? (raw as TransferStatus) : undefined

  const query = useQuery({
    queryKey: cargoKeys.transfers(status),
    queryFn: () => transfersAPI.list(status),
    refetchInterval: 60_000,
  })

  const columns = useMemo<Column<CargoTransfer>[]>(() => [
    { key: 'code', header: 'Transfer', sortValue: t => t.code, cell: t => <span className="font-mono font-medium">{t.code}</span> },
    { key: 'status', header: 'Status', sortValue: t => t.status, cell: t => <StatusPill status={t.status} /> },
    {
      key: 'route', header: 'From and to',
      cell: t => (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <span className="font-mono">{t.from_vehicle?.plate_number ?? '—'}</span>
          <ArrowRight size={14} className="text-muted" aria-label="to" />
          <span className={t.to_vehicle ? 'font-mono' : undefined}>{t.to_vehicle?.plate_number ?? t.to_depot?.name ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'items', header: 'Consignments', hideBelow: 'md', align: 'right', sortValue: pieces,
      cell: t => <span className="tabular">{t.items.length.toLocaleString('en-IN')} · {pieces(t).toLocaleString('en-IN')} pcs</span>,
    },
    {
      key: 'flags', header: 'Check',
      cell: t => {
        const mismatch = hasMismatch(t)
        const due = partBDue(t)
        if (!mismatch && !due) return <span className="text-muted">—</span>
        return (
          <span className="inline-flex flex-wrap gap-1">
            {mismatch && <StatusPill tone="danger">Count mismatch</StatusPill>}
            {due && <StatusPill tone="warning">Part B due</StatusPill>}
          </span>
        )
      },
    },
    {
      key: 'created', header: 'Created', hideBelow: 'lg', sortValue: stamp,
      cell: t => {
        const at = stamp(t)
        return at ? formatRelative(at) : '—'
      },
    },
  ], [])

  return (
    <div className="space-y-4">
      <Select
        label="Status"
        value={status ?? ''}
        onChange={e => setStatus(e.target.value)}
        options={FILTERS}
        className="w-full sm:w-56"
      />
      <DataTable
        caption="Cargo transfers"
        columns={columns}
        rows={query.data ?? []}
        rowKey={t => t.id}
        loading={query.isLoading}
        error={query.isError ? 'We could not load transfers.' : undefined}
        onRetry={() => query.refetch()}
        onRowClick={t => navigate(`/cargo/transfers/${t.id}`)}
        initialSort={{ key: 'created', direction: 'desc' }}
        empty={{
          icon: <ArrowRightLeft size={22} />,
          title: 'No transfers',
          description: 'Transfers are planned from an exception case, or from a shipment’s "Move to another vehicle".',
        }}
      />
    </div>
  )
}
