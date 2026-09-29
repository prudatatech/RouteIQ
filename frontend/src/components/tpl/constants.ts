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

/** One corridor & rate row in the onboarding form and the partner's settings tab. */
export interface CorridorFormRow {
  id: number
  name: string
  /** Comma-separated vehicle types. */
  vehicles: string
  rate: string
  priority: string
}

export function emptyCorridorRow(): CorridorFormRow {
  return { id: Date.now() + Math.random(), name: '', vehicles: '', rate: '', priority: '1' }
}
