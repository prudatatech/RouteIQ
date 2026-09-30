import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Building2, Package } from 'lucide-react'
import { Card, CardHeader, DataTable, EmptyState, ErrorState, Skeleton, StatusPill, useUrlState, type Column } from '@/components/ui'
import { formatDateTime, formatKg } from '@/utils/display'
import { cargoKeys, hubsAPI, type HubInventoryRow, type HubSummary } from '@/services/cargo'
import { ConsignmentLink } from './CargoBits'
import { useNow } from './useNow'
import { consignmentCode, exceptionTypeLabel, hubAgeing } from './logic'

const rowKey = (r: HubInventoryRow) => r.shipment_id ?? r.manifest_id ?? r.tracking_id ?? ''

function HubCard({ hub, selected, now, onSelect }: { hub: HubSummary; selected: boolean; now: number; onSelect: () => void }) {
  const age = hubAgeing(hub.oldest_since, now)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'w-full rounded-card border bg-surface p-4 text-left transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
        selected ? 'border-brand ring-2 ring-brand/20' : 'border-border',
      )}
    >
      <p className="font-medium text-text break-words">{hub.name}</p>
      {hub.address && <p className="mt-0.5 text-sm text-muted break-words">{hub.address}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-xs text-muted">Consignments</dt><dd className="tabular font-medium">{hub.consignments}</dd></div>
        <div><dt className="text-xs text-muted">Pieces</dt><dd className="tabular font-medium">{hub.pieces}</dd></div>
        <div>
          <dt className="text-xs text-muted">Oldest waiting</dt>
          <dd>{hub.oldest_since ? <StatusPill tone={age.tone} dot={false}>{age.label}</StatusPill> : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Open exceptions</dt>
          <dd className="tabular font-medium">{hub.open_exceptions ?? 0}</dd>
        </div>
      </dl>
    </button>
  )
}

function Inventory({ hub, now }: { hub: HubSummary; now: number }) {
  const inv = useQuery({ queryKey: cargoKeys.hubInventory(hub.id), queryFn: () => hubsAPI.inventory(hub.id), refetchInterval: 60_000 })

  const columns: Column<HubInventoryRow>[] = [
    { key: 'consignment', header: 'Consignment', sortValue: r => consignmentCode(r), cell: r => <ConsignmentLink c={r} /> },
    { key: 'status', header: 'Status', hideBelow: 'md', sortValue: r => r.status, cell: r => <StatusPill status={r.status} kind="cargo" /> },
    { key: 'pieces', header: 'Pieces', align: 'right', sortValue: r => r.pieces ?? 0, cell: r => <span className="tabular">{r.pieces ?? '—'}</span> },
    { key: 'weight', header: 'Weight', align: 'right', hideBelow: 'lg', sortValue: r => r.weight_kg ?? 0, cell: r => (r.weight_kg != null ? formatKg(r.weight_kg) : '—') },
    { key: 'destination', header: 'Destination', hideBelow: 'lg', sortValue: r => r.destination ?? '', cell: r => <span className="break-words">{r.destination ?? '—'}</span> },
    {
      key: 'ageing', header: 'At hub for', sortValue: r => hubAgeing(r.since, now).hours,
      cell: r => { const a = hubAgeing(r.since, now); return <StatusPill tone={a.tone} dot={false}>{a.label}</StatusPill> },
    },
    {
      key: 'next', header: 'Next leg', hideBelow: 'md',
      cell: r => {
        const leg = r.next_leg
        if (!leg || (!leg.label && !leg.vehicle_plate && !leg.scheduled_for)) return <span className="text-muted">Not planned</span>
        return (
          <span className="break-words">
            {[leg.label, leg.vehicle_plate].filter(Boolean).join(' · ')}
            {leg.scheduled_for && <span className="block text-xs text-muted">{formatDateTime(leg.scheduled_for)}</span>}
          </span>
        )
      },
    },
    {
      key: 'exceptions', header: 'Open exceptions',
      cell: r => (r.open_exceptions?.length
        ? (
          <span className="flex flex-col gap-0.5">
            {r.open_exceptions.map(x => (
              <Link key={x.id} to={`/cargo/exceptions/${x.id}`} className="text-brand hover:underline">
                <span className="font-mono">{x.code}</span> · {exceptionTypeLabel(x.type)}
              </Link>
            ))}
          </span>
        )
        : <span className="text-muted">None</span>),
    },
  ]

  return (
    <DataTable
      caption={`Consignments at ${hub.name}`}
      columns={columns}
      rows={inv.data ?? []}
      rowKey={rowKey}
      loading={inv.isLoading}
      error={inv.isError ? 'We could not load the consignments at this hub.' : undefined}
      onRetry={() => inv.refetch()}
      initialSort={{ key: 'ageing', direction: 'desc' }}
      pageSize={10}
      empty={{ icon: <Package size={22} />, title: 'Nothing at this hub', description: 'Consignments appear here after they are checked in at the hub.' }}
    />
  )
}

/** Depots with what is waiting in them, and the selected depot's consignments sorted by how long they have waited. */
export default function HubsTab() {
  const now = useNow(60_000)
  const [hubId, setHubId] = useUrlState('hub')
  const hubs = useQuery({ queryKey: cargoKeys.hubs, queryFn: hubsAPI.list, refetchInterval: 60_000 })
  const list = useMemo(() => hubs.data ?? [], [hubs.data])
  const selected = list.find(h => h.id === hubId)

  useEffect(() => {
    if (!selected && list.length > 0) setHubId(list[0].id)
  }, [selected, list, setHubId])

  if (hubs.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-36" />)}</div>
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (hubs.isError) return <Card><ErrorState title="We could not load the hubs" onRetry={() => hubs.refetch()} /></Card>
  if (list.length === 0) {
    return <Card><EmptyState icon={<Building2 size={22} />} title="No hubs yet" description="Depots that hold cargo between legs appear here with what is waiting in them." /></Card>
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map(h => <HubCard key={h.id} hub={h} now={now} selected={h.id === selected?.id} onSelect={() => setHubId(h.id)} />)}
      </div>
      {selected && (
        <section className="space-y-3" aria-label={`Consignments at ${selected.name}`}>
          <Card><CardHeader title={selected.name} description="Consignments waiting here, longest first. Over a day is amber, over three days is red." /></Card>
          <Inventory hub={selected} now={now} />
        </section>
      )}
    </div>
  )
}
