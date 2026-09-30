import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Package, Star } from 'lucide-react'
import { PageHeader, SectionHeader, Stat } from '@/components/ui'
import { tplNetworkAPI } from '@/services/api'
import { TplEarningsTab } from '@/components/tpl/TplEarningsTab'
import { formatPercent, formatRating } from '@/components/tpl/stats'
import { usePortal } from './portalContext'

/** Earnings: what the partner is owed and has been paid, by month, and how their work is going. */
export default function EarningsPage() {
  const { partner } = usePortal()
  const stats = useQuery({ queryKey: ['tpl-my-stats'], queryFn: tplNetworkAPI.myStats, retry: false })
  const s = stats.data

  return (
    <div className="space-y-8">
      <PageHeader title="Earnings" description="The amounts agreed on the loads you accepted, and when dispatch pays them." />
      <TplEarningsTab />

      <section className="space-y-3">
        <SectionHeader title="How your work is going" description="What dispatch sees when it chooses a partner for a load." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Active orders"
            value={s ? s.orders_active.toLocaleString('en-IN') : '—'}
            icon={<Package size={16} />}
            hint={s ? `${s.orders_completed.toLocaleString('en-IN')} delivered so far` : undefined}
            loading={stats.isLoading}
          />
          <Stat
            label="Acceptance rate"
            value={formatPercent(s?.acceptance_rate)}
            icon={<CheckCircle2 size={16} />}
            hint={s && s.offers_accepted + s.offers_declined > 0
              ? `${s.offers_accepted.toLocaleString('en-IN')} accepted of ${(s.offers_accepted + s.offers_declined).toLocaleString('en-IN')} answered`
              : 'Shown after you answer an offer'}
            loading={stats.isLoading}
          />
          <Stat
            label="Late deliveries"
            value={s ? s.sla_breaches.toLocaleString('en-IN') : '—'}
            icon={<AlertTriangle size={16} />}
            tone={s && s.sla_breaches > 0 ? 'warning' : 'default'}
            hint={`Delivered after the due time. Your SLA commitment: ${partner.sla_commitment || 'not set'}`}
            loading={stats.isLoading}
          />
          <Stat
            label="Rating from dispatch"
            value={formatRating(s?.rating_avg)}
            icon={<Star size={16} />}
            hint={s && s.rating_count > 0 ? `${s.rating_count.toLocaleString('en-IN')} rated ${s.rating_count === 1 ? 'order' : 'orders'}` : 'Shown after dispatch rates a delivery'}
            loading={stats.isLoading}
          />
        </div>
      </section>
    </div>
  )
}
