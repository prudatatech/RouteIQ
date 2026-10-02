import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, MessageSquarePlus, X } from 'lucide-react'
import {
  Alert, Button, EmptyState, ErrorState, Page, PageHeader, Skeleton, StatusPill, useConfirm,
} from '@/components/ui'
import { isNotFoundError } from '@/utils/display'
import { useReviewActions, useVendorReview } from '@/components/admin/vendor-review/useVendorReview'
import { AskMoreDetailsModal } from '@/components/admin/vendor-review/AskMoreDetailsModal'
import {
  AccountSection, ActivitySection, BusinessSection, DocumentsSection, HistorySection, KycFormSection, RequestsSection,
  StatusAlert, SummarySection, useDocumentViewer,
} from '@/components/admin/vendor-review/ReviewSections'
import type { VendorReview } from '@/components/admin/vendor-review/types'

const BACK = { to: '/admin/kyc', label: 'KYC review' }

const WHY_DISABLED: Record<string, string> = {
  pending: 'This vendor has not submitted KYC yet. You can decide once they do.',
  info_requested: 'You asked this vendor for more details. You can decide once they answer.',
  approved: 'This vendor is already approved.',
  rejected: 'This KYC was rejected. You can decide again once the vendor resubmits.',
}

export default function VendorReviewPage() {
  const { vendorId = '' } = useParams()
  const q = useVendorReview(vendorId)

  if (q.isLoading) {
    return (
      <Page>
        <PageHeader title="Vendor" back={BACK} />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </Page>
    )
  }
  if (q.isError || !q.data) {
    return (
      <Page>
        <PageHeader title="Vendor" back={BACK} />
        {isNotFoundError(q.error)
          ? <EmptyState title="No vendor here" description="This vendor does not exist or was removed." />
          : <ErrorState title="We could not load this vendor" description="Check your connection and try again." onRetry={() => q.refetch()} />}
      </Page>
    )
  }
  return <ReviewView id={vendorId} data={q.data} />
}

function ReviewView({ id, data }: { id: string; data: VendorReview }) {
  const { confirm, prompt } = useConfirm()
  const [askOpen, setAskOpen] = useState(false)
  const viewer = useDocumentViewer()
  const { approve, reject, askInfo } = useReviewActions(id, () => setAskOpen(false))
  const { account, business, kyc } = data
  const name = business?.business_name || kyc.form?.name || account.full_name || 'Unnamed vendor'
  const canDecide = kyc.status === 'submitted'
  const busy = approve.isPending || reject.isPending || askInfo.isPending

  const doApprove = async () => {
    const ok = await confirm({
      title: `Approve KYC for ${name}?`,
      message: 'Check the documents match the details first. Once approved, the vendor can post loads and bid.',
      confirmLabel: 'Approve KYC',
    })
    if (ok) approve.mutate()
  }
  const doReject = async () => {
    const reason = await prompt({
      title: `Reject KYC for ${name}?`,
      message: 'The vendor will see this reason and can correct and resubmit their KYC.',
      inputLabel: 'Reason',
      placeholder: 'What needs to be fixed?',
      confirmLabel: 'Reject KYC',
      tone: 'danger',
      required: true,
    })
    if (reason?.trim()) reject.mutate(reason.trim())
  }

  return (
    <Page>
      <PageHeader
        back={BACK}
        title={(
          <span className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 break-words">{name}</span>
            <StatusPill status={kyc.status} kind="kyc" />
          </span>
        )}
        description={[account.email, account.phone].filter(Boolean).join(' · ') || undefined}
        actions={(
          <>
            <Button variant="secondary" icon={<MessageSquarePlus size={16} />} disabled={!canDecide || busy} onClick={() => setAskOpen(true)}>Ask for more details</Button>
            <Button variant="secondary" icon={<X size={16} />} disabled={!canDecide || busy} loading={reject.isPending} onClick={doReject}>Reject</Button>
            <Button icon={<Check size={16} />} disabled={!canDecide || busy} loading={approve.isPending} onClick={doApprove}>Approve</Button>
          </>
        )}
      />

      {!canDecide && <Alert tone="info">{WHY_DISABLED[kyc.status] ?? 'This KYC cannot be decided now.'}</Alert>}
      <StatusAlert kyc={kyc} />

      <SummarySection data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AccountSection account={account} />
        <BusinessSection business={business} />
      </div>
      <KycFormSection form={kyc.form} ifscVerifiedAt={kyc.ifsc_verified_at} />
      <DocumentsSection documents={kyc.documents} viewer={viewer} />
      <RequestsSection requests={data.info_requests} viewer={viewer} />
      <ActivitySection activity={data.activity} />
      <HistorySection history={data.history} />

      {askOpen && (
        <AskMoreDetailsModal open vendorName={name} busy={askInfo.isPending} onClose={() => setAskOpen(false)} onSubmit={d => askInfo.mutate(d)} />
      )}
      {viewer.modal}
    </Page>
  )
}
