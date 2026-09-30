import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Button, DataTable, PageHeader, SearchInput, buttonClasses, type Column } from '@/components/ui'
import { corridorRateText } from '@/components/tpl/constants'
import { usePortal, vehicleList, type PortalCorridor } from './portalContext'

/** Lanes: the corridors the partner is approved to carry on, with their rates. Changes go through Settings for approval. */
export default function LanesPage() {
  const { id } = useParams()
  const { partner, corridors } = usePortal()
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return corridors
    return corridors.filter(c => [c.corridor_name, vehicleList(c.vehicle_types).join(', ')].some(v => v.toLowerCase().includes(q)))
  }, [corridors, search])

  const columns: Column<PortalCorridor>[] = [
    { key: 'name', header: 'Lane', cell: c => <span className="font-medium">{c.corridor_name}</span>, sortValue: c => c.corridor_name },
    {
      key: 'vehicles', header: 'Vehicle types', hideBelow: 'md', cell: c => (
        <div className="flex flex-wrap gap-1">
          {vehicleList(c.vehicle_types).map(v => (
            <span key={v} className="rounded-full bg-neutral-soft px-2 py-0.5 text-xs text-neutral">{v}</span>
          ))}
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', hideBelow: 'md', cell: c => <span>P{c.priority ?? '—'}</span>, sortValue: c => c.priority ?? null },
    { key: 'rate', header: 'Rate', align: 'right', cell: c => <span className="tabular">{corridorRateText(c)}</span>, sortValue: c => (c.rate_amount != null ? Number(c.rate_amount) : null) },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lanes"
        description="The trips dispatch can offer you loads on."
        actions={<Link to={`/3pl-portal/${id}/settings`} className={buttonClasses({ variant: 'secondary' })}>Request changes</Link>}
      />
      {partner.pending_updates && (
        <Alert tone="warning" title="A change to your lanes or terms is waiting for approval">
          These are your current lanes. The change you asked for applies once dispatch approves it.
        </Alert>
      )}
      <div className="space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by lane or vehicle type" className="sm:max-w-xs" />
        <DataTable
          caption="Approved lanes"
          columns={columns}
          rows={rows}
          rowKey={c => c.id}
          empty={search
            ? { title: 'No lanes match your search' }
            : {
                title: 'No lanes yet',
                description: 'Add the trips you serve so dispatch can offer you loads.',
                action: <Link to={`/3pl-portal/${id}/settings`}><Button>Add lanes</Button></Link>,
              }}
        />
      </div>
    </div>
  )
}
