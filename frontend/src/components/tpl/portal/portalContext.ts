import { createContext, useContext } from 'react'
import type { CorridorFormRow, RateUnit } from '@/components/tpl/constants'

export interface PortalCorridor {
  id: string
  corridor_name: string
  vehicle_types: string[] | string | null
  proposed_rate: string | null
  rate_amount?: number | null
  rate_unit?: RateUnit | null
  priority: number | string | null
}

export interface PortalDocument {
  id: string
  doc_type: string
  file_url: string
  uploaded_at: string
}

export interface PortalPendingUpdates {
  sla_commitment?: string
  tax_treatment?: string
  corridors?: CorridorFormRow[]
}

export interface PortalPartner {
  id: string
  user_id?: string | null
  company_name: string
  custom_id?: string | null
  gstin?: string | null
  pan_number?: string | null
  msme_status?: string | null
  bank_account_no?: string | null
  bank_ifsc?: string | null
  bank_name?: string | null
  bank_branch?: string | null
  bank_ifsc_verified_at?: string | null
  status: string
  created_at: string
  sla_commitment?: string | null
  tax_treatment?: string | null
  pending_updates?: PortalPendingUpdates | null
  tpl_corridors?: PortalCorridor[]
  tpl_documents?: PortalDocument[]
}

export interface PortalContextValue {
  partner: PortalPartner
  corridors: PortalCorridor[]
  documents: PortalDocument[]
  /** Refetch the partner record (after the partner changes something). */
  reload: () => void
}

export const PortalContext = createContext<PortalContextValue | null>(null)

export function usePortal(): PortalContextValue {
  const ctx = useContext(PortalContext)
  if (!ctx) throw new Error('usePortal must be used inside the partner portal')
  return ctx
}

/** Vehicle types come as a list, or occasionally as one comma-separated string. */
export function vehicleList(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value
  return (value ?? '').split(',').map(v => v.trim()).filter(Boolean)
}
