/**
 * Cargo custody, exceptions, transfers, hubs and claims: the typed client for
 * `/api/v1/cargo` (docs/cargo-plan.md is the contract). Every POST that changes state sends an
 * `Idempotency-Key`, so a retried request is applied once. The backend's answers are mapped to
 * the shapes below by cargoMap.ts.
 */
import { api } from '@/services/api'
import { supabase } from '@/services/supabase'
import {
  listOf, mapClaim, mapCustodyEvent, mapException, mapExceptionDetail, mapHub, mapHubInventoryRow, mapLots, mapMergeResult, mapOnBoard, mapRelief,
  mapSplitResult, mapTransfer, mapWhere,
} from './cargoMap'

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
  'release_hold', 'lost', 'split', 'merge',
] as const
export type CustodyKind = (typeof CUSTODY_KINDS)[number]

/** Why a consignment was split into lots (`shipments.split_reason`). */
export const SPLIT_REASONS = ['multi_drop', 'partial_transfer', 'hub_crossdock', 'partial_delivery_remainder', 'manual'] as const
export type SplitReason = (typeof SPLIT_REASONS)[number]

// ── Records (as the screens use them; cargoMap.ts maps the backend's answers to these) ──

/** A vehicle as the cargo endpoints embed it. `where` gives lat/lng, the other answers latitude/longitude. */
export interface CargoVehicle {
  id: string
  plate_number: string
  driver_name?: string | null
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
  /** Pieces still on the vehicle; 0 when the goods are elsewhere, null when the count is unknown. */
  on_board: number | null
}

/** Short consignment identity that list rows carry so they can be shown without another fetch. */
export interface ConsignmentLabel {
  shipment_id?: string | null
  manifest_id?: string | null
  /** RTX-… for a shipment, CM-… for a vendor load (the backend's `code` or `consignment_code`). */
  tracking_id?: string | null
  status?: string | null
  /** A lot's label (`A`, `B`, `A1`); set when the row is a lot of a split consignment (code `RTX-ABC123-B`). */
  lot_label?: string | null
}

export interface ExceptionItem extends ConsignmentLabel {
  id: string
  exception_id: string
  pieces_affected: number | null
  weight_affected_kg: number | null
  condition: ConditionCode | null
  note: string | null
  /** Pieces the consignment has in all. */
  pieces_total?: number | null
  /** Pieces its current holder has now. */
  pieces_held?: number | null
  current_holder?: Holder | null
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
  /** The consignment of a custody entry. */
  ref?: ConsignmentLabel | null
  pieces?: number | null
  condition?: string | null
  transfer_id?: string | null
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
  /** When the transfer was planned, which is also when it was created. */
  planned_at: string | null
  started_at: string | null
  completed_at: string | null
  new_route_id: string | null
  eway_part_b_required: boolean
  eway_part_b_updated_at: string | null
  eway_part_b_ref: string | null
  created_by: string | null
  note: string | null
  items: TransferItem[]
  from_vehicle?: CargoVehicle | null
  to_vehicle?: CargoVehicle | null
  to_depot?: CargoDepot | null
  exception?: Pick<CargoException, 'id' | 'code' | 'type' | 'status'> | null
  /** A partial transfer (fewer pieces than on board): the lot that moves and the lot that stays. */
  split_lots?: { moving: ConsignmentLabel | null; staying: ConsignmentLabel | null } | null
}

export interface ClaimDocument {
  path: string
  /** Short-lived signed link. */
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

/** The short form of a claim on a case page; the claim drawer loads the whole claim. */
export type ClaimSummary = Pick<CargoClaim, 'id' | 'code' | 'claim_type' | 'status' | 'claimed_amount' | 'approved_amount' | 'settled_amount' | 'created_at'> & ConsignmentLabel

export interface ExceptionDetail extends CargoException {
  timeline: CaseTimelineEntry[]
  transfers: CargoTransfer[]
  claims: ClaimSummary[]
}

export interface ReliefVehicle {
  vehicle: CargoVehicle & { cargo_types?: string[] | null }
  distance_km: number
  free_kg: number
  eta_minutes?: number | null
  /** Free capacity covers the weight of the goods. */
  fits: boolean
  /** Carries the cargo types the goods need. */
  cargo_match: boolean
}

/** GET /cargo/where/:ref */
export interface WhereIsIt {
  ref: CargoRef & { tracking_id?: string | null }
  /** RTX-… or CM-… */
  code: string | null
  status: string
  current_holder: Holder
  vehicle: (CargoVehicle & { lat?: number | null; lng?: number | null }) | null
  depot: CargoDepot | null
  pieces: Pieces
  seal_number: string | null
  open_exceptions: Pick<CargoException, 'id' | 'code' | 'type' | 'severity' | 'status' | 'sla_due_at'>[]
  delivery_attempts: number
  max_delivery_attempts: number | null
  delivery_otp_required: boolean
  rto: boolean
  on_hold_reason?: string | null
  /** A master's status, holder and pieces are rolled up from its lots; a master holds no goods itself. */
  is_master: boolean
  /** Set on a lot: its label (`B`) and its master. */
  lot_label?: string | null
  master?: ConsignmentLabel | null
}

/** One event of GET /cargo/timeline/:ref, with the backend's embedded vehicles, depots and people flattened. */
export interface CustodyEvent {
  id: string
  kind: CustodyKind
  /** The plain-words line the backend writes for the event. */
  summary?: string | null
  recorded_at: string
  from_holder: Holder | null
  to_holder: Holder | null
  from_vehicle_id: string | null
  to_vehicle_id: string | null
  from_depot_id: string | null
  to_depot_id: string | null
  from_vehicle_plate?: string | null
  to_vehicle_plate?: string | null
  from_depot_name?: string | null
  to_depot_name?: string | null
  pieces: number | null
  weight_kg?: number | null
  condition: ConditionCode | null
  seal_number?: string | null
  seal_ok?: boolean | null
  receiver_name: string | null
  otp_verified: boolean | null
  /** Signed links to the photos. */
  photo_urls: string[]
  signature_url: string | null
  lat: number | null
  lng: number | null
  notes?: string | null
  exception_id?: string | null
  transfer_id?: string | null
  driver_name?: string | null
  /** Id of who recorded it (staff views only). */
  recorded_by?: string | null
  recorded_by_name?: string | null
  recorded_role?: string | null
  /** On a master's merged timeline: the lot the event belongs to (`B`, and its code `RTX-ABC123-B`). */
  lot_label?: string | null
  lot_code?: string | null
}

export interface HubSummary extends CargoDepot {
  consignments: number
  pieces: number
  weight_kg: number
  /** When the longest-waiting consignment arrived. */
  oldest_since: string | null
  oldest_age_hours: number | null
}

export interface HubInventoryRow extends ConsignmentLabel {
  pieces: number | null
  pieces_total?: number | null
  weight_kg: number | null
  /** When it arrived at the hub; ageing is counted from here. Null when no arrival was recorded. */
  since: string | null
  age_hours?: number | null
  rto?: boolean
  on_hold_reason?: string | null
  /** Where it goes next: the next drop (or the return point) by name and address. */
  next_leg: { label: string | null; address: string | null } | null
  open_exceptions: Pick<CargoException, 'id' | 'code' | 'type' | 'severity' | 'status'>[]
  destination: string | null
}

export interface OnBoardItem extends ConsignmentLabel {
  pieces_on_board: number
  pieces_total?: number | null
  weight_kg: number | null
  seal_number?: string | null
  /** The condition last recorded (good when none was). */
  condition?: ConditionCode | null
  rto?: boolean
  on_hold_reason?: string | null
  next_stop?: { name: string | null; address: string | null } | null
  open_exceptions?: Pick<CargoException, 'id' | 'code' | 'type' | 'severity'>[]
}

export interface OnBoard {
  vehicle_id: string
  vehicle?: CargoVehicle | null
  items: OnBoardItem[]
}

export interface LotDrop {
  name: string | null
  address: string | null
  lat: number | null
  lng: number | null
}

export interface LotConsignee {
  name: string | null
  phone: string | null
  gstin: string | null
}

/** One lot of a split consignment (GET /cargo/lots/:ref). */
export interface Lot extends ConsignmentLabel {
  /** `A`, `B`, `A1` … */
  label: string | null
  status: string
  current_holder: Holder
  vehicle: CargoVehicle | null
  depot: CargoDepot | null
  pieces: Pieces
  weight_kg: number | null
  declared_value: number | null
  freight_share: number | null
  drop: LotDrop | null
  consignee: LotConsignee | null
  split_reason: SplitReason | null
  open_exceptions: Pick<CargoException, 'id' | 'code' | 'type' | 'severity' | 'status' | 'sla_due_at'>[]
}

export interface LotsMaster extends ConsignmentLabel {
  status: string
  pieces: Pieces
  weight_kg: number | null
  declared_value: number | null
  /** The master's whole freight_charge. */
  freight: number | null
}

/** GET /cargo/lots/:ref: the master and every lot, whichever of them was asked for. */
export interface LotsView {
  master: LotsMaster
  lots: Lot[]
  /** The rolled-up pieces of all lots. */
  totals: Pieces
}

/** What the split answers: the master and the lots made (a remainder lot included). */
export interface SplitResult {
  master: ConsignmentLabel
  lots: (ConsignmentLabel & { label: string | null; pieces: number | null; weight_kg: number | null })[]
}

// ── Request bodies ─────────────────────────────────────────────────────────

/** POST /cargo/custody (the backend's CustodySchema). */
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
  pieces_refused?: number
  pieces_short?: number
  pieces_damaged?: number
  /** hold: why; a staff delivery: a logged reason instead of a photo; refused / undelivered: the reason code. */
  reason?: string
  /** hub_in: the hub reached; hub_out: the hub left. */
  depot_id?: string
  /** Staff naming the vehicle of a pickup, hub departure or return pickup. */
  vehicle_id?: string
  /** hub_out: where the goods go next. */
  next_status?: 'in_transit' | 'out_for_delivery'
}

/** What POST /cargo/custody answers. */
export interface CustodyResult {
  event: { id: string; kind: CustodyKind } | null
  ref: CargoRef
  status: string
  current_holder: Holder
  pieces: Pieces
  exception_ids: string[]
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

/** POST /cargo/exceptions/:id/actions (exception.service exceptionAction). */
export type ExceptionAction =
  | { action: 'assign_owner'; owner_id: string }
  | { action: 'set_status'; status: ExceptionStatus }
  | { action: 'transship'; to_vehicle_id: string; meet_lat?: number; meet_lng?: number; meet_address?: string; note?: string }
  | { action: 'move_to_hub'; depot_id: string; note?: string }
  | { action: 'wait_for_repair'; expected_at: string }
  | { action: 'continue_after_repair'; note?: string }
  | { action: 'return_to_origin' }
  | { action: 'reattempt'; scheduled_for: string }
  | { action: 'deliver_with_remarks'; receiver_name: string; note: string; condition?: ConditionCode; pieces_damaged?: number; photo_paths?: string[]; otp?: string }
  | { action: 'write_off'; pieces: number; note: string; ref?: CargoRef }
  | { action: 'raise_claim'; claim_type: ClaimType; claimed_amount: number; ref?: CargoRef; note?: string }
  | { action: 'resolve'; resolution: Resolution; note: string }
  | { action: 'add_note'; note: string }

export type ExceptionActionName = ExceptionAction['action']

export interface CreateTransferBody {
  exception_id?: string
  from_vehicle_id: string
  to_vehicle_id?: string
  to_depot_id?: string
  /**
   * `pieces` is what moves. Below what is on board, the backend first splits the consignment into
   * a lot that moves and a lot that stays (split_reason `partial_transfer`) and transfers the moving lot.
   */
  items: { ref: CargoRef; pieces: number }[]
  meet_lat?: number
  meet_lng?: number
  meet_address?: string
  note?: string
}

/** One lot asked for in POST /cargo/lots/split. Give one destination at most: a drop, a vehicle or a hub. */
export interface SplitLotInput {
  pieces: number
  weight_kg?: number
  declared_value?: number
  freight_share?: number
  consignee_name?: string
  consignee_phone?: string
  consignee_gstin?: string
  drop?: { address: string; lat: number; lng: number }
  to_vehicle_id?: string
  to_depot_id?: string
}

/** POST /cargo/lots/split. Pieces below what is held leave a remainder lot where the goods are. */
export interface SplitBody {
  ref: CargoRef
  reason: SplitReason
  lots: SplitLotInput[]
  /** Free text for the record (sent as `note`; the contract's `reason` is the split_reason code). */
  note?: string
}

/** One drop of a multi-drop booking (`drops[]` on POST /shipments); each becomes a lot. */
export interface ShipmentDropInput {
  address: string
  lat: number
  lng: number
  consignee_name: string
  consignee_phone: string
  consignee_gstin?: string
  pieces: number
  weight_kg?: number
  declared_value?: number
}

/** PATCH /cargo/claims/:id (staff). Documents are added with uploadDocument, not here. */
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
}

export interface ExceptionFilters {
  /** One status, or several separated by commas. */
  status?: string
  type?: string
  severity?: string
  vehicle_id?: string
  ref?: string
  overdue?: boolean
}

/** Every open case state, as one status filter. */
export const OPEN_EXCEPTION_FILTER = 'open,investigating,action_planned'

export interface SignedUpload { path: string; token: string; bucket: string; signed_url?: string }

// ── Client ─────────────────────────────────────────────────────────────────

const newKey = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

function post<T>(url: string, body: object = {}): Promise<T> {
  return api.post(url, body, { headers: { 'Idempotency-Key': newKey() } }).then(r => r.data as T)
}

const enc = encodeURIComponent

/** Uploads one file to a signed URL the backend handed out; gives back its storage path. */
async function uploadToSigned(signed: SignedUpload, file: File): Promise<string> {
  const { error } = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type })
  if (error) throw error
  return signed.path
}

export const custodyAPI = {
  /** `ref` is a shipment uuid, a tracking id (RTX-…) or a manifest code (CM-…). */
  where: (ref: string) => api.get(`/cargo/where/${enc(ref)}`).then(r => mapWhere(r.data)),
  timeline: (ref: string) => api.get(`/cargo/timeline/${enc(ref)}`).then(r => listOf<unknown>(r.data, 'events').map(mapCustodyEvent)),
  record: (body: CustodyBody) => post<CustodyResult>('/cargo/custody', body),
  /** A signed URL into `cargo/<consignment id>/` for a custody photo or signature (JPG or PNG). */
  uploadUrl: (ref: CargoRef | string, file: { kind: 'photo' | 'signature'; content_type: string; size: number }) =>
    api.post('/cargo/custody/upload-url', { ref, ...file }).then(r => r.data as SignedUpload),
  /** Uploads a custody photo of a consignment and gives back its path, for `photo_paths`. */
  uploadPhoto: async (ref: CargoRef | string, file: File) =>
    uploadToSigned(await custodyAPI.uploadUrl(ref, { kind: 'photo', content_type: file.type, size: file.size }), file),
  sendOtp: (ref: CargoRef) => post<{ expires_at: string; notified: { in_app: boolean; sms: boolean } }>('/cargo/otp/send', { ref }),
  /** The answer is `{ vehicle, totals, items }`. */
  onBoard: (vehicleId: string) => api.get(`/cargo/vehicles/${enc(vehicleId)}/on-board`).then(r => mapOnBoard(r.data, vehicleId)),
}

/** An action answers the case; transship and move_to_hub add the transfer, raise_claim the claim. */
export interface ExceptionActionResult {
  exception: ExceptionDetail
  transfer?: CargoTransfer
  claim?: CargoClaim
}

export const exceptionsAPI = {
  list: (filters: ExceptionFilters = {}) => api.get('/cargo/exceptions', {
    params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== false)),
  }).then(r => listOf<unknown>(r.data, 'exceptions').map(mapException)),
  get: (id: string) => api.get(`/cargo/exceptions/${enc(id)}`).then(r => mapExceptionDetail(r.data)),
  raise: (body: RaiseExceptionBody) => post<unknown>('/cargo/exceptions', body).then(mapExceptionDetail),
  act: (id: string, body: ExceptionAction) => post<Record<string, unknown>>(`/cargo/exceptions/${enc(id)}/actions`, body)
    .then((d): ExceptionActionResult => (d && typeof d === 'object' && 'exception' in d
      ? {
        exception: mapExceptionDetail(d.exception),
        ...(d.transfer ? { transfer: mapTransfer(d.transfer) } : {}),
        ...(d.claim ? { claim: mapClaim(d.claim) } : {}),
      }
      : { exception: mapExceptionDetail(d) })),
  /** Ranked relief vehicles; the answer is `{ affected_kg, origin, vehicles }`. */
  reliefVehicles: (id: string) => api.get(`/cargo/exceptions/${enc(id)}/relief-vehicles`).then(r => listOf<unknown>(r.data, 'vehicles').map(mapRelief)),
}

export const transfersAPI = {
  list: (status?: TransferStatus) => api.get('/cargo/transfers', { params: status ? { status } : undefined })
    .then(r => listOf<unknown>(r.data, 'transfers').map(mapTransfer)),
  get: (id: string) => api.get(`/cargo/transfers/${enc(id)}`).then(r => mapTransfer(r.data)),
  create: (body: CreateTransferBody) => post<unknown>('/cargo/transfers', body).then(mapTransfer),
  cancel: (id: string, reason?: string) => post<unknown>(`/cargo/transfers/${enc(id)}/cancel`, reason ? { reason } : {}).then(mapTransfer),
  recordEway: (id: string, eway_part_b_ref: string) => post<unknown>(`/cargo/transfers/${enc(id)}/eway`, { eway_part_b_ref }).then(mapTransfer),
}

export const lotsAPI = {
  /** The master and its lots; `ref` may be the master or any lot. Null when the consignment was never split. */
  get: (ref: string) => api.get(`/cargo/lots/${enc(ref)}`)
    .then(r => mapLots(r.data))
    .catch((err: { response?: { status?: number } }) => {
      if (err?.response?.status === 404) return null
      throw err
    }),
  split: (body: SplitBody) => post<unknown>('/cargo/lots/split', body).then(mapSplitResult),
  /** Answers the lot the others were merged into. */
  merge: (refs: CargoRef[]) => post<unknown>('/cargo/lots/merge', { refs }).then(mapMergeResult),
}

export const hubsAPI = {
  list: () => api.get('/cargo/hubs').then(r => listOf<unknown>(r.data, 'hubs').map(mapHub)),
  /** The answer is `{ depot, items }`. */
  inventory: (depotId: string) => api.get(`/cargo/hubs/${enc(depotId)}/inventory`).then(r => listOf<unknown>(r.data, 'items').map(mapHubInventoryRow)),
}

export const claimsAPI = {
  list: (params: { status?: string; ref?: string } = {}) => api.get('/cargo/claims', {
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v)),
  }).then(r => listOf<unknown>(r.data, 'claims').map(mapClaim)),
  get: (id: string) => api.get(`/cargo/claims/${enc(id)}`).then(r => mapClaim(r.data)),
  create: (body: { exception_id?: string; ref: CargoRef; claim_type: ClaimType; claimed_amount?: number; notes?: string }) =>
    post<unknown>('/cargo/claims', body).then(mapClaim),
  update: (id: string, patch: ClaimPatch) => api.patch(`/cargo/claims/${enc(id)}`, patch).then(r => mapClaim(r.data)),
  /**
   * A signed upload URL for one document (JPG, PNG or PDF). The backend adds the path to the claim
   * when it hands out the URL, so nothing is sent after the upload.
   */
  documentUploadUrl: (id: string, file: { content_type: string; size: number }) =>
    api.post(`/cargo/claims/${enc(id)}/documents-upload-url`, file).then(r => r.data as SignedUpload),
  uploadDocument: async (id: string, file: File) =>
    uploadToSigned(await claimsAPI.documentUploadUrl(id, { content_type: file.type, size: file.size }), file),
}

/** React Query keys, so every screen invalidates the same caches. */
export const cargoKeys = {
  all: ['cargo'] as const,
  where: (ref: string) => ['cargo', 'where', ref] as const,
  lots: (ref: string) => ['cargo', 'lots', ref] as const,
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
  claim: (id: string) => ['cargo', 'claim', id] as const,
}
