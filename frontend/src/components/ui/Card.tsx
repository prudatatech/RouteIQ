import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds the standard inner padding. Leave off when the card holds a table or map edge to edge. */
  padded?: boolean
  /** @deprecated Ignored; kept so pages that still pass it compile until they migrate. */
  glass?: boolean
}

export function Card({ children, className, padded = false, glass: _glass, ...props }: CardProps) {
  return (
    <div className={clsx('rounded-card border border-border bg-surface', padded && 'p-4 sm:p-6', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ title, description, actions, subtitle, action, className }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** @deprecated Use description. */
  subtitle?: ReactNode
  /** @deprecated Use actions. */
  action?: ReactNode
  className?: string
}) {
  description ??= subtitle
  actions ??= action
  return (
    <div className={clsx('flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6', className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('px-4 py-4 sm:px-6', className)}>{children}</div>
}

/** Label/value pairs, for record details in drawers and cards. */
export function DetailList({ items, columns = 2, className }: {
  items: { label: ReactNode; value: ReactNode }[]
  columns?: 1 | 2 | 3
  className?: string
}) {
  return (
    <dl className={clsx(
      'grid gap-x-6 gap-y-4',
      columns === 2 && 'sm:grid-cols-2',
      columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
      className,
    )}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-text">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
