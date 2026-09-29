import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Building2, CheckCircle2, UploadCloud, Trash2, Eye } from 'lucide-react'
import { tplAPI } from '@/services/api'
import { Button, Card, Checkbox, Input, Select, Spinner } from '@/components/ui'
import { CorridorEditor } from '@/components/tpl/CorridorEditor'
import { OperationalTermsFields } from '@/components/tpl/OperationalTermsFields'
import { emptyCorridorRow, TPL_DOCUMENT_TYPES, type CorridorFormRow } from '@/components/tpl/constants'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { uploadTplDocument } from '@/services/tplDocuments'
import DocumentViewerModal from '@/components/ui/DocumentViewerModal'

const MSME_OPTIONS = ['Not Registered', 'Micro', 'Small', 'Medium']

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
const CUSTOM_ID_PATTERN = /^[a-z0-9_]{5,20}$/
const MOBILE_PATTERN = /^[6-9]\d{9}$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_PATTERN = /^\d{9,18}$/
const DRAFT_KEY = 'tpl-onboarding-draft'

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 15)
  return base
}

const steps = [
  { id: 1, label: 'Company & KYC' },
  { id: 2, label: 'Operational profile' },
  { id: 3, label: 'Submitted' },
] as const

export default function TplOnboardingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const editPan = searchParams.get('pan')

  const [step, setStep] = useState(1)
  const [loadingExisting, setLoadingExisting] = useState(!!editId)
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})

  // Company & KYC
  const [companyName, setCompanyName] = useState('')
  const [customId, setCustomId] = useState('')
  const [customIdError, setCustomIdError] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [pan, setPan] = useState('')
  const [gst, setGst] = useState('')
  const [msmeStatus, setMsmeStatus] = useState('Not Registered')
  const [bankAccount, setBankAccount] = useState('')
  const [bankIfsc, setBankIfsc] = useState('')

  // Operational profile
  const [corridors, setCorridors] = useState<CorridorFormRow[]>([emptyCorridorRow()])
  const [slaCommitment, setSlaCommitment] = useState('2 Hours')
  const [taxTreatment, setTaxTreatment] = useState('12% GTA (With ITC) - Forward Charge')
  const [isDeclared, setIsDeclared] = useState(false)

  // Documents (staged locally until submit)
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, File>>({})
  const [existingDocs, setExistingDocs] = useState<{ type: string, url: string }[]>([])
  const [previewFile, setPreviewFile] = useState<{ url: string, name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [trackingId, setTrackingId] = useState('')
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)

  // --- Step validation -------------------------------------------------
  const stepErrors = useMemo(() => {
    const errors: Record<number, Record<string, string>> = { 1: {}, 2: {} }
    if (!companyName.trim()) errors[1].companyName = 'Enter your company legal name'
    if (!editId && (!customId || customIdError)) errors[1].customId = customIdError || 'Choose a valid 3PL ID'
    if (!email.trim()) errors[1].email = 'Enter a contact email'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors[1].email = 'Enter a valid email address'
    if (!phone.trim()) errors[1].phone = 'Enter a mobile number'
    else if (!MOBILE_PATTERN.test(phone.trim())) errors[1].phone = 'Enter a valid 10-digit mobile number'
    if (!pan.trim()) errors[1].pan = 'Enter the company PAN'
    else if (!PAN_PATTERN.test(pan.trim())) errors[1].pan = 'PAN format looks wrong (e.g. ABCDE1234F)'
    if (!gst.trim()) errors[1].gst = 'Enter the GSTIN'
    else if (!GST_PATTERN.test(gst.trim())) errors[1].gst = 'GSTIN format looks wrong (e.g. 07ABCDE1234F1Z5)'
    if (!bankAccount.trim()) errors[1].bankAccount = 'Enter the bank account number'
    else if (!ACCOUNT_PATTERN.test(bankAccount.trim())) errors[1].bankAccount = 'Account number must be 9–18 digits'
    if (!bankIfsc.trim()) errors[1].bankIfsc = 'Enter the IFSC code'
    else if (!IFSC_PATTERN.test(bankIfsc.trim())) errors[1].bankIfsc = 'IFSC looks wrong (e.g. HDFC0001234)'

    if (!isDeclared) errors[2].declaration = 'Accept the declaration to submit'
    return errors
  }, [companyName, customId, customIdError, editId, email, phone, pan, gst, bankAccount, bankIfsc, isDeclared])

  const stepValid = (i: number) => Object.keys(stepErrors[i]).length === 0
  const err = (i: number, key: string) => (attempted[i] ? stepErrors[i][key] : undefined)

  const handleCustomIdChange = (val: string) => {
    const rawVal = val.toLowerCase().replace(/[^a-z0-9_]/g, '')
    setCustomId(rawVal)
    if (rawVal.length > 0 && (rawVal.length < 5 || rawVal.length > 20)) {
      setCustomIdError('ID must be between 5 and 20 characters')
    } else if (rawVal.length > 0 && !CUSTOM_ID_PATTERN.test(rawVal)) {
      setCustomIdError('Only lowercase letters, numbers and underscores are allowed')
    } else {
      setCustomIdError('')
    }
  }

  // Pre-fill the form when editing a pending application
  useEffect(() => {
    if (!editId || !editPan) return
    tplAPI.getPartner(editId, editPan).then(data => {
      if (data.pan_number !== editPan.toUpperCase()) {
        toast.error('Invalid credentials for editing this application.')
        navigate('/3pl/onboard/track')
        return
      }
      setCompanyName(data.company_name || '')
      setCustomId(data.custom_id || '')
      setPhone(data.phone || '')
      setPan(data.pan_number || '')
      setGst(data.gstin || '')
      setMsmeStatus(data.msme_status || 'Not Registered')
      setBankAccount(data.bank_account_no || '')
      setBankIfsc(data.bank_ifsc || '')
      setSlaCommitment(data.sla_commitment || '2 Hours')
      setTaxTreatment(data.tax_treatment || '12% GTA (With ITC) - Forward Charge')
      if (data.tpl_corridors?.length > 0) {
        setCorridors(data.tpl_corridors.map((c: {
          corridor_name: string
          vehicle_types?: string[] | null
          proposed_rate?: string | null
          priority?: string | number | null
        }, i: number) => ({
          id: i + 1,
          name: c.corridor_name,
          vehicles: (c.vehicle_types || []).join(', '),
          rate: c.proposed_rate || '',
          priority: String(c.priority || '1'),
        })))
      }
      if (data.tpl_documents?.length > 0) {
        setExistingDocs(data.tpl_documents.map((d: { doc_type: string; file_url: string }) => ({ type: d.doc_type, url: d.file_url })))
      }
    }).catch(() => {
      toast.error('Failed to load application data.')
    }).finally(() => setLoadingExisting(false))
  }, [editId, editPan, navigate])

  // --- Draft autosave (localStorage) — only for a fresh application; an
  // application being edited already loads its truth from the server. Only
  // the uploaded documents' storage paths (existingDocs) can be restored —
  // staged File objects (uploadedDocs) are never put in localStorage.
  useEffect(() => {
    if (editId || draftRestored) return
    setDraftRestored(true)
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as Record<string, unknown>
      if (typeof draft.companyName === 'string') setCompanyName(draft.companyName)
      if (typeof draft.customId === 'string') setCustomId(draft.customId)
      if (typeof draft.email === 'string') setEmail(draft.email)
      if (typeof draft.phone === 'string') setPhone(draft.phone)
      if (typeof draft.pan === 'string') setPan(draft.pan)
      if (typeof draft.gst === 'string') setGst(draft.gst)
      if (typeof draft.msmeStatus === 'string') setMsmeStatus(draft.msmeStatus)
      if (typeof draft.bankAccount === 'string') setBankAccount(draft.bankAccount)
      if (typeof draft.bankIfsc === 'string') setBankIfsc(draft.bankIfsc)
      if (typeof draft.slaCommitment === 'string') setSlaCommitment(draft.slaCommitment)
      if (typeof draft.taxTreatment === 'string') setTaxTreatment(draft.taxTreatment)
      if (Array.isArray(draft.corridors) && draft.corridors.length > 0) setCorridors(draft.corridors as CorridorFormRow[])
      if (typeof draft.step === 'number') setStep(draft.step)
      toast('Restored your saved draft. Documents must be re-attached.', { icon: '📝' })
    } catch (e) {
      console.error('Failed to restore draft', e)
    }
  }, [editId, draftRestored])

  useEffect(() => {
    if (editId || !draftRestored) return
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          companyName, customId, email, phone, pan, gst, msmeStatus, bankAccount, bankIfsc,
          slaCommitment, taxTreatment, corridors, step,
        }))
        setDraftSavedAt(Date.now())
      } catch (e) {
        console.error('Failed to save draft', e)
      }
    }, 400)
    return () => window.clearTimeout(id)
  }, [editId, draftRestored, companyName, customId, email, phone, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment, corridors, step])

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
  }

  const handleNext = () => {
    setAttempted(prev => ({ ...prev, 1: true }))
    if (!stepValid(1)) {
      toast.error('Please fix the errors before continuing.')
      return
    }
    setStep(2)
  }

  const handleFileSelect = (docType: string, file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error(`${file.name} is over the 2 MB limit.`)
      return
    }
    setUploadedDocs(prev => ({ ...prev, [docType]: file }))
  }

  const handleSubmit = async () => {
    setAttempted({ 1: true, 2: true })
    if (!stepValid(1) || !stepValid(2)) {
      toast.error('Please fix the errors before submitting.')
      setStep(stepValid(1) ? 2 : 1)
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        custom_id: customId,
        companyName, email, phone, pan, gst, msmeStatus, bankAccount, bankIfsc, slaCommitment, taxTreatment,
        corridors,
        // Keep documents that aren't being replaced by a new upload in this save, so
        // editing without re-uploading every file doesn't delete the untouched ones.
        documents: existingDocs.filter(d => !(d.type in uploadedDocs)) as { type: string, url: string }[],
        ...(editId && editPan ? { verify_pan: editPan } : {}),
      }

      await Promise.all(Object.keys(uploadedDocs).map(async docType => {
        const file = uploadedDocs[docType]
        const target = editId ? { applicationId: editId, verifyPan: editPan } : { customId }
        const path = await uploadTplDocument(file, docType, target)
          .catch((err: Error) => { throw new Error(`Failed to upload ${docType}: ${err.message}`) })
        payload.documents.push({ type: docType, url: path })
      }))

      const promise = editId ? tplAPI.updateApplication(editId, payload) : tplAPI.onboard(payload)
      const data = await toast.promise(promise, {
        loading: editId ? 'Updating application…' : 'Submitting application…',
        success: editId ? 'Application updated.' : 'Application submitted.',
        error: editId ? 'Failed to update application.' : 'Failed to submit application.',
      })
      setTrackingId(customId || editId || data.id)
      clearDraft()
      setStep(3)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingExisting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-12">
      <div className="mx-auto max-w-form space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Building2 size={28} />
          </div>
          <h1 className="text-2xl font-semibold text-text sm:text-3xl">3PL partner setup</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            {editId ? 'Update your business identity and operational terms.' : 'Provide your business identity and operational terms to apply as a 3PL partner.'}
          </p>
        </div>

        {/* Stepper */}
        <ol className="flex items-center justify-center gap-3 text-sm">
          {steps.slice(0, 2).map((s, i) => (
            <li key={s.id} className="flex items-center gap-3">
              <span className={clsx(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium',
                step > s.id ? 'bg-success text-white' : step === s.id ? 'bg-brand-fill text-text' : 'bg-neutral-soft text-muted',
              )}>
                {step > s.id ? <CheckCircle2 size={14} /> : s.id}
              </span>
              <span className={clsx(step === s.id ? 'font-medium text-text' : 'text-muted')}>{s.label}</span>
              {i === 0 && <span className="h-px w-8 bg-border" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <Card padded>
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Input label="Company legal name" required value={companyName} onChange={e => {
                  setCompanyName(e.target.value)
                  if (!editId && !customId) handleCustomIdChange(slugify(e.target.value))
                }} placeholder="e.g. Acme Logistics Pvt Ltd" error={err(1, 'companyName')} />
                <Input
                  label="3PL ID"
                  required
                  disabled={!!editId}
                  hint={editId ? 'Cannot be changed once submitted.' : 'Lowercase letters, numbers and underscores, 5–20 characters.'}
                  error={err(1, 'customId') || customIdError || undefined}
                  value={customId}
                  onChange={e => handleCustomIdChange(e.target.value)}
                  placeholder="e.g. acme_3pl"
                />
                <Input label="Contact email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" error={err(1, 'email')} />
                <Input
                  label="Mobile number" type="tel" inputMode="tel" required maxLength={10}
                  value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="9876543210" error={err(1, 'phone')}
                />
                <Input label="Company PAN" required value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" className="font-mono" error={err(1, 'pan')} />
                <Input label="GSTIN" required value={gst} onChange={e => setGst(e.target.value.toUpperCase())} placeholder="07ABCDE1234F1Z5" className="font-mono" error={err(1, 'gst')} />
                <Select label="MSME status" options={MSME_OPTIONS.map(o => ({ value: o, label: o }))} value={msmeStatus} onChange={e => setMsmeStatus(e.target.value)} />
              </div>

              <div className="border-t border-border pt-6">
                <div className="mb-4 flex items-center gap-2">
                  <h3 className="text-sm font-medium text-text">Bank details (for remittance)</h3>
                  {draftSavedAt && <span className="text-xs text-muted">Saved</span>}
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Input
                    label="Account number" required value={bankAccount}
                    onChange={e => setBankAccount(e.target.value.replace(/\D/g, '').slice(0, 18))}
                    error={err(1, 'bankAccount')}
                    hint="9–18 digits"
                  />
                  <Input
                    label="IFSC code" required value={bankIfsc}
                    onChange={e => setBankIfsc(e.target.value.toUpperCase())}
                    className="font-mono" error={err(1, 'bankIfsc')}
                    placeholder="HDFC0001234"
                  />
                </div>
              </div>
            </div>
          </Card>
        )}

        {step === 1 && (
          <div className="flex justify-end">
            <Button onClick={handleNext}>Next: Operational profile</Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <Card padded>
              <div className="space-y-8">
                <OperationalTermsFields
                  slaCommitment={slaCommitment}
                  taxTreatment={taxTreatment}
                  onSlaChange={setSlaCommitment}
                  onTaxChange={setTaxTreatment}
                />
                <div className="border-t border-border pt-8">
                  <CorridorEditor corridors={corridors} onChange={setCorridors} />
                </div>

                <div className="border-t border-border pt-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-text">KYC and commercial documents</h3>
                    <span className="text-xs text-muted">Max file size: 2 MB</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {TPL_DOCUMENT_TYPES.map(docType => {
                      const file = uploadedDocs[docType]
                      const existing = existingDocs.find(d => d.type === docType)
                      const hasSomething = !!file || !!existing
                      return (
                        <div
                          key={docType}
                          className={clsx(
                            'flex h-28 flex-col items-center justify-center rounded-control border border-dashed p-3 text-center',
                            hasSomething ? 'border-success bg-success-soft' : 'border-border-strong bg-surface',
                          )}
                        >
                          {hasSomething ? (
                            <>
                              <CheckCircle2 size={20} className="mb-1 text-success" />
                              <div className="w-full truncate text-xs font-medium text-text" title={docType}>{docType}</div>
                              <div className="mt-1 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => file
                                    ? setPreviewFile({ url: URL.createObjectURL(file), name: docType })
                                    : existing && setPreviewFile({ url: existing.url, name: docType })}
                                  className="text-muted hover:text-text"
                                  aria-label={`View ${docType}`}
                                >
                                  <Eye size={14} />
                                </button>
                                <label className="cursor-pointer text-muted hover:text-text">
                                  <UploadCloud size={14} />
                                  <span className="sr-only">Replace {docType}</span>
                                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={e => handleFileSelect(docType, e.target.files?.[0])} />
                                </label>
                                {file && (
                                  <button
                                    type="button"
                                    onClick={() => setUploadedDocs(prev => {
                                      const next = { ...prev }
                                      delete next[docType]
                                      return next
                                    })}
                                    className="text-danger hover:text-danger"
                                    aria-label={`Remove ${docType}`}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            </>
                          ) : (
                            <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2">
                              <UploadCloud size={20} className="text-muted" />
                              <span className="text-xs font-medium text-text">{docType}</span>
                              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={e => handleFileSelect(docType, e.target.files?.[0])} />
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="border-t border-border pt-6">
                  <Checkbox
                    checked={isDeclared}
                    onChange={e => setIsDeclared(e.target.checked)}
                    label="I declare that the information provided is accurate and complete."
                    description="This operational profile is subject to approval before your account is activated."
                    error={err(2, 'declaration')}
                  />
                </div>
              </div>
            </Card>

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={!isDeclared} loading={submitting} onClick={handleSubmit}>
                {editId ? 'Save changes' : 'Submit application'}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <Card padded className="py-16 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle2 size={32} />
            </div>
            <h2 className="text-lg font-semibold text-text">{editId ? 'Application updated' : 'Application submitted'}</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted">
              {editId
                ? 'Your updated identity and operational terms have been sent for review.'
                : 'Your identity and operational terms have been sent for review.'}
            </p>
            <div className="mx-auto mt-6 max-w-sm rounded-control border border-border bg-surface-subtle p-4">
              <p className="text-xs text-muted">Your 3PL tracking ID</p>
              <p className="mt-1 select-all font-mono text-sm font-semibold text-brand">{trackingId || '—'}</p>
              <p className="mt-2 text-xs text-muted">Save this ID to check your status or edit your application before it's approved.</p>
            </div>
            <Button variant="secondary" className="mt-6" onClick={() => navigate('/3pl/onboard/track')}>
              Track my application
            </Button>
          </Card>
        )}

        <div className="text-center">
          <Link to="/" className="text-sm text-muted hover:text-text">Go to main page</Link>
        </div>
      </div>

      {previewFile && (
        <DocumentViewerModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileUrl={previewFile.url}
          fileName={previewFile.name}
        />
      )}
    </div>
  )
}
