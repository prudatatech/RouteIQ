import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, FileText, Trash2, Upload } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useVendorContext } from '@/components/vendor/vendorContext'
import { getKycDocumentUrl, uploadKycDocument } from '@/services/kycDocuments'
import AddressPicker from '@/components/map/AddressPicker'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { Alert, Button, Card, Checkbox, Input, Page, PageHeader, Select, Spinner, useConfirm } from '@/components/ui'
import type { ResolvedPlace } from '@/services/geocoding'

type KycStatus = 'pending' | 'submitted' | 'approved' | 'rejected'

interface DocRef { name: string; path: string }

interface KycFormData {
  name: string
  country: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  latitude: string
  longitude: string
  contactPerson: string
  telephone: string
  mobileNumber: string
  emailAddress: string
  beneficiaryAccountName: string
  bankAccountNumber: string
  bankName: string
  bankBranchName: string
  bankIfscCode: string
  accountType: string
  panNumber: string
  gstNumber: string
  vendorType: string
  msmeStatus: string
  msmeRegNumber: string
  declaration: boolean
  docUrls: Record<string, string>
}

const EMPTY_FORM: KycFormData = {
  name: '', country: 'India', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '',
  latitude: '', longitude: '',
  contactPerson: '', telephone: '', mobileNumber: '', emailAddress: '',
  beneficiaryAccountName: '', bankAccountNumber: '', bankName: '', bankBranchName: '', bankIfscCode: '', accountType: 'Current',
  panNumber: '', gstNumber: '', vendorType: 'Service provider',
  msmeStatus: 'Not applicable', msmeRegNumber: '',
  declaration: false,
  docUrls: {},
}

const VENDOR_TYPES = [
  { value: 'Manufacturer', label: 'Manufacturer' },
  { value: 'Trader', label: 'Trader' },
  { value: 'Consultant', label: 'Consultant' },
  { value: 'Service provider', label: 'Service provider' },
]

const MSME_STATUSES = [
  { value: 'Not applicable', label: 'Not applicable' },
  { value: 'Registered', label: 'Registered' },
  { value: 'Applied', label: 'Applied' },
]

const ACCOUNT_TYPES = [
  { value: 'Savings', label: 'Savings' },
  { value: 'Current', label: 'Current' },
]

const DOC_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'panScan', label: 'PAN card', hint: 'PDF or image' },
  { key: 'cancelledCheque', label: 'Cancelled cheque', hint: 'For the bank account above' },
  { key: 'gstRegistration', label: 'GST registration', hint: 'If registered for GST' },
  { key: 'msmeCert', label: 'Company registration / MSME certificate' },
  { key: 'companyLogo', label: 'Company logo', hint: 'Shown in the header once approved' },
]

const STEPS = ['Company', 'Contact & address', 'Documents', 'Declaration & review'] as const

/**
 * The company & KYC wizard, shared by the first-time setup flow (/vendor/onboarding)
 * and the ongoing "Company & KYC" page (/vendor/documents). Both routes render this
 * component; `mode` only changes copy and where a first save sends the vendor.
 */
export default function VendorDocumentsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const userId = useAuthStore(s => s.userId)
  const { confirm } = useConfirm()
  const { refreshProfile } = useVendorContext()

  const mode: 'onboarding' | 'documents' = location.pathname.startsWith('/vendor/onboarding') ? 'onboarding' : 'documents'

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [kycStatus, setKycStatus] = useState<KycStatus>('pending')
  const [kycRejectionReason, setKycRejectionReason] = useState<string | null>(null)
  const [hasProfile, setHasProfile] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const isEditingRef = useRef(false)
  const setIsEditingKyc = (v: boolean) => { isEditingRef.current = v; setIsEditing(v) }

  const [step, setStep] = useState(0)
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})
  const [form, setForm] = useState<KycFormData>(EMPTY_FORM)
  const [otherDocs, setOtherDocs] = useState<DocRef[]>([])
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null)

  const setField = <K extends keyof KycFormData>(key: K, value: KycFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = async () => {
      const { data: profile, error } = await supabase.from('vendor_profiles').select('*').eq('id', userId).maybeSingle()
      if (cancelled) return
      if (error) { console.error('Failed to load vendor profile', error); setLoading(false); return }
      if (!profile) { setHasProfile(false); setLoading(false); return }
      setHasProfile(true)
      const status = String(profile.kyc_status ?? 'pending').toLowerCase() as KycStatus
      setKycStatus(['pending', 'submitted', 'approved', 'rejected'].includes(status) ? status : 'pending')
      setKycRejectionReason(profile.kyc_rejection_reason ?? null)

      if (!isEditingRef.current) {
        const kycData = profile.kyc_data as { data?: Partial<KycFormData>; otherDocs?: DocRef[] } | null
        if (kycData?.data && Object.keys(kycData.data).length > 0) {
          setForm(prev => ({ ...prev, ...kycData.data }))
        } else {
          setForm(prev => ({
            ...prev,
            name: profile.company_name || '',
            gstNumber: profile.gst_number || '',
            addressLine1: profile.address || '',
            city: profile.city || '',
            latitude: profile.latitude != null ? String(profile.latitude) : '',
            longitude: profile.longitude != null ? String(profile.longitude) : '',
          }))
        }
        setOtherDocs(kycData?.otherDocs ?? [])
      }
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`vendor-kyc-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_profiles', filter: `id=eq.${userId}` }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [userId])

  const readOnly = mode === 'documents' && hasProfile && (kycStatus === 'submitted' || kycStatus === 'approved') && !isEditing

  // --- Step validation -----------------------------------------------------
  const stepErrors = useMemo(() => {
    const errors: Record<number, Record<string, string>> = { 0: {}, 1: {}, 2: {}, 3: {} }
    if (!form.name.trim()) errors[0].name = 'Enter your company name'
    if (!form.panNumber.trim()) errors[0].panNumber = 'Enter the company PAN'
    else if (!/^[A-Z]{5}\d{4}[A-Z]$/i.test(form.panNumber.trim())) errors[0].panNumber = 'PAN looks incorrect (e.g. AAAAA0000A)'
    if (form.gstNumber && !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z]\d$/i.test(form.gstNumber.trim())) errors[0].gstNumber = 'GST number looks incorrect'

    if (!form.contactPerson.trim()) errors[1].contactPerson = 'Enter a contact person'
    if (!form.emailAddress.trim()) errors[1].emailAddress = 'Enter a contact email'
    if (!form.mobileNumber.trim()) errors[1].mobileNumber = 'Enter a mobile number'
    if (!form.addressLine1.trim()) errors[1].addressLine1 = 'Search for the registered address'
    if (!form.city.trim()) errors[1].city = 'Enter the city'
    if (!form.state.trim()) errors[1].state = 'Enter the state'
    if (!form.postalCode.trim()) errors[1].postalCode = 'Enter the postal code'
    else if (!/^\d{6}$/.test(form.postalCode.trim())) errors[1].postalCode = 'PIN code must be exactly 6 digits'
    if (!form.latitude || !form.longitude) errors[1].location = 'Set your operating base on the map'

    if (!form.beneficiaryAccountName.trim()) errors[2].beneficiaryAccountName = 'Enter the account holder name'
    if (!form.bankAccountNumber.trim()) errors[2].bankAccountNumber = 'Enter the bank account number'
    if (!form.bankName.trim()) errors[2].bankName = 'Enter the bank name'
    if (!form.bankIfscCode.trim()) errors[2].bankIfscCode = 'Enter the IFSC code'

    if (!form.declaration) errors[3].declaration = 'Accept the declaration to submit'
    return errors
  }, [form])

  const stepValid = (i: number) => Object.keys(stepErrors[i]).length === 0
  const err = (i: number, key: string) => (attempted[i] ? stepErrors[i][key] : undefined)

  const goNext = () => {
    setAttempted(prev => ({ ...prev, [step]: true }))
    if (!stepValid(step)) return
    setStep(s => Math.min(STEPS.length - 1, s + 1))
    window.scrollTo(0, 0)
  }
  const goBack = () => { setStep(s => Math.max(0, s - 1)); window.scrollTo(0, 0) }

  // --- Document upload -------------------------------------------------------
  const uploadDoc = async (key: string, file: File) => {
    if (!userId) return
    setUploadingKey(key)
    try {
      const path = await uploadKycDocument(userId, key, file)
      setField('docUrls', { ...form.docUrls, [key]: path })
      toast.success('Document uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload document')
    } finally {
      setUploadingKey(null)
    }
  }

  const removeDoc = (key: string) => {
    const next = { ...form.docUrls }
    delete next[key]
    setField('docUrls', next)
  }

  const openViewer = async (path: string, name: string) => {
    try {
      const url = await getKycDocumentUrl(path)
      setViewer({ url, name })
    } catch {
      toast.error('Failed to open document')
    }
  }

  const uploadOtherDoc = async (file: File) => {
    if (!userId) return
    setUploadingKey('__other__')
    try {
      const path = await uploadKycDocument(userId, 'other', file)
      const updated = [...otherDocs, { name: file.name, path }]
      setOtherDocs(updated)
      const { data: profile } = await supabase.from('vendor_profiles').select('kyc_data').eq('id', userId).maybeSingle()
      const kycData = (profile?.kyc_data as Record<string, unknown>) || { data: form, otherDocs: [] }
      kycData.otherDocs = updated
      await supabase.from('vendor_profiles').update({ kyc_data: kycData }).eq('id', userId)
      toast.success('Document uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload document')
    } finally {
      setUploadingKey(null)
    }
  }

  const removeOtherDoc = async (index: number) => {
    const updated = otherDocs.filter((_, i) => i !== index)
    setOtherDocs(updated)
    try {
      const { data: profile } = await supabase.from('vendor_profiles').select('kyc_data').eq('id', userId).maybeSingle()
      const kycData = (profile?.kyc_data as Record<string, unknown>) || { data: form, otherDocs: [] }
      kycData.otherDocs = updated
      await supabase.from('vendor_profiles').update({ kyc_data: kycData }).eq('id', userId)
    } catch (err) {
      console.error('Failed to remove document', err)
    }
  }

  // --- Location ---------------------------------------------------------
  const onAddressPicked = (place: ResolvedPlace | null) => {
    if (!place) return
    setForm(prev => ({
      ...prev,
      addressLine1: place.address,
      latitude: String(place.lat),
      longitude: String(place.lng),
      city: place.parts?.city || prev.city,
      state: place.parts?.state || prev.state,
      postalCode: place.parts?.pincode || prev.postalCode,
    }))
  }

  // --- Submit -------------------------------------------------------------
  const submit = async () => {
    setAttempted({ 0: true, 1: true, 2: true, 3: true })
    if (!stepValid(0) || !stepValid(1) || !stepValid(2) || !stepValid(3) || !userId) return

    if (hasProfile && kycStatus === 'approved') {
      const ok = await confirm({
        title: 'Send your company back for review?',
        message: 'Saving these changes moves your company back to KYC review. You will not be able to bid or post loads until an admin approves it again.',
        confirmLabel: 'Save and resubmit',
      })
      if (!ok) return
    }

    setSubmitting(true)
    try {
      const kycData = { data: form, otherDocs }
      // upsert() targets the primary key, so this both creates the profile on a
      // first-time save (onboarding) and updates it on every later save.
      const { error } = await supabase.from('vendor_profiles').upsert({
        id: userId,
        company_name: form.name,
        gst_number: form.gstNumber || '',
        city: form.city,
        address: form.addressLine1,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        company_logo: form.docUrls.companyLogo || null,
        kyc_data: kycData,
        kyc_status: 'submitted',
      })
      if (error) throw error

      window.dispatchEvent(new Event('vendor-profile-updated'))
      refreshProfile()
      setKycStatus('submitted')
      setHasProfile(true)
      setIsEditingKyc(false)
      toast.success(mode === 'onboarding' ? 'Company profile created' : 'KYC submitted for review')
      if (mode === 'onboarding') navigate('/vendor')
      else window.scrollTo(0, 0)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'We could not save your details. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!userId) return null

  if (loading) {
    return (
      <Page>
        <PageHeader title={mode === 'onboarding' ? 'Set up your company' : 'Company & KYC'} />
        <div className="flex justify-center py-16"><Spinner size={28} /></div>
      </Page>
    )
  }

  const title = mode === 'onboarding' ? 'Set up your company' : 'Company & KYC'
  const description = mode === 'onboarding'
    ? 'Tell us about your company so we can verify it and open up bidding and posting loads.'
    : 'Your company details and KYC documents. Changing them sends an approved company back for review.'

  return (
    <Page width="form">
      <PageHeader title={title} description={description} />

      {hasProfile && kycStatus === 'approved' && (
        <Alert tone="success" title="KYC approved" action={!isEditing && !readOnly ? undefined : (
          !isEditing ? <Button variant="secondary" size="sm" onClick={() => setIsEditingKyc(true)}>Update details</Button> : undefined
        )}>
          Your company is verified. You can bid and post loads.
        </Alert>
      )}
      {hasProfile && kycStatus === 'submitted' && (
        <Alert tone="warning" title="KYC in review" action={!isEditing ? <Button variant="secondary" size="sm" onClick={() => setIsEditingKyc(true)}>Update details</Button> : undefined}>
          Your documents are being reviewed. We will notify you once a decision is made.
        </Alert>
      )}
      {hasProfile && kycStatus === 'rejected' && (
        <Alert tone="danger" title="KYC rejected">
          {kycRejectionReason || 'Please review and correct your details below, then resubmit.'}
        </Alert>
      )}

      {readOnly ? (
        <ReadOnlySummary form={form} otherDocs={otherDocs} onView={openViewer} />
      ) : (
        <Card padded className="space-y-6">
          <Stepper current={step} onSelect={i => { if (i < step || stepValid(step)) setStep(i) }} />

          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Company name" required value={form.name} onChange={e => setField('name', e.target.value)} error={err(0, 'name')} />
                <Select label="Vendor type" required options={VENDOR_TYPES} value={form.vendorType} onChange={e => setField('vendorType', e.target.value)} />
                <Input label="PAN number" required value={form.panNumber} onChange={e => setField('panNumber', e.target.value.toUpperCase())} error={err(0, 'panNumber')} inputClassName="uppercase" hint="10-character company or proprietor PAN" />
                <Input label="GST number" value={form.gstNumber} onChange={e => setField('gstNumber', e.target.value.toUpperCase())} error={err(0, 'gstNumber')} inputClassName="uppercase" hint="Leave blank if not GST-registered" />
                <Select label="MSME status" options={MSME_STATUSES} value={form.msmeStatus} onChange={e => setField('msmeStatus', e.target.value)} />
                {form.msmeStatus !== 'Not applicable' && (
                  <Input label="MSME registration number" value={form.msmeRegNumber} onChange={e => setField('msmeRegNumber', e.target.value)} />
                )}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Contact person" required value={form.contactPerson} onChange={e => setField('contactPerson', e.target.value)} error={err(1, 'contactPerson')} />
                <Input label="Contact email" type="email" required value={form.emailAddress} onChange={e => setField('emailAddress', e.target.value)} error={err(1, 'emailAddress')} />
                <Input label="Mobile number" required value={form.mobileNumber} onChange={e => setField('mobileNumber', e.target.value)} error={err(1, 'mobileNumber')} />
                <Input label="Telephone" value={form.telephone} onChange={e => setField('telephone', e.target.value)} />
              </div>

              <AddressPicker
                label="Registered address / operating base"
                required
                value={form.addressLine1 ? { address: form.addressLine1, lat: Number(form.latitude) || 0, lng: Number(form.longitude) || 0 } : null}
                onChange={onAddressPicked}
                error={err(1, 'addressLine1') || err(1, 'location')}
                hint="Search, use your current location, or drag the pin to set the 50 km radius you want to see capacity within."
                kind="hub"
                mapHeight={260}
              />
              <Input label="Address line 2" value={form.addressLine2} onChange={e => setField('addressLine2', e.target.value)} hint="Suite, floor or landmark (optional)" />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Input label="City" required value={form.city} onChange={e => setField('city', e.target.value)} error={err(1, 'city')} />
                <Input label="State" required value={form.state} onChange={e => setField('state', e.target.value)} error={err(1, 'state')} />
                <Input
                  label="Postal code" required value={form.postalCode}
                  onChange={e => setField('postalCode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  error={err(1, 'postalCode')}
                  inputMode="numeric" maxLength={6}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <p className="mb-3 text-sm font-medium text-text">Bank details</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input label="Beneficiary account name" required value={form.beneficiaryAccountName} onChange={e => setField('beneficiaryAccountName', e.target.value)} error={err(2, 'beneficiaryAccountName')} />
                  <Input label="Bank account number" required value={form.bankAccountNumber} onChange={e => setField('bankAccountNumber', e.target.value)} error={err(2, 'bankAccountNumber')} />
                  <Input label="Bank name" required value={form.bankName} onChange={e => setField('bankName', e.target.value)} error={err(2, 'bankName')} />
                  <Input label="Branch name" required value={form.bankBranchName} onChange={e => setField('bankBranchName', e.target.value)} error={err(2, 'bankBranchName')} />
                  <Input label="IFSC code" required value={form.bankIfscCode} onChange={e => setField('bankIfscCode', e.target.value.toUpperCase())} error={err(2, 'bankIfscCode')} inputClassName="uppercase" />
                  <Select label="Account type" required options={ACCOUNT_TYPES} value={form.accountType} onChange={e => setField('accountType', e.target.value)} />
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-text">Documents</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {DOC_FIELDS.map(f => (
                    <DocUploadField
                      key={f.key}
                      label={f.label}
                      hint={f.hint}
                      path={form.docUrls[f.key]}
                      busy={uploadingKey === f.key}
                      onUpload={file => uploadDoc(f.key, file)}
                      onRemove={() => removeDoc(f.key)}
                      onView={() => openViewer(form.docUrls[f.key], f.label)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-text">Other documents <span className="font-normal text-muted">(optional)</span></p>
                <div className="rounded-card border border-dashed border-border p-4">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-brand hover:underline">
                    <Upload size={14} />
                    {uploadingKey === '__other__' ? 'Uploading…' : 'Upload a document'}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      disabled={uploadingKey === '__other__'}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadOtherDoc(f); e.target.value = '' }}
                    />
                  </label>
                  {otherDocs.length === 0 ? (
                    <p className="mt-2 text-xs text-muted">No additional documents uploaded.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {otherDocs.map((doc, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface-subtle px-3 py-2 text-sm">
                          <button type="button" onClick={() => openViewer(doc.path, doc.name)} className="flex min-w-0 items-center gap-2 text-left text-text hover:text-brand">
                            <FileText size={14} className="shrink-0 text-muted" />
                            <span className="truncate">{doc.name}</span>
                          </button>
                          <button type="button" onClick={() => removeOtherDoc(i)} aria-label={`Remove ${doc.name}`} className="shrink-0 text-muted hover:text-danger">
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <ReadOnlySummary form={form} otherDocs={otherDocs} onView={openViewer} compact />
              <Checkbox
                label={`We, ${form.name.trim() || 'the company named above'}, certify that the details above are correct and can be used for remittance of funds.`}
                description="Any delay in payment caused by incorrect details is our responsibility."
                checked={form.declaration}
                onChange={e => setField('declaration', e.target.checked)}
                error={err(3, 'declaration')}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={goBack} disabled={step === 0}>Back</Button>
            <div className="flex items-center gap-3">
              {isEditing && (
                <Button type="button" variant="ghost" onClick={() => { setIsEditingKyc(false); setStep(0) }}>Cancel</Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={goNext}>Continue</Button>
              ) : (
                <Button type="button" onClick={submit} loading={submitting} disabled={!stepValid(3)}>
                  {mode === 'onboarding' ? 'Create company profile' : 'Submit for review'}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      <DocumentViewerModal
        isOpen={!!viewer}
        onClose={() => setViewer(null)}
        fileUrl={viewer?.url ?? ''}
        fileName={viewer?.name ?? ''}
      />
    </Page>
  )
}

function Stepper({ current, onSelect }: { current: number; onSelect: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center">
          <button
            type="button"
            onClick={() => onSelect(i)}
            className="flex items-center gap-2 rounded-control px-1 py-1 text-left"
          >
            <span className={
              i < current
                ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-fill text-xs font-medium text-text'
                : i === current
                  ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand text-xs font-medium text-brand'
                  : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-muted'
            }>
              {i < current ? <Check size={14} /> : i + 1}
            </span>
            <span className={i === current ? 'text-sm font-medium text-text' : 'text-sm text-muted'}>{label}</span>
          </button>
          {i < STEPS.length - 1 && <span className="mx-2 h-px w-6 bg-border sm:w-10" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}

function DocUploadField({ label, hint, path, busy, onUpload, onRemove, onView }: {
  label: string
  hint?: string
  path?: string
  busy?: boolean
  onUpload: (file: File) => void
  onRemove: () => void
  onView: () => void
}) {
  return (
    <div className="rounded-card border border-border p-4">
      <p className="text-sm font-medium text-text">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3 flex items-center gap-2">
        {path ? (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={onView}>View</Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button>
          </>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            <Upload size={14} />
            {busy ? 'Uploading…' : 'Upload'}
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }}
            />
          </label>
        )}
      </div>
    </div>
  )
}

function ReadOnlySummary({ form, otherDocs, onView, compact }: {
  form: KycFormData
  otherDocs: DocRef[]
  onView: (path: string, name: string) => void
  compact?: boolean
}) {
  const rows: [string, string][] = [
    ['Company name', form.name || '—'],
    ['Vendor type', form.vendorType || '—'],
    ['PAN', form.panNumber || '—'],
    ['GST number', form.gstNumber || '—'],
    ['Contact', [form.contactPerson, form.mobileNumber, form.emailAddress].filter(Boolean).join(' · ') || '—'],
    ['Registered address', [form.addressLine1, form.city, form.state, form.postalCode].filter(Boolean).join(', ') || '—'],
    ['Bank account', form.bankAccountNumber ? `${form.bankName || ''} · ${form.bankAccountNumber}` : '—'],
  ]
  const uploaded = Object.entries(form.docUrls).filter(([, path]) => path)

  return (
    <Card padded={!compact} className={compact ? 'space-y-4' : 'space-y-6'}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-0.5 break-words text-sm text-text">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="text-xs text-muted">Documents</p>
        {uploaded.length === 0 && otherDocs.length === 0 ? (
          <p className="mt-1 text-sm text-text">No documents uploaded yet.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {DOC_FIELDS.filter(f => form.docUrls[f.key]).map(f => (
              <li key={f.key}>
                <button type="button" onClick={() => onView(form.docUrls[f.key], f.label)} className="rounded-full bg-surface-subtle px-3 py-1 text-xs font-medium text-brand hover:underline">
                  {f.label}
                </button>
              </li>
            ))}
            {otherDocs.map((doc, i) => (
              <li key={i}>
                <button type="button" onClick={() => onView(doc.path, doc.name)} className="rounded-full bg-surface-subtle px-3 py-1 text-xs font-medium text-brand hover:underline">
                  {doc.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
