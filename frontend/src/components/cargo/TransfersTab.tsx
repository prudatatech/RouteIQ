import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowRightLeft } from 'lucide-react'
import { DataTable, ExportCsvButton, Select, StatusPill, statusToLabel, useUrlState, type Column } from '@/components/ui'
import { cargoKeys, transfersAPI, TRANSFER_STATUSES, type CargoTransfer, type TransferStatus } from '@/services/cargo'
import { formatDateTime, formatRelative, formatPieces } from '@/utils/display'
import type { CsvColumn } from '@/utils/csv'
import { partBDue, transferItemCount } from './logic'

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const pieces = (t: CargoTransfer) => t.items.reduce((total, i) => total + i.pieces_planned, 0)
const hasMismatch = (t: CargoTransfer) => t.items.some(i => transferItemCount(i).mismatch)
const stamp = (t: CargoTransfer) => t.planned_at ?? ''

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'transfer', header: 'Transfer' },
  { key: 'status', header: 'Status' },
  { key: 'from', header: 'From vehicle' },
  { key: 'to', header: 'To' },
  { key: 'shipments', header: 'Shipments' },
  { key: 'pieces', header: 'Pieces planned' },
  { key: 'check', header: 'Check' },
  { key: 'created', header: 'Created' },
]

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
      key: 'items', header: 'Shipments', hideBelow: 'md', align: 'right', sortValue: pieces,
      cell: t => <span className="tabular">{t.items.length.toLocaleString('en-IN')} · {formatPieces(pieces(t))}</span>,
    },
    {
      key: 'flags', header: 'Check',
      cell: t => {
        const mismatch = hasMismatch(t)
        const due = partBDue(t)
        if (!mismatch && !due) return <span className="text-muted">—</span>
        return (
          <span className="inline-flex flex-wrap gap-1">
            {mismatch && (
              <StatusPill tone={t.status === 'completed' ? 'warning' : 'danger'} title="The pieces counted do not match the pieces planned or handed over. A shortage problem is opened when fewer pieces arrive than left.">
                {t.status === 'completed' ? 'Counts differed' : 'Count mismatch'}
              </StatusPill>
            )}
            {due && (
              <StatusPill tone="warning" title="The goods moved to another vehicle, so the vehicle number on the e-way bill (Part B) must be updated on the e-way bill portal.">
                Update e-way bill
              </StatusPill>
            )}
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

  const csvRows = (query.data ?? []).map(t => ({
    transfer: t.code,
    status: statusToLabel(t.status),
    from: t.from_vehicle?.plate_number ?? '',
    to: t.to_vehicle?.plate_number ?? t.to_depot?.name ?? '',
    shipments: t.items.length,
    pieces: pieces(t),
    check: [hasMismatch(t) ? 'Count mismatch' : '', partBDue(t) ? 'Update e-way bill' : ''].filter(Boolean).join(', '),
    created: stamp(t) ? formatDateTime(stamp(t)) : '',
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={status ?? ''}
          onChange={e => setStatus(e.target.value)}
          options={FILTERS}
          className="w-full sm:w-56"
        />
        <span className="ml-auto"><ExportCsvButton name="transfers" rows={csvRows} columns={CSV_COLUMNS} /></span>
      </div>
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
          description: 'Transfers are planned from a problem case, or from a shipment’s "Move to another vehicle".',
        }}
      />
    </div>
  )
}
