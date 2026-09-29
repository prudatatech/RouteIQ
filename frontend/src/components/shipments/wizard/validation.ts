import type { DraftShipmentData } from '@/store/draftStore'

export const STEPS = [
  { id: 'route', label: 'Route' },
  { id: 'cargo', label: 'Cargo' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'review', label: 'Review' },
] as const
export type StepId = (typeof STEPS)[number]['id']

export type FieldErrors = Partial<Record<
  'origin' | 'destination' | 'scheduled_date' | 'total_items' | 'total_weight_kg' | 'length_cm' | 'width_cm' | 'height_cm' |
  'vehicle' | 'asking_price',
  string
>>

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Problems that stop the user leaving a step. Empty when the step is complete. */
export function validateStep(step: StepId, d: DraftShipmentData): FieldErrors {
  const e: FieldErrors = {}
  if (step === 'route') {
    if (!d.origin_lat || !d.origin_lng) e.origin = 'Choose a pickup address from the suggestions.'
    if (!d.dest_lat || !d.dest_lng) e.destination = 'Choose a destination from the suggestions.'
    if (d.plan_for_later) {
      if (!d.scheduled_date) e.scheduled_date = 'Choose a dispatch date.'
      else if (d.scheduled_date < todayIso()) e.scheduled_date = 'The dispatch date cannot be in the past.'
    }
  }
  if (step === 'cargo') {
    if (!Number.isInteger(Number(d.total_items)) || Number(d.total_items) < 1) e.total_items = 'Enter a whole number of 1 or more.'
    if (!(Number(d.total_weight_kg) > 0)) e.total_weight_kg = 'Enter a weight above 0.'
    if (!(Number(d.length_cm) > 0)) e.length_cm = 'Enter a length above 0.'
    if (!(Number(d.width_cm) > 0)) e.width_cm = 'Enter a width above 0.'
    if (!(Number(d.height_cm) > 0)) e.height_cm = 'Enter a height above 0.'
  }
  if (step === 'vehicle' && d.open_bidding) {
    if (!d.selectedVehicleId) e.vehicle = 'Choose the vehicle whose spare space vendors will bid on.'
    if (d.asking_price && !(Number(d.asking_price) > 0)) e.asking_price = 'Enter a price above 0, or leave it empty.'
  }
  return e
}

/** First step with a problem, so Review can send the user back to it. */
export function firstInvalidStep(d: DraftShipmentData): StepId | null {
  for (const s of STEPS) {
    if (Object.keys(validateStep(s.id, d)).length > 0) return s.id
  }
  return null
}
