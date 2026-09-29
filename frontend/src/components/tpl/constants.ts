/** Documents a 3PL applicant or partner can upload; matches backend TPL_DOCUMENT_TYPES. */
export const TPL_DOCUMENT_TYPES = ['PAN Card', 'GST Certificate', 'Cancelled Cheque', 'Signed Rate Agreement'] as const

export const SLA_COMMITMENT_OPTIONS = ['2 Hours', '4 Hours', '6 Hours', '12 Hours']

export const TAX_TREATMENT_OPTIONS = [
  '12% GTA (With ITC) - Forward Charge',
  '5% GTA (No ITC) - Reverse Charge',
]

export const CORRIDOR_PRIORITY_OPTIONS = [
  { value: '1', label: 'Priority 1 (first)' },
  { value: '2', label: 'Priority 2' },
  { value: '3', label: 'Priority 3 (backup)' },
]

/** Common lanes offered as suggestions in the corridor field (free text is still allowed). */
export const CORRIDOR_SUGGESTIONS = ['DEL-BOM', 'BOM-BLR', 'DEL-CCU', 'MAA-BLR', 'DEL-HYD', 'PNQ-BLR', 'AMD-BOM', 'DEL-MAA']

/** Common vehicle types offered as a multi-select in the corridor editor. */
export const VEHICLE_TYPE_SUGGESTIONS = [
  '32ft SXL', '32ft MXL', '24ft SXL', '20ft', '14ft Eicher',
  '17ft Eicher', '19ft Eicher', 'Tata Ace', 'Ashok Leyland Dost',
  'Bolero Pickup', '40ft Trailer', '40ft Flatbed', 'Refrigerated Van',
]

/** Split the comma-separated vehicle list stored on a corridor row. */
export function parseVehicleTypes(value: string): string[] {
  return value.split(',').map(v => v.trim()).filter(Boolean)
}

export type RateUnit = 'per_trip' | 'per_km'

export const RATE_UNIT_OPTIONS: { value: RateUnit; label: string }[] = [
  { value: 'per_trip', label: 'per trip' },
  { value: 'per_km', label: 'per km' },
]

/** One corridor & rate row in the onboarding form and the partner's settings tab. */
export interface CorridorFormRow {
  id: number
  name: string
  /** Comma-separated vehicle types. */
  vehicles: string
  /** The rate as a number typed by the partner (empty: they quote each load). */
  rate: string
  rate_unit: RateUnit
  /** An earlier free-text rate that is not a number. Shown and kept as written, never used to price a load. */
  legacy_rate?: string
  priority: string
}

export function emptyCorridorRow(): CorridorFormRow {
  return { id: Date.now() + Math.random(), name: '', vehicles: '', rate: '', rate_unit: 'per_trip', priority: '1' }
}

/** A corridor as the database returns it. */
export interface StoredCorridor {
  corridor_name: string
  vehicle_types?: string[] | string | null
  /** Readable rate text: "₹45,000 per trip" for a numeric rate, or the earlier free text. */
  proposed_rate?: string | null
  rate_amount?: number | string | null
  rate_unit?: RateUnit | null
  priority?: string | number | null
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** A rate as it is shown: numeric rates as amount and unit, older text as written, "Quoted per load" for none. */
export function rateText(amount: number | string | null | undefined, unit: RateUnit | null | undefined, legacy?: string | null): string {
  const n = Number(amount)
  if (amount != null && amount !== '' && Number.isFinite(n) && n > 0) {
    return `${rupees(n)} ${unit === 'per_km' ? 'per km' : 'per trip'}`
  }
  return legacy?.trim() || 'Quoted per load'
}

export const corridorRateText = (c: StoredCorridor) => rateText(c.rate_amount, c.rate_unit, c.proposed_rate)

/** A stored corridor as an editable form row. A rate that is not a number is carried as `legacy_rate`. */
export function corridorToFormRow(c: StoredCorridor, id: number): CorridorFormRow {
  const hasNumber = c.rate_amount != null && Number(c.rate_amount) > 0
  return {
    id,
    name: c.corridor_name,
    vehicles: Array.isArray(c.vehicle_types) ? c.vehicle_types.join(', ') : (c.vehicle_types || ''),
    rate: hasNumber ? String(Number(c.rate_amount)) : '',
    rate_unit: hasNumber && c.rate_unit ? c.rate_unit : 'per_trip',
    ...(!hasNumber && c.proposed_rate ? { legacy_rate: c.proposed_rate } : {}),
    priority: String(c.priority || '1'),
  }
}

/**
 * A corridor row saved in the browser before rates had a unit: a rate that is not a plain number
 * becomes the earlier text instead of a value that would be refused.
 */
export function normaliseDraftCorridor(row: Partial<CorridorFormRow> & { id: number; name: string }): CorridorFormRow {
  const rate = String(row.rate ?? '').trim()
  const isNumber = rate !== '' && Number.isFinite(Number(rate)) && Number(rate) > 0
  return {
    id: row.id,
    name: row.name,
    vehicles: row.vehicles ?? '',
    rate: isNumber ? rate : '',
    rate_unit: row.rate_unit === 'per_km' ? 'per_km' : 'per_trip',
    ...(row.legacy_rate ? { legacy_rate: row.legacy_rate } : rate && !isNumber ? { legacy_rate: rate } : {}),
    priority: row.priority ?? '1',
  }
}
