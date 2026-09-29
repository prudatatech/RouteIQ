import type { AxiosError } from 'axios'
import type { Tone } from '@/components/ui'

export type CheckState = 'ok' | 'warning' | 'critical' | 'unknown'
export type HealthBand = 'good' | 'attention' | 'poor' | 'unknown'
export type ServiceState = 'overdue' | 'due_soon' | 'ok' | 'unknown'

export interface HealthCheck {
  key: 'service' | 'documents' | 'alarms' | 'fuel'
  label: string
  state: CheckState
  penalty: number
  detail: string
}

export interface ServiceItem {
  id: string
  vehicle_id: string
  item: string
  interval_km: number | null
  interval_days: number | null
  last_done_km: number | null
  last_done_at: string | null
  status: ServiceState
  km_remaining: number | null
  days_remaining: number | null
  next_due_km: number | null
  next_due_at: string | null
  summary: string
}

export interface ServiceDueRow extends ServiceItem {
  plate_number: string
  odometer_km: number | null
}

export interface VehicleHealth {
  vehicle_id: string
  plate_number: string
  status: string | null
  odometer_km: number | null
  score: number | null
  band: HealthBand
  checks: HealthCheck[]
  checks_known: number
  issues: { severity: 'warning' | 'critical'; text: string }[]
  service: ServiceItem[]
}

export interface ServiceLogEntry {
  id: string
  item: string
  done_at: string
  odometer_km: number | null
  cost: number | null
  note: string | null
}

export interface FleetAlert {
  id: string
  vehicle_id: string
  plate_number: string | null
  type: string
  severity: string | null
  message: string | null
  status: 'open' | 'acknowledged' | 'resolved'
  source: string | null
  is_test: boolean
  occurrences: number
  created_at: string
  last_seen_at: string | null
  acknowledged_at: string | null
  resolved_at: string | null
}

export const fleetKeys = {
  health: ['fleet-health'] as const,
  serviceDue: ['fleet-service-due'] as const,
  alerts: (status: string) => ['fleet-alerts', status] as const,
  alertSummary: ['fleet-alert-summary'] as const,
  plans: (vehicleId: string) => ['fleet-service-plans', vehicleId] as const,
  log: (vehicleId: string) => ['fleet-service-log', vehicleId] as const,
}

export const SERVICE_PRESETS = ['Engine oil', 'Brakes', 'Tyres', 'General service']

export const bandTone: Record<HealthBand, Tone> = { good: 'success', attention: 'warning', poor: 'danger', unknown: 'neutral' }
export const bandLabel: Record<HealthBand, string> = { good: 'Good', attention: 'Needs attention', poor: 'Poor', unknown: 'Not enough data' }
export const checkTone: Record<CheckState, Tone> = { ok: 'success', warning: 'warning', critical: 'danger', unknown: 'neutral' }
export const checkLabel: Record<CheckState, string> = { ok: 'OK', warning: 'Watch', critical: 'Act now', unknown: 'Unknown' }
export const serviceTone: Record<ServiceState, Tone> = { overdue: 'danger', due_soon: 'warning', ok: 'success', unknown: 'neutral' }
export const serviceLabel: Record<ServiceState, string> = { overdue: 'Overdue', due_soon: 'Due soon', ok: 'On track', unknown: 'Not tracked yet' }

export const ALERT_TYPE_LABELS: Record<string, string> = {
  overspeed: 'Overspeed',
  harsh_braking: 'Harsh braking',
  harsh_acceleration: 'Harsh acceleration',
  tamper: 'Tamper',
  low_fuel: 'Low fuel',
  ignition: 'Ignition',
  geofence: 'Geofence',
  long_idle: 'Long idle',
  gps_lost: 'GPS lost',
}
export const alertTypeLabel = (type: string) => ALERT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')

export const formatOdometer = (km: number | null | undefined) =>
  km == null ? 'Unknown' : `${Math.round(Number(km)).toLocaleString('en-IN')} km`

/** Readable message from an API error, falling back to `fallback`. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as AxiosError<{ detail?: unknown }>)?.response?.data?.detail
  return typeof detail === 'string' && detail ? detail : fallback
}
