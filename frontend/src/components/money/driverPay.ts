import { tripNumber } from '@/utils/display'
import { manifestTrackingId } from '@/components/shipments/format'

/**
 * Driver pay (staff): the types the backend returns and the small rules the
 * Driver pay tab shows. Pay is a fixed amount per trip plus a rate per km, per vehicle type.
 */
export const PAY_VEHICLE_TYPES = ['truck', 'van', 'bike', 'car'] as const
export type PayVehicleType = (typeof PAY_VEHICLE_TYPES)[number]
export type PayStatus = 'earned' | 'approved' | 'paid' | 'void'
export type KmSource = 'gps' | 'planned' | 'estimated' | 'none'
export type PayoutMethod = 'cash' | 'bank' | 'upi'

export interface PayRate {
  id: string
  vehicle_type: PayVehicleType
  per_trip_amount: number
  per_km_amount: number
  effective_from: string
  active: boolean
  superseded_on: string | null
  state: 'current' | 'upcoming' | 'superseded' | 'withdrawn'
}

export interface PayEntry {
  id: string
  driver_id: string
  driver_name: string | null
  vehicle_id: string | null
  plate_number: string | null
  vehicle_type: string | null
  route_id: string | null
  manifest_id: string | null
  trip_date: string
  km: number
  km_source: KmSource
  per_trip_amount: number
  per_km_amount: number
  adjustments: Array<{ amount: number; reason: string; by: string; at: string }>
  amount: number
  rate_missing: boolean
  status: PayStatus
  void_reason: string | null
  payout_id: string | null
  paid_at: string | null
  /** The trip's own status. A cancelled trip is paid only for the leg that was driven. */
  route_status?: string | null
}

export interface PayEntriesResponse {
  entries: PayEntry[]
  totals: { earned: number; approved: number; paid: number }
  rate_missing_types: string[]
  truncated: boolean
}

export interface PayoutInput {
  driver_id: string
  entry_ids: string[]
  method: PayoutMethod
  reference?: string
  note?: string
  paid_at?: string
}

export const METHOD_LABEL: Record<PayoutMethod, string> = { cash: 'Cash', bank: 'Bank transfer', upi: 'UPI' }

export const STATUS_LABEL: Record<PayStatus, string> = { earned: 'Awaiting approval', approved: 'Approved', paid: 'Paid', void: 'Void' }
export const STATUS_TONE: Record<PayStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  earned: 'warning', approved: 'info', paid: 'success', void: 'neutral',
}

export const KM_SOURCE_LABEL: Record<KmSource, string> = {
  gps: 'Driven (GPS)', planned: 'Planned route', estimated: 'Straight line', none: 'Not known',
}

/** What each way of measuring the distance means, in plain words. */
export const KM_SOURCE_HELP: Record<KmSource, string> = {
  gps: 'Measured from the vehicle\'s GPS positions while it drove.',
  planned: 'The distance of the planned trip by road. It was not measured while driving.',
  estimated: 'Straight line: the distance between the stops as a bird flies, not by road. Roads are longer, so the real distance is more.',
  none: 'No distance could be worked out for this trip.',
}

/**
 * A line for a trip that did not run to its end. A cancelled trip is paid for the leg the driver
 * actually drove (up to the handover), not the whole plan; staff can adjust the amount while it is
 * not yet paid.
 */
export function partTripNote(e: Pick<PayEntry, 'route_status'>): string | null {
  return e.route_status === 'cancelled' ? 'Part trip: trip cancelled, paid for the leg driven' : null
}

export const typeLabel = (t: string | null | undefined) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Unknown type')

/** The rate in force on a date: the latest start on or before it among the rates that are not withdrawn. */
export function rateOn(rates: PayRate[], type: string, date: string): PayRate | null {
  return rates
    .filter(r => r.active && r.vehicle_type === type && r.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null
}

/** Approve is for entries waiting on it that have a real amount; an entry with no rate has to be priced first. */
export const canApprove = (e: PayEntry) => e.status === 'earned' && !e.rate_missing
export const canPay = (e: PayEntry) => e.status === 'approved'
export const canChange = (e: PayEntry) => e.status === 'earned' || e.status === 'approved'

/** What the selected approved entries come to, and whether they can be paid in one payout (one driver). */
export function payoutSummary(entries: PayEntry[]): { total: number; driverIds: string[]; single: boolean } {
  const total = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100
  const driverIds = [...new Set(entries.map(e => e.driver_id))]
  return { total, driverIds, single: driverIds.length === 1 }
}

/** A short code for the trip: TR-XXXXXXXX for a route, CM-XXXXXXXX for a vendor load. */
export function tripRef(e: Pick<PayEntry, 'route_id' | 'manifest_id'>): string {
  if (e.route_id) return tripNumber(e.route_id)
  if (e.manifest_id) return manifestTrackingId(e.manifest_id)
  return 'Trip'
}

/** The columns of the Driver pay CSV, in the order an accountant reads them. */
export const PAY_CSV_COLUMNS = [
  { key: 'trip_date', header: 'Trip date' },
  { key: 'driver', header: 'Driver' },
  { key: 'trip', header: 'Trip' },
  { key: 'vehicle', header: 'Vehicle' },
  { key: 'vehicle_type', header: 'Vehicle type' },
  { key: 'km', header: 'Distance (km)' },
  { key: 'km_basis', header: 'Distance basis' },
  { key: 'per_trip', header: 'Per trip (₹)' },
  { key: 'per_km', header: 'Per km (₹)' },
  { key: 'adjustments', header: 'Adjustments (₹)' },
  { key: 'pay', header: 'Pay (₹)' },
  { key: 'state', header: 'State' },
  { key: 'paid_on', header: 'Paid on' },
]

/** One trip's pay as a CSV row; `paidOn` is the formatted payment date, passed in so this stays free of date formats. */
export function payCsvRow(e: PayEntry, paidOn: string): Record<string, string | number> {
  return {
    trip_date: e.trip_date,
    driver: e.driver_name ?? 'Unnamed driver',
    trip: tripRef(e),
    vehicle: e.plate_number ?? '',
    vehicle_type: typeLabel(e.vehicle_type),
    km: Math.round(e.km * 10) / 10,
    km_basis: KM_SOURCE_LABEL[e.km_source],
    per_trip: e.per_trip_amount,
    per_km: e.per_km_amount,
    adjustments: Math.round(e.adjustments.reduce((n, a) => n + a.amount, 0) * 100) / 100,
    pay: e.amount,
    state: STATUS_LABEL[e.status],
    paid_on: e.status === 'paid' ? paidOn : '',
  }
}
