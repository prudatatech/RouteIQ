import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, FileText, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { vendorAPI } from '@/services/api'
import { getKycDocumentUrl } from '@/services/kycDocuments'
import {
  Alert, Button, DataTable, DetailList, Drawer, Page, PageHeader, SearchInput, StatusPill, statusToLabel, Tabs, TabPanel,
  buttonClasses, parseSort, serializeSort, useConfirm, useTabParam, useUrlState, type Column,
} from '@/components/ui'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { GstinStatus } from '@/components/tpl/GstinStatus'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { errorMessage, formatDateTime, formatRelative } from '@/utils/display'

type KycStatus = 'pending' | 'submitted' | 'approved' | 'rejected'

/** Form fields a vendor fills in on the KYC page (vendor_profiles.kyc_data.data). */
interface KycForm {
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
  docUrls?: Record<string, string | null | undefined>
}

interface VendorKyc {
  id: string
  company_name: string | null
  gst_number: string | null
  kyc_status: KycStatus
  kyc_reviewed_at: string | null
  kyc_rejection_reason: string | null
  updated_at: string | null
  created_at: string | null
  form: KycForm
  otherDocs: { name: string; path: string }[]
}

const docLabels: Record<string, string> = {
  softCopyExcel: 'Vendor form (spreadsheet)',
  softCopyPdf: 'Vendor form (PDF)',
  panScan: 'PAN card',
  cancelledCheque: 'Cancelled cheque',
  gstRegistration: 'GST registration',
  msmeCert: 'MSME certificate',
  companyLogo: 'Company logo',
}

const TAB_IDS = ['submitted', 'approved', 'rejected', 'pending', 'all'] as const
type TabId = typeof TAB_IDS[number]

const vendorName = (v: VendorKyc) => v.form.name || v.company_name || 'Unnamed vendor'

async function loadVendors(): Promise<VendorKyc[]> {
  const { data, error } = await supabase.from('vendor_profiles').select('*')
  if (error) throw error
  return (data ?? []).map(v => {
    const kyc = (v.kyc_data ?? {}) as { data?: KycForm; otherDocs?: { name: string; path: string }[] }
    const status = String(v.kyc_status || 'pending').toLowerCase()
    return {
      id: v.id,
      company_name: v.company_name ?? null,
      gst_number: v.gst_number ?? null,
      kyc_status: (['pending', 'submitted', 'approved', 'rejected'].includes(status) ? status : 'pending') as KycStatus,
      kyc_reviewed_at: v.kyc_reviewed_at ?? null,
      kyc_rejection_reason: v.kyc_rejection_reason ?? null,
      updated_at: v.updated_at ?? null,
      created_at: v.created_at ?? null,
      form: kyc.data ?? {},
      otherDocs: Array.isArray(kyc.otherDocs) ? kyc.otherDocs.filter(d => d?.path) : [],
    }
  })
}

async function countPendingPartners() {
  const { count, error } = await supabase.from('tpl_partners').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

export default function KycReviewPage() {
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const [tab, setTab] = useTabParam<TabId>(TAB_IDS, 'submitted')
  const [search, setSearch] = useUrlState('q', { debounceMs: 300 })
  const [sortParam, setSortParam] = useUrlState('sort', { fallback: tab === 'submitted' ? 'updated:asc' : 'updated:desc' })
  const sort = parseSort(sortParam)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const vendors = useQuery({ queryKey: ['kyc-vendors'], queryFn: loadVendors })
  const partners = useQuery({ queryKey: ['tpl-partners-pending-count'], queryFn: countPendingPartners })
  useRealtimeRefresh('kyc_review_page', ['vendor_profiles'], [['kyc-vendors']])
  useRealtimeRefresh('kyc_review_page_partners', ['tpl_partners'], [['tpl-partners-pending-count']])

  const review = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: 'approved' | 'rejected'; reason?: string }) => {
      // The backend decides only a submission still waiting for review, tells the
      // vendor and records the decision in the audit log.
      if (status === 'rejected') await vendorAPI.rejectKyc(id, reason!)
      else await vendorAPI.approveKyc(id)
    },
    onSuccess: (_d, { status }) => {
      toast.success(status === 'approved' ? 'KYC approved. The vendor can now bid.' : 'KYC rejected. The vendor can correct and resubmit it.')
      setSelectedId(null)
    },
    onError: err => toast.error(errorMessage(err, 'We could not save the review. Try again.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['kyc-vendors'] }),
  })

  const all = useMemo(() => vendors.data ?? [], [vendors.data])
  const counts = useMemo(() => {
    const c: Record<TabId, number> = { submitted: 0, approved: 0, rejected: 0, pending: 0, all: all.length }
    for (const v of all) c[v.kyc_status]++
    return c
  }, [all])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(v => (tab === 'all' || v.kyc_status === tab)
      && (!q || [vendorName(v), v.company_name, v.gst_number, v.form.gstNumber, v.form.panNumber].some(x => (x ?? '').toLowerCase().includes(q))))
  }, [all, tab, search])

  const selected = all.find(v => v.id === selectedId) ?? null

  const decide = async (v: VendorKyc, status: 'approved' | 'rejected') => {
    if (status === 'rejected') {
      const reason = await prompt({
        title: `Reject KYC for ${vendorName(v)}?`,
        message: 'The vendor will see this reason and can correct and resubmit their KYC.',
        inputLabel: 'Reason',
        placeholder: 'What needs to be fixed?',
        confirmLabel: 'Reject KYC',
        tone: 'danger',
        required: true,
      })
      if (reason) review.mutate({ id: v.id, status, reason })
      return
    }
    const ok = await confirm({
      title: `Approve KYC for ${vendorName(v)}?`,
      message: 'Check the documents match the details first. Once approved, the vendor can bid for space on your vehicles.',
      confirmLabel: 'Approve KYC',
    })
    if (ok) review.mutate({ id: v.id, status })
  }

  const columns: Column<VendorKyc>[] = [
    {
      key: 'vendor', header: 'Vendor',
      sortValue: v => vendorName(v).toLowerCase(),
      cell: v => {
        const gst = v.form.gstNumber || (v.gst_number !== 'PENDING' ? v.gst_number : null)
        return (
          <div className="min-w-0">
            <p className="font-medium text-text">{vendorName(v)}</p>
            <p className="font-mono text-xs text-muted">{gst ? `GST ${gst}` : 'No GST number'}</p>
          </div>
        )
      },
    },
    {
      key: 'status', header: 'Status',
      sortValue: v => statusToLabel(v.kyc_status, 'kyc'),
      cell: v => (
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill status={v.kyc_status} kind="kyc" />
          {v.kyc_status === 'submitted' && v.kyc_reviewed_at && <span className="text-xs text-muted">Resubmitted</span>}
        </span>
      ),
    },
    {
      key: 'updated', header: 'Updated',
      sortValue: v => (v.updated_at ? new Date(v.updated_at).getTime() : 0),
      cell: v => <span title={formatDateTime(v.updated_at)}>{v.updated_at ? formatRelative(v.updated_at) : '—'}</span>,
    },
    {
      key: 'reviewed', header: 'Last reviewed', hideBelow: 'lg',
      sortValue: v => (v.kyc_reviewed_at ? new Date(v.kyc_reviewed_at).getTime() : 0),
      cell: v => (v.kyc_reviewed_at ? formatDateTime(v.kyc_reviewed_at) : 'Never'),
    },
  ]

  const tabs = [
    { id: 'submitted' as const, label: 'Waiting for review', count: counts.submitted },
    { id: 'approved' as const, label: 'Approved', count: counts.approved },
    { id: 'rejected' as const, label: 'Rejected', count: counts.rejected },
    { id: 'pending' as const, label: 'Not submitted', count: counts.pending },
    { id: 'all' as const, label: 'All', count: counts.all },
  ]

  const emptyTitle: Record<TabId, string> = {
    submitted: 'Nothing waiting for review',
    approved: 'No approved vendors yet',
    rejected: 'No rejected KYC',
    pending: 'Every vendor has submitted KYC',
    all: 'No vendors yet',
  }

  const pendingPartners = partners.data ?? 0

  return (
    <Page>
      <PageHeader
        title="KYC review"
        description="Check each vendor’s company, bank and tax details against their documents. Vendors can bid only after approval."
      >
        <div className="space-y-4">
          {pendingPartners > 0 && (
            <Alert
              tone="info"
              title={`${pendingPartners.toLocaleString('en-IN')} 3PL partner ${pendingPartners === 1 ? 'application is' : 'applications are'} waiting`}
              action={<Link to="/3pl-partners?tab=pending" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Review 3PL partners</Link>}
            >
              3PL partners are verified with their lanes and rates, on the 3PL partners page.
            </Alert>
          )}
          <Tabs label="Filter by KYC status" tabs={vendors.isLoading ? tabs.map(t => ({ ...t, count: undefined })) : tabs} value={tab} onChange={setTab} />
          <SearchInput value={search} onChange={setSearch} label="Search vendors" placeholder="Search by company, GST or PAN" className="max-w-sm" />
        </div>
      </PageHeader>

      <TabPanel id={tab}>
        <DataTable
          caption="Vendor KYC"
          columns={columns}
          rows={rows}
          rowKey={v => v.id}
          loading={vendors.isLoading}
          error={vendors.error ? 'We could not load vendor KYC. Check your connection and try again.' : undefined}
          onRetry={() => vendors.refetch()}
          onRowClick={v => setSelectedId(v.id)}
          selectedKey={selectedId}
          sort={sort}
          onSortChange={s => setSortParam(serializeSort(s))}
          empty={search
            ? { title: 'No vendors match your search', action: <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> }
            : { title: emptyTitle[tab] }}
        />
      </TabPanel>

      <KycDrawer
        vendor={selected}
        onClose={() => setSelectedId(null)}
        pending={review.isPending ? review.variables?.status ?? null : null}
        onDecide={decide}
      />
    </Page>
  )
}

function KycDrawer({ vendor, onClose, pending, onDecide }: {
  vendor: VendorKyc | null
  onClose: () => void
  pending: 'approved' | 'rejected' | null
  onDecide: (v: VendorKyc, status: 'approved' | 'rejected') => void
}) {
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const f = vendor?.form ?? {}
  const documents = vendor ? [
    ...Object.entries(f.docUrls ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
      .map(([key, path]) => ({ key, label: docLabels[key] ?? key, path })),
    ...vendor.otherDocs.map((d, i) => ({ key: `other-${i}`, label: d.name || `Other document ${i + 1}`, path: d.path })),
  ] : []

  const openDocument = async (label: string, path: string, key: string) => {
    setOpening(key)
    try {
      setViewer({ url: await getKycDocumentUrl(path), name: label })
    } catch {
      toast.error('We could not open this document. Try again.')
    } finally {
      setOpening(null)
    }
  }

  const address = [f.addressLine1, f.addressLine2, f.city, f.state, f.postalCode, f.country].filter(Boolean).join(', ')
  const text = (v: string | undefined) => v || 'Not given'
  const mono = (v: string | undefined) => (v ? <span className="font-mono">{v}</span> : 'Not given')
  const canDecide = vendor?.kyc_status === 'submitted'

  return (
    <>
      <Drawer
        open={!!vendor}
        onClose={onClose}
        title={vendor ? vendorName(vendor) : 'KYC'}
        description={vendor ? statusToLabel(vendor.kyc_status, 'kyc') : undefined}
        size="xl"
        footer={canDecide && vendor ? (
          <>
            <Button variant="secondary" icon={<X size={16} />} disabled={!!pending} loading={pending === 'rejected'} onClick={() => onDecide(vendor, 'rejected')}>Reject KYC</Button>
            <Button icon={<Check size={16} />} disabled={!!pending} loading={pending === 'approved'} onClick={() => onDecide(vendor, 'approved')}>Approve KYC</Button>
          </>
        ) : undefined}
      >
        {vendor && (
          <div className="space-y-8">
            {vendor.kyc_status === 'submitted' && vendor.kyc_reviewed_at && (
              <Alert tone="warning" title="Changed since the last review">
                This vendor was last reviewed on {formatDateTime(vendor.kyc_reviewed_at)} and has since changed their details, so it needs another review.
              </Alert>
            )}
            {vendor.kyc_status === 'pending' && (
              <Alert tone="info">This vendor has not submitted KYC yet. You can review it once they do.</Alert>
            )}
            {vendor.kyc_status === 'rejected' && vendor.kyc_rejection_reason && (
              <Alert tone="danger" title="Rejected">{vendor.kyc_rejection_reason}</Alert>
            )}

            <section className="space-y-3">
              <h3 className="text-base font-semibold text-text">Company</h3>
              <DetailList items={[
                { label: 'Registered name', value: text(f.name || vendor.company_name || undefined) },
                { label: 'Vendor number', value: mono(f.number) },
                { label: 'Vendor type', value: text(f.vendorType) },
                { label: 'Address', value: text(address) },
              ]} />
            </section>

            <section className="space-y-3">
              <h3 className="text-base font-semibold text-text">Contact</h3>
              <DetailList items={[
                { label: 'Contact person', value: text(f.contactPerson) },
                { label: 'Email', value: text(f.emailAddress) },
                { label: 'Mobile', value: mono(f.mobileNumber) },
                { label: 'Telephone', value: mono(f.telephone) },
              ]} />
            </section>

            <section className="space-y-3">
              <h3 className="text-base font-semibold text-text">Bank</h3>
              <DetailList items={[
                { label: 'Account holder', value: text(f.beneficiaryAccountName) },
                { label: 'Bank and branch', value: text([f.bankName, f.bankBranchName].filter(Boolean).join(', ')) },
                { label: 'Account number', value: mono(f.bankAccountNumber) },
                { label: 'Account type', value: text(f.accountType) },
                { label: 'IFSC', value: mono(f.bankIfscCode) },
                { label: 'MICR', value: mono(f.bankMicrCode) },
              ]} />
            </section>

            <section className="space-y-3">
              <h3 className="text-base font-semibold text-text">Tax</h3>
              <DetailList items={[
                { label: 'PAN', value: mono(f.panNumber) },
                { label: 'TAN', value: mono(f.tanNumber) },
                { label: 'GST number', value: f.gstNumber ? <div>{mono(f.gstNumber)}<GstinStatus gstin={f.gstNumber} pan={f.panNumber} /></div> : text(f.reasonNoGst ? `None: ${f.reasonNoGst}` : undefined) },
                { label: 'MSME', value: text([f.msmeStatus, f.msmeRegNumber].filter(Boolean).join(', ')) },
              ]} />
            </section>

            <section className="space-y-3">
              <h3 className="text-base font-semibold text-text">Documents</h3>
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
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={opening === d.key}
                        disabled={opening !== null && opening !== d.key}
                        onClick={() => openDocument(d.label, d.path, d.key)}
                        aria-label={`View ${d.label}`}
                      >
                        View
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <DocumentViewerModal
        isOpen={!!viewer}
        onClose={() => setViewer(null)}
        fileUrl={viewer?.url ?? ''}
        fileName={viewer?.name ?? ''}
      />
    </>
  )
}
