import { ShieldAlert } from 'lucide-react'
import { StatusPill } from '@/components/ui'
import type { SosCounts } from '@/utils/sos'

/**
 * How often a vehicle has raised an SOS: the total, how many in the last 30 days, and a red pill
 * when any are still open. Nothing to show (a dash) for a vehicle that never raised one.
 */
export default function SosCountBadge({ counts, loading }: { counts?: SosCounts; loading?: boolean }) {
  if (!counts || counts.total === 0) return <span className="text-muted">{loading ? '…' : 'None'}</span>
  return (
    <div className="space-y-1">
      <p className="inline-flex items-center gap-1.5 text-sm text-text">
        <ShieldAlert size={14} className="text-muted" aria-hidden="true" />
        <span className="font-semibold tabular">{counts.total}</span>
        <span className="text-muted">total</span>
      </p>
      <p className="text-xs text-muted tabular">{counts.last_30_days} in the last 30 days</p>
      {counts.open > 0 && <StatusPill tone="danger">{counts.open} open</StatusPill>}
    </div>
  )
}
