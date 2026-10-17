import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { adminOrgsAPI } from '@/services/api'
import { uploadAdminOrgKycDocument } from '@/services/kycDocuments'
import { useDocumentViewer } from '@/components/admin/useDocumentViewer'
import { DocUploadField } from '@/components/kyc/DocUploadField'
import { Alert, Button, IfscField, Input, Modal, Select, Stepper, Textarea } from '@/components/ui'
import { errorMessage, serverFieldError } from '@/utils/display'
import { ENTITY_TYPE_OPTIONS, entityTypeRequiresCin, isCinFormat } from '@/utils/entityType'
import { gstinError } from '@/utils/gstin'
import { ORG_KYC_DOCUMENTS } from '@/utils/platformOrgs'
import type { IfscDetails } from '@/services/api'
import type { OrgProfileInput, OrgRegistration, OrgRow } from '@/utils/orgs'

const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_PATTERN = /^\d{9,18}$/

const STEPS = ['Applicant & company', 'Bank & documents'] as const

// Step 1 mirrors the self-serve registration form (RegisterCompanyPage), minus the company's own
// `email` - the create-on-behalf route reserves that top-level key for the applicant's own email,
// so the company's own contact email is set afterward in step 2, alongside the other remaining fields.
type DetailsForm = Omit<OrgRegistration, 'email'> & { applicantEmail: string; applicantFullName: string }
type DetailsErrors = Partial<Record<keyof DetailsForm, string>>

const EMPTY_DETAILS: DetailsForm = {
  applicantEmail: '', applicantFullName: '', name: '', legal_name: '', gstin: '', pan: '', state: '', city: '', address: '', pincode: '', phone: '',
}

/** A string field out of an org's free-form `profile` JSON, or '' if it is missing or not a string. */
function profileString(org: OrgRow | null | undefined, key: string): string {
  const value = org?.profile?.[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Staff registers a logistic company for an applicant who called or WhatsApp'd their details in,
 * or finishes a registration (staff-entered or self-serve) that was left incomplete before KYC was
 * submitted. Walks the same calls self-service makes (register, then complete KYC) through
 * POST /admin/orgs/create-on-behalf and the admin KYC routes, so the company lands in the normal
 * review queue unchanged - no auto-approval.
 *
 * Pass `resumeOrg` to skip step 0 (and the create-on-behalf call) and open directly at step 2,
 * pre-filled with whatever the company already has. Without it, the modal creates a brand-new company.
 */
export default function RegisterCompanyModal({ open, onClose, onRegistered, resumeOrg }: {
  open: boolean
  onClose: () => void
  /** Called once the company has been created (so the list can refresh), and again after a successful submit. */
  onRegistered: () => void
  /** An existing, not-yet-submitted company to resume instead of creating a new one. */
  resumeOrg?: OrgRow | null
}) {
  const viewer = useDocumentViewer()
  const [step, setStep] = useState(resumeOrg ? 1 : 0)
  const [details, setDetails] = useState<DetailsForm>(EMPTY_DETAILS)
  const [detailErrors, setDetailErrors] = useState<DetailsErrors>({})
  const [detailFormError, setDetailFormError] = useState<string | null>(null)

  const [org, setOrg] = useState<OrgRow | null>(resumeOrg ?? null)
  const [companyEmail, setCompanyEmail] = useState(resumeOrg?.email ?? '')
  const [entityType, setEntityType] = useState(resumeOrg?.entity_type ?? '')
  const [cin, setCin] = useState(resumeOrg?.cin ?? '')
  const [authorizedSignatoryName, setAuthorizedSignatoryName] = useState(resumeOrg?.authorized_signatory_name ?? '')
  const [bankName, setBankName] = useState(profileString(resumeOrg, 'bank_name'))
  const [bankAccountNo, setBankAccountNo] = useState(profileString(resumeOrg, 'bank_account_no'))
  const [bankIfsc, setBankIfsc] = useState(profileString(resumeOrg, 'bank_ifsc'))
  const [, setIfscInfo] = useState<IfscDetails | null>(null)
  const [docUrls, setDocUrls] = useState<Record<string, string>>(resumeOrg?.kyc_documents?.docUrls ?? {})
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const reset = () => {
    setStep(resumeOrg ? 1 : 0); setDetails(EMPTY_DETAILS); setDetailErrors({}); setDetailFormError(null)
    setOrg(resumeOrg ?? null); setCompanyEmail(resumeOrg?.email ?? ''); setEntityType(resumeOrg?.entity_type ?? ''); setCin(resumeOrg?.cin ?? '')
    setAuthorizedSignatoryName(resumeOrg?.authorized_signatory_name ?? '')
    setBankName(profileString(resumeOrg, 'bank_name')); setBankAccountNo(profileString(resumeOrg, 'bank_account_no')); setBankIfsc(profileString(resumeOrg, 'bank_ifsc')); setIfscInfo(null)
    setDocUrls(resumeOrg?.kyc_documents?.docUrls ?? {}); setUploadingKey(null); setAttemptedSubmit(false); setSubmitError(null); setDone(false)
  }

  const close = () => { onClose(); reset() }

  const setField = (key: keyof DetailsForm, upper = false) => (value: string) => {
    setDetails(f => ({ ...f, [key]: upper ? value.toUpperCase() : value }))
    setDetailErrors(e => ({ ...e, [key]: undefined }))
    setDetailFormError(null)
  }

  const create = useMutation({
    mutationFn: () => adminOrgsAPI.createOnBehalf({
      applicant_email: details.applicantEmail.trim().toLowerCase(),
      applicant_full_name: details.applicantFullName.trim() || undefined,
      name: details.name.trim(),
      legal_name: details.legal_name.trim() || undefined,
      gstin: details.gstin.trim() || undefined,
      pan: details.pan.trim() || undefined,
      state: details.state.trim() || undefined,
      city: details.city.trim() || undefined,
      address: details.address.trim() || undefined,
      pincode: details.pincode.trim() || undefined,
      phone: details.phone.trim() || undefined,
    }),
    onSuccess: created => {
      setOrg(created)
      setStep(1)
      onRegistered()
      toast.success(`${created.name} created - an invite went out to ${details.applicantEmail.trim()}`)
    },
    onError: err => {
      const named = serverFieldError(err)
      if (named && named.field in EMPTY_DETAILS) setDetailErrors({ [named.field as keyof DetailsForm]: named.message })
      else setDetailFormError(errorMessage(err, 'We could not create this company. Try again.'))
    },
  })

  const saveKyc = useMutation({
    mutationFn: () => {
      if (!org) throw new Error('No company yet')
      return adminOrgsAPI.update(org.id, {
        email: companyEmail.trim() || undefined,
        entity_type: entityType || undefined,
        cin: cin.trim().toUpperCase() || undefined,
        authorized_signatory_name: authorizedSignatoryName.trim() || undefined,
        profile: { bank_name: bankName.trim() || null, bank_account_no: bankAccountNo.trim() || null, bank_ifsc: bankIfsc.trim().toUpperCase() || null },
      } satisfies Partial<OrgProfileInput> & { email?: string; profile?: Record<string, unknown> })
    },
    onSuccess: () => toast.success('Details saved'),
    onError: err => toast.error(errorMessage(err, 'We could not save these details. Try again.')),
  })

  const submit = useMutation({
    mutationFn: async () => {
      if (!org) throw new Error('No company yet')
      await saveKyc.mutateAsync()
      return adminOrgsAPI.submitKyc(org.id)
    },
    onSuccess: () => { setSubmitError(null); setDone(true); onRegistered() },
    onError: err => setSubmitError(errorMessage(err, 'We could not submit this company for review. Check everything below is filled in.')),
  })

  const uploadDoc = async (key: string, file: File) => {
    if (!org) return
    setUploadingKey(key)
    try {
      const path = await uploadAdminOrgKycDocument(org.id, key, file)
      const updated = { ...docUrls, [key]: path }
      setDocUrls(updated)
      await adminOrgsAPI.saveKycDocuments(org.id, { docUrls: updated })
      toast.success('Document uploaded')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to upload document'))
    } finally {
      setUploadingKey(null)
    }
  }

  const removeDoc = async (key: string) => {
    if (!org) return
    const updated = { ...docUrls }
    delete updated[key]
    setDocUrls(updated)
    try {
      await adminOrgsAPI.saveKycDocuments(org.id, { docUrls: updated })
    } catch (err) {
      console.error('Failed to remove document', err)
    }
  }

  const submitDetails = () => {
    const errors: DetailsErrors = {}
    if (details.name.trim().length < 2) errors.name = 'Enter the company name (at least 2 characters).'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.applicantEmail.trim())) errors.applicantEmail = 'Enter a valid email for the applicant.'
    if (!details.gstin.trim()) errors.gstin = 'Enter the company GSTIN'
    else { const g = gstinError(details.gstin, details.pan); if (g) errors.gstin = g }
    if (!details.pan.trim()) errors.pan = 'Enter the company PAN'
    else if (!PAN_PATTERN.test(details.pan.trim())) errors.pan = 'PAN looks incorrect (e.g. AAAAA0000A)'
    if (Object.keys(errors).length > 0) { setDetailErrors(errors); return }
    create.mutate()
  }

  const fieldErrors: Record<string, string> = {}
  if (!entityType.trim()) fieldErrors.entityType = 'Choose the entity type'
  if (!authorizedSignatoryName.trim()) fieldErrors.authorizedSignatoryName = 'Enter the authorized signatory name'
  if (entityTypeRequiresCin(entityType)) {
    if (!cin.trim()) fieldErrors.cin = 'CIN is required for this entity type'
    else if (!isCinFormat(cin)) fieldErrors.cin = 'CIN looks incorrect (21 letters and digits, e.g. U74999DL2019PTC123456)'
  } else if (cin.trim() && !isCinFormat(cin)) {
    fieldErrors.cin = 'CIN looks incorrect (21 letters and digits, e.g. U74999DL2019PTC123456)'
  }
  if (!bankAccountNo.trim()) fieldErrors.bankAccountNo = 'Enter the bank account number'
  else if (!ACCOUNT_PATTERN.test(bankAccountNo.trim())) fieldErrors.bankAccountNo = 'Account number must be 9 to 18 digits'
  if (!bankIfsc.trim()) fieldErrors.bankIfsc = 'Enter the IFSC code'
  else if (!IFSC_PATTERN.test(bankIfsc.trim())) fieldErrors.bankIfsc = 'IFSC has 11 characters: 4 letters, a 0, then 6 letters or digits'
  const missingDocs = ORG_KYC_DOCUMENTS.filter(d => !docUrls[d.key])
  const canSubmit = Object.keys(fieldErrors).length === 0 && missingDocs.length === 0
  const err = (key: string) => (attemptedSubmit ? fieldErrors[key] : undefined)

  const trySubmit = () => {
    setAttemptedSubmit(true)
    if (canSubmit) submit.mutate()
  }

  return (
    <Modal open={open} onClose={close} size="lg" title={resumeOrg ? `Finish registering ${resumeOrg.name}` : 'Register a company for someone'} closeOnBackdrop={!create.isPending && !submit.isPending}>
      <div className="space-y-5">
        <Stepper steps={STEPS} current={done ? 2 : step} variant="inline" />

        {done ? (
          <Alert tone="success" title="Submitted for review">
            <p>{org?.name} is now waiting in the normal review queue, exactly like a self-serve registration.</p>
            {!resumeOrg && (
              <p className="mt-1">An invite to set a password was sent to {details.applicantEmail.trim()}; once they sign in they own this company and can see or fix anything flagged during review.</p>
            )}
            <Button className="mt-3" size="sm" onClick={close}>Done</Button>
          </Alert>
        ) : step === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Enter the applicant&apos;s email so we can invite them to own the company, and the company details they gave you.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Applicant email" type="email" required value={details.applicantEmail} error={detailErrors.applicantEmail} onChange={e => setField('applicantEmail')(e.target.value)} autoComplete="email" />
              <Input label="Applicant name" value={details.applicantFullName} error={detailErrors.applicantFullName} onChange={e => setField('applicantFullName')(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <Input label="Company name" required className="sm:col-span-2" value={details.name} error={detailErrors.name} onChange={e => setField('name')(e.target.value)} autoComplete="organization" />
              <Input label="Legal name" hint="As on the GST certificate." className="sm:col-span-2" value={details.legal_name} error={detailErrors.legal_name} onChange={e => setField('legal_name')(e.target.value)} />
              <Input label="GSTIN" required value={details.gstin} error={detailErrors.gstin} onChange={e => setField('gstin', true)(e.target.value)} maxLength={15} inputClassName="uppercase" />
              <Input label="PAN" required value={details.pan} error={detailErrors.pan} onChange={e => setField('pan', true)(e.target.value)} maxLength={10} inputClassName="uppercase" />
              <Input label="State" value={details.state} error={detailErrors.state} onChange={e => setField('state')(e.target.value)} />
              <Input label="City" value={details.city} error={detailErrors.city} onChange={e => setField('city')(e.target.value)} />
              <Textarea label="Address" className="sm:col-span-2" value={details.address} error={detailErrors.address} onChange={e => setField('address')(e.target.value)} />
              <Input label="Pincode" value={details.pincode} error={detailErrors.pincode} onChange={e => setField('pincode')(e.target.value)} inputMode="numeric" maxLength={6} />
              <Input label="Phone" type="tel" value={details.phone} error={detailErrors.phone} onChange={e => setField('phone')(e.target.value)} autoComplete="tel" />
            </div>
            {detailFormError && <Alert tone="danger" title="We could not create this company">{detailFormError}</Alert>}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="secondary" onClick={close} disabled={create.isPending}>Cancel</Button>
              <Button loading={create.isPending} onClick={submitDetails}>Create and continue</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <Alert tone="info" title={org?.name ?? ''}>
              {resumeOrg ? 'Finish the bank details and documents below, then submit for review.' : 'The applicant already got an invite to set a password. Fill in the rest before submitting for review.'}
            </Alert>
            <div>
              <p className="mb-3 text-sm font-medium text-text">Company details</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Company email" type="email" className="sm:col-span-2" value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} />
                <Select label="Entity type" value={entityType} onChange={e => setEntityType(e.target.value)} options={ENTITY_TYPE_OPTIONS} placeholder="Choose the entity type" error={err('entityType')} />
                {entityTypeRequiresCin(entityType) && (
                  <Input label="CIN" value={cin} onChange={e => setCin(e.target.value.toUpperCase())} maxLength={21} inputClassName="uppercase" error={err('cin')} hint="21-character Corporate Identity Number" />
                )}
                <Input label="Authorized signatory name" className="sm:col-span-2" value={authorizedSignatoryName} onChange={e => setAuthorizedSignatoryName(e.target.value)} error={err('authorizedSignatoryName')} />
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-medium text-text">Bank details</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Bank account number" value={bankAccountNo} onChange={e => setBankAccountNo(e.target.value.replace(/\D/g, '').slice(0, 18))} inputMode="numeric" hint="9 to 18 digits" error={err('bankAccountNo')} />
                <IfscField label="IFSC code" value={bankIfsc} onChange={setBankIfsc} onResolved={setIfscInfo} error={err('bankIfsc')} className="sm:col-span-2" />
                <Input label="Bank name" value={bankName} onChange={e => setBankName(e.target.value)} className="sm:col-span-2" />
              </div>
              <Button className="mt-3" variant="secondary" size="sm" loading={saveKyc.isPending} onClick={() => saveKyc.mutate()}>Save details</Button>
            </div>
            <div>
              <p className="mb-3 text-sm font-medium text-text">Documents</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {ORG_KYC_DOCUMENTS.map(d => (
                  <DocUploadField
                    key={d.key}
                    label={d.label}
                    hint={d.hint}
                    path={docUrls[d.key]}
                    busy={uploadingKey === d.key}
                    onUpload={file => uploadDoc(d.key, file)}
                    onRemove={() => removeDoc(d.key)}
                    onView={() => viewer.open(d.label, docUrls[d.key], d.key)}
                  />
                ))}
              </div>
            </div>
            {submitError && <Alert tone="danger" title="Not ready to submit">{submitError}</Alert>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button variant="secondary" onClick={close} disabled={submit.isPending}>Close (finish later)</Button>
              <Button loading={submit.isPending} onClick={trySubmit}>Submit for review</Button>
            </div>
            {missingDocs.length > 0 && <p className="text-xs text-muted">Documents still needed: {missingDocs.map(d => d.label).join(', ')}</p>}
          </div>
        )}
      </div>
      {viewer.modal}
    </Modal>
  )
}
