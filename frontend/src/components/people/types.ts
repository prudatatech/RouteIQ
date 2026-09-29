import { statusToLabel, type Tone } from '@/components/ui'

/** Shapes of the people API in docs/people-plan.md. */

export type PersonRole = 'superadmin' | 'admin' | 'manager' | 'driver'
export type PersonStatus = 'onboarding' | 'active' | 'on_leave' | 'suspended' | 'inactive'
export type DocStatus = 'pending' | 'verified' | 'rejected' | 'expired'
export type EmploymentType = 'permanent' | 'contract' | 'on_call'

export const STAFF_ROLES: readonly string[] = ['superadmin', 'admin', 'manager']

export const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager', driver: 'Driver', vendor: 'Vendor', customer: 'Customer',
}
export const roleLabel = (role: string | null | undefined) => (role ? ROLE_LABELS[role] ?? role : '—')

export const STATUS_LABELS: Record<PersonStatus, string> = {
  onboarding: 'Onboarding', active: 'Active', on_leave: 'On leave', suspended: 'Suspended', inactive: 'Left',
}
export const STATUS_TONES: Record<PersonStatus, Tone> = {
  onboarding: 'info', active: 'success', on_leave: 'info', suspended: 'warning', inactive: 'neutral',
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
}

export const DOC_TYPES: DocTypeInfo[] = [
  { type: 'driving_licence', label: 'Driving licence', needsNumber: true, needsExpiry: true },
  { type: 'aadhaar', label: 'Aadhaar', needsNumber: true, needsExpiry: false },
  { type: 'voter_id', label: 'Voter ID', needsNumber: true, needsExpiry: false },
  { type: 'passport', label: 'Passport', needsNumber: true, needsExpiry: false },
  { type: 'pan', label: 'PAN', needsNumber: true, needsExpiry: false },
  { type: 'photo', label: 'Photo', needsNumber: false, needsExpiry: false },
  { type: 'police_verification', label: 'Police verification', needsNumber: false, needsExpiry: false },
  { type: 'medical_fitness', label: 'Medical fitness', needsNumber: false, needsExpiry: true },
  { type: 'address_proof', label: 'Address proof', needsNumber: false, needsExpiry: false },
  { type: 'offer_letter', label: 'Offer or appointment letter', needsNumber: false, needsExpiry: false },
  { type: 'bank_proof', label: 'Bank proof (cheque or passbook)', needsNumber: false, needsExpiry: false },
  { type: 'other', label: 'Other', needsNumber: false, needsExpiry: false },
]

/**
 * "Required" is checked per group: one document of any listed type satisfies the group.
 * Identity proof is one of Aadhaar, voter ID or passport; tax ID is PAN (or "No PAN" with a reason).
 */
export interface RequiredGroup {
  key: string
  label: string
  types: string[]
  /** Staff can waive the group with a written reason (PAN only). */
  waivable?: boolean
}
const ALL_ROLES = ['driver', 'admin', 'manager', 'superadmin']
const GROUPS: (RequiredGroup & { roles: string[] })[] = [
  { key: 'licence', label: 'Driving licence', types: ['driving_licence'], roles: ['driver'] },
  { key: 'identity', label: 'Identity proof', types: ['aadhaar', 'voter_id', 'passport'], roles: ALL_ROLES },
  { key: 'tax', label: 'Tax ID', types: ['pan'], roles: ALL_ROLES, waivable: true },
  { key: 'photo', label: 'Photo', types: ['photo'], roles: ALL_ROLES },
]
export const requiredGroups = (role: string | null | undefined): RequiredGroup[] =>
  GROUPS.filter(g => !!role && g.roles.includes(role)).map(({ roles: _roles, ...g }) => g)
export const groupHelp = (g: RequiredGroup) => g.types.length > 1 ? g.types.map(t => docLabelOf(t)).join(', ').replace(/, ([^,]*)$/, ' or $1') : null
const docLabelOf = (t: string) => DOC_TYPES.find(d => d.type === t)?.label ?? t
export const docInfo = (type: string) => DOC_TYPES.find(d => d.type === type)
export const docLabel = (type: string) => docInfo(type)?.label ?? type
export const requiredDocTypes = (role: string | null | undefined) => requiredGroups(role).flatMap(g => g.types)

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
  employer_type?: EmployerType | null
  employer_partner_name?: string | null
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
  /** False when the sign-in account was deleted or never created. */
  has_sign_in_account?: boolean
}

export interface PhoneHistoryItem { phone: string; from_at: string | null; to_at: string | null }
export interface VehicleAssignment {
  id: string
  vehicle_id: string
  plate_number: string | null
  assigned_at: string
  unassigned_at: string | null
  assigned_by_name?: string | null
}
export type EmployerType = 'company' | 'partner'

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
  updated_at?: string | null
  employer_type?: EmployerType | null
  employer_partner_id?: string | null
  employer_partner_name?: string | null
  /** Why this person has no PAN. Waives the tax ID group. */
  no_pan_reason?: string | null
  suspended_until?: string | null
  leave_from?: string | null
  leave_until?: string | null
  consent_at?: string | null
  consent_by?: string | null
  consent_method?: string | null
  invite_sent_at?: string | null
  anonymised_at?: string | null
}

export interface PersonDocument {
  /** Plain-language soft warnings the server returns when it saves a document (for example an odd licence number). */
  warning_messages?: string[]
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
  name_on_document?: string | null
  extra_file_paths?: string[] | null
  review_by?: string | null
  number_last4?: string | null
  verification_method?: string | null
  verification_note?: string | null
  resubmission_count?: number | null
  /** Set by the server when the document is past expiry but inside the licence grace period. */
  in_grace?: boolean
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
  branch_name?: string | null
  bank_city?: string | null
  bank_state?: string | null
  ifsc_verified_at?: string | null
  upi_id: string | null
  is_primary: boolean
  is_verified: boolean
  /** Payouts use this account only from this time (bank change cooldown). */
  effective_from?: string | null
  proof_document_id?: string | null
  verification_note?: string | null
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
  phone_history?: PhoneHistoryItem[]
  vehicle_assignments?: VehicleAssignment[]
}

export type EnforcementMode = 'off' | 'warn' | 'block'
export interface PeopleSettings {
  licence_grace_days: number
  document_retention_days: number
  bank_change_cooldown_hours: number
  driver_document_enforcement: EnforcementMode
}

export interface DuplicateMatch { id: string; full_name: string | null; role?: string; status?: string; match?: string }

export interface ImportRow {
  row: number
  name?: string | null
  status: 'ok' | 'error' | 'duplicate'
  errors?: string[]
  duplicate_of?: { id: string; full_name: string | null } | null
}
export interface ImportReport { dry_run?: boolean; rows: ImportRow[]; created?: number }

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

/** A 10-digit Indian mobile number as +91XXXXXXXXXX; null when it is not one. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '').replace(/^0+/, '')
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null
}
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

export const personName =(p: { full_name: string | null; email?: string | null; phone?: string | null }) =>
  p.full_name || p.email || p.phone || 'Unnamed person'

export const LICENCE_CLASSES = [
  { value: 'LMV', label: 'LMV (light)' }, { value: 'HMV', label: 'HMV (heavy)' }, { value: 'HGMV', label: 'HGMV (heavy goods)' },
  { value: 'HPMV', label: 'HPMV (heavy passenger)' }, { value: 'TRANS', label: 'Transport' },
]
export const CONSENT_METHODS = [
  { value: 'signed_form', label: 'Signed form' }, { value: 'in_app', label: 'Agreed in the app' }, { value: 'verbal', label: 'Said yes, recorded by staff' },
]
