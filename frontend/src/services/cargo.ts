/**
 * Cargo custody, exceptions, transfers, hubs and claims: the typed client for
 * `/api/v1/cargo` (docs/cargo-plan.md is the contract). Every POST sends an
 * `Idempotency-Key`, so a retried request is applied once.
 */
import { api } from '@/services/api'

// ── Vocabulary ─────────────────────────────────────────────────────────────

export type Holder = 'consignor' | 'vehicle' | 'hub' | 'consignee'

export const CONDITION_CODES = ['good', 'damaged_packaging', 'damaged_goods', 'wet', 'seal_tampered', 'shortage', 'excess'] as const
export type ConditionCode = (typeof CONDITION_CODES)[number]

/** A consignment: a shipment (RTX-…) or a vendor load (cargo_manifest, CM-…). */
export type CargoRef = { shipment_id: string } | { manifest_id: string }

export const EXCEPTION_TYPES = [
  'vehicle_accident', 'vehicle_breakdown', 'damage', 'shortage', 'excess', 'theft', 'refused', 'undeliverable', 'delay',
  'seal_tamper', 'weather', 'other',
] as const
export type ExceptionType = (typeof EXCEPTION_TYPES)[number]

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export const EXCEPTION_STATUSES = ['open', 'investigating', 'action_planned', 'resolved', 'closed'] as const
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number]

export const EXCEPTION_SOURCES = ['sos', 'maintenance', 'stop_failed', 'custody', 'eta', 'manual', 'driver'] as const
export type ExceptionSource = (typeof EXCEPTION_SOURCES)[number]

export const RESOLUTIONS = [
  'transshipped', 'repaired_continue', 'moved_to_hub', 'returned', 'delivered_with_remarks', 'redelivered', 'written_off',
  'claim_settled', 'no_action',
] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const TRANSFER_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'] as const
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

export const CLAIM_TYPES = ['damage', 'shortage', 'loss', 'theft', 'delay'] as const
export type ClaimType = (typeof CLAIM_TYPES)[number]

export const CLAIM_STATUSES = ['draft', 'filed', 'surveyed', 'approved', 'rejected', 'settled', 'withdrawn'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const CUSTODY_KINDS = [
  'booked', 'accepted', 'arrived_pickup', 'pickup', 'departed', 'arrived_drop', 'delivery', 'partial_delivery', 'refused',
  'undelivered', 'handover_out', 'handover_in', 'hub_in', 'hub_out', 'return_pickup', 'return_delivery', 'inspection', 'hold',
  'release_hold', 'lost',
] as const
export type CustodyKind = (typeof CUSTODY_KINDS)[number]

// ── Records ────────────────────────────────────────────────────────────────

/** A vehicle as the cargo endpoints embed it. Position fields may come as lat/lng or latitude/longitude. */
export interface CargoVehicle {
  id: string
  plate_number: string
  driver_name?: string | null
  driver_phone?: string | null
  vehicle_type?: string | null
  status?: string | null
  lat?: number | null
  lng?: number | null
  latitude?: number | null
  longitude?: number | null
  last_seen_at?: string | null
}

export interface CargoDepot {
  id: string
  name: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}

export interface Pieces {
  total: number | null
  delivered: number
  damaged: number
  short: number
  returned: number
  on_board: number
}

/** Short consignment identity that list rows carry so they can be shown without another fetch. */
export interface ConsignmentLabel {
  shipment_id?: string | null
  manifest_id?: string | null
  /** RTX-… for a shipment, CM-… for a vendor load. */
  tracking_id?: string | null
  status?: string | null
}

export interface ExceptionItem extends ConsignmentLabel {
  id: string
  exception_id: string
  pieces_affected: number | null
  weight_affected_kg: number | null
  condition: ConditionCode | null
  note: string | null
  /** Pieces the consignment has in all, when the backend adds it. */
  pieces_total?: number | null
}

export interface CargoException {
  id: string
  code: string
  type: ExceptionType
  severity: Severity
  status: ExceptionStatus
  source: ExceptionSource | null
  sos_alert_id: string | null
  maintenance_job_id: string | null
  vehicle_id: string | null
  route_id: string | null
  lat: number | null
  lng: number | null
  description: string | null
  owner_id: string | null
  sla_due_at: string | null
  escalation_count: number
  last_escalated_at: string | null
  resolution: Resolution | null
  resolution_note: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string | null
  items: ExceptionItem[]
  vehicle?: CargoVehicle | null
  owner?: { id: string; full_name: string | null } | null
}

/** One entry of the case's merged timeline: custody events, SOS, maintenance, actions and notes. */
export interface CaseTimelineEntry {
  id: string
  at: string
  source: 'custody' | 'sos' | 'maintenance' | 'note' | 'action' | string
  kind: string
  title?: string | null
  note?: string | null
  actor_name?: string | null
  actor_role?: string | null
  photo_urls?: string[] | null
  signature_url?: string | null
}

export interface TransferItem extends ConsignmentLabel {
  id: string
  transfer_id: string
  pieces_planned: number
  pieces_out: number | null
  pieces_in: number | null
  condition_in: ConditionCode | null
}

export interface CargoTransfer {
  id: string
  code: string
  exception_id: string | null
  from_vehicle_id: string
  to_vehicle_id: string | null
  to_depot_id: string | null
  status: TransferStatus
  meet_lat: number | null
  meet_lng: number | null
  meet_address: string | null
  planned_at: string | null
  started_at: string | null
  completed_at: string | null
  new_route_id: string | null
  eway_part_b_required: boolean
  eway_part_b_updated_at: string | null
  eway_part_b_ref: string | null
  created_by: string | null
  note: string | null
  created_at?: string
  items: TransferItem[]
  from_vehicle?: CargoVehicle | null
  to_vehicle?: CargoVehicle | null
  to_depot?: CargoDepot | null
  exception?: Pick<CargoException, 'id' | 'code' | 'type' | 'status'> | null
}

export interface ClaimDocument {
  path: string
  /** Short-lived signed link, when the backend adds one. */
  url?: string | null
}

export interface CargoClaim extends ConsignmentLabel {
  id: string
  code: string
  exception_id: string | null
  claim_type: ClaimType
  declared_value: number | null
  claimed_amount: number | null
  approved_amount: number | null
  settled_amount: number | null
  status: ClaimStatus
  raised_by_role: 'staff' | 'customer' | 'vendor'
  raised_by: string | null
  insurer: string | null
  policy_number: string | null
  fir_number: string | null
  surveyor_name: string | null
  survey_date: string | null
  document_paths: string[]
  documents?: ClaimDocument[]
  notes: string | null
  created_at: string
  updated_at: string | null
  settled_at: string | null
}

export interface ExceptionDetail extends CargoException {
  timeline: CaseTimelineEntry[]
  transfers: CargoTransfer[]
  claims: CargoClaim[]
}

export interface ReliefVehicle {
  vehicle: CargoVehicle & { capacity_kg?: number | null; cargo_types?: string[] | null }
  distance_km: number
  free_kg: number
  eta_minutes?: number | null
}

/** GET /cargo/where/:ref */
export interface WhereIsIt {
  ref: CargoRef & { tracking_id?: string | null }
  status: string
  current_holder: Holder
  vehicle: (CargoVehicle & { lat: number | null; lng: number | null }) | null
  depot: CargoDepot | null
  pieces: Pieces
  seal_number: string | null
  open_exceptions: Pick<CargoException, 'id' | 'code' | 'type' | 'severity' | 'status' | 'sla_due_at'>[]
  delivery_attempts: number
  max_delivery_attempts?: number | null
  delivery_otp_required?: boolean | null
  rto: boolean
  on_hold_reason?: string | null
}

export interface CustodyEvent {
  id: string
  shipment_id: string | null
  manifest_id: string | null
  kind: CustodyKind
  from_holder: Holder | null
  from_vehicle_id: string | null
  from_depot_id: string | null
  to_holder: Holder | null
  to_vehicle_id: string | null
  to_depot_id: string | null
  driver_id: string | null
  pieces: number | null
  weight_kg: number | null
  condition: ConditionCode | null
  seal_number: string | null
  seal_ok: boolean | null
  photo_paths: string[] | null
  /** Signed links for photo_paths, same order. */
  photo_urls?: string[] | null
  signature_path: string | null
  signature_url?: string | null
  otp_verified: boolean | null
  receiver_name: string | null
  lat: number | null
  lng: number | null
  notes: string | null
  exception_id: string | null
  transfer_id: string | null
  recorded_by: string | null
  recorded_role: string | null
  recorded_by_name?: string | null
  recorded_at: string
  /** Names the backend may join in for display. */
  from_vehicle_plate?: string | null
  to_vehicle_plate?: string | null
  from_depot_name?: string | null
  to_depot_name?: string | null
}

export interface HubSummary extends CargoDepot {
  consignments: number
  pieces: number
  /** When the longest-waiting consignment arrived. */
  oldest_since?: string | null
  open_exceptions?: number
}

export interface HubInventoryRow extends ConsignmentLabel {
  pieces: number | null
  weight_kg?: number | null
  /** When it arrived at the hub; ageing is counted from here. */
  since: string
  next_leg?: { label?: string | null; vehicle_plate?: string | null; scheduled_for?: string | null } | null
  open_exceptions?: Pick<CargoException, 'id' | 'code' | 'type' | 'severity'>[]
  destination?: string | null
}

export interface OnBoardItem extends ConsignmentLabel {
  pieces_on_board: number
  pieces_total?: number | null
  weight_kg: number | null
  next_stop?: { name?: string | null; address?: string | null; eta?: string | null } | null
  consignee_name?: string | null
  open_exceptions?: Pick<CargoException, 'id' | 'code' | 'type' | 'severity'>[]
}

export interface OnBoard {
  vehicle_id: string
  items: OnBoardItem[]
}

// ── Request bodies ─────────────────────────────────────────────────────────

export interface CustodyBody {
  ref: CargoRef
  kind: CustodyKind
  pieces?: number
  weight_kg?: number
  condition?: ConditionCode
  seal_number?: string
  photo_paths?: string[]
  signature_path?: string
  receiver_name?: string
  otp?: string
  lat?: number
  lng?: number
  notes?: string
  reason?: string
  to_depot_id?: string
  from_depot_id?: string
}

export interface RaiseExceptionBody {
  type: ExceptionType
  severity: Severity
  description: string
  items: { ref: CargoRef; pieces_affected: number; condition: ConditionCode }[]
  vehicle_id?: string
  lat?: number
  lng?: number
}

export type ExceptionAction =
  | { action: 'assign_owner'; owner_id: string }
  | { action: 'set_status'; status: ExceptionStatus }
  | { action: 'transship'; to_vehicle_id: string; meet_lat?: number; meet_lng?: number; meet_address?: string }
  | { action: 'move_to_hub'; depot_id: string }
  | { action: 'wait_for_repair'; expected_at: string }
  | { action: 'continue_after_repair' }
  | { action: 'return_to_origin'; note?: string }
  | { action: 'reattempt'; scheduled_for: string }
  | { action: 'deliver_with_remarks'; note?: string }
  | { action: 'write_off'; pieces: number; note: string }
  | { action: 'raise_claim'; claim_type: ClaimType; claimed_amount: number }
  | { action: 'resolve'; resolution: Resolution; note: string }
  | { action: 'add_note'; note: string }

export type ExceptionActionName = ExceptionAction['action']

export interface CreateTransferBody {
  exception_id?: string
  from_vehicle_id: string
  to_vehicle_id?: string
  to_depot_id?: string
  items: { ref: CargoRef; pieces: number }[]
  meet_lat?: number
  meet_lng?: number
  meet_address?: string
}

export interface ClaimPatch {
  status?: ClaimStatus
  insurer?: string | null
  policy_number?: string | null
  fir_number?: string | null
  surveyor_name?: string | null
  survey_date?: string | null
  claimed_amount?: number | null
  approved_amount?: number | null
  settled_amount?: number | null
  notes?: string | null
  document_paths?: string[]
}

export interface ExceptionFilters {
  status?: string
  type?: string
  severity?: string
  vehicle_id?: string
  ref?: string
  overdue?: boolean
}

// ── Client ─────────────────────────────────────────────────────────────────

const newKey = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

function post<T>(url: string, body: object = {}): Promise<T> {
  return api.post(url, body, { headers: { 'Idempotency-Key': newKey() } }).then(r => r.data as T)
}

/** A list endpoint may answer with an array or with `{ items }` / `{ <name> }`. */
function listOf<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (Array.isArray(d[key])) return d[key] as T[]
    if (Array.isArray(d.items)) return d.items as T[]
  }
  return []
}

const enc = encodeURIComponent

export const custodyAPI = {
  /** `ref` is a shipment uuid, a tracking id (RTX-…) or a manifest code (CM-…). */
  where: (ref: string) => api.get(`/cargo/where/${enc(ref)}`).then(r => r.data as WhereIsIt),
  timeline: (ref: string) => api.get(`/cargo/timeline/${enc(ref)}`).then(r => listOf<CustodyEvent>(r.data, 'events')),
  record: (body: CustodyBody) => post<{ event?: CustodyEvent }>('/cargo/custody', body),
  sendOtp: (ref: CargoRef) => post<{ expires_at?: string }>('/cargo/otp/send', { ref }),
  onBoard: (vehicleId: string) => api.get(`/cargo/vehicles/${enc(vehicleId)}/on-board`).then(r => ({
    vehicle_id: vehicleId,
    items: listOf<OnBoardItem>(r.data, 'items'),
  }) as OnBoard),
}

export const exceptionsAPI = {
  list: (filters: ExceptionFilters = {}) => api.get('/cargo/exceptions', {
    params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== false)),
  }).then(r => listOf<CargoException>(r.data, 'exceptions')),
  get: (id: string) => api.get(`/cargo/exceptions/${enc(id)}`).then(r => {
    const d = r.data as Partial<ExceptionDetail> & { exception?: CargoException }
    // Accept the case at the top level or under `exception`, with its lists beside it
    const base = (d.exception ?? d) as CargoException
    return {
      ...base,
      items: d.items ?? base.items ?? [],
      timeline: d.timeline ?? [],
      transfers: d.transfers ?? [],
      claims: d.claims ?? [],
    } as ExceptionDetail
  }),
  raise: (body: RaiseExceptionBody) => post<CargoException>('/cargo/exceptions', body),
  act: (id: string, body: ExceptionAction) => post<unknown>(`/cargo/exceptions/${enc(id)}/actions`, body),
  reliefVehicles: (id: string) => api.get(`/cargo/exceptions/${enc(id)}/relief-vehicles`).then(r => listOf<ReliefVehicle>(r.data, 'vehicles')),
}

export const transfersAPI = {
  list: (status?: TransferStatus) => api.get('/cargo/transfers', { params: status ? { status } : undefined })
    .then(r => listOf<CargoTransfer>(r.data, 'transfers')),
  get: (id: string) => api.get(`/cargo/transfers/${enc(id)}`).then(r => {
    const d = r.data as CargoTransfer & { transfer?: CargoTransfer }
    const base = d.transfer ?? d
    return { ...base, items: d.items ?? base.items ?? [] } as CargoTransfer
  }),
  create: (body: CreateTransferBody) => post<CargoTransfer>('/cargo/transfers', body),
  cancel: (id: string, note?: string) => post<CargoTransfer>(`/cargo/transfers/${enc(id)}/cancel`, note ? { note } : {}),
  recordEway: (id: string, eway_part_b_ref: string) => post<CargoTransfer>(`/cargo/transfers/${enc(id)}/eway`, { eway_part_b_ref }),
}

export const hubsAPI = {
  list: () => api.get('/cargo/hubs').then(r => listOf<HubSummary>(r.data, 'hubs')),
  inventory: (depotId: string) => api.get(`/cargo/hubs/${enc(depotId)}/inventory`).then(r => listOf<HubInventoryRow>(r.data, 'items')),
}

export const claimsAPI = {
  list: (params: { status?: string; ref?: string } = {}) => api.get('/cargo/claims', {
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v)),
  }).then(r => listOf<CargoClaim>(r.data, 'claims')),
  create: (body: { exception_id?: string; ref: CargoRef; claim_type: ClaimType; claimed_amount: number; notes?: string }) =>
    post<CargoClaim>('/cargo/claims', body),
  update: (id: string, patch: ClaimPatch) => api.patch(`/cargo/claims/${enc(id)}`, patch).then(r => r.data as CargoClaim),
  documentUploadUrl: (id: string, file: { file_name: string; content_type: string; size: number }) =>
    post<{ path: string; token: string; bucket: string; signed_url?: string }>(`/cargo/claims/${enc(id)}/documents-upload-url`, file),
}

/** React Query keys, so every screen invalidates the same caches. */
export const cargoKeys = {
  all: ['cargo'] as const,
  where: (ref: string) => ['cargo', 'where', ref] as const,
  timeline: (ref: string) => ['cargo', 'timeline', ref] as const,
  onBoard: (vehicleId: string) => ['cargo', 'on-board', vehicleId] as const,
  exceptions: (filters: ExceptionFilters = {}) => ['cargo', 'exceptions', filters] as const,
  exception: (id: string) => ['cargo', 'exception', id] as const,
  relief: (id: string) => ['cargo', 'relief', id] as const,
  transfers: (status?: string) => ['cargo', 'transfers', status ?? 'all'] as const,
  transfer: (id: string) => ['cargo', 'transfer', id] as const,
  hubs: ['cargo', 'hubs'] as const,
  hubInventory: (id: string) => ['cargo', 'hub', id] as const,
  claims: (params: object = {}) => ['cargo', 'claims', params] as const,
}
