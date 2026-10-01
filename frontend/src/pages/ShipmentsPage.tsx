import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Download, Plus } from 'lucide-react'
import {
  Button, DataTable, Page, PageHeader, SearchInput, StatusPill, Tabs, humanize, parseSort, serializeSort,
  useTabParam, useUrlState, type Column,
} from '@/components/ui'
import AssignVehicleModal from '@/components/shipments/AssignVehicleModal'
import EditShipmentModal from '@/components/shipments/EditShipmentModal'
import ShipmentDetailsDrawer from '@/components/shipments/ShipmentDetailsDrawer'
import {
  SHIPMENT_STATUSES, deliveryPointsOf, destinationOf, isBiddingOpen, pickupDateOf, plateOf, shipmentStatusLabel,
} from '@/components/shipments/format'
import type { ShipmentRow } from '@/components/shipments/types'
import { shipmentsAPI } from '@/services/api'
import { supabase, openChannel } from '@/services/supabase'
import { useDraftStore } from '@/store/draftStore'
import { downloadCsv, toCsv } from '@/utils/csv'
import { formatDate, formatKg } from '@/utils/display'
import { groupLots } from '@/components/cargo/lots'
import PlaceText from '@/components/shipments/PlaceText'

const TAB_IDS = ['all', ...SHIPMENT_STATUSES] as const
type TabId = (typeof TAB_IDS)[number]
/** Cargo custody states are rare; their tabs show only while something is in them (or they are open). */
const QUIET_TABS: readonly TabId[] = ['at_hub', 'out_for_delivery', 'on_hold', 'partially_delivered', 'returning', 'returned', 'lost']

const PlaceCell = ({ name, address }: { name?: string | null; address?: string | null }) => (
  <PlaceText name={name} address={address} truncate className="max-w-44 2xl:max-w-64" />
)

/** One row of the list: a shipment, or a split master with its lots. */
interface ListRow extends ShipmentRow {
  lots: ShipmentRow[]
  /** The row's status: a master's is the rollup of its lots, which the backend stores on it. */
  shownStatus: string | null
}


const lotHolder = (s: ShipmentRow) => plateOf(s) ?? (s.current_holder === 'hub' ? 'At a hub' : s.current_holder === 'consignee' ? 'Delivered' : s.vehicle_id ? 'Assigned' : 'With the sender')

/** A master's lots under its row: each opens in the drawer like any shipment. */
function LotRows({ lots, selectedId, onOpen }: { lots: ShipmentRow[]; selectedId: string | null; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-border" aria-label="Lots">
      {lots.map(l => {
        const dest = destinationOf(l)
        return (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => onOpen(l.id)}
              className={clsx(
                'grid w-full grid-cols-1 gap-x-4 gap-y-1 py-2.5 pl-8 pr-4 text-left text-sm hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:grid-cols-[minmax(0,12rem)_minmax(0,9rem)_minmax(0,1fr)_minmax(0,9rem)] sm:items-center',
                selectedId === l.id && 'bg-brand-soft',
              )}
            >
              <span className="min-w-0 font-mono font-medium text-brand">{l.tracking_id}</span>
              <span><StatusPill status={l.status} kind="cargo">{shipmentStatusLabel(l.status)}</StatusPill></span>
              <span className="min-w-0 truncate text-text">
                {[l.consignee_name, dest?.name && dest.name !== l.consignee_name ? dest.name : dest?.address].filter(Boolean).join(' · ') || <span className="text-muted">No drop</span>}
              </span>
              <span className="min-w-0 truncate text-muted">
                {(l.pieces_total ?? l.total_items) != null ? `${(l.pieces_total ?? l.total_items)!.toLocaleString('en-IN')} pcs · ` : ''}{lotHolder(l)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default function ShipmentsPage() {
  const queryClient = useQueryClient()
  const openCreate = useDraftStore(s => s.openModal)
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'all', 'status')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [sortParam, setSortParam] = useUrlState('sort', { fallback: 'shipment:desc' })
  const sort = parseSort(sortParam)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ShipmentRow | null>(null)
  const [assigning, setAssigning] = useState<ShipmentRow | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const { data: shipments = [], isLoading, isError, refetch } = useQuery<ShipmentRow[]>({
    queryKey: ['shipments'],
    queryFn: () => shipmentsAPI.list() as Promise<ShipmentRow[]>,
  })

  // Old links (?open=<id>) now go to the shipment's own page.
  const openId = searchParams.get('open')
  useEffect(() => {
    if (openId) navigate(`/shipments/${encodeURIComponent(openId)}`, { replace: true })
  }, [openId, navigate])

  // Keep the list current when shipments or cargo manifests change anywhere.
  useEffect(() => {
    const channel = openChannel('public:shipments_and_manifests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, () => {
        queryClient.invalidateQueries({ queryKey: ['shipments'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cargo_manifest' }, () => {
        queryClient.invalidateQueries({ queryKey: ['shipments'] })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  const rows = useMemo(() => shipments.filter(Boolean), [shipments])

  // A split master is one row with its lots under it; the backend stores its rolled-up status on it
  const listRows = useMemo<ListRow[]>(() => groupLots(rows).map(({ row, lots }) => ({
    ...row,
    // Merged or emptied lots are cancelled with nothing on them (lots_summary leaves them out too)
    lots: row.status === 'cancelled' ? lots : lots.filter(l => l.status !== 'cancelled'),
    shownStatus: row.status ?? null,
  })), [rows])

  /** A row is in a status tab by its own (rolled-up) status or any of its lots' statuses. */
  const inTab = (r: ListRow, id: TabId) => id === 'all' || r.shownStatus === id || r.lots.some(l => l.status === id)

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = { all: listRows.length }
    for (const id of TAB_IDS) if (id !== 'all') byStatus[id] = listRows.filter(r => inTab(r, id)).length
    return byStatus
  }, [listRows])

  const matchesSearch = (s: ShipmentRow, q: string) => {
    const dest = destinationOf(s)
    return [s.tracking_id, s.origin_name, s.origin_address, dest?.name, dest?.address, s.driver_name, plateOf(s), s.consignee_name]
      .some(v => v?.toLowerCase().includes(q))
  }
  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => listRows.filter(r => {
    if (!inTab(r, tab)) return false
    return !q || matchesSearch(r, q) || r.lots.some(l => matchesSearch(l, q))
  }), [listRows, tab, q])

  const isExpanded = (r: ListRow) => r.lots.length > 0 && (expanded.has(r.id) || (!!q && r.lots.some(l => matchesSearch(l, q))))
  const toggleExpanded = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  // Look the selection up in the live list so the drawer shows realtime changes.
  const selected = selectedId ? rows.find(s => s.id === selectedId) ?? null : null

  const columns: Column<ListRow>[] = [
    {
      key: 'shipment',
      header: 'Shipment',
      sortValue: s => (s.created_at ? new Date(s.created_at).getTime() : null),
      cell: s => (
        <div className="whitespace-nowrap">
          <div className="font-mono font-medium">{s.tracking_id}</div>
          {s.created_at && <div className="text-xs font-normal text-muted">{formatDate(s.created_at)}</div>}
          {pickupDateOf(s) && <div className="text-xs font-normal text-muted">Pickup {formatDate(pickupDateOf(s))}</div>}
          {s.lots.length > 0 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); toggleExpanded(s.id) }}
              aria-expanded={isExpanded(s)}
              aria-label={`${isExpanded(s) ? 'Hide' : 'Show'} the ${s.lots.length} lots of ${s.tracking_id}`}
              className="mt-1 inline-flex items-center gap-1 rounded-control text-xs font-medium text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {isExpanded(s) ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              {s.lots.length.toLocaleString('en-IN')} lots
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: s => shipmentStatusLabel(s.shownStatus),
      cell: s => {
        const urgent = s.priority === 'high' || s.priority === 'critical'
        return (
          <div className="flex flex-col items-end gap-1 md:items-start">
            <StatusPill status={s.shownStatus} kind="cargo">{shipmentStatusLabel(s.shownStatus)}</StatusPill>
            {s.lots_summary && s.lots_summary.count > 0 && (
              <span className="text-xs text-muted">
                {s.lots_summary.delivered_lots.toLocaleString('en-IN')} of {s.lots_summary.count.toLocaleString('en-IN')} lots delivered
              </span>
            )}
            {isBiddingOpen(s) && <StatusPill tone="warning" dot={false}>Bidding open</StatusPill>}
            {urgent && <span className={s.priority === 'critical' ? 'text-xs font-medium text-danger' : 'text-xs font-medium text-warning'}>{humanize(s.priority!)} priority</span>}
          </div>
        )
      },
    },
    {
      key: 'pickup',
      header: 'Pickup',
      sortValue: s => s.origin_name || s.origin_address,
      cell: s => <PlaceCell name={s.origin_name} address={s.origin_address} />,
    },
    {
      key: 'destination',
      header: 'Destination',
      sortValue: s => destinationOf(s)?.name,
      cell: s => {
        if (s.lots.length > 0) {
          const drops = new Set(s.lots.map(l => destinationOf(l)?.address ?? destinationOf(l)?.name).filter(Boolean)).size
          return <span className="whitespace-nowrap text-text">{drops > 1 ? `${drops.toLocaleString('en-IN')} drops` : (destinationOf(s)?.name ?? destinationOf(s)?.address ?? '—')}</span>
        }
        const dest = destinationOf(s)
        const extra = deliveryPointsOf(s).length - 1
        return (
          <div className="min-w-0">
            <PlaceCell name={dest?.name} address={dest?.address} />
            {extra > 0 && <div className="text-xs text-muted">+{extra.toLocaleString('en-IN')} more {extra === 1 ? 'stop' : 'stops'}</div>}
          </div>
        )
      },
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      hideBelow: 'xl',
      sortValue: s => plateOf(s) ?? s.driver_name,
      cell: s => {
        if (s.lots.length > 0) {
          const plates = [...new Set(s.lots.map(plateOf).filter(Boolean))]
          return <span className="whitespace-nowrap text-muted">{plates.length === 0 ? 'Per lot' : plates.length === 1 ? <span className="font-mono text-text">{plates[0]}</span> : `${plates.length} vehicles`}</span>
        }
        const plate = plateOf(s)
        if (!plate && !s.driver_name) return <span className="whitespace-nowrap text-muted">Not assigned</span>
        return (
          <div className="min-w-0 whitespace-nowrap">
            {plate && <div className="font-mono">{plate}</div>}
            {s.driver_name && <div className="max-w-40 truncate text-xs text-muted">{s.driver_name}</div>}
          </div>
        )
      },
    },
    {
      key: 'load',
      header: 'Load',
      align: 'right',
      hideBelow: 'xl',
      hideOnMobile: true,
      sortValue: s => s.total_weight_kg,
      cell: s => (
        <div className="whitespace-nowrap tabular">
          <div>{formatKg(s.total_weight_kg) ?? '—'}</div>
          {s.total_items != null && <div className="text-xs text-muted">{s.total_items.toLocaleString('en-IN')} {s.total_items === 1 ? 'item' : 'items'}</div>}
        </div>
      ),
    },
  ]

  const createButton = <Button icon={<Plus size={16} />} onClick={openCreate}>Create shipment</Button>
  const filtering = tab !== 'all' || search.trim() !== ''

  const exportCsv = () => {
    // Each master is followed by its lots, which carry their master's code
    const flat = filtered.flatMap(r => [{ s: r as ShipmentRow, status: r.shownStatus, master: r.master_tracking_id ?? '' }, ...r.lots.map(l => ({ s: l, status: l.status ?? null, master: r.tracking_id }))])
    const csv = toCsv(flat.map(({ s, status, master }) => {
      const dest = destinationOf(s)
      return {
        tracking_id: s.tracking_id,
        lot_of: master,
        status: shipmentStatusLabel(status),
        pickup: s.origin_name || s.origin_address || '',
        destination: dest?.name || dest?.address || '',
        vehicle: plateOf(s) || '',
        driver: s.driver_name || '',
        load_kg: s.total_weight_kg ?? '',
        items: s.total_items ?? '',
        created_at: s.created_at || '',
        pickup_date: pickupDateOf(s) || '',
      }
    }), [
      { key: 'tracking_id', header: 'Tracking ID' },
      { key: 'lot_of', header: 'Lot of' },
      { key: 'status', header: 'Status' },
      { key: 'pickup', header: 'Pickup' },
      { key: 'destination', header: 'Destination' },
      { key: 'vehicle', header: 'Vehicle' },
      { key: 'driver', header: 'Driver' },
      { key: 'load_kg', header: 'Load (kg)' },
      { key: 'items', header: 'Items' },
      { key: 'created_at', header: 'Created at' },
      { key: 'pickup_date', header: 'Pickup date' },
    ])
    downloadCsv(`shipments-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <Page>
      <PageHeader
        title="Shipments"
        description="Every shipment and where it is now."
        actions={(
          <>
            <Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv}>Export CSV</Button>
            {createButton}
          </>
        )}
      >
        <Tabs
          label="Filter by status"
          value={tab}
          onChange={setTab}
          tabs={TAB_IDS.filter(id => !QUIET_TABS.includes(id) || id === tab || (counts[id] ?? 0) > 0).map(id => ({
            id,
            label: id === 'all' ? 'All' : shipmentStatusLabel(id),
            count: isLoading ? undefined : counts[id] ?? 0,
          }))}
        />
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Search shipments"
          placeholder="Search by tracking ID, place, vehicle or driver"
          className="max-w-md"
        />
      </PageHeader>

      <DataTable
        caption="Shipments"
        columns={columns}
        rows={filtered}
        rowKey={s => s.id}
        loading={isLoading}
        error={isError ? 'We could not load shipments. Check your connection and try again.' : undefined}
        onRetry={() => refetch()}
        onRowClick={s => setSelectedId(s.id)}
        selectedKey={selectedId}
        renderExpanded={r => (isExpanded(r) ? <LotRows lots={r.lots} selectedId={selectedId} onOpen={setSelectedId} /> : null)}
        sort={sort}
        onSortChange={s => setSortParam(serializeSort(s))}
        empty={filtering
          ? {
            title: 'No shipments match',
            description: 'Try another status or search term.',
            action: <Button variant="secondary" onClick={() => { setSearch(''); setTab('all') }}>Clear filters</Button>,
          }
          : { title: 'No shipments yet', description: 'Create a shipment to start tracking it here.', action: createButton }}
      />

      <ShipmentDetailsDrawer
        shipment={selected}
        onClose={() => setSelectedId(null)}
        onEdit={s => setEditing(s)}
        onAssign={s => setAssigning(s)}
      />
      <EditShipmentModal shipment={editing} onClose={() => setEditing(null)} />
      <AssignVehicleModal shipment={assigning} onClose={() => setAssigning(null)} />
    </Page>
  )
}
