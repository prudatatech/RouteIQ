import type { Tone } from '@/components/ui/status'

/**
 * The same three warnings worded for the vehicle list in Assign vehicle, where the vehicle is still
 * counted as able to take the load: a licence problem there is a heads-up, not a verdict.
 */
export const LICENCE_NOTE: Record<'expired' | 'expiring' | 'missing', { text: string; tone: Tone }> = {
  expired: { text: 'Licence expired', tone: 'danger' },
  expiring: { text: 'Licence expiring soon', tone: 'warning' },
  missing: { text: 'Licence not on file', tone: 'warning' },
}

/** The note for a driver's licence status, or null when the licence is fine or unknown. */
export function licenceNote(status: string | null | undefined) {
  return status === 'expired' || status === 'expiring' || status === 'missing' ? LICENCE_NOTE[status] : null
}
