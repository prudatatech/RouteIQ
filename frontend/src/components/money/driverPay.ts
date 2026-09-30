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
  if (e.route_id) return `TR-${e.route_id.split('-')[0].toUpperCase()}`
  if (e.manifest_id) return `CM-${e.manifest_id.split('-')[0].toUpperCase()}`
  return 'Trip'
}
