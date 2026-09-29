import type { ReactNode } from 'react'
import clsx from 'clsx'
import { StatusPill } from './StatusPill'
import { statusToLabel, statusToTone, toneClasses, type Tone } from './status'
import { Stat } from './States'

// ---------------------------------------------------------------------------
// Legacy components. Pages still using these are being moved to StatusPill and
// Stat; remove once nothing imports them (Phase 7).
// ---------------------------------------------------------------------------

const legacyBadgeTone: Record<'green' | 'orange' | 'blue' | 'warn' | 'muted', Tone> = {
  green: 'success',
  orange: 'warning',
  blue: 'info',
  warn: 'warning',
  muted: 'neutral',
}

/** @deprecated Use StatusPill. */
export function Badge({ children, variant = 'green', className }: {
  children: ReactNode
  variant?: keyof typeof legacyBadgeTone
  className?: string
}) {
  return <StatusPill tone={legacyBadgeTone[variant]} dot={false} className={className}>{children}</StatusPill>
}

/** @deprecated Use StatusPill. Coloured dot with the status announced to screen readers. */
export function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center">
      <span aria-hidden="true" className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', toneClasses[statusToTone(status)].dot)} />
      <span className="sr-only">{statusToLabel(status)}</span>
    </span>
  )
}

/** @deprecated Use Stat. */
export function KPICard({ label, value, icon }: {
  label: string; value: string; delta?: string; deltaUp?: boolean
  icon: ReactNode; color?: string; progress?: number
}) {
  return <Stat label={label} value={value} icon={icon} />
}
