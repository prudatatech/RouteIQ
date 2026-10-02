/**
 * Contracts for the anchor network (docs/network-design.md). Every call that returns or sends these lives in
 * services/api.ts (tplPortalAPI, networkAPI), so a contract fix is a change to those two files and this one.
 */

/** A vehicle a 3PL partner registered. Field names match the company vehicle form. */
export interface NetVehicle {
  id: string
  plate_number: string
  vehicle_type: string
  body_type?: string | null
  vehicle_class?: string | null
  vehicle_model?: string | null
  capacity_kg: number | null
  status?: string | null
  hazmat_certified?: boolean | null
  is_reefer?: boolean | null
  rc_number?: string | null
  rc_expiry?: string | null
  insurance_number?: string | null
  insurance_expiry?: string | null
  fitness_certificate_number?: string | null
  fitness_expiry?: string | null
  permit_number?: string | null
  permit_expiry?: string | null
  puc_number?: string | null
  puc_expiry?: string | null
}

/** What the partner types into the vehicle form: blank dates and numbers are left out when sent. */
export type NetVehicleInput = Partial<Omit<NetVehicle, 'id'>> & { plate_number: string }

export interface NetDriver {
  id: string
  full_name: string | null
  phone: string | null
  status?: string | null
}

export type StatementStatus = 'draft' | 'issued' | 'paid'

export interface StatementDeduction {
  label: string
  amount_paise: number
  reason: string
}

/** Money is whole paise; the balance is always worked out by the server. */
export interface NetStatement {
  id: string
  partner_org_id?: string
  company_org_id?: string
  partner_name?: string | null
  company_name?: string | null
  /** YYYYMM */
  period: string
  orders_total_paise: number
  deductions: StatementDeduction[]
  balance_paise: number
  status: StatementStatus
  issued_at?: string | null
  paid_at?: string | null
  paid_reference?: string | null
  pdf_url?: string | null
}

/** Offers or orders, grouped by the company that handed them over. */
export interface CompanyGroup<T> {
  org_id: string
  name: string
  items: T[]
}

export interface Grouped<T> {
  items: T[]
  companies: CompanyGroup<T>[]
}

export interface PartnerFleetSummary {
  vehicles_total: number
  available: number
  on_trip: number
  maintenance: number
  by_class: Record<string, number>
  docs_ok: number
  docs_expiring: number
}

export interface AffiliationRules {
  vehicle_classes?: string[]
  corridor_ids?: string[]
  min_rate_per_km?: number | null
  gps_required?: boolean
  insurance_required?: boolean
}

export interface ExcludedPartner {
  partner_id: string
  name: string
  reason: string
}
