import type { CustomerBooking } from '@/services/api'
import type { Tone } from '@/components/ui'
import { formatRupees } from '@/utils/display'
import { customerLabel } from '@/utils/customerProfile'

/**
 * A Request is demand we have not moved yet: a customer booking or a vendor's load. This file puts both in
 * one shape for the inbox, so tabs, filters, prices and the next step are decided in one place.
 */

export type RequestSource = 'customer' | 'vendor'
export const SOURCES = ['customer', 'vendor'] as const

export const STAGE_IDS = ['accept', 'accepted', 'progress', 'done', 'closed', 'all'] as const
export type StageId = typeof STAGE_IDS[number]
type Stage = Exclude<StageId, 'all'>

export const STAGE_LABELS: Record<StageId, string> = {
  accept: 'New loads',
  accepted: 'Accepted',
  progress: 'In progress',
  done: 'Done',
  closed: 'Rejected or cancelled',
  all: 'All',
}

export interface CargoDetails {
  category?: string
  name?: string
  noOfPackages?: number
  packagingType?: string
  declaredValue?: string | number
  /** Free text from the older form; the Post a Load form writes an object of flags ({ fragile: true }). */
  specialHandling?: string | Record<string, boolean>
  remarks?: string
}

/** A load a vendor posted (vendor_shipment_requests). */
export interface VendorRequest {
  id: string
  /** MRX-YYYY-NNNNN, set for loads posted through the Post a Load form. */
  load_number?: string | null
  vendor_id: string
  pickup_location: string
  pickup_lat: number
  pickup_lng: number
  drop_location: string
  drop_lat: number
  drop_lng: number
  required_capacity_kg: number
  status: string
  created_at: string
  updated_at: string | null
  assigned_vehicle_id: string | null
  /** The agreed price for the load, set when staff accept it. */
  cost: number | null
  cost_per_km: number | null
  rejection_reason: string | null
  metadata: {
    consignee?: { name?: string; contact?: string; email?: string }
    cargo?: CargoDetails
    /** The price the vendor offered on the Review step, in rupees. */
    offered_price_inr?: number
    dispatch_date?: string
    /** Posted loads: how a perishable load is kept (chilled, frozen, ambient). */
    temp_mode?: string | null
  } | null
  vendor: { company_name: string | null; city: string | null } | null
}

const CUSTOMER_STAGE: Record<CustomerBooking['status'], Stage> = {
  requested: 'accept',
  confirmed: 'accepted',
  assigned: 'progress',
  in_transit: 'progress',
  delivered: 'done',
  cancelled: 'closed',
}

const VENDOR_STAGE: Record<string, Stage> = {
  pending: 'accept',
  approved: 'accepted',
  escalated: 'accepted',
  assigned: 'progress',
  assigned_to_partner: 'progress',
  completed: 'done',
  fulfilled: 'done',
  rejected: 'closed',
  cancelled: 'closed',
}

export type PrimaryAction = 'accept' | 'assign' | 'open'

export interface RequestRow {
  /** Unique across both sources: `customer:<id>` or `vendor:<id>`. */
  key: string
  id: string
  source: RequestSource
  stage: Stage
  requester: string
  /** The requester's own page (a vendor in People). Null when there is none, as for customers. */
  requesterHref: string | null
  pickup: string
  drop: string
  pieces: number | null
  weightKg: number | null
  /** The pickup date the requester asked for (YYYY-MM-DD), if any. */
  wantedDate: string | null
  /** The agreed or quoted price, and what it is. */
  price: number | null
  priceKind: 'agreed' | 'quoted' | 'offered' | 'none'
  createdAt: string
  statusLabel: string
  statusTone: Tone
  action: PrimaryAction | null
  /** The shipment to open, when there is one. */
  shipmentId: string | null
  /** Tracking ID of that shipment, when known. */
  trackingId: string | null
  customer?: CustomerBooking
  vendor?: VendorRequest
}

export const shortPlace = (place: string | null | undefined) => (place ?? '').split(',')[0].trim() || '—'

/** Company, else the person's name, else "Customer 7701" from the phone (the server sends this as `customer.name`). */
export const customerName = (b: CustomerBooking) => customerLabel(b.customer)
export const vendorName = (r: VendorRequest) => r.vendor?.company_name || 'Unnamed vendor'

function bookingStatus(b: CustomerBooking): { label: string; tone: Tone } {
  if (b.shipment_status === 'exception' && !['delivered', 'cancelled'].includes(b.status)) return { label: 'Delivery failed', tone: 'danger' }
  switch (b.status) {
    case 'requested': return { label: 'New', tone: 'warning' }
    case 'confirmed': return { label: 'Accepted, needs a vehicle', tone: 'info' }
    case 'assigned': return { label: 'Vehicle assigned', tone: 'info' }
    case 'in_transit': return { label: 'On the way', tone: 'info' }
    case 'delivered': return { label: 'Delivered', tone: 'success' }
    default: return { label: 'Cancelled', tone: 'neutral' }
  }
}

function loadStatus(r: VendorRequest): { label: string; tone: Tone } {
  switch (r.status) {
    case 'pending': return { label: 'New', tone: 'warning' }
    case 'approved': return { label: 'Accepted, needs a vehicle', tone: 'info' }
    case 'escalated': return { label: 'With 3PL partners', tone: 'info' }
    case 'assigned': return { label: 'Vehicle assigned', tone: 'info' }
    case 'assigned_to_partner': return { label: 'With a 3PL partner', tone: 'info' }
    case 'completed':
    case 'fulfilled': return { label: 'Delivered', tone: 'success' }
    case 'rejected': return { label: 'Rejected', tone: 'danger' }
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral' }
    default: return { label: r.status.replace(/_/g, ' '), tone: 'neutral' }
  }
}

/** A booking whose vehicle can be chosen: waiting for one, or already has one (a failed delivery is handled on its shipment). */
export const bookingNeedsVehicle = (b: CustomerBooking) => b.status === 'confirmed' || b.status === 'assigned'
/** A load whose vehicle can be chosen: it is accepted at a price and has none yet. */
export const loadNeedsVehicle = (r: VendorRequest) => r.status === 'approved'

export function customerRow(b: CustomerBooking): RequestRow {
  const status = bookingStatus(b)
  const stage = CUSTOMER_STAGE[b.status] ?? 'accept'
  return {
    key: `customer:${b.id}`,
    id: b.id,
    source: 'customer',
    stage,
    requester: customerName(b),
    // Customers have no page on the web console yet, so there is nothing to link to
    requesterHref: null,
    pickup: b.pickup_name || b.pickup_address,
    drop: b.drop_name || b.drop_address,
    pieces: null,
    weightKg: Number(b.weight_kg),
    wantedDate: b.pickup_date ?? null,
    price: b.quoted_price != null ? Number(b.quoted_price) : null,
    priceKind: b.quoted_price != null ? (b.status === 'requested' ? 'quoted' : 'agreed') : 'none',
    createdAt: b.created_at,
    statusLabel: status.label,
    statusTone: status.tone,
    action: b.status === 'requested' ? 'accept' : b.status === 'confirmed' && !b.vehicle_id ? 'assign' : b.shipment_id ? 'open' : null,
    shipmentId: b.shipment_id,
    trackingId: b.tracking_id,
    customer: b,
  }
}

export function vendorRow(r: VendorRequest): RequestRow {
  const status = loadStatus(r)
  const stage = VENDOR_STAGE[r.status] ?? 'accept'
  const offered = r.metadata?.offered_price_inr
  const cost = r.cost != null ? Number(r.cost) : null
  const dispatch = r.metadata?.dispatch_date
  return {
    key: `vendor:${r.id}`,
    id: r.id,
    source: 'vendor',
    stage,
    requester: vendorName(r),
    requesterHref: r.vendor_id ? `/admin/users/${encodeURIComponent(r.vendor_id)}` : null,
    pickup: r.pickup_location,
    drop: r.drop_location,
    pieces: r.metadata?.cargo?.noOfPackages ? Number(r.metadata.cargo.noOfPackages) : null,
    weightKg: Number(r.required_capacity_kg),
    wantedDate: typeof dispatch === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dispatch) ? dispatch.slice(0, 10) : null,
    price: cost ?? (offered ? Number(offered) : null),
    priceKind: cost ? 'agreed' : offered ? 'offered' : 'none',
    createdAt: r.created_at,
    statusLabel: status.label,
    statusTone: status.tone,
    action: r.status === 'pending' ? 'accept' : loadNeedsVehicle(r) ? 'assign' : r.assigned_vehicle_id ? 'open' : null,
    // A vendor's load has no shipment row of its own; the shipment page reads it by the request id
    shipmentId: r.assigned_vehicle_id || ['completed', 'fulfilled'].includes(r.status) ? r.id : null,
    trackingId: `VR-${r.id.slice(0, 8).toUpperCase()}`,
    vendor: r,
  }
}

export const shipmentHref = (row: Pick<RequestRow, 'shipmentId'>) => (row.shipmentId ? `/shipments/${encodeURIComponent(row.shipmentId)}` : null)

/** Words for the price cell: "₹9,000", "₹9,000 quoted", "₹9,000 offered" or "Not priced". */
export function priceText(row: Pick<RequestRow, 'price' | 'priceKind'>): string {
  if (row.price == null) return 'Not priced'
  const amount = formatRupees(row.price)
  return row.priceKind === 'quoted' ? `${amount} quoted` : row.priceKind === 'offered' ? `${amount} offered` : amount
}

export function primaryLabel(row: Pick<RequestRow, 'action'>): string {
  return row.action === 'accept' ? 'Accept and price' : row.action === 'assign' ? 'Assign vehicle' : 'Open shipment'
}

export function stageCounts(rows: RequestRow[]): Record<StageId, number> {
  const counts: Record<StageId, number> = { accept: 0, accepted: 0, progress: 0, done: 0, closed: 0, all: rows.length }
  for (const r of rows) counts[r.stage]++
  return counts
}

/** Pending vendor loads are New loads. Only delegate them when the company board can actually render them. */
export function rowsForStage(rows: RequestRow[], stage: StageId, companyMarket: boolean): RequestRow[] {
  return rows.filter(r => (stage === 'all' || r.stage === stage)
    && !(stage === 'accept' && companyMarket && r.source === 'vendor'))
}

/** Old links carry the old tab names; map them to the inbox's tabs. */
const OLD_TABS: Record<RequestSource, Record<string, StageId>> = {
  customer: { new: 'accept', active: 'progress', done: 'done', cancelled: 'closed', all: 'all' },
  vendor: { open: 'accept', assigned: 'progress', completed: 'done', rejected: 'closed', all: 'all' },
}

export function stageFromOldTab(source: RequestSource, tab: string | null): StageId | null {
  return tab ? OLD_TABS[source][tab] ?? null : null
}

/** The link the old pages and their notifications used, rewritten for the inbox. */
export function inboxLink(source: RequestSource, search: string): string {
  const old = new URLSearchParams(search)
  const next = new URLSearchParams()
  next.set('source', source)
  const stage = stageFromOldTab(source, old.get('tab'))
  if (stage && stage !== 'accept') next.set('tab', stage)
  const open = old.get('open')
  if (open) next.set('open', open)
  const q = old.get('q')
  if (q) next.set('q', q)
  return `/requests?${next.toString()}`
}
