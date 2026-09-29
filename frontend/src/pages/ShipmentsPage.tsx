import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus } from 'lucide-react'
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

const TAB_IDS = ['all', ...SHIPMENT_STATUSES] as const
type TabId = (typeof TAB_IDS)[number]

function PlaceCell({ name, address }: { name?: string | null; address?: string | null }) {
  if (!name && !address) return <span className="text-muted">—</span>
  return (
    <div className="min-w-0 max-w-44 2xl:max-w-64">
      <div className="truncate">{name || address}</div>
      {name && address && address !== name && <div className="truncate text-xs text-muted">{address}</div>}
    </div>
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
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: shipments = [], isLoading, isError, refetch } = useQuery<ShipmentRow[]>({
    queryKey: ['shipments'],
    queryFn: () => shipmentsAPI.list() as Promise<ShipmentRow[]>,
  })

  // Opened from a link elsewhere (e.g. global search or a notification): ?open=<id>
  // selects the matching row and opens its drawer, then the param is dropped from the URL.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || isLoading) return
    if (shipments.some(s => s.id === openId)) setSelectedId(openId)
    setSearchParams(params => { params.delete('open'); return params }, { replace: true })
  }, [searchParams, setSearchParams, shipments, isLoading])

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

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = { all: rows.length }
    for (const s of rows) if (s.status) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1
    return byStatus
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(s => {
      if (tab !== 'all' && s.status !== tab) return false
      if (!q) return true
      const dest = destinationOf(s)
      return [s.tracking_id, s.origin_name, s.origin_address, dest?.name, dest?.address, s.driver_name, plateOf(s)]
        .some(v => v?.toLowerCase().includes(q))
    })
  }, [rows, tab, search])

  // Look the selection up in the live list so the drawer shows realtime changes.
  const selected = selectedId ? rows.find(s => s.id === selectedId) ?? null : null

  const columns: Column<ShipmentRow>[] = [
    {
      key: 'shipment',
      header: 'Shipment',
      sortValue: s => (s.created_at ? new Date(s.created_at).getTime() : null),
      cell: s => (
        <div className="whitespace-nowrap">
          <div className="font-mono font-medium">{s.tracking_id}</div>
          {s.created_at && <div className="text-xs font-normal text-muted">{formatDate(s.created_at)}</div>}
          {pickupDateOf(s) && <div className="text-xs font-normal text-muted">Pickup {formatDate(pickupDateOf(s))}</div>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: s => shipmentStatusLabel(s.status),
      cell: s => {
        const urgent = s.priority === 'high' || s.priority === 'critical'
        return (
          <div className="flex flex-col items-end gap-1 md:items-start">
            <StatusPill status={s.status}>{shipmentStatusLabel(s.status)}</StatusPill>
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
    const csv = toCsv(filtered.map(s => {
      const dest = destinationOf(s)
      return {
        tracking_id: s.tracking_id,
        status: shipmentStatusLabel(s.status),
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
          tabs={TAB_IDS.map(id => ({
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
