import clsx from 'clsx'
import type { ReactNode } from 'react'
import { statusToLabel, statusToTone, toneClasses, type StatusKind, type Tone } from './status'

/**
 * Status label with a coloured background. Always shows text, so the meaning never
 * depends on colour alone. Pass `status` for database values, or `tone` + children
 * for anything else.
 */
export function StatusPill({ status, kind, tone, children, dot = true, className }: {
  status?: string | null
  /** Which kind of record the status is on, for values that mean different things on different records. */
  kind?: StatusKind
  tone?: Tone
  children?: ReactNode
  dot?: boolean
  className?: string
}) {
  const resolved = tone ?? statusToTone(status, kind)
  const t = toneClasses[resolved]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', t.pill, className)}>
      {dot && <span aria-hidden="true" className={clsx('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {children ?? statusToLabel(status, kind)}
    </span>
  )
}
