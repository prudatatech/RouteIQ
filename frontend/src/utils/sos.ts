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

/**
 * The statuses of an SOS alert (sos_alerts.status), as the server writes them: active, then
 * acknowledged, then resolved; or cancelled from either open state (a false alarm, cancelled by
 * the driver in the app or closed by staff).
 */
export type SosStatus = 'active' | 'acknowledged' | 'resolved' | 'cancelled'

/** A row with no status has not been touched yet, so it is active. */
export const sosStatusOf = (status: string | null | undefined): string => status || 'active'

/** Colour of an SOS alert's status: active is urgent, acknowledged is being handled, resolved is done, cancelled is closed. */
export function sosStatusTone(status: string | null | undefined): Tone {
  const s = sosStatusOf(status)
  if (s === 'resolved') return 'success'
  if (s === 'cancelled') return 'neutral'
  if (s === 'acknowledged') return 'warning'
  return 'danger'
}

export function sosStatusLabel(status: string | null | undefined): string {
  const s = sosStatusOf(status)
  return s === 'cancelled' ? 'Cancelled (false alarm)' : humanize(s)
}

/** An alert that still needs a response: active or acknowledged. */
export const isOpenSos = (status: string | null | undefined): boolean => {
  const s = sosStatusOf(status)
  return s === 'active' || s === 'acknowledged'
}

/** How many times a vehicle has raised an SOS, as the server counts it. */
export interface SosCounts {
  total: number
  last_30_days: number
  /** Active or acknowledged. */
  open: number
  cancelled: number
}

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
