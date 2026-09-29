import { formatDate } from '@/utils/display'
import type { MaintenanceJob } from './types'

/** "In maintenance since 12 Sep 2026, expected back 20 Sep 2026", with "overdue" in red when it is late. */
export function MaintenanceNote({ job, className }: { job: MaintenanceJob; className?: string }) {
  return (
    <p className={className ?? 'text-xs text-muted'}>
      In maintenance since {formatDate(job.opened_at)}
      {job.expected_return_date ? `, expected back ${formatDate(job.expected_return_date)}` : ''}
      {job.is_overdue && (
        <span className="font-medium text-danger">
          {' '}· overdue by {job.days_overdue} {job.days_overdue === 1 ? 'day' : 'days'}
        </span>
      )}
    </p>
  )
}
