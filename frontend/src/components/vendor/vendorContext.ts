import { useOutletContext } from 'react-router-dom'

export type KycStatus = 'pending' | 'submitted' | 'approved' | 'rejected'

export interface VendorProfileSummary {
  id: string
  company_name: string | null
  city: string | null
  company_logo: string | null
  kycStatus: KycStatus
}

export interface VendorOutletContext {
  /** Null for visitors and for signed-in vendors who have not created a profile yet. */
  vendorProfile: VendorProfileSummary | null
  profileLoading: boolean
  isSignedIn: boolean
  /** Re-read the profile, for example after the vendor saves their documents. */
  refreshProfile: () => void
}

/** Profile and sign-in state provided by VendorLayout to every vendor page. */
export function useVendorContext(): VendorOutletContext {
  return useOutletContext<VendorOutletContext>()
}
