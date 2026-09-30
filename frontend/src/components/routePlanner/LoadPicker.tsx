import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flag, Package } from 'lucide-react'
import { Button, EmptyState, ErrorState, LoadingState, Modal, SearchInput, StatusPill } from '@/components/ui'
import { routingAPI, type OpenLoad } from '@/services/routing'
import { formatKg } from '@/utils/display'
import { routingErrorMessage, stopsFromLoad, type PlannerStop } from '@/utils/routePlanner'

/**
 * Pick pickup and drop points from open shipments and vendor loads. Adding a whole load puts its
 * pickup first, so the plan can keep pickup before drop.
 */
export default function LoadPicker({ open, onClose, onAdd, added, room }: {
  open: boolean
  onClose: () => void
  onAdd: (stops: PlannerStop[]) => void
  /** Ids of loads that already have stops in the plan. */
  added: ReadonlySet<string>
  /** How many more stops fit in the plan. */
  room: number
}) {
  const [search, setSearch] = useState('')
  const { data: loads = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['routing', 'open-loads'],
    queryFn: routingAPI.openLoads,
    enabled: open,
    staleTime: 30_000,
  })

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return loads
    return loads.filter(l => [l.reference, l.pickup?.name, l.pickup?.address, ...l.drops.flatMap(d => [d.name, d.address])]
      .some(t => t?.toLowerCase().includes(q)))
  }, [loads, search])

  const add = (load: OpenLoad, part: 'all' | 'pickup' | 'drops') => {
    const stops = stopsFromLoad(load, part)
    onAdd(stops.slice(0, room))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add stops from shipments and loads"
      description="Open shipments waiting for a vehicle and vendor loads waiting for pickup, with their real pickup and drop points."
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <SearchInput value={search} onChange={setSearch} label="Search loads" placeholder="Search by tracking number or place" />
        {isLoading && <LoadingState label="Loading open shipments and loads" />}
        {isError && (
          <ErrorState compact title="Could not load shipments and loads" description={routingErrorMessage(error, 'Check your connection and try again.')} onRetry={() => refetch()} />
        )}
        {!isLoading && !isError && loads.length === 0 && (
          <EmptyState compact title="No open shipments or loads" description="Shipments waiting for a vehicle and vendor loads waiting for pickup will show up here." />
        )}
        {!isLoading && !isError && loads.length > 0 && shown.length === 0 && (
          <EmptyState compact title="Nothing matches that search" />
        )}
        <ul className="space-y-3">
          {shown.map(load => (
            <li key={load.id} className="rounded-card border border-border p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text">{load.reference}</span>
                  <StatusPill tone="neutral" dot={false}>{load.kind === 'load' ? 'Vendor load' : 'Shipment'}</StatusPill>
                  {load.weight_kg != null && <span className="text-xs text-muted">{formatKg(load.weight_kg)}</span>}
                  {added.has(load.id) && <StatusPill tone="success" dot={false}>In this plan</StatusPill>}
                </div>
                <Button size="sm" onClick={() => add(load, 'all')} disabled={room <= 0 || (!load.pickup && load.drops.length === 0)}>
                  Add pickup and drop
                </Button>
              </div>
              <ul className="mt-3 space-y-2">
                {load.pickup && (
                  <PointRow icon={<Package size={14} />} kind="Pickup" name={load.pickup.name} address={load.pickup.address} disabled={room <= 0} onAdd={() => add(load, 'pickup')} />
                )}
                {load.drops.map((d, i) => (
                  <PointRow key={`${d.delivery_point_id ?? 'drop'}-${i}`} icon={<Flag size={14} />} kind={load.drops.length > 1 ? `Drop ${i + 1}` : 'Drop'} name={d.name} address={d.address}
                    disabled={room <= 0}
                    onAdd={() => onAdd(stopsFromLoad({ ...load, drops: [d] }, 'drops').slice(0, room))} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {room <= 0 && <p className="text-sm text-muted">The plan already has the most stops it can hold.</p>}
      </div>
    </Modal>
  )
}

function PointRow({ icon, kind, name, address, onAdd, disabled }: {
  icon: ReactNode
  kind: string
  name: string
  address: string | null
  onAdd: () => void
  disabled: boolean
}) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text"><span className="text-muted">{kind}: </span>{name}</p>
        {address && address !== name && <p className="truncate text-xs text-muted">{address}</p>}
      </div>
      <Button variant="ghost" size="sm" onClick={onAdd} disabled={disabled} aria-label={`Add ${kind.toLowerCase()} ${name}`}>Add</Button>
    </li>
  )
}
