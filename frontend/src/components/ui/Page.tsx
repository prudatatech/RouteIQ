import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft } from 'lucide-react'

/**
 * Wraps a page's content. The app shell already sets the content width and page
 * padding; this adds the standard spacing between sections, and `form` narrows
 * single-form pages.
 */
export function Page({ children, width = 'content', className }: {
  children: ReactNode
  width?: 'content' | 'form'
  className?: string
}) {
  return <div className={clsx('space-y-6', width === 'form' && 'mx-auto max-w-form', className)}>{children}</div>
}

/** Title row at the top of every page. Filters or tabs go in `children`, below the title. */
export function PageHeader({ title, description, actions, back, children, className }: {
  title: ReactNode
  description?: ReactNode
  /** Page-level actions, primary action last. */
  actions?: ReactNode
  back?: { to: string; label: string }
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={clsx('space-y-4', className)}>
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft size={16} aria-hidden="true" /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-text sm:text-3xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted sm:text-base">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

/** Heading for a block of content inside a page. */
export function SectionHeader({ title, description, actions, className }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
