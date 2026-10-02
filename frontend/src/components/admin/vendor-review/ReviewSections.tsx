import { useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { FileText } from 'lucide-react'
import { Alert, Button, Card, DetailList, IfscVerifiedHint, StatusPill, Timeline, type TimelineEvent } from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { GstinStatus } from '@/components/tpl/GstinStatus'
import { getKycDocumentUrl } from '@/services/kycDocuments'
import { formatDateTime } from '@/utils/display'
import { auditActionLabel } from '@/utils/auditLabels'
import type { InfoRequest, KycFormView, VendorReview } from './types'

const given = (v: string | null | undefined) => (v && v.trim() ? v : 'Not given')
const mono = (v: string | null | undefined) => (v && v.trim() ? <span className="font-mono break-all">{v}</span> : 'Not given')
const when = (v: string | null | undefined) => (v ? formatDateTime(v) : 'Never')
const n = (v: number) => v.toLocaleString('en-IN')

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card padded className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </Card>
  )
}

export function SummarySection({ data }: { data: VendorReview }) {
  const { account, business, kyc, history } = data
  const submitted = history.find(h => /kyc_submitted|submit/i.test(h.action))?.at ?? (kyc.status !== 'pending' ? kyc.updated_at : null)
  const events: (TimelineEvent | null)[] = [
    { status: 'registered', at: account.created_at ?? '', label: 'Registered' },
    business && business.business_name ? { status: 'profile', at: account.created_at ?? '', label: 'Business profile filled' } : null,
    submitted ? { status: 'submitted', at: submitted, label: 'KYC submitted' } : null,
    kyc.reviewed_at ? { status: kyc.status, at: kyc.reviewed_at, label: kyc.status === 'rejected' ? 'Rejected' : kyc.status === 'approved' ? 'Approved' : 'Reviewed' } : null,
  ]
  const steps = events.filter((e): e is TimelineEvent => !!e && !!e.at)
  return (
    <Section title="Summary" description="Where this vendor is, from sign-up to a decision.">
      <Timeline events={steps} formatAt={v => formatDateTime(v)} />
      {!kyc.reviewed_at && <p className="text-sm text-muted">No decision yet.</p>}
    </Section>
  )
}

export function AccountSection({ account }: { account: VendorReview['account'] }) {
  return (
    <Section title="Account">
      <DetailList items={[
        { label: 'Name', value: given(account.full_name) },
        { label: 'Email', value: given(account.email) },
        { label: 'Phone', value: mono(account.phone) },
        { label: 'Joined', value: when(account.created_at) },
        { label: 'Last sign-in', value: when(account.last_sign_in_at) },
      ]} />
    </Section>
  )
}

export function BusinessSection({ business }: { business: VendorReview['business'] }) {
  if (!business) {
    return <Section title="Business"><p className="text-sm text-muted">This vendor has not filled in a business profile yet.</p></Section>
  }
  return (
    <Section title="Business" description="From the company profile the vendor created at sign-up.">
      <DetailList items={[
        { label: 'Business name', value: given(business.business_name) },
        { label: 'Contact', value: given(business.contact_name) },
        { label: 'Account type', value: given(business.account_type) },
        { label: 'Business type', value: given(business.business_type) },
        { label: 'Loads a month', value: given(business.monthly_loads) },
        { label: 'GSTIN', value: business.gstin ? <div>{mono(business.gstin)}<GstinStatus gstin={business.gstin} /></div> : 'Not given' },
        { label: 'Address', value: given(business.address) },
        { label: 'Pin code', value: mono(business.pincode) },
        { label: 'State', value: given(business.state) },
      ]} />
    </Section>
  )
}

export function KycFormSection({ form, ifscVerifiedAt }: { form: KycFormView; ifscVerifiedAt: string | null }) {
  const f = form ?? {}
  const address = [f.addressLine1, f.addressLine2, f.city, f.state, f.postalCode, f.country].filter(Boolean).join(', ')
  const extra = Object.entries(f.extra ?? {}).filter(([, v]) => v)
  const group = (title: string, items: { label: string; value: ReactNode }[]) => (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      <DetailList items={items} />
    </div>
  )
  return (
    <Section title="KYC form" description="What the vendor entered on the KYC page.">
      <div className="space-y-6">
        {group('Company', [
          { label: 'Registered name', value: given(f.name) },
          { label: 'Vendor number', value: mono(f.number) },
          { label: 'Vendor type', value: given(f.vendorType) },
          { label: 'Address', value: given(address) },
        ])}
        {group('Contact', [
          { label: 'Contact person', value: given(f.contactPerson) },
          { label: 'Email', value: given(f.emailAddress) },
          { label: 'Mobile', value: mono(f.mobileNumber) },
          { label: 'Telephone', value: mono(f.telephone) },
        ])}
        {group('Bank', [
          { label: 'Account holder', value: given(f.beneficiaryAccountName) },
          { label: 'Bank and branch', value: given([f.bankName, f.bankBranchName].filter(Boolean).join(', ')) },
          { label: 'Account number', value: mono(f.bankAccountNumber) },
          { label: 'Account type', value: given(f.accountType) },
          { label: 'IFSC', value: <div>{mono(f.bankIfscCode)} {f.bankIfscCode ? <IfscVerifiedHint verifiedAt={ifscVerifiedAt} /> : null}</div> },
          { label: 'MICR', value: mono(f.bankMicrCode) },
        ])}
        {group('Tax', [
          { label: 'PAN', value: mono(f.panNumber) },
          { label: 'TAN', value: mono(f.tanNumber) },
          { label: 'GST number', value: f.gstNumber ? <div>{mono(f.gstNumber)}<GstinStatus gstin={f.gstNumber} pan={f.panNumber} /></div> : given(f.reasonNoGst ? `None: ${f.reasonNoGst}` : undefined) },
          { label: 'MSME', value: given([f.msmeStatus, f.msmeRegNumber].filter(Boolean).join(', ')) },
        ])}
        {extra.length > 0 && group('Extra details the vendor sent', extra.map(([label, value]) => ({ label, value })))}
      </div>
    </Section>
  )
}

/** The documents list with a viewer; also used to open documents a vendor attached to an answer. */
export function useDocumentViewer() {
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const open = async (label: string, path: string, key: string) => {
    setOpening(key)
    try {
      setViewer({ url: await getKycDocumentUrl(path), name: label })
    } catch {
      toast.error('We could not open this document. Try again.')
    } finally {
      setOpening(null)
    }
  }
  const modal = <DocumentViewerModal isOpen={!!viewer} onClose={() => setViewer(null)} fileUrl={viewer?.url ?? ''} fileName={viewer?.name ?? ''} />
  return { open, opening, modal }
}

type Viewer = ReturnType<typeof useDocumentViewer>

function DocButton({ viewer, label, path, id }: { viewer: Viewer; label: string; path: string; id: string }) {
  return (
    <Button size="sm" variant="secondary" loading={viewer.opening === id} disabled={viewer.opening !== null && viewer.opening !== id} onClick={() => viewer.open(label, path, id)} aria-label={`View ${label}`}>
      View
    </Button>
  )
}

export function DocumentsSection({ documents, viewer }: { documents: VendorReview['kyc']['documents']; viewer: Viewer }) {
  return (
    <Section title="Documents">
      {documents.length === 0 ? (
        <p className="text-sm text-muted">No documents uploaded.</p>
      ) : (
        <ul className="divide-y divide-border rounded-control border border-border">
          {documents.map(d => (
            <li key={d.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm text-text">
                <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
                <span className="truncate">{d.label}</span>
              </span>
              <DocButton viewer={viewer} label={d.label} path={d.path} id={d.key} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function RequestCard({ r, viewer }: { r: InfoRequest; viewer: Viewer }) {
  const answerFor = (key: string) => (Array.isArray(r.answers) ? r.answers : []).find(a => a.key === key)
  return (
    <li className="space-y-3 rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={r.status === 'open' ? 'warning' : 'success'}>{r.status === 'open' ? 'Waiting for the vendor' : 'Answered'}</StatusPill>
        <span className="text-xs text-muted">Asked {formatDateTime(r.requested_at)}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''}</span>
        {r.answered_at && <span className="text-xs text-muted">Answered {formatDateTime(r.answered_at)}</span>}
      </div>
      {r.message && <p className="text-sm text-text">{r.message}</p>}
      <ul className="space-y-2">
        {r.items.map(item => {
          const a = answerFor(item.key)
          return (
            <li key={item.key} className="text-sm">
              <p className="font-medium text-text">{item.label} <span className="font-normal text-muted">({item.kind === 'document' ? 'document' : 'text'})</span></p>
              {item.hint && <p className="text-xs text-muted">{item.hint}</p>}
              {r.status === 'answered' && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-text">
                  {a?.text ? <span className="whitespace-pre-wrap">{a.text}</span> : null}
                  {a?.document_path ? <DocButton viewer={viewer} label={item.label} path={a.document_path} id={`${r.id}-${item.key}`} /> : null}
                  {!a?.text && !a?.document_path && <span className="text-muted">No answer</span>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </li>
  )
}

export function RequestsSection({ requests, viewer }: { requests: InfoRequest[]; viewer: Viewer }) {
  return (
    <Section title="More-details requests" description="Everything you have asked this vendor for, and what they sent back.">
      {requests.length === 0 ? <p className="text-sm text-muted">You have not asked this vendor for anything.</p> : (
        <ul className="space-y-3">{requests.map(r => <RequestCard key={r.id} r={r} viewer={viewer} />)}</ul>
      )}
    </Section>
  )
}

export function ActivitySection({ activity }: { activity: VendorReview['activity'] }) {
  return (
    <Section title="Activity" description="How this vendor uses the platform.">
      <DetailList columns={3} items={[
        { label: 'Loads posted', value: n(activity.loads_total) },
        { label: 'Open loads', value: n(activity.loads_open) },
        { label: 'Awarded loads', value: n(activity.loads_awarded) },
        { label: 'Invoices', value: n(activity.invoices) },
        { label: 'Last load', value: activity.last_load_at ? formatDateTime(activity.last_load_at) : 'No loads yet' },
      ]} />
    </Section>
  )
}

export function HistorySection({ history }: { history: VendorReview['history'] }) {
  const sorted = [...history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return (
    <Section title="History" description="Every review action, newest first.">
      {sorted.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
        <ul className="divide-y divide-border">
          {sorted.map((h, i) => (
            <li key={`${h.at}-${i}`} className="py-2 text-sm">
              <p className="font-medium text-text">{auditActionLabel(h.action)}</p>
              <p className="text-xs text-muted">{formatDateTime(h.at)}{h.actor ? ` · ${h.actor}` : ''}</p>
              {typeof h.detail === 'string' && h.detail && <p className="mt-0.5 text-text">{h.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function StatusAlert({ kyc }: { kyc: VendorReview['kyc'] }) {
  if (kyc.status === 'rejected' && kyc.rejection_reason) return <Alert tone="danger" title="Rejected">{kyc.rejection_reason}</Alert>
  if (kyc.status === 'approved') return <Alert tone="success" title="Approved">This vendor can post loads and bid.</Alert>
  if (kyc.status === 'submitted' && kyc.reviewed_at) {
    return <Alert tone="warning" title="Changed since the last review">Last reviewed on {formatDateTime(kyc.reviewed_at)}; the vendor has changed their details since, so it needs another review.</Alert>
  }
  return null
}
