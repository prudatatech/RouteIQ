import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { vendorAPI } from '@/services/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { errorMessage, isNotFoundError } from '@/utils/display'
import type { InfoRequestInput } from './types'

export const reviewKey = (id: string) => ['vendor-review', id] as const

export function useVendorReview(id: string) {
  // The vendor may fix flagged documents or answer an info request while staff still have this page
  // open; without this, staff keep reviewing a stale snapshot until they manually reload.
  useRealtimeRefresh('vendor_review_page', ['vendor_profiles'], [reviewKey(id), ['vendor-registry']])
  return useQuery({
    queryKey: reviewKey(id),
    queryFn: () => vendorAPI.review(id),
    enabled: !!id,
    retry: (count, err) => !isNotFoundError(err) && count < 2,
  })
}

/** Approve, reject and ask-for-details, each refreshing the page and the list. */
export function useReviewActions(id: string, onDone?: () => void) {
  const queryClient = useQueryClient()
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: reviewKey(id) }),
    queryClient.invalidateQueries({ queryKey: ['vendor-registry'] }),
  ])
  const fail = (fallback: string) => (err: unknown) => toast.error(errorMessage(err, fallback))

  const approve = useMutation({
    mutationFn: () => vendorAPI.approveKyc(id),
    onSuccess: () => { toast.success('KYC approved. The vendor can now bid.'); onDone?.() },
    onError: fail('We could not approve this KYC. Try again.'),
    onSettled: refresh,
  })
  const reject = useMutation({
    mutationFn: (reason: string) => vendorAPI.rejectKyc(id, reason),
    onSuccess: () => { toast.success('KYC rejected. The vendor can correct and resubmit it.'); onDone?.() },
    onError: fail('We could not reject this KYC. Try again.'),
    onSettled: refresh,
  })
  const askInfo = useMutation({
    mutationFn: (data: { message?: string; items: InfoRequestInput[] }) => vendorAPI.requestKycInfo(id, data),
    onSuccess: () => { toast.success('Request sent. The vendor will see it when they sign in.'); onDone?.() },
    onError: fail('We could not send the request. Try again.'),
    onSettled: refresh,
  })
  const flagDocuments = useMutation({
    mutationFn: (issues: Record<string, string>) => vendorAPI.flagKycDocuments(id, issues),
    onSuccess: () => { toast.success('The vendor has been told which documents to fix.'); onDone?.() },
    onError: fail('We could not flag these documents. Try again.'),
    onSettled: refresh,
  })
  return { approve, reject, askInfo, flagDocuments }
}
