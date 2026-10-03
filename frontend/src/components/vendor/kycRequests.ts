import { useQuery } from '@tanstack/react-query'
import { vendorAPI } from '@/services/api'
import type { InfoAnswer, VendorKycRequest } from '@/components/admin/vendor-review/types'

export const kycRequestsKey = ['vendor', 'kyc-requests'] as const

/** The vendor's open asks from the review team. Empty while loading or when there are none. */
export function useKycRequests(enabled: boolean) {
  return useQuery({ queryKey: kycRequestsKey, queryFn: () => vendorAPI.kycRequests(), enabled, retry: false })
}

/** Answers that can be sent: every item has text or an uploaded document. */
export function collectAnswers(request: VendorKycRequest, text: Record<string, string>, docs: Record<string, string>): InfoAnswer[] | null {
  const answers: InfoAnswer[] = []
  for (const item of request.items) {
    if (item.kind === 'document') {
      if (!docs[item.key]) return null
      answers.push({ key: item.key, document_path: docs[item.key] })
    } else {
      const t = (text[item.key] ?? '').trim()
      if (!t) return null
      answers.push({ key: item.key, text: t })
    }
  }
  return answers
}
