import { humanize, type Tone } from '@/components/ui/status'

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

/** Colour of an SOS alert's status: still active is urgent, acknowledged is being handled, resolved is done. */
export function sosStatusTone(status: string | null | undefined): Tone {
  if (status === 'resolved') return 'success'
  if (status === 'acknowledged') return 'warning'
  return 'danger'
}

export function sosStatusLabel(status: string | null | undefined): string {
  return humanize(status || 'active')
}

/** An alert that still needs a response. */
export const isOpenSos = (status: string | null | undefined): boolean => status !== 'resolved'

/** Type and severity as one line, e.g. "Accident · Injuries reported". */
export function sosHeadline(alert: { alert_type?: string | null; severity?: string | null }): string {
  const severity = sosSeverityLabel(alert.severity)
  return severity ? `${sosTypeLabel(alert.alert_type)} · ${severity}` : sosTypeLabel(alert.alert_type)
}

/**
 * Alert types that, when serious, take the vehicle out of service (it goes to
 * maintenance). Same list as the server's VEHICLE_DOWN_SOS_TYPES.
 */
export function sosHoldsVehicle(alert: { alert_type?: string | null; severity?: string | null }): boolean {
  return alert.severity === 'serious' && (alert.alert_type === 'breakdown' || alert.alert_type === 'accident')
}
