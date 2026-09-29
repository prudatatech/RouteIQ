import type { Tone } from '@/components/ui'

export const MAINTENANCE_REASONS = ['scheduled_service', 'breakdown', 'accident', 'tyre', 'other'] as const
export type MaintenanceReason = typeof MAINTENANCE_REASONS[number]

export const REASON_LABELS: Record<MaintenanceReason, string> = {
  scheduled_service: 'Scheduled service',
  breakdown: 'Breakdown',
  accident: 'Accident',
  tyre: 'Tyre',
  other: 'Other',
}

export type AttachmentKind = 'invoice' | 'job_card' | 'photo' | 'other'
export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  invoice: 'Invoice', job_card: 'Job card', photo: 'Photo', other: 'Other',
}

/** A file already uploaded to storage, ready to be attached to a record or job. */
export interface AttachmentInput {
  path: string
  kind: AttachmentKind
  file_name: string
  content_type: string
  size_bytes: number
}

export interface Attachment {
  id: string
  kind: AttachmentKind
  file_name: string | null
  content_type: string | null
  size_bytes: number | null
  created_at: string
}

export interface ServiceLineItem {
  id: string
  description: string
  kind: 'part' | 'repair'
  quantity: number
  unit_cost: number
  total_cost: number
}

export interface ServiceRecord {
  id: string
  vehicle_id: string
  item: string
  done_at: string
  odometer_km: number | null
  cost: number | null
  labour_cost: number | null
  workshop: string | null
  invoice_number: string | null
  note: string | null
  job_id: string | null
  items: ServiceLineItem[]
  attachments: Attachment[]
}

export interface MaintenanceJob {
  id: string
  vehicle_id: string
  plate_number: string | null
  status: 'open' | 'closed'
  reason_type: MaintenanceReason
  workshop: string | null
  expected_return_date: string | null
  note: string | null
  sos_alert_id: string | null
  released_work: { routes: string[]; manifests: string[] } | null
  opened_at: string
  opened_odometer_km: number | null
  closed_at: string | null
  final_odometer_km: number | null
  total_cost: number | null
  close_note: string | null
  service_log_id: string | null
  days_in_maintenance: number
  is_overdue: boolean
  days_overdue: number
  attachments: Attachment[]
}

export interface OpenWork {
  routes: { id: string; status: string; started_at: string | null }[]
  manifests: { id: string; status: string; pickup_location: string | null; drop_location: string | null }[]
  shipments_on_board: number
  blocking: boolean
  summary: string
}

export interface OdometerSyncResult {
  vehicle_id: string
  changed: boolean
  before_km: number | null
  after_km: number | null
  added_km: number
  source: 'gps' | 'routes' | 'manual' | 'none'
  points_used: number
  points_ignored: number
  synced_at: string
  message: string
}

/** The vehicle columns the condition card reads. */
export interface ConditionVehicle {
  id: string
  plate_number: string
  status: string
  odometer_km: number | null
  odometer_updated_at: string | null
  odometer_synced_at: string | null
  odometer_source: 'gps' | 'routes' | 'manual' | null
  rc_expiry: string | null
  insurance_expiry: string | null
  fitness_expiry: string | null
  permit_expiry: string | null
  puc_expiry: string | null
}

export const maintenanceKeys = {
  vehicle: (vehicleId: string) => ['fleet-vehicle', vehicleId] as const,
  plans: (vehicleId: string) => ['fleet-service-plans', vehicleId] as const,
  jobs: (vehicleId: string) => ['fleet-maintenance-jobs', vehicleId] as const,
  openJobs: ['fleet-maintenance-jobs', 'open'] as const,
  preview: (vehicleId: string) => ['fleet-maintenance-preview', vehicleId] as const,
}

/** "In maintenance since 12 Sep 2026, expected back 20 Sep 2026" pill tone: late jobs are red. */
export const jobTone = (job: Pick<MaintenanceJob, 'is_overdue'>): Tone => (job.is_overdue ? 'danger' : 'warning')
