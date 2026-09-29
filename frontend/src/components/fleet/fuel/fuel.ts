import { api } from '@/services/api'
import { supabase } from '@/services/supabase'
import type { Tone } from '@/components/ui'

export type FuelFlag = 'no_bill' | 'low_mileage' | 'over_tank_capacity' | 'odometer_backwards' | 'duplicate' | 'far_from_gps'
export type PaymentMode = 'cash' | 'card' | 'upi' | 'fuel_card' | 'credit' | 'other'

export interface FuelLog {
  id: string
  vehicle_id: string
  filled_at: string
  litres: number
  price_per_litre: number
  total_amount: number
  odometer_km: number | null
  is_full_tank: boolean
  station_name: string | null
  payment_mode: PaymentMode
  bill_status: 'with_bill' | 'no_bill'
  bill_path: string | null
  logged_by_role: string | null
  reviewed_at: string | null
  /** Set on the full fill that closes a stretch between two full fills. */
  distance_km: number | null
  litres_used: number | null
  mileage_kmpl: number | null
  flags: FuelFlag[]
  note: string | null
}

export interface FuelStats {
  vehicle_id: string
  fills: number
  no_bill_fills: number
  flagged_fills: number
  rolling_avg_kmpl: number | null
  last_kmpl: number | null
  cost_per_km: number | null
  month_spend: number
  month_litres: number
  month_fills: number
  last_fill_at: string | null
  trend: { date: string; kmpl: number; distance_km: number }[]
  tank_capacity_liters: number | null
  fuel_efficiency_kmpl: number | null
}

export interface FuelInput {
  litres?: number
  price_per_litre?: number
  total_amount?: number
  filled_at?: string
  odometer_km?: number | null
  is_full_tank: boolean
  station_name?: string | null
  payment_mode: PaymentMode
  bill_path?: string | null
}

export const fuelKeys = {
  logs: (vehicleId: string) => ['fleet-fuel-logs', vehicleId] as const,
  stats: (vehicleId: string) => ['fleet-fuel-stats', vehicleId] as const,
}

export const BILL_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
export const MAX_BILL_BYTES = 5 * 1024 * 1024

export const fuelAPI = {
  logs: (vehicleId: string) => api.get(`/fleet/vehicles/${vehicleId}/fuel-logs`).then(r => (Array.isArray(r.data) ? r.data : []) as FuelLog[]),
  stats: (vehicleId: string) => api.get(`/fleet/vehicles/${vehicleId}/fuel-stats`).then(r => r.data as FuelStats),
  create: (vehicleId: string, input: FuelInput) => api.post(`/fleet/vehicles/${vehicleId}/fuel-logs`, input).then(r => r.data as FuelLog),
  markReviewed: (logId: string, reviewed: boolean) => api.put(`/fleet/fuel-logs/${logId}`, { reviewed }).then(r => r.data as FuelLog),
  remove: (logId: string) => api.delete(`/fleet/fuel-logs/${logId}`),
  billUpload: (vehicleId: string, file: { content_type: string; size: number }) =>
    api.post(`/fleet/vehicles/${vehicleId}/fuel-logs/bill-upload`, file).then(r => r.data as { path: string; token: string; bucket: string }),
  billUrl: (logId: string) => api.get(`/fleet/fuel-logs/${logId}/bill-url`).then(r => r.data as { url: string }),
}

/** Uploads a bill through a signed URL from the backend and returns its storage path. */
export async function uploadBill(vehicleId: string, file: File): Promise<string> {
  const upload = await fuelAPI.billUpload(vehicleId, { content_type: file.type, size: file.size })
  const { error } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
  if (error) throw new Error('We could not upload the bill. Try again.')
  return upload.path
}

/** Opens a fill's bill in a new tab; the tab opens inside the click so popup blockers allow it. */
export async function openBill(logId: string): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const { url } = await fuelAPI.billUrl(logId)
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (err) {
    tab?.close()
    throw err
  }
}

// ── Labels ─────────────────────────────────────────────────

export const FLAG_LABELS: Record<FuelFlag, string> = {
  no_bill: 'No bill',
  low_mileage: 'Low mileage',
  over_tank_capacity: 'Over tank size',
  odometer_backwards: 'Odometer went back',
  duplicate: 'Possible duplicate',
  far_from_gps: 'Far from vehicle',
}

export const FLAG_HINTS: Record<FuelFlag, string> = {
  no_bill: 'No bill was attached. Check it before it is counted as verified.',
  low_mileage: 'Mileage over this stretch was more than 25% below this vehicle\'s recent average.',
  over_tank_capacity: 'More litres than the vehicle\'s tank holds.',
  odometer_backwards: 'The odometer reading is lower than an earlier fill. It is left out of mileage.',
  duplicate: 'Another fill of the same size was logged within 30 minutes. It is left out of mileage.',
  far_from_gps: 'The fill location was more than 5 km from where the vehicle was at that time.',
}

export const flagTone = (flag: FuelFlag): Tone => (flag === 'no_bill' ? 'warning' : 'danger')

export const PAYMENT_LABELS: Record<PaymentMode, string> = {
  cash: 'Cash', card: 'Card', upi: 'UPI', fuel_card: 'Fuel card', credit: 'Credit', other: 'Other',
}

export { deriveAmounts, formatKmpl, sendableAmounts, type AmountField, type AmountValues } from './amounts'
