import { StatusPill } from '@/components/ui'
import { licenceWarning } from './docs'
import type { DriverLicenceStatus } from './types'

/**
 * Warning next to a vehicle whose driver's licence is expired, expiring or missing. It never blocks
 * the choice: when the server is set to block, it refuses the assignment and says why.
 */
export function DriverLicenceBadge({ status, className }: { status: DriverLicenceStatus; className?: string }) {
  const warning = licenceWarning(status)
  if (!warning) return null
  return <StatusPill tone={warning.tone} className={className}>{warning.text}</StatusPill>
}
