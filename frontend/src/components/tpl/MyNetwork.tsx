import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { Card, SectionHeader, Skeleton, Stat, StatusPill } from '@/components/ui'
import { networkAPI, tplNetworkAPI, vehiclesAPI } from '@/services/api'
import { formatPercent } from './stats'

export interface NetworkPartner { id: string; company_name: string; status: string }

function PartnerCard({ partner }: { partner: NetworkPartner }) {
  const fleet = useQuery({ queryKey: ['network-fleet', partner.id], queryFn: () => networkAPI.fleet(partner.id), retry: false })
  const stats = useQuery({ queryKey: ['tpl-partner-stats'], queryFn: tplNetworkAPI.allStats, staleTime: 30_000 })
  const f = fleet.data
  const s = stats.data?.[partner.id]
  const classes = f ? Object.entries(f.by_class).filter(([, n]) => n > 0) : []

  return (
    <Card padded className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/3pl-partners/${partner.id}`} className="min-w-0 truncate text-base font-semibold text-text hover:underline">{partner.company_name}</Link>
        <Link to={`/3pl-partners/${partner.id}`} aria-label={`Open ${partner.company_name}`} className="text-muted hover:text-text"><ArrowRight size={16} /></Link>
      </div>
      {fleet.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : f ? (
        <>
          <p className="text-sm text-text">
            {f.vehicles_total.toLocaleString('en-IN')} {f.vehicles_total === 1 ? 'vehicle' : 'vehicles'}
            <span className="text-muted">
              {` · ${f.available.toLocaleString('en-IN')} free · ${f.on_trip.toLocaleString('en-IN')} on a trip · ${f.maintenance.toLocaleString('en-IN')} in the workshop`}
            </span>
          </p>
          {classes.length > 0 && <p className="text-xs text-muted">{classes.map(([k, n]) => `${n} ${k}`).join(', ')}</p>}
          <div className="flex flex-wrap gap-1.5">
            <StatusPill tone="success" dot={false}>{f.docs_ok.toLocaleString('en-IN')} documents in order</StatusPill>
            {f.docs_expiring > 0 && <StatusPill tone="warning" dot={false}>{f.docs_expiring.toLocaleString('en-IN')} expiring soon</StatusPill>}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">No fleet to show yet.</p>
      )}
      {s && (
        <p className="border-t border-border pt-2 text-xs text-muted">
          {`${s.orders_active.toLocaleString('en-IN')} active · ${s.orders_completed.toLocaleString('en-IN')} delivered · accepts ${formatPercent(s.acceptance_rate)}`}
        </p>
      )}
    </Card>
  )
}

/** My network: the company's own fleet counts, then a card per active 3PL partner with their fleet and how they perform. */
export default function MyNetwork({ partners }: { partners: NetworkPartner[] }) {
  const own = useQuery({ queryKey: ['fleet-summary'], queryFn: vehiclesAPI.summary, retry: false })
  const o = own.data as { total: number; active: number; idle: number; maintenance: number } | undefined
  const active = partners.filter(p => p.status === 'active')

  return (
    <section className="space-y-3" aria-labelledby="my-network">
      <SectionHeader title={<span id="my-network">My network</span>} description="Your own fleet and the partners who carry loads for you." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Own vehicles" value={o ? o.total.toLocaleString('en-IN') : '—'} loading={own.isLoading} />
        <Stat label="Free now" value={o ? o.idle.toLocaleString('en-IN') : '—'} loading={own.isLoading} tone="success" />
        <Stat label="On a trip" value={o ? o.active.toLocaleString('en-IN') : '—'} loading={own.isLoading} />
        <Stat label="In the workshop" value={o ? o.maintenance.toLocaleString('en-IN') : '—'} loading={own.isLoading} tone={o && o.maintenance > 0 ? 'warning' : 'default'} />
      </div>
      {active.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {active.map(p => <PartnerCard key={p.id} partner={p} />)}
        </div>
      )}
    </section>
  )
}
