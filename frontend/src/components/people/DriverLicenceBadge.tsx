import { StatusPill } from '@/components/ui'
import { LICENCE_NOTE, licenceWarning } from './docs'
import type { DriverLicenceStatus } from './types'

/**
 * Warning next to a vehicle whose driver's licence is expired, expiring or missing. It never blocks
 * the choice: when the server is set to block, it refuses the assignment and says why.
 */
export function DriverLicenceBadge({ status, variant = 'status', className }: {
  status: DriverLicenceStatus
  /** `choice` words it as a heads-up for a vehicle that can still be chosen (Assign vehicle, the wizard). */
  variant?: 'status' | 'choice'
  className?: string
}) {
  const warning = licenceWarning(status)
  if (!warning) return null
  if (variant === 'choice') {
    const note = LICENCE_NOTE[status as 'expired' | 'expiring' | 'missing']
    return <StatusPill tone={note.tone} className={className} title="You can still assign this vehicle unless Settings blocks it.">{note.text}</StatusPill>
  }
  return <StatusPill tone={warning.tone} className={className}>{warning.text}</StatusPill>
}
