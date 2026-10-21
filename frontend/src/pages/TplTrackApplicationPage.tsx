import { errorMessage, formatDateTime } from '@/utils/display'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, CheckCircle2, Upload, Building2, FileCheck, IndianRupee, Clock, ArrowLeft, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { tplAPI } from '@/services/api'
import { uploadTplDocument } from '@/services/tplDocuments'
import { Alert, Button, Card, FileButton, IfscField, Input, Select, StatusPill } from '@/components/ui'
import { OperationalTermsFields } from '@/components/tpl/OperationalTermsFields'
import { gstinError } from '@/utils/gstin'
import { ENTITY_TYPE_OPTIONS, entityTypeRequiresCin, isCinFormat } from '@/utils/entityType'

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const ACCOUNT_PATTERN = /^\d{9,18}$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/i

interface TplApplication {
  id: string
  company_name: string
  status: string
  corridor_count?: number
  document_count?: number
  created_at?: string
  rejection_reason?: string | null
  document_issues?: Record<string, string> | null
}

interface TplDocument { id: string; doc_type: string; file_url: string }
interface TplApplicationFull extends TplApplication {
  tpl_documents?: TplDocument[]
  contact_name?: string | null
  pan_number?: string | null
  gstin?: string | null
  entity_type?: string | null
  cin?: string | null
  authorizedSignatoryName?: string | null
  authorized_signatory_name?: string | null
  bank_account_no?: string | null
  bank_ifsc?: string | null
  sla_commitment?: string | null
  tax_treatment?: string | null
}

/**
 * Edits the company, tax, bank and operational details of a pending or rejected application.
 */
export function FixDetails({ applicationId, pan, full, onSaved }: { applicationId: string; pan: string; full: TplApplicationFull; onSaved: () => void }) {
  const [companyName, setCompanyName] = useState(full.company_name || '')
  const [contactName, setContactName] = useState(full.contact_name || '')
  const [panNumber, setPanNumber] = useState(full.pan_number || '')
  const [gst, setGst] = useState(full.gstin || '')
  const [entityType, setEntityType] = useState(full.entity_type || '')
  const [cin, setCin] = useState(full.cin || '')
  const [authorizedSignatoryName, setAuthorizedSignatoryName] = useState(full.authorized_signatory_name || full.authorizedSignatoryName || '')
  const [bankAccount, setBankAccount] = useState(full.bank_account_no || '')
  const [bankIfsc, setBankIfsc] = useState(full.bank_ifsc || '')
  const [slaCommitment, setSlaCommitment] = useState(full.sla_commitment || '2 Hours')
  const [taxTreatment, setTaxTreatment] = useState(full.tax_treatment || '12% GTA (With ITC) - Forward Charge')
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)

  const errors: Record<string, string> = {}
  if (!companyName.trim()) errors.companyName = 'Company name is required.'
  if (!contactName.trim()) errors.contactName = 'Contact person is required.'
  if (!entityType.trim()) errors.entityType = 'Choose the entity type.'
  if (!authorizedSignatoryName.trim()) errors.authorizedSignatoryName = 'Enter the authorized signatory name.'
  if (entityTypeRequiresCin(entityType) && !cin.trim()) errors.cin = 'CIN is required for this entity type.'
  else if (cin.trim() && !isCinFormat(cin)) errors.cin = 'CIN looks incorrect (21 letters and digits, e.g. U74999DL2019PTC123456).'
  if (panNumber.trim() && !PAN_PATTERN.test(panNumber.trim().toUpperCase())) errors.panNumber = 'PAN looks incorrect (e.g. ABCDE1234F).'
  if (gst.trim()) {
    const g = gstinError(gst.trim(), panNumber.trim() || undefined)
    if (g) errors.gst = g
  }
  if (bankAccount.trim() && !ACCOUNT_PATTERN.test(bankAccount.trim())) errors.bankAccount = 'Bank account must be 9 to 18 digits.'
  if (bankIfsc.trim() && !IFSC_PATTERN.test(bankIfsc.trim().toUpperCase())) errors.bankIfsc = 'IFSC looks incorrect (e.g. HDFC0001234).'

  const err = (key: string) => (attempted ? errors[key] : undefined)

  const handleGstChange = (val: string) => {
    const upper = val.toUpperCase()
    setGst(upper)
    if (!panNumber.trim() && upper.length >= 12) {
      const derived = upper.slice(2, 12)
      if (PAN_PATTERN.test(derived)) {
        setPanNumber(derived)
      }
    }
  }

  const save = async () => {
    setAttempted(true)
    const firstError = Object.values(errors)[0]
    if (firstError) {
      toast.error(firstError)
      return
    }
    setSaving(true)
    try {
      await tplAPI.updateApplication(applicationId, {
        verify_pan: pan,
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        entityType,
        authorizedSignatoryName: authorizedSignatoryName.trim(),
        ...(panNumber.trim() ? { pan: panNumber.trim().toUpperCase() } : {}),
        ...(gst.trim() ? { gst: gst.trim().toUpperCase() } : {}),
        ...(cin.trim() ? { cin: cin.trim().toUpperCase() } : {}),
        ...(bankAccount.trim() ? { bankAccount: bankAccount.trim() } : {}),
        ...(bankIfsc.trim() ? { bankIfsc: bankIfsc.trim().toUpperCase() } : {}),
        slaCommitment,
        taxTreatment,
      })
      toast.success(full.status === 'rejected' ? 'Details saved. Your application is back under review.' : 'Details saved')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err, 'We could not save your details. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Identity & Corporate */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Building2 size={16} className="text-brand" />
          <h4 className="text-xs font-bold text-text uppercase tracking-wider">Company &amp; Governance</h4>
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Input label="Company name" required value={companyName} error={err('companyName')} onChange={e => setCompanyName(e.target.value)} />
          <Input label="Contact person" required value={contactName} error={err('contactName')} onChange={e => setContactName(e.target.value)} />
          <Select label="Entity type" required value={entityType} error={err('entityType')} onChange={e => setEntityType(e.target.value)} options={ENTITY_TYPE_OPTIONS} placeholder="Choose entity type" />
          {entityTypeRequiresCin(entityType) && (
            <Input label="CIN" required value={cin} error={err('cin')} onChange={e => setCin(e.target.value.toUpperCase())} placeholder="U74999DL2019PTC123456" maxLength={21} inputClassName="font-mono uppercase" />
          )}
          <Input label="Authorized signatory name" required value={authorizedSignatoryName} error={err('authorizedSignatoryName')} onChange={e => setAuthorizedSignatoryName(e.target.value)} className={entityTypeRequiresCin(entityType) ? '' : 'sm:col-span-2'} />
        </div>
      </div>

      {/* 2. Tax & Banking */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <FileCheck size={16} className="text-brand" />
          <h4 className="text-xs font-bold text-text uppercase tracking-wider">Tax &amp; Settlement Account</h4>
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Input label="PAN" value={panNumber} error={err('panNumber')} onChange={e => setPanNumber(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} inputClassName="font-mono uppercase" />
          <Input label="GSTIN" value={gst} error={err('gst')} onChange={e => handleGstChange(e.target.value)} placeholder="07ABCDE1234F1Z5" maxLength={15} inputClassName="font-mono uppercase" />
          <Input label="Bank account number" value={bankAccount} error={err('bankAccount')} onChange={e => setBankAccount(e.target.value)} inputClassName="font-mono" placeholder="9 to 18 digits" />
          <IfscField label="Bank IFSC" value={bankIfsc} error={err('bankIfsc')} onChange={setBankIfsc} placeholder="HDFC0001234" required={false} />
        </div>
      </div>

      {/* 3. Operational Terms */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Clock size={16} className="text-brand" />
          <h4 className="text-xs font-bold text-text uppercase tracking-wider">Service Levels &amp; Tax Terms</h4>
        </div>
        <OperationalTermsFields
          slaCommitment={slaCommitment}
          taxTreatment={taxTreatment}
          onSlaChange={setSlaCommitment}
          onTaxChange={setTaxTreatment}
        />
      </div>

      <div className="pt-2">
        <Button fullWidth size="lg" loading={saving} onClick={save} className="font-bold justify-center">
          Save updated details
        </Button>
      </div>
    </div>
  )
}

function FixDocumentsList({ applicationId, pan, full, onReplaced }: { applicationId: string; pan: string; full: TplApplicationFull; onReplaced: () => void }) {
  const [uploadingType, setUploadingType] = useState<string | null>(null)

  const uniqueDocs = (full.tpl_documents ?? []).reduce<TplDocument[]>((acc, doc) => {
    const existingIndex = acc.findIndex(d => d.doc_type === doc.doc_type)
    if (existingIndex >= 0) {
      acc[existingIndex] = doc
    } else {
      acc.push(doc)
    }
    return acc
  }, [])

  const replace = (doc: TplDocument) => async (file: File) => {
    setUploadingType(doc.doc_type)
    try {
      const path = await uploadTplDocument(file, doc.doc_type, { applicationId, verifyPan: pan })
      const documents = uniqueDocs.map(d => (d.doc_type === doc.doc_type ? { type: d.doc_type, url: path } : { type: d.doc_type, url: d.file_url }))
      await tplAPI.updateApplication(applicationId, { verify_pan: pan, documents })
      toast.success(full.status === 'rejected' ? 'Document replaced. Your application is back under review.' : 'Document replaced')
      onReplaced()
    } catch (err) {
      toast.error(errorMessage(err, 'We could not save this document. Try again.'))
    } finally {
      setUploadingType(null)
    }
  }

  if (uniqueDocs.length === 0) {
    return <p className="text-sm text-muted">No documents uploaded yet.</p>
  }

  return (
    <div className="space-y-3">
      {uniqueDocs.map(doc => {
        const issue = full.document_issues?.[doc.doc_type]
        return (
          <div key={doc.id} className={clsx('rounded-card border p-4 transition-all', issue ? 'border-warning bg-warning/5 shadow-xs' : 'border-border bg-surface')}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-text flex items-center gap-2">
                <FileCheck size={16} className="text-brand shrink-0" />
                {doc.doc_type}
              </span>
              {issue ? (
                <StatusPill tone="warning" dot={false}>Fix requested</StatusPill>
              ) : (
                <span className="text-[11px] font-semibold text-success flex items-center gap-1">
                  <CheckCircle2 size={13} /> Active on file
                </span>
              )}
            </div>
            {issue && (
              <p className="mt-2 text-xs text-warning bg-warning/10 p-2 rounded-control font-medium flex items-start gap-1.5">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{issue}</span>
              </p>
            )}
            <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs">
              <span className="text-muted">PDF or JPEG (max 10MB)</span>
              <FileButton variant="secondary" icon={<Upload size={14} />} accept=".pdf,.jpg,.jpeg,.png" disabled={uploadingType === doc.doc_type} onFile={replace(doc)}>
                {uploadingType === doc.doc_type ? 'Uploading…' : 'Replace this document'}
              </FileButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FixApplication({ applicationId, pan, mode, onDone }: { applicationId: string; pan: string; mode: 'full' | 'documents'; onDone: () => void }) {
  const [full, setFull] = useState<TplApplicationFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    return tplAPI.getPartner(applicationId, pan)
      .then(data => setFull(data as TplApplicationFull))
      .catch(err => setError(errorMessage(err, 'We could not load your application. Check the PAN and try again.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = async () => {
    await load()
    onDone()
  }

  if (loading) return <p className="text-center text-sm text-muted py-6">Loading your application details…</p>
  if (error || !full) return <Alert tone="danger">{error ?? 'Application not found'}</Alert>

  return (
    <div className="space-y-6">
      {mode === 'full' && <FixDetails applicationId={applicationId} pan={pan} full={full} onSaved={refresh} />}
      <div className={mode === 'full' ? 'border-t border-border pt-6' : ''}>
        {mode === 'full' && (
          <div className="flex items-center gap-2 mb-3">
            <Upload size={16} className="text-brand" />
            <h3 className="text-sm font-bold text-text uppercase tracking-wider">Uploaded Documents</h3>
          </div>
        )}
        <FixDocumentsList applicationId={applicationId} pan={pan} full={full} onReplaced={refresh} />
      </div>
    </div>
  )
}

export default function TplTrackApplicationPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [trackingId, setTrackingId] = useState(searchParams.get('id') ?? '')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [editPan, setEditPan] = useState('')
  const [fixingDocs, setFixingDocs] = useState(false)
  const [loading, setLoading] = useState(false)
  const [application, setApplication] = useState<TplApplication | null>(null)

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = trackingId.trim()
    if (!cleaned) {
      setLookupError('Enter your 3PL tracking ID.')
      return
    }
    setLookupError(null)
    setLoading(true)
    try {
      const data = await tplAPI.getPartner(cleaned)
      setApplication(data as TplApplication)
    } catch (err) {
      console.error(err)
      setLookupError((err as { response?: { status?: number } })?.response?.status === 404
        ? 'We could not find an application with that ID. Check it for typos. It is the 3PL ID you chose when you applied.'
        : errorMessage(err, 'We could not look up your application. Check your connection and try again.'))
      setApplication(null)
    } finally {
      setLoading(false)
    }
  }

  const refreshAfterFix = async () => {
    if (!application) return
    try {
      const data = await tplAPI.getPartner(application.id)
      setApplication(data as TplApplication)
    } catch { /* keep current state */ }
  }

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-control text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold tracking-tight">
              Margix<span className="text-brand">India</span>
            </span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <Link to="/3pl/onboard" className="text-muted hover:text-text">
              New 3PL Application
            </Link>
            <Link to="/login" className="px-3 py-1.5 rounded-control border border-border bg-surface hover:bg-surface-subtle text-text">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 sm:py-12">
        <div className={clsx('w-full space-y-6 transition-all duration-300', fixingDocs ? 'max-w-3xl' : 'max-w-lg')}>
          <div className="flex items-center justify-between">
            <Link to="/3pl/onboard" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text font-semibold transition-colors">
              <ArrowLeft size={14} /> Back to partner registration
            </Link>
            <span className="text-xs font-mono text-muted">Carrier Status Portal</span>
          </div>

          <Card padded className="shadow-raised border border-border">
            <div className="mb-6 flex items-start gap-4 border-b border-border pb-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-brand-soft text-brand">
                <Search size={22} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-text tracking-tight">Check 3PL Partner Application</h1>
                <p className="text-xs sm:text-sm text-muted mt-0.5">
                  Track verification status, address flagged compliance documents, or update bank details.
                </p>
              </div>
            </div>

            {!application ? (
              <form noValidate onSubmit={handleTrack} className="space-y-4">
                {lookupError && <Alert tone="danger">{lookupError}</Alert>}
                <Input
                  label="Your 3PL Partner ID"
                  required
                  value={trackingId}
                  onChange={e => setTrackingId(e.target.value)}
                  placeholder="e.g. acme_3pl or tracking UUID"
                  hint="The unique partner ID chosen during your registration."
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  inputClassName="font-mono text-base"
                />
                <Button type="submit" size="lg" fullWidth loading={loading} className="font-bold justify-center">
                  Check application status <ArrowRight size={15} className="ml-1" />
                </Button>
                <div className="pt-2 text-center">
                  <p className="text-xs text-muted">
                    Need help finding your application? <a href="mailto:support@margixindia.com" className="text-brand font-semibold hover:underline">Contact carrier support</a>
                  </p>
                </div>
              </form>
            ) : (
              <div className="space-y-6">
                {/* Application Overview Badge */}
                <div className="rounded-card border border-border bg-surface-subtle p-5 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Registered Carrier</span>
                      <h3 className="text-base sm:text-lg font-bold text-text">{application.company_name}</h3>
                      <p className="mt-0.5 font-mono text-xs text-muted">ID: {application.id}</p>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-3 border-t border-border text-xs">
                    <div>
                      <dt className="text-muted font-medium">Corridors Requested</dt>
                      <dd className="mt-0.5 text-text font-bold text-sm">{application.corridor_count ?? 0} routes</dd>
                    </div>
                    <div>
                      <dt className="text-muted font-medium">Documents on File</dt>
                      <dd className="mt-0.5 text-text font-bold text-sm">{application.document_count ?? 0} files</dd>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <dt className="text-muted font-medium">Application Date</dt>
                      <dd className="mt-0.5 text-text font-mono text-xs">{formatDateTime(application.created_at)}</dd>
                    </div>
                  </dl>
                </div>

                {application.status === 'pending' ? (
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-control bg-blue-500/10 border border-blue-500/20 text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                      Your application is actively under review by Margix compliance. You will receive an email once approved. You can fix or replace documents below.
                    </div>

                    {application.document_issues && Object.keys(application.document_issues).length > 0 && (
                      <Alert tone="warning" title="Action Needed: Fix Flagged Documents">
                        <ul className="list-disc space-y-1 pl-4 mt-1">
                          {Object.entries(application.document_issues).map(([type, reason]) => (
                            <li key={type}><strong className="font-semibold">{type}</strong>: {reason}</li>
                          ))}
                        </ul>
                      </Alert>
                    )}

                    {fixingDocs ? (
                      <FixApplication applicationId={application.id} pan={editPan.trim()} mode="documents" onDone={refreshAfterFix} />
                    ) : (
                      <div className="p-4 rounded-card border border-border bg-surface space-y-3">
                        <h4 className="text-xs font-bold text-text uppercase tracking-wider">Authorize Document Updates</h4>
                        <Input
                          label="Enter Company PAN to Edit"
                          hint="Verification requires the PAN submitted with the application."
                          value={editPan}
                          onChange={e => setEditPan(e.target.value.toUpperCase())}
                          placeholder="ABCDE1234F"
                          maxLength={10}
                          inputClassName="font-mono uppercase text-base"
                        />
                        <Button
                          variant="secondary"
                          fullWidth
                          size="lg"
                          disabled={!editPan.trim()}
                          onClick={() => setFixingDocs(true)}
                          className="font-bold justify-center"
                        >
                          {application.document_issues && Object.keys(application.document_issues).length > 0 ? 'Fix flagged documents' : 'Replace an uploaded document'}
                        </Button>
                      </div>
                    )}
                    <Button variant="ghost" fullWidth onClick={() => setApplication(null)}>
                      ← Check another application ID
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-5 text-center">
                    {application.status === 'rejected' ? (
                      <div className="space-y-4 text-left">
                        <Alert tone="danger" title="Application Not Approved">
                          {application.rejection_reason || 'Compliance criteria were not met. You can fix details and resubmit.'}
                        </Alert>

                        {application.document_issues && Object.keys(application.document_issues).length > 0 && (
                          <Alert tone="warning" title="Flagged Document Issues">
                            <ul className="list-disc space-y-1 pl-4 mt-1">
                              {Object.entries(application.document_issues).map(([type, reason]) => (
                                <li key={type}><strong className="font-semibold">{type}</strong>: {reason}</li>
                              ))}
                            </ul>
                          </Alert>
                        )}

                        {fixingDocs ? (
                          <FixApplication applicationId={application.id} pan={editPan.trim()} mode="full" onDone={refreshAfterFix} />
                        ) : (
                          <div className="p-4 rounded-card border border-border bg-surface space-y-3">
                            <h4 className="text-xs font-bold text-text uppercase tracking-wider">Resubmit with Corrections</h4>
                            <Input
                              label="Company PAN"
                              hint="Enter your PAN to unlock full editing and resubmit."
                              value={editPan}
                              onChange={e => setEditPan(e.target.value.toUpperCase())}
                              placeholder="ABCDE1234F"
                              maxLength={10}
                              inputClassName="font-mono uppercase text-base"
                            />
                            <Button fullWidth size="lg" disabled={!editPan.trim()} onClick={() => setFixingDocs(true)} className="font-bold justify-center">
                              Fix application details &amp; resubmit
                            </Button>
                          </div>
                        )}
                        <div className="text-center pt-2">
                          <Link to="/3pl/onboard" className="text-xs font-semibold text-brand hover:underline">
                            Or start a brand new partner application
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4 py-4">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                          <CheckCircle2 size={32} />
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-lg font-bold text-text">Partner Application Approved!</h3>
                          <p className="text-xs text-muted max-w-sm mx-auto">
                            Your carrier credentials are confirmed. Set up your password now to access your 3PL partner dispatch dashboard.
                          </p>
                        </div>
                        <Button size="lg" onClick={() => navigate('/3pl/onboard/setup')} className="font-bold">
                          Set up partner login credentials <ArrowRight size={15} className="ml-1" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  )
}
