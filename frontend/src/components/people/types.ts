import { statusToLabel, type Tone } from '@/components/ui'

/** Shapes of the people API in docs/people-plan.md. */

export type PersonRole = 'superadmin' | 'admin' | 'manager' | 'driver'
export type PersonStatus = 'onboarding' | 'active' | 'suspended' | 'inactive'
export type DocStatus = 'pending' | 'verified' | 'rejected' | 'expired'
export type EmploymentType = 'permanent' | 'contract' | 'on_call'

export const STAFF_ROLES: readonly string[] = ['superadmin', 'admin', 'manager']

export const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager', driver: 'Driver', vendor: 'Vendor', customer: 'Customer',
}
export const roleLabel = (role: string | null | undefined) => (role ? ROLE_LABELS[role] ?? role : '—')

export const STATUS_LABELS: Record<PersonStatus, string> = {
  onboarding: 'Onboarding', active: 'Active', suspended: 'Suspended', inactive: 'Left',
}
export const STATUS_TONES: Record<PersonStatus, Tone> = {
  onboarding: 'info', active: 'success', suspended: 'warning', inactive: 'neutral',
}
export const STATUS_OPTIONS = (Object.keys(STATUS_LABELS) as PersonStatus[]).map(value => ({ value, label: STATUS_LABELS[value] }))
export const statusLabel = (s: string | null | undefined) => STATUS_LABELS[s as PersonStatus] ?? statusToLabel(s)

export const EMPLOYMENT_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'contract', label: 'Contract' },
  { value: 'on_call', label: 'On call' },
]

export interface DocTypeInfo {
  type: string
  label: string
  needsNumber: boolean
  needsExpiry: boolean
  /** Roles that must have it. */
  requiredFor: string[]
}

export const DOC_TYPES: DocTypeInfo[] = [
  { type: 'driving_licence', label: 'Driving licence', needsNumber: true, needsExpiry: true, requiredFor: ['driver'] },
  { type: 'aadhaar', label: 'Aadhaar', needsNumber: true, needsExpiry: false, requiredFor: ['driver', 'admin', 'manager', 'superadmin'] },
  { type: 'pan', label: 'PAN', needsNumber: true, needsExpiry: false, requiredFor: ['driver', 'admin', 'manager', 'superadmin'] },
  { type: 'photo', label: 'Photo', needsNumber: false, needsExpiry: false, requiredFor: ['driver', 'admin', 'manager', 'superadmin'] },
  { type: 'police_verification', label: 'Police verification', needsNumber: false, needsExpiry: true, requiredFor: [] },
  { type: 'medical_fitness', label: 'Medical fitness', needsNumber: false, needsExpiry: true, requiredFor: [] },
  { type: 'address_proof', label: 'Address proof', needsNumber: false, needsExpiry: false, requiredFor: [] },
  { type: 'offer_letter', label: 'Offer or appointment letter', needsNumber: false, needsExpiry: false, requiredFor: [] },
  { type: 'other', label: 'Other', needsNumber: false, needsExpiry: false, requiredFor: [] },
]
export const docInfo = (type: string) => DOC_TYPES.find(d => d.type === type)
export const docLabel = (type: string) => docInfo(type)?.label ?? type
export const requiredDocTypes = (role: string | null | undefined) =>
  DOC_TYPES.filter(d => role && d.requiredFor.includes(role)).map(d => d.type)

export interface DocSummary {
  required: number
  verified: number
  pending: number
  expiring: number
  expired: number
  missing: number
}

export interface PersonRow {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  role: string
  status: PersonStatus
  employee_code: string | null
  designation: string | null
  vehicle_plate: string | null
  doc_summary: DocSummary | null
  last_login: string | null
}

export interface PersonUser {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  role: string
  status: PersonStatus
  is_active?: boolean
  last_login?: string | null
  created_at?: string | null
}

export interface PersonProfile {
  employee_code?: string | null
  designation?: string | null
  department?: string | null
  employment_type?: EmploymentType | null
  date_of_joining?: string | null
  date_of_birth?: string | null
  gender?: string | null
  blood_group?: string | null
  alternate_phone?: string | null
  personal_email?: string | null
  address_line?: string | null
  city?: string | null
  state?: string | null
  pincode?: string | null
  latitude?: number | null
  longitude?: number | null
  base_depot_id?: string | null
  base_depot_name?: string | null
  reporting_manager_id?: string | null
  reporting_manager_name?: string | null
  photo_path?: string | null
}

export interface PersonDocument {
  id: string
  user_id: string
  doc_type: string
  doc_number: string | null
  issued_on: string | null
  expires_on: string | null
  file_path: string | null
  status: DocStatus
  rejection_reason: string | null
  metadata: Record<string, unknown> | null
  verified_at: string | null
  archived_at: string | null
  created_at: string
}

export interface EmergencyContact {
  id: string
  name: string
  relation: string | null
  phone: string
  is_primary: boolean
}

export interface BankAccount {
  id: string
  account_holder: string
  /** Masked by the API (last 4 only) until a superadmin reveals it. */
  account_number: string
  ifsc: string
  bank_name: string | null
  upi_id: string | null
  is_primary: boolean
  is_verified: boolean
}

export interface StatusHistoryItem {
  id: string
  from_status: string | null
  to_status: string
  reason: string | null
  changed_by: string | null
  changed_by_name?: string | null
  created_at: string
}

export interface PersonNote {
  id: string
  body: string
  author_id: string | null
  author_name?: string | null
  created_at: string
}

export interface ActivityItem {
  id: string
  action: string
  actor_id: string | null
  actor_name?: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export interface PersonVehicle {
  id: string
  plate_number: string
  vehicle_type?: string | null
  status?: string | null
}

export interface PersonDetail {
  user: PersonUser
  profile: PersonProfile | null
  documents: PersonDocument[]
  emergency_contacts: EmergencyContact[]
  bank_accounts: BankAccount[]
  status_history: StatusHistoryItem[]
  notes: PersonNote[]
  activity: ActivityItem[]
  vehicle: PersonVehicle | null
}

export interface PeopleAttention {
  expired_licences: { user_id: string; full_name: string | null; expires_on: string | null }[]
  expiring_licences: { user_id: string; full_name: string | null; expires_on: string | null }[]
  missing_required: { user_id: string; full_name: string | null; missing: string[] }[]
}

export type DriverLicenceStatus = 'valid' | 'expiring' | 'expired' | 'missing' | null | undefined

export function initialsOf(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export const personName = (p: { full_name: string | null; email?: string | null; phone?: string | null }) =>
  p.full_name || p.email || p.phone || 'Unnamed person'
