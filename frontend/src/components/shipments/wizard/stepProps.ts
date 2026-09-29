import type { DraftShipmentData } from '@/store/draftStore'
import type { FieldErrors } from './validation'

export interface StepProps {
  data: DraftShipmentData
  update: (patch: Partial<DraftShipmentData>) => void
  errors: FieldErrors
}
