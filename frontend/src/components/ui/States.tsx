import type { ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Inbox } from 'lucide-react'
import { Button } from './Button'

/** Shown when a list or area has nothing in it: what is missing, and one way forward. */
export function EmptyState({ icon, title, description, action, compact, className }: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  /** Smaller padding for use inside cards and table bodies. */
  compact?: boolean
  className?: string
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center text-center', compact ? 'py-8 px-4' : 'py-16 px-6', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-soft text-muted" aria-hidden="true">
        {icon ?? <Inbox size={22} />}
      </div>
      <p className="text-base font-medium text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Shown when loading failed. Offer a retry whenever the action can be repeated. */
export function ErrorState({ title = 'Something went wrong', description, onRetry, compact, className }: {
  title?: ReactNode
  description?: ReactNode
  onRetry?: () => void
  compact?: boolean
  className?: string
}) {
  return (
    <div role="alert" className={clsx('flex flex-col items-center justify-center text-center', compact ? 'py-8 px-4' : 'py-16 px-6', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger" aria-hidden="true">
        <AlertTriangle size={22} />
      </div>
      <p className="text-base font-medium text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {onRetry && <Button variant="secondary" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

/** Inline message banner for page-level notices. */
export function Alert({ tone = 'info', title, children, action, className }: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const tones = {
    info: 'border-info/30 bg-info-soft',
    success: 'border-success/30 bg-success-soft',
    warning: 'border-warning/30 bg-warning-soft',
    danger: 'border-danger/30 bg-danger-soft',
  }
  const titleTones = { info: 'text-info', success: 'text-success', warning: 'text-warning', danger: 'text-danger' }
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={clsx('flex flex-col gap-3 rounded-control border px-4 py-3 sm:flex-row sm:items-center sm:justify-between', tones[tone], className)}
    >
      <div className="text-sm">
        {title && <p className={clsx('font-medium', titleTones[tone])}>{title}</p>}
        {children && <div className="text-text">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** Grey placeholder block shown while content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx('animate-pulse rounded-control bg-neutral-soft', className)} />
}

/** A number with a label, for summary rows at the top of a page. */
export function Stat({ label, value, hint, icon, tone, loading, className }: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger'
  loading?: boolean
  className?: string
}) {
  const valueTone = { default: 'text-text', success: 'text-success', warning: 'text-warning', danger: 'text-danger' }[tone ?? 'default']
  return (
    <div className={clsx('min-w-0 rounded-card border border-border bg-surface p-4 sm:p-5', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {icon && <span className="text-muted" aria-hidden="true">{icon}</span>}
      </div>
      {loading
        ? <Skeleton className="mt-2 h-8 w-20" />
        : (
          // A long text value (a plate, a name) is smaller on a phone and cut with an ellipsis rather than pushing the page wider
          <p
            title={typeof value === 'string' ? value : undefined}
            className={clsx('mt-1 truncate font-semibold tabular', typeof value === 'string' && value.length > 8 ? 'text-lg sm:text-2xl' : 'text-2xl', valueTone)}
          >
            {value}
          </p>
        )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}
