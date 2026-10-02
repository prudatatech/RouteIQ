/** Shapes of /api/v1/loads/:id/documents, dispatch-check, settlement and timeline (docs/load-posting-design.md section 3). */

export type DocumentKind =
  | 'tax_invoice' | 'bill_of_supply' | 'delivery_challan' | 'eway_bill'
  | 'lr' | 'freight_sheet' | 'pod'
  | 'loading_report' | 'unloading_report' | 'damage_report' | 'trip_closure'

/** The kinds a vendor uploads. */
export type UploadKind = 'tax_invoice' | 'bill_of_supply' | 'delivery_challan' | 'eway_bill'

/** The kinds the logistic company generates. */
export type GenerateKind = 'lr' | 'freight_sheet' | 'trip_closure' | 'loading_report' | 'unloading_report' | 'damage_report'

export type DocumentStatus = 'draft' | 'final' | 'expired' | 'cancelled' | 'superseded'

export interface LoadDocument {
  id: string
  kind: DocumentKind
  number: string | null
  doc_date: string | null
  fields: Record<string, unknown>
  file_path: string | null
  status: DocumentStatus
  valid_until: string | null
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface DocumentInput {
  kind: DocumentKind
  number?: string
  doc_date?: string
  fields: Record<string, unknown>
  file_path?: string
}

export type DocumentPatch = Partial<Omit<DocumentInput, 'kind'>> & { status?: DocumentStatus; valid_until?: string }

export interface DocumentEvent {
  id?: string
  action: string
  changes?: Record<string, unknown> | null
  by?: string | null
  at: string
}

export type CheckStatus = 'ok' | 'missing' | 'expired' | 'mismatch'

export interface DispatchCheckItem {
  key: string
  label: string
  status: CheckStatus
  detail: string | null
  required: boolean
}

export interface DispatchCheck {
  items: DispatchCheckItem[]
  /** True when the company has turned blocking on and something required is not in order. */
  blocking: boolean
}

export interface ExtraCharge {
  label: string
  amount: number
  approved_by: string | null
  approved_at: string | null
}

export interface Deduction {
  label: string
  amount: number
  reason: string
}

export interface Settlement {
  id: string
  agreed_freight: number | null
  advance_paid: number | null
  extra_charges: ExtraCharge[]
  deductions: Deduction[]
  /** Computed by the server: freight + approved extras - deductions - advance. Rupees. */
  balance: number | null
  payment_terms: 'paid' | 'to_pay' | 'to_be_billed' | null
  payment_status: string | null
  pod_document_id: string | null
  closed_at: string | null
  status: 'open' | 'closed'
}

export interface TimelineItem {
  at: string
  kind: string
  title: string
  detail: string | null
}
