import { useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2 } from 'lucide-react'
import { Alert, Button, Drawer, IfscField, Input, Select } from '@/components/ui'
import { DocUploadField } from '@/components/kyc/DocUploadField'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'
import { tplAPI } from '@/services/api'
import { uploadTplDocument } from '@/services/tplDocuments'
import { getKycDocumentUrl } from '@/services/kycDocuments'
import { errorMessage } from '@/utils/display'
import { gstinError } from '@/utils/gstin'
import { ENTITY_TYPE_OPTIONS, entityTypeRequiresCin, isCinFormat } from '@/utils/entityType'
import { OperationalTermsFields } from './OperationalTermsFields'
import { CorridorEditor } from './CorridorEditor'
import { TPL_DOCUMENT_TYPES, TPL_MSME_OPTIONS, emptyCorridorRow, type CorridorFormRow } from './constants'

// Keep in step with backend-ts/src/schemas/tpl.ts (same checks, same messages).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_PATTERN = /^\d{9,18}$/
// Keep in step with backend-ts/src/services/tpl.service.ts's CUSTOM_ID_PATTERN.
const CUSTOM_ID_PATTERN = /^[a-z0-9_]{5,20}$/

/** A 3PL ID candidate from the company name: lowercase, underscored, a random suffix so it is likely free. */
function suggestCustomId(companyName: string): string {
  const base = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14) || 'partner'
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${base}_${suffix}`.slice(0, 20)
}

const MSME_OPTIONS = TPL_MSME_OPTIONS.map(value => ({ value, label: value }))

interface FormState {
  customId: string
  companyName: string
  contactName: string
  email: string
  phone: string
  pan: string
  gst: string
  entityType: string
  cin: string
  authorizedSignatoryName: string
  msmeStatus: string
  bankAccount: string
  bankIfsc: string
  slaCommitment: string
  taxTreatment: string
  corridors: CorridorFormRow[]
}

function emptyForm(): FormState {
  return {
    customId: '', companyName: '', contactName: '', email: '', phone: '',
    pan: '', gst: '', entityType: '', cin: '', authorizedSignatoryName: '',
    msmeStatus: 'Not Registered', bankAccount: '', bankIfsc: '',
    slaCommitment: '2 Hours', taxTreatment: '12% GTA (With ITC) - Forward Charge',
    corridors: [emptyCorridorRow()],
  }
}

interface Created { id: string; custom_id: string | null }

/**
 * Lets a superadmin enter a 3PL application for someone who phoned or WhatsApp'd their details in,
 * instead of using the public wizard themselves. Collects the same full (non-quick) field set as
 * `TplOnboardingPage`'s regular path and posts to `POST /tpl/admin/create`, which is `tpl.service.ts`'s
 * `onboard()` tagged with the staff member who entered it — no `fleetSize` (that flag is what makes
 * onboard() treat a submission as "quick") and no `user_id` (stays null; approve() emails a
 * password-setup link once the application is approved, same as any applicant with no linked account).
 */
export function StaffCreateApplicationDrawer({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [customIdTouched, setCustomIdTouched] = useState(false)
  const [docUrls, setDocUrls] = useState<Record<string, string>>({})
  const [uploadingType, setUploadingType] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }))

  const reset = () => {
    setForm(emptyForm())
    setCustomIdTouched(false)
    setDocUrls({})
    setAttemptedSubmit(false)
    setCreated(null)
  }

  const handleClose = () => {
    onClose()
    reset()
  }

  const customId = form.customId.trim().toLowerCase()
  const customIdValid = CUSTOM_ID_PATTERN.test(customId)
  const requiresCin = entityTypeRequiresCin(form.entityType)

  const fieldErrors: Record<string, string> = {}
  if (!form.companyName.trim()) fieldErrors.companyName = 'Company name is required'
  if (!form.contactName.trim()) fieldErrors.contactName = 'Contact person is required'
  if (!EMAIL_PATTERN.test(form.email.trim())) fieldErrors.email = 'Enter a valid email address, for example name@company.in'
  if (!PAN_PATTERN.test(form.pan.trim())) fieldErrors.pan = 'PAN looks incorrect (for example ABCDE1234F)'
  if (!form.entityType) fieldErrors.entityType = `Entity type is required (one of: ${ENTITY_TYPE_OPTIONS.map(o => o.label).join(', ')})`
  if (!form.authorizedSignatoryName.trim()) fieldErrors.authorizedSignatoryName = 'The authorized signatory name is required'
  if (requiresCin && !form.cin.trim()) fieldErrors.cin = 'CIN is required for this entity type'
  else if (form.cin.trim() && !isCinFormat(form.cin)) fieldErrors.cin = 'CIN looks incorrect (21 letters and digits, for example U74999DL2019PTC123456)'
  if (form.gst.trim()) { const g = gstinError(form.gst, form.pan); if (g) fieldErrors.gst = g }
  if (form.bankIfsc.trim() && !IFSC_PATTERN.test(form.bankIfsc.trim())) fieldErrors.bankIfsc = 'IFSC looks incorrect (for example HDFC0001234)'
  if (form.bankAccount.trim() && !ACCOUNT_PATTERN.test(form.bankAccount.trim())) fieldErrors.bankAccount = 'Account number must be 9 to 18 digits'
  if (form.customId.trim() && !customIdValid) fieldErrors.customId = 'Partner ID must be 5-20 lowercase letters, digits or underscores'
  const canSubmit = Object.keys(fieldErrors).length === 0
  const err = (key: string) => (attemptedSubmit ? fieldErrors[key] : undefined)

  const applyCompanyName = (value: string) => {
    set('companyName', value)
    if (!customIdTouched) set('customId', value.trim() ? suggestCustomId(value) : '')
  }

  const uploadDoc = async (docType: string, file: File) => {
    if (!customIdValid) {
      toast.error('Choose a valid 3PL ID above before attaching documents.')
      return
    }
    setUploadingType(docType)
    try {
      const path = await uploadTplDocument(file, docType, { customId })
      setDocUrls(u => ({ ...u, [docType]: path }))
      toast.success('Document uploaded')
    } catch (uploadErr) {
      toast.error(errorMessage(uploadErr, 'We could not upload this document. Try again.'))
    } finally {
      setUploadingType(null)
    }
  }

  const removeDoc = (docType: string) => setDocUrls(u => {
    const next = { ...u }
    delete next[docType]
    return next
  })

  const openViewer = async (path: string, name: string) => {
    try {
      setViewer({ url: await getKycDocumentUrl(path), name })
    } catch {
      toast.error('We could not open this document. Try again.')
    }
  }

  const submit = async () => {
    setAttemptedSubmit(true)
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const namedCorridors = form.corridors.filter(c => c.name.trim())
      const documents = Object.entries(docUrls).map(([type, url]) => ({ type, url }))
      const res = await tplAPI.adminCreate({
        ...(customId ? { custom_id: customId } : {}),
        companyName: form.companyName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        pan: form.pan.trim().toUpperCase(),
        ...(form.gst.trim() ? { gst: form.gst.trim().toUpperCase() } : {}),
        entityType: form.entityType,
        ...(form.cin.trim() ? { cin: form.cin.trim().toUpperCase() } : {}),
        authorizedSignatoryName: form.authorizedSignatoryName.trim(),
        msmeStatus: form.msmeStatus,
        ...(form.bankAccount.trim() ? { bankAccount: form.bankAccount.trim() } : {}),
        ...(form.bankIfsc.trim() ? { bankIfsc: form.bankIfsc.trim().toUpperCase() } : {}),
        slaCommitment: form.slaCommitment,
        taxTreatment: form.taxTreatment,
        ...(namedCorridors.length ? { corridors: namedCorridors } : {}),
        ...(documents.length ? { documents } : {}),
      })
      setCreated({ id: res?.data?.id, custom_id: res?.data?.custom_id ?? null })
      onCreated()
    } catch (createErr) {
      toast.error(errorMessage(createErr, 'We could not create this application. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={handleClose}
        size="xl"
        title={created ? 'Application created' : 'Enter an application for someone'}
        description={created ? undefined : 'For an applicant who phoned or messaged their details in. It goes through the same review queue as a self-serve application.'}
        footer={created ? (
          <>
            <Button variant="secondary" onClick={reset}>Enter another application</Button>
            <Button onClick={handleClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} loading={submitting}>Create application</Button>
          </>
        )}
      >
        {created ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle2 size={28} />
            </div>
            <div>
              <p className="font-medium text-text">The application is pending review.</p>
              <p className="mt-1 text-sm text-muted">
                {created.custom_id ? <>3PL ID: <span className="font-mono">{created.custom_id}</span></> : 'No 3PL ID was set.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {attemptedSubmit && !canSubmit && (
              <Alert tone="danger" title="Fix the highlighted fields before creating this application" />
            )}

            <section aria-label="Partner ID">
              <Input
                label="3PL ID"
                hint="Used for the partner's document folder and, later, to track the application. Suggested from the company name; edit if you like."
                placeholder="e.g. acme_3pl"
                value={form.customId}
                onChange={e => { setCustomIdTouched(true); set('customId', e.target.value.toLowerCase()) }}
                error={err('customId')}
                className="font-mono"
              />
            </section>

            <section aria-label="Contact details">
              <h3 className="mb-3 text-sm font-medium text-text">Contact details</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Company name" required value={form.companyName} onChange={e => applyCompanyName(e.target.value)} error={err('companyName')} />
                <Input label="Contact person" required value={form.contactName} onChange={e => set('contactName', e.target.value)} error={err('contactName')} />
                <Input label="Email" required type="email" value={form.email} onChange={e => set('email', e.target.value)} error={err('email')} />
                <Input label="Mobile number" value={form.phone} onChange={e => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} />
              </div>
            </section>

            <section aria-label="Company and tax details" className="border-t border-border pt-6">
              <h3 className="mb-3 text-sm font-medium text-text">Company and tax details</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="PAN" required value={form.pan} onChange={e => set('pan', e.target.value.toUpperCase())} maxLength={10} inputClassName="uppercase" error={err('pan')} />
                <Input label="GSTIN" value={form.gst} onChange={e => set('gst', e.target.value.toUpperCase())} maxLength={15} inputClassName="uppercase" error={err('gst')} />
                <Select label="Entity type" required options={ENTITY_TYPE_OPTIONS} value={form.entityType} onChange={e => set('entityType', e.target.value)} placeholder="Choose the entity type" error={err('entityType')} />
                {requiresCin && (
                  <Input label="CIN" required value={form.cin} onChange={e => set('cin', e.target.value.toUpperCase())} maxLength={21} inputClassName="uppercase" error={err('cin')} />
                )}
                <Input label="Authorized signatory name" required value={form.authorizedSignatoryName} onChange={e => set('authorizedSignatoryName', e.target.value)} error={err('authorizedSignatoryName')} />
                <Select label="MSME status" options={MSME_OPTIONS} value={form.msmeStatus} onChange={e => set('msmeStatus', e.target.value)} />
              </div>
            </section>

            <section aria-label="Bank details" className="border-t border-border pt-6">
              <h3 className="mb-3 text-sm font-medium text-text">Bank details</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Bank account number" value={form.bankAccount} onChange={e => set('bankAccount', e.target.value.replace(/\D/g, '').slice(0, 18))} inputMode="numeric" hint="9 to 18 digits" error={err('bankAccount')} />
                <IfscField label="IFSC code" value={form.bankIfsc} onChange={v => set('bankIfsc', v)} error={err('bankIfsc')} />
              </div>
            </section>

            <section aria-label="Service terms" className="border-t border-border pt-6">
              <h3 className="mb-3 text-sm font-medium text-text">Service terms</h3>
              <OperationalTermsFields
                slaCommitment={form.slaCommitment}
                taxTreatment={form.taxTreatment}
                onSlaChange={v => set('slaCommitment', v)}
                onTaxChange={v => set('taxTreatment', v)}
              />
            </section>

            <section aria-label="Corridors" className="border-t border-border pt-6">
              <CorridorEditor corridors={form.corridors} onChange={rows => set('corridors', rows)} />
            </section>

            <section aria-label="Documents" className="border-t border-border pt-6">
              <h3 className="mb-3 text-sm font-medium text-text">Documents</h3>
              <p className="mb-3 text-xs text-muted">
                {customIdValid
                  ? 'Optional here, but GSTIN, bank details and at least one document are all required before this application can be approved.'
                  : 'Choose a valid 3PL ID above to attach documents.'}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {TPL_DOCUMENT_TYPES.map(docType => (
                  <DocUploadField
                    key={docType}
                    label={docType}
                    path={docUrls[docType]}
                    busy={uploadingType === docType}
                    onUpload={file => uploadDoc(docType, file)}
                    onRemove={() => removeDoc(docType)}
                    onView={() => openViewer(docUrls[docType], docType)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </Drawer>

      {viewer && <DocumentViewerModal isOpen onClose={() => setViewer(null)} fileUrl={viewer.url} fileName={viewer.name} />}
    </>
  )
}
