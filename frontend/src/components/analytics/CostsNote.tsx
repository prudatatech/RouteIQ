import { Link } from 'react-router-dom'
import { Alert, buttonClasses } from '@/components/ui'
import type { FinanceSummary } from './useFinanceSummary'

/** Says so next to profit when its costs are incomplete (no fuel price, or completed trips with no cost recorded). */
export default function CostsNote({ status }: { status: FinanceSummary['costs_status'] | undefined }) {
  if (!status || status.complete || !status.note) return null
  return (
    <Alert
      tone="warning"
      title={status.note}
      action={(
        <span className="flex flex-wrap gap-2">
          {status.fuel_price_missing && <Link to="/admin/settings" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Set fuel price in Settings</Link>}
          {status.trips_without_costs > 0 && <Link to="/money?tab=expenses" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Add expenses</Link>}
        </span>
      )}
    >
      Net profit and profit per truck below leave those costs out, so they are higher than the real profit.
    </Alert>
  )
}
