/** Shapes of the vendor review API (/vendor/registry, /vendor/kyc/requests). Kept in one place so a backend change is a one-line fix. */

export type KycStatus = 'pending' | 'submitted' | 'info_requested' | 'approved' | 'rejected'
export const KYC_STATUSES: KycStatus[] = ['pending', 'submitted', 'info_requested', 'approved', 'rejected']

export interface RegistryRow {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  created_at: string | null
  kyc_status: KycStatus
  org_status: string | null
  gstin: string | null
  city: string | null
  updated_at: string | null
  kyc_reviewed_at: string | null
  open_requests: number
}

export interface RegistryList { items: RegistryRow[]; total: number }

/** Form fields a vendor fills in on the KYC page, under the key names the vendor form stores. */
export interface KycFormView {
  name?: string
  number?: string
  country?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  contactPerson?: string
  telephone?: string
  mobileNumber?: string
  emailAddress?: string
  bankAccountNumber?: string
  beneficiaryAccountName?: string
  bankName?: string
  bankBranchName?: string
  bankIfscCode?: string
  bankMicrCode?: string
  accountType?: string
  panNumber?: string
  tanNumber?: string
  gstNumber?: string
  vendorType?: string
  reasonNoGst?: string
  msmeStatus?: string
  msmeRegNumber?: string
  /** Answers to questions the review team asked, by label. */
  extra?: Record<string, string>
}

export interface RequestItem { key: string; label: string; kind: 'text' | 'document'; hint?: string | null }

export interface InfoAnswer { key: string; text?: string | null; document_path?: string | null }

export interface InfoRequest {
  id: string
  message: string | null
  items: RequestItem[]
  status: 'open' | 'answered'
  requested_at: string
  requested_by_name: string | null
  answered_at: string | null
  /** A list once answered; the server sends an empty object while open. */
  answers: InfoAnswer[] | Record<string, never> | null
}

export interface VendorReview {
  account: { id: string; email: string | null; phone: string | null; full_name: string | null; created_at: string | null; last_sign_in_at: string | null }
  business: {
    org_id: string | null; org_status: string | null; business_name: string | null; contact_name: string | null
    account_type: string | null; business_type: string | null; monthly_loads: string | null
    gstin: string | null; gstin_status: string | null; address: string | null; pincode: string | null
    state: string | null; state_code: string | null; email: string | null
  } | null
  kyc: {
    status: KycStatus
    reviewed_at: string | null
    rejection_reason: string | null
    updated_at: string | null
    form: KycFormView
    documents: { key: string; label: string; path: string }[]
    ifsc_verified_at: string | null
  }
  info_requests: InfoRequest[]
  history: { at: string; actor: string | null; action: string; detail: unknown }[]
  activity: { loads_total: number; loads_open: number; loads_awarded: number; invoices: number; last_load_at: string | null }
}

export interface InfoRequestInput { label: string; kind: 'text' | 'document'; hint?: string }

/** What a vendor sees: the open asks from the review team. */
export interface VendorKycRequest { id: string; message: string | null; items: RequestItem[]; requested_at: string }
