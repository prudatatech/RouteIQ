import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileText, Trash2, Upload } from 'lucide-react'
import { vendorAPI } from '@/services/api'
import { getKycDocumentUrl, uploadKycDocumentFor } from '@/services/kycDocuments'
import { errorMessage } from '@/utils/display'
import AddressPicker from '@/components/map/AddressPicker'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { DocUploadField } from '@/components/kyc/DocUploadField'
import type { ResolvedPlace } from '@/services/geocoding'
import { GstinStatus } from '@/components/tpl/GstinStatus'
import { gstinError } from '@/utils/gstin'
import { ENTITY_TYPE_OPTIONS, entityTypeRequiresCin, isCinFormat } from '@/utils/entityType'
import type { IfscDetails } from '@/services/api'
import {
  Alert, BankBranchFields, Button, Card, Checkbox, FileButton, IfscField, Input, Page, PageHeader, Select, Stepper,
} from '@/components/ui'

const BACK = { to: '/admin/kyc', label: 'KYC review' }

/**
 * Fields the staff-entered form collects, mirroring VendorDocumentsPage.tsx's KycFormData one for
 * one - the applicant is giving the same details a self-service sign-up would, just over the phone
 * or WhatsApp instead of typing them in themselves. Keep both in step: a field added to the vendor
 * KYC wizard needs the same field here.
 */
interface StaffKycFormData {
  name: string
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
  entityType: string
  cin: string
  authorizedSignatoryName: string
  declaration: boolean
  docUrls: Record<string, string>
}

interface DocRef { name: string; path: string }

const EMPTY_FORM: StaffKycFormData = {
  name: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '',
  latitude: '', longitude: '',
  contactPerson: '', telephone: '', mobileNumber: '', emailAddress: '',
  beneficiaryAccountName: '', bankAccountNumber: '', bankName: '', bankBranchName: '', bankIfscCode: '', accountType: 'Current',
  panNumber: '', gstNumber: '', vendorType: 'Service provider',
  msmeStatus: 'Not applicable', msmeRegNumber: '',
  entityType: '', cin: '', authorizedSignatoryName: '',
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

const STEPS = ['Applicant', 'Company', 'Contact & address', 'Bank & documents', 'Review & submit'] as const

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_PATTERN = /^\d{9,18}$/

/**
 * Staff enter a vendor's KYC on behalf of an applicant who phoned or WhatsApp'd their company
 * details in instead of using the self-serve sign-up wizard. The same fields as
 * VendorDocumentsPage.tsx's wizard are collected here, but:
 *   1. an email (and optional name) resolves or invites the applicant's own account first -
 *      document uploads and the final submit are scoped under that id, not the staff member's;
 *   2. the final submit goes through POST /vendor/admin/kyc/applicants/create, which runs the
 *      exact same `submitKyc` / review-queue path a self-service submission does (no auto-approval).
 *
 * A single page mirroring the wizard's steps (rather than reusing its component directly) because
 * the wizard is written around the signed-in vendor's own session (useVendorContext, realtime
 * profile subscription, localStorage draft keyed by the caller's own user id, read-only/approved-
 * resubmit states that do not apply before an account even exists) - threading an "acting for
 * someone else" id through all of that would complicate the vendor's own page for a staff-only
 * concern. Field list, labels and validation are kept identical by hand instead.
 */
export default function EnterVendorKycPage() {
  const [step, setStep] = useState(0)
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})
  const [form, setForm] = useState<StaffKycFormData>(EMPTY_FORM)
  const [applicantEmail, setApplicantEmail] = useState('')
  const [applicantFullName, setApplicantFullName] = useState('')
  const [applicantCompanyName, setApplicantCompanyName] = useState('')
  const [vendorUserId, setVendorUserId] = useState<string | null>(null)
  const [invited, setInvited] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [ifscInfo, setIfscInfo] = useState<IfscDetails | null>(null)
  const [otherDocs, setOtherDocs] = useState<DocRef[]>([])
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null)

  const setField = <K extends keyof StaffKycFormData>(key: K, value: StaffKycFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const stepErrors = useMemo(() => {
    const errors: Record<number, Record<string, string>> = { 0: {}, 1: {}, 2: {}, 3: {}, 4: {} }
    if (!applicantEmail.trim()) errors[0].email = "Enter the applicant's email"
    else if (!EMAIL_PATTERN.test(applicantEmail.trim())) errors[0].email = 'Enter an email like name@company.com'

    if (!form.name.trim()) errors[1].name = 'Enter the company name'
    if (!form.panNumber.trim()) errors[1].panNumber = 'Enter the company PAN'
    else if (!/^[A-Z]{5}\d{4}[A-Z]$/i.test(form.panNumber.trim())) errors[1].panNumber = 'PAN looks incorrect (e.g. AAAAA0000A)'
    if (form.gstNumber.trim()) {
      const gstProblem = gstinError(form.gstNumber, form.panNumber)
      if (gstProblem) errors[1].gstNumber = gstProblem
    }
    if (!form.entityType.trim()) errors[1].entityType = 'Choose the entity type'
    if (!form.authorizedSignatoryName.trim()) errors[1].authorizedSignatoryName = 'Enter the authorized signatory name'
    if (entityTypeRequiresCin(form.entityType)) {
      if (!form.cin.trim()) errors[1].cin = 'CIN is required for this entity type'
      else if (!isCinFormat(form.cin)) errors[1].cin = 'CIN looks incorrect (21 letters and digits, e.g. U74999DL2019PTC123456)'
    } else if (form.cin.trim() && !isCinFormat(form.cin)) {
      errors[1].cin = 'CIN looks incorrect (21 letters and digits, e.g. U74999DL2019PTC123456)'
    }

    if (!form.contactPerson.trim()) errors[2].contactPerson = 'Enter a contact person'
    if (!form.emailAddress.trim()) errors[2].emailAddress = 'Enter a contact email'
    else if (!EMAIL_PATTERN.test(form.emailAddress.trim())) errors[2].emailAddress = 'Enter an email like you@company.com'
    if (!form.mobileNumber.trim()) errors[2].mobileNumber = 'Enter a mobile number'
    else if (!/^[6-9]\d{9}$/.test(form.mobileNumber.trim())) errors[2].mobileNumber = 'Enter a valid 10-digit mobile number'
    if (form.telephone.trim() && !/^[6-9]\d{9}$/.test(form.telephone.trim())) errors[2].telephone = 'Enter a valid 10-digit number'
    if (!form.addressLine1.trim()) errors[2].addressLine1 = 'Search for the registered address'
    if (!form.city.trim()) errors[2].city = 'Enter the city'
    if (!form.state.trim()) errors[2].state = 'Enter the state'
    if (!form.postalCode.trim()) errors[2].postalCode = 'Enter the postal code'
    else if (!/^\d{6}$/.test(form.postalCode.trim())) errors[2].postalCode = 'PIN code must be exactly 6 digits'
    if (!form.latitude || !form.longitude) errors[2].location = 'Set the operating base on the map'

    if (!form.beneficiaryAccountName.trim()) errors[3].beneficiaryAccountName = 'Enter the account holder name'
    if (!form.bankAccountNumber.trim()) errors[3].bankAccountNumber = 'Enter the bank account number'
    else if (!ACCOUNT_PATTERN.test(form.bankAccountNumber.trim())) errors[3].bankAccountNumber = 'Account number must be 9 to 18 digits'
    if (!form.bankName.trim()) errors[3].bankName = 'Enter the bank name'
    if (!form.bankBranchName.trim()) errors[3].bankBranchName = 'Enter the branch name'
    if (!form.bankIfscCode.trim()) errors[3].bankIfscCode = 'Enter the IFSC code'
    else if (!IFSC_PATTERN.test(form.bankIfscCode.trim())) errors[3].bankIfscCode = 'IFSC looks wrong (e.g. HDFC0001234)'

    if (!form.declaration) errors[4].declaration = 'Accept the declaration to submit'
    return errors
  }, [form, applicantEmail])

  const stepValid = (i: number) => Object.keys(stepErrors[i]).length === 0
  const err = (i: number, key: string) => (attempted[i] ? stepErrors[i][key] : undefined)

  /** Resolves (or invites) the applicant's account before leaving step 0 - document uploads on
   * later steps are scoped by this id, so it must exist first. Safe to call again unchanged. */
  const resolveApplicant = async (): Promise<string | null> => {
    setAttempted(prev => ({ ...prev, 0: true }))
    if (!stepValid(0)) return null
    if (vendorUserId) return vendorUserId
    setResolving(true)
    try {
      const { vendorUserId: id, invited: wasInvited } = await vendorAPI.adminResolveKycApplicant({
        email: applicantEmail.trim(),
        full_name: applicantFullName.trim() || undefined,
        company_name: applicantCompanyName.trim() || undefined,
      })
      setVendorUserId(id)
      setInvited(wasInvited)
      if (applicantCompanyName.trim() && !form.name.trim()) setField('name', applicantCompanyName.trim())
      if (applicantFullName.trim() && !form.authorizedSignatoryName.trim()) setField('authorizedSignatoryName', applicantFullName.trim())
      return id
    } catch (e) {
      toast.error(errorMessage(e, 'Could not resolve or invite the applicant'))
      return null
    } finally {
      setResolving(false)
    }
  }

  const handleGstChange = (val: string) => {
    const upper = val.toUpperCase()
    setField('gstNumber', upper)
    if (!form.panNumber.trim() && upper.length >= 12) {
      const derived = upper.slice(2, 12)
      if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(derived)) {
        setField('panNumber', derived)
      }
    }
  }

  const goNext = async () => {
    setAttempted(prev => ({ ...prev, [step]: true }))
    if (!stepValid(step)) {
      const firstError = Object.values(stepErrors[step])[0]
      if (firstError) toast.error(firstError)
      return
    }
    if (step === 0) {
      const id = await resolveApplicant()
      if (!id) return
    }
    setStep(s => Math.min(STEPS.length - 1, s + 1))
    window.scrollTo(0, 0)
  }
  const goBack = () => { setStep(s => Math.max(0, s - 1)); window.scrollTo(0, 0) }

  const uploadDoc = async (key: string, file: File) => {
    if (!vendorUserId) return
    setUploadingKey(key)
    try {
      const path = await uploadKycDocumentFor(vendorUserId, key, file)
      setField('docUrls', { ...form.docUrls, [key]: path })
      toast.success('Document uploaded')
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to upload document'))
    } finally {
      setUploadingKey(null)
    }
  }
  const removeDoc = (key: string) => {
    const next = { ...form.docUrls }
    delete next[key]
    setField('docUrls', next)
  }

  const uploadOtherDoc = async (file: File) => {
    if (!vendorUserId) return
    setUploadingKey('__other__')
    try {
      const path = await uploadKycDocumentFor(vendorUserId, 'other', file)
      setOtherDocs(prev => [...prev, { name: file.name, path }])
      toast.success('Document uploaded')
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to upload document'))
    } finally {
      setUploadingKey(null)
    }
  }
  const removeOtherDoc = (index: number) => setOtherDocs(prev => prev.filter((_, i) => i !== index))

  const openViewer = async (path: string, name: string) => {
    try {
      const url = await getKycDocumentUrl(path)
      setViewer({ url, name })
    } catch {
      toast.error('Failed to open document')
    }
  }

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

  const submit = async () => {
    setAttempted({ 0: true, 1: true, 2: true, 3: true, 4: true })
    const firstInvalid = [0, 1, 2, 3, 4].find(i => !stepValid(i))
    if (firstInvalid !== undefined) {
      const firstError = Object.values(stepErrors[firstInvalid])[0]
      if (firstInvalid !== step) {
        toast.error(`Some details in "${STEPS[firstInvalid]}" need fixing${firstError ? `: ${firstError}` : ''}`)
        setStep(firstInvalid)
        window.scrollTo(0, 0)
      } else if (firstError) {
        toast.error(firstError)
      }
      return
    }
    const id = await resolveApplicant()
    if (!id) return

    setSubmitting(true)
    try {
      await vendorAPI.adminCreateKycOnBehalf({
        email: applicantEmail.trim(),
        full_name: applicantFullName.trim() || undefined,
        companyName: form.name,
        gstNumber: form.gstNumber || '',
        city: form.city,
        address: form.addressLine1,
        lat: Number(form.latitude),
        lng: Number(form.longitude),
        companyLogo: form.docUrls.companyLogo || null,
        kycData: { data: form, otherDocs },
      })
      setDone(true)
    } catch (e) {
      toast.error(errorMessage(e, 'We could not save these details. Check them and try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <Page width="form">
        <PageHeader back={BACK} title="Application entered" />
        <Alert tone="success" title="Submitted for review">
          {form.name}&rsquo;s KYC is now in the normal review queue, the same as a self-service submission.
          {invited
            ? ` We invited ${applicantEmail.trim()} to set a password so they can log in and track the review, or respond if we ask for more details.`
            : ` ${applicantEmail.trim()} already had an account; they can log in to track the review or respond if we ask for more details.`}
        </Alert>
        <div className="mt-6 flex gap-3">
          <Link to="/admin/kyc" className="inline-flex"><Button variant="secondary">Back to KYC review</Button></Link>
          <Button variant="secondary" onClick={() => window.location.reload()}>Enter another application</Button>
        </div>
      </Page>
    )
  }

  return (
    <Page width="form">
      <PageHeader
        back={BACK}
        title="Enter an application for someone"
        description="For an applicant who phoned or WhatsApp'd their company details in instead of using the sign-up form. This goes through the same review queue as a self-service submission - nothing is auto-approved."
      />

      <Card padded className="space-y-6">
        <Stepper steps={STEPS} current={step} variant="inline" onSelect={i => { if (i <= step) setStep(i) }} />

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              We use this email to find the applicant&rsquo;s account, or invite them to set a password if they are new. Documents
              uploaded on later steps belong to this account, so it needs to exist first.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Applicant email" required type="email" value={applicantEmail}
                onChange={e => { setApplicantEmail(e.target.value); setVendorUserId(null) }}
                error={err(0, 'email')}
                disabled={!!vendorUserId}
                hint={vendorUserId ? (invited ? 'Invited - continue to the rest of the form.' : 'Existing account found - continue to the rest of the form.') : undefined}
              />
              <Input label="Applicant's name" value={applicantFullName} onChange={e => { setApplicantFullName(e.target.value); setVendorUserId(null) }} disabled={!!vendorUserId} />
              <Input label="Company name (optional, helps the invite email)" value={applicantCompanyName} onChange={e => { setApplicantCompanyName(e.target.value); setVendorUserId(null) }} disabled={!!vendorUserId} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Company name" required value={form.name} onChange={e => setField('name', e.target.value)} error={err(1, 'name')} />
              <Select label="Vendor type" required options={VENDOR_TYPES} value={form.vendorType} onChange={e => setField('vendorType', e.target.value)} />
              <Input label="PAN number" required value={form.panNumber} onChange={e => setField('panNumber', e.target.value.toUpperCase())} error={err(1, 'panNumber')} inputClassName="uppercase" hint="10-character company or proprietor PAN" />
              <div>
                <Input label="GST number" value={form.gstNumber} onChange={e => handleGstChange(e.target.value)} error={err(1, 'gstNumber')} inputClassName="uppercase" hint="Leave blank if not GST-registered" />
                <GstinStatus gstin={form.gstNumber} pan={form.panNumber} />
              </div>
              <Select label="MSME status" options={MSME_STATUSES} value={form.msmeStatus} onChange={e => setField('msmeStatus', e.target.value)} />
              {form.msmeStatus !== 'Not applicable' && (
                <Input label="MSME registration number" value={form.msmeRegNumber} onChange={e => setField('msmeRegNumber', e.target.value)} />
              )}
              <Select label="Entity type" required options={ENTITY_TYPE_OPTIONS} value={form.entityType} onChange={e => setField('entityType', e.target.value)} error={err(1, 'entityType')} placeholder="Choose the entity type" />
              {entityTypeRequiresCin(form.entityType) && (
                <Input label="CIN" required value={form.cin} onChange={e => setField('cin', e.target.value.toUpperCase())} error={err(1, 'cin')} inputClassName="uppercase" hint="21-character Corporate Identity Number" />
              )}
              <Input label="Authorized signatory name" required value={form.authorizedSignatoryName} onChange={e => setField('authorizedSignatoryName', e.target.value)} error={err(1, 'authorizedSignatoryName')} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Contact person" required value={form.contactPerson} onChange={e => setField('contactPerson', e.target.value)} error={err(2, 'contactPerson')} />
              <Input label="Contact email" type="email" required value={form.emailAddress} onChange={e => setField('emailAddress', e.target.value)} error={err(2, 'emailAddress')} />
              <Input
                label="Mobile number" required type="tel" inputMode="tel" maxLength={10}
                value={form.mobileNumber} onChange={e => setField('mobileNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                error={err(2, 'mobileNumber')}
              />
              <Input
                label="Telephone" type="tel" inputMode="tel" maxLength={10}
                value={form.telephone} onChange={e => setField('telephone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                error={err(2, 'telephone')}
              />
            </div>

            <AddressPicker
              label="Registered address / operating base"
              required
              value={form.addressLine1 ? { address: form.addressLine1, lat: Number(form.latitude) || 0, lng: Number(form.longitude) || 0 } : null}
              onChange={onAddressPicked}
              error={err(2, 'addressLine1') || err(2, 'location')}
              hint="Search, or use the city and PIN code the applicant gave, to set the 50 km radius they want to see capacity within."
              kind="hub"
              mapHeight={260}
            />
            <Input label="Address line 2" value={form.addressLine2} onChange={e => setField('addressLine2', e.target.value)} hint="Suite, floor or landmark (optional)" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input label="City" required value={form.city} onChange={e => setField('city', e.target.value)} error={err(2, 'city')} />
              <Input label="State" required value={form.state} onChange={e => setField('state', e.target.value)} error={err(2, 'state')} />
              <Input
                label="Postal code" required value={form.postalCode}
                onChange={e => setField('postalCode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                error={err(2, 'postalCode')}
                inputMode="numeric" maxLength={6}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <p className="mb-3 text-sm font-medium text-text">Bank details</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Beneficiary account name" required value={form.beneficiaryAccountName} onChange={e => setField('beneficiaryAccountName', e.target.value)} error={err(3, 'beneficiaryAccountName')} />
                <Input label="Bank account number" required value={form.bankAccountNumber} onChange={e => setField('bankAccountNumber', e.target.value.replace(/\D/g, '').slice(0, 18))} error={err(3, 'bankAccountNumber')} inputMode="numeric" hint="9 to 18 digits" />
                <IfscField label="IFSC code" required value={form.bankIfscCode} onChange={v => setField('bankIfscCode', v)} onResolved={setIfscInfo} error={err(3, 'bankIfscCode')} className="sm:col-span-2" />
                <div className="sm:col-span-2">
                  <BankBranchFields
                    required details={ifscInfo} bankName={form.bankName} branch={form.bankBranchName}
                    onBankName={v => setField('bankName', v)} onBranch={v => setField('bankBranchName', v)}
                    bankError={err(3, 'bankName')} branchError={err(3, 'bankBranchName')}
                  />
                </div>
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
                <FileButton
                  variant="link"
                  icon={<Upload size={14} />}
                  accept=".pdf,.jpg,.jpeg,.png"
                  disabled={uploadingKey === '__other__'}
                  onFile={uploadOtherDoc}
                >
                  {uploadingKey === '__other__' ? 'Uploading…' : 'Upload a document'}
                </FileButton>
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

        {step === 4 && (
          <div className="space-y-6">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {([
                ['Applicant', [applicantFullName, applicantEmail].filter(Boolean).join(' · ')],
                ['Company name', form.name],
                ['Entity type', form.entityType],
                ['PAN', form.panNumber],
                ['GST number', form.gstNumber || 'Not GST-registered'],
                ['Authorized signatory', form.authorizedSignatoryName],
                ['Contact', [form.contactPerson, form.mobileNumber, form.emailAddress].filter(Boolean).join(' · ')],
                ['Registered address', [form.addressLine1, form.city, form.state, form.postalCode].filter(Boolean).join(', ')],
                ['Bank account', `${form.bankName} · ${form.bankAccountNumber}`],
                ['Documents', [...Object.keys(form.docUrls), ...otherDocs.map(d => d.name)].join(', ') || 'None uploaded'],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-0.5 break-words text-sm text-text">{value || '—'}</dd>
                </div>
              ))}
            </dl>
            <Checkbox
              label={`We entered the details above for ${form.name.trim() || 'this applicant'} as they gave them to us by phone or WhatsApp, and they can be used for remittance of funds.`}
              description="The applicant can review and correct these details themselves once they log in, if anything is wrong."
              checked={form.declaration}
              onChange={e => setField('declaration', e.target.checked)}
              error={err(4, 'declaration')}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={goBack} disabled={step === 0}>Back</Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={goNext} loading={step === 0 && resolving}>Continue</Button>
          ) : (
            <Button type="button" onClick={submit} loading={submitting}>Submit for review</Button>
          )}
        </div>
      </Card>

      <DocumentViewerModal
        isOpen={!!viewer}
        onClose={() => setViewer(null)}
        fileUrl={viewer?.url ?? ''}
        fileName={viewer?.name ?? ''}
      />
    </Page>
  )
}
