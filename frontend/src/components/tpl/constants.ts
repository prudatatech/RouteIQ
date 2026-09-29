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
