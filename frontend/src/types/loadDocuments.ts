/** Shapes of /api/v1/loads/:id/documents, dispatch-check, settlement and timeline (backend-ts/src/routes/load-documents.routes.ts). */

export type DocumentKind =
  | 'tax_invoice' | 'bill_of_supply' | 'delivery_challan' | 'eway_bill'
  | 'lr' | 'freight_sheet' | 'pod'
  | 'loading_report' | 'unloading_report' | 'damage_report' | 'trip_closure'

/** The kinds a vendor uploads. */
export type UploadKind = 'tax_invoice' | 'bill_of_supply' | 'delivery_challan' | 'eway_bill'

/** The kinds the logistic company generates. */
export type GenerateKind = 'lr' | 'freight_sheet' | 'pod' | 'loading_report' | 'unloading_report' | 'damage_report' | 'trip_closure'

export type DocumentStatus = 'draft' | 'final' | 'expired' | 'cancelled' | 'superseded'

/** A document as GET /loads/:id/documents returns it (DocumentView). */
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
  /** Display name of the kind. */
  label?: string
  /** `draft`/`final` becomes `expired` once an e-way bill is past valid_until. */
  effective_status?: DocumentStatus
  expired?: boolean
  /** Rendered to PDF on request; an upload has a file_url instead. */
  generated?: boolean
  /** A 10-minute signed link to the uploaded file. */
  file_url?: string | null
  /** For a POD: signed links to the delivery photos and the signature. */
  evidence?: { photo_urls: string[]; signature_url: string | null }
}

export type LoadViewer = 'vendor' | 'carrier' | 'platform'

export interface LoadDocumentsResponse {
  load: { id: string; code: string; status: string; viewer: LoadViewer; vendor_org_id: string | null; carrier_org_id: string | null }
  documents: LoadDocument[]
}

export interface DocumentInput {
  kind: DocumentKind
  number?: string
  doc_date?: string
  valid_until?: string
  fields: Record<string, unknown>
  file_path?: string
  status?: 'draft' | 'final'
}

export type DocumentPatch = Partial<Omit<DocumentInput, 'kind' | 'status'>> & { status?: DocumentStatus }

export interface UploadUrl {
  path: string
  token: string
  upload_url: string
  signed_url: string
  bucket: string
}

export interface DocumentEvent {
  action: string
  /** Each changed column or `fields.<key>` as { from, to }. */
  changes?: Record<string, { from: unknown; to: unknown }> | null
  version?: number
  by?: string | null
  by_name?: string | null
  by_role?: string | null
  at: string
}

export interface DocumentHistory {
  document_id: string
  events: DocumentEvent[]
}

export type CheckStatus = 'ok' | 'expiring' | 'missing' | 'expired' | 'inconsistent' | 'not_required'

export interface DispatchCheckItem {
  key: string
  label: string
  required: boolean
  status: CheckStatus
  message: string
  document_id: string | null
}

export interface DispatchCheck {
  load_id: string
  eway: { required: boolean; reason: string | null; declared_value: number | null; threshold: number }
  items: DispatchCheckItem[]
  issues: number
  ready: boolean
  /** 'block' when the company has turned blocking on. */
  mode: 'warn' | 'block'
  can_dispatch: boolean
}

/** All amounts are rupees. */
export interface ExtraCharge {
  idx: number
  label: string
  amount: number
  added_at: string | null
  approved: boolean
  approved_by: string | null
  approved_at: string | null
}

export interface Deduction {
  idx: number
  label: string
  amount: number
  reason: string | null
  added_at: string | null
}

export interface Settlement {
  id: string
  load_id?: string
  agreed_freight: number
  advance_paid: number
  extra_charges: ExtraCharge[]
  deductions: Deduction[]
  approved_extras_total: number
  pending_extras_total: number
  deductions_total: number
  /** Computed by the server: freight + approved extras - deductions - advance. */
  balance: number
  payment_terms: 'paid' | 'to_pay' | 'to_be_billed'
  payment_status: 'pending' | 'partial' | 'paid'
  pod_document_id: string | null
  closed_at: string | null
  status: 'open' | 'closed'
}

export interface ClosedSettlement extends Settlement {
  trip_closure_document_id: string
}

export interface TimelineEntry {
  at: string
  type: 'load' | 'document' | 'custody' | 'exception' | 'settlement'
  title: string
  detail: string | null
  by: string | null
  ref: Record<string, string | null>
}

export interface LoadTimelineResponse {
  load_id: string
  entries: TimelineEntry[]
}
