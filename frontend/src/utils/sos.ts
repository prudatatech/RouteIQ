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

export function sosTypeLabel(type: string | null | undefined): string {
  if (!type) return SOS_TYPE_LABELS.panic_button
  return SOS_TYPE_LABELS[type] ?? humanize(type)
}
