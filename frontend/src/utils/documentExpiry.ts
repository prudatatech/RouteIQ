/** How soon an expiry counts as "expiring soon" and gets a warning badge. */
const EXPIRING_SOON_DAYS = 30

export interface ExpiryStatus {
  tone: 'danger' | 'warning'
  label: string
  daysLeft: number
}

/**
 * Badge info for a vehicle document's expiry date, or null when it's not
 * expired and not expiring within {@link EXPIRING_SOON_DAYS} days (or has no
 * expiry on file). Shared by the vehicle wizard and the Fleet detail drawer.
 */
export function expiryStatus(dateStr: string | null | undefined): ExpiryStatus | null {
  if (!dateStr) return null
  const expiry = new Date(dateStr)
  if (Number.isNaN(expiry.getTime())) return null
  const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000)
  if (daysLeft < 0) return { tone: 'danger', label: 'Expired', daysLeft }
  if (daysLeft <= EXPIRING_SOON_DAYS) return { tone: 'warning', label: `Expires in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`, daysLeft }
  return null
}
