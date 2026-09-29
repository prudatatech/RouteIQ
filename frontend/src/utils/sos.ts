import { humanize } from '@/components/ui/status'

/** Names for SOS alert types, including the older ones still stored on past alerts. */
const SOS_TYPE_LABELS: Record<string, string> = {
  panic_button: 'Panic button',
  accident: 'Accident',
  accident_serious: 'Serious accident',
  accident_non_serious: 'Accident',
  breakdown: 'Breakdown',
  vehicle_damage: 'Vehicle damage',
  medical: 'Medical',
  theft: 'Theft',
  other: 'Other emergency',
}

/** What the driver said about injuries; null when they did not say. */
export function sosSeverityLabel(severity: string | null | undefined): string | null {
  if (severity === 'serious') return 'Injuries reported'
  if (severity === 'minor') return 'No injuries reported'
  return null
}

export function sosTypeLabel(type: string | null | undefined): string {
  if (!type) return SOS_TYPE_LABELS.panic_button
  return SOS_TYPE_LABELS[type] ?? humanize(type)
}
