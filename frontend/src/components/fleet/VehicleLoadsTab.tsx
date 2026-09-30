import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Package, Route as RouteIcon } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { Card, CardBody, CardHeader, DataTable, SectionHeader, StatusPill, buttonClasses, type Column } from '@/components/ui'
import { formatDate, formatDateTime, formatKg, formatKm } from '@/utils/display'
import { OnBoardCard } from '@/components/cargo/OnBoardList'
import LoadBar from './LoadBar'
import type { Vehicle } from './types'

interface RouteRow {
  id: string
  status: string
  total_distance_km: number | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

interface ManifestRow {
  id: string
  pickup_location: string | null
  drop_location: string | null
  capacity_kg: number | null
  status: string
  created_at: string
}

/** What the vehicle carries now, the routes it has been given and the vendor loads (cargo manifests) assigned to it. */
export default function VehicleLoadsTab({ vehicle }: { vehicle: Vehicle }) {
  const routes = useQuery<RouteRow[]>({
    queryKey: ['vehicles', 'loads-routes', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select('id, status, total_distance_km, started_at, completed_at, created_at')
        .eq('vehicle_id', vehicle.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as RouteRow[]
    },
    refetchInterval: 60_000,
  })
  const manifests = useQuery<ManifestRow[]>({
    queryKey: ['vehicles', 'loads-manifests', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cargo_manifest')
        .select('id, pickup_location, drop_location, capacity_kg, status, created_at')
        .eq('vehicle_id', vehicle.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as ManifestRow[]
    },
    refetchInterval: 60_000,
  })

  const routeColumns: Column<RouteRow>[] = [
    { key: 'created', header: 'Created', sortValue: r => r.created_at, cell: r => formatDateTime(r.created_at) },
    { key: 'status', header: 'Status', sortValue: r => r.status, cell: r => <StatusPill status={r.status} kind="route" /> },
    { key: 'distance', header: 'Distance', hideBelow: 'md', sortValue: r => r.total_distance_km ?? 0, cell: r => (r.total_distance_km != null ? formatKm(r.total_distance_km) : '—') },
    { key: 'done', header: 'Finished', hideBelow: 'md', cell: r => (r.completed_at ? formatDate(r.completed_at) : r.started_at ? 'Started, not finished' : '—') },
    { key: 'open', header: <span className="sr-only">Open</span>, align: 'right', cell: r => <Link to={`/routes/${r.id}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Open</Link> },
  ]
  const manifestColumns: Column<ManifestRow>[] = [
    { key: 'leg', header: 'Pickup to drop', cell: m => <span className="break-words">{m.pickup_location ?? '—'} <span className="text-muted">to</span> {m.drop_location ?? '—'}</span> },
    { key: 'weight', header: 'Load', sortValue: m => m.capacity_kg ?? 0, cell: m => (m.capacity_kg != null ? formatKg(m.capacity_kg) : '—') },
    { key: 'status', header: 'Status', sortValue: m => m.status, cell: m => <StatusPill status={m.status} /> },
    { key: 'created', header: 'Assigned', hideBelow: 'md', sortValue: m => m.created_at, cell: m => formatDate(m.created_at) },
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="On board now" description="Weight against capacity. Capacity and container size are on the Overview." />
        <CardBody>
          <LoadBar vehicle={vehicle} />
        </CardBody>
      </Card>
      <OnBoardCard vehicleId={vehicle.id} />
      <section className="space-y-3" aria-label="Routes">
        <SectionHeader title="Routes" description="Routes given to this vehicle, newest first" />
        <DataTable
          caption={`Routes of ${vehicle.plate_number}`}
          columns={routeColumns}
          rows={routes.data ?? []}
          rowKey={r => r.id}
          loading={routes.isLoading}
          error={routes.isError ? 'We could not load the routes.' : undefined}
          onRetry={() => routes.refetch()}
          initialSort={{ key: 'created', direction: 'desc' }}
          pageSize={8}
          empty={{ icon: <RouteIcon size={22} />, title: 'No routes yet', description: 'Routes assigned to this vehicle are listed here.' }}
        />
      </section>
      <section className="space-y-3" aria-label="Vendor loads">
        <SectionHeader title="Vendor loads" description="Cargo manifests a vendor has assigned to this vehicle" />
        <DataTable
          caption={`Vendor loads of ${vehicle.plate_number}`}
          columns={manifestColumns}
          rows={manifests.data ?? []}
          rowKey={m => m.id}
          loading={manifests.isLoading}
          error={manifests.isError ? 'We could not load the vendor loads.' : undefined}
          onRetry={() => manifests.refetch()}
          initialSort={{ key: 'created', direction: 'desc' }}
          pageSize={8}
          empty={{ icon: <Package size={22} />, title: 'No vendor loads', description: 'Loads a vendor books on this vehicle appear here once assigned.' }}
        />
      </section>
    </div>
  )
}
