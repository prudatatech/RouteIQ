import { errorMessage, formatDateTime } from '@/utils/display'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, CheckCircle2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { tplAPI } from '@/services/api'
import { uploadTplDocument } from '@/services/tplDocuments'
import { Alert, Button, Card, FileButton, Input, Select, StatusPill } from '@/components/ui'
import { OperationalTermsFields } from '@/components/tpl/OperationalTermsFields'
import { ENTITY_TYPE_OPTIONS, entityTypeRequiresCin, isCinFormat } from '@/utils/entityType'

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
  authorized_signatory_name?: string | null
  bank_account_no?: string | null
  bank_ifsc?: string | null
  sla_commitment?: string | null
  tax_treatment?: string | null
}

/**
 * Edits the company, tax, bank and operational details of a pending or rejected application —
 * the same fields `updateApplication` already accepts, just given a form. Saving resubmits a
 * rejected application (the backend flips it back to pending and clears the rejection reason).
 * Optional fields (GSTIN, bank account, IFSC) are only sent when filled in, so leaving one blank
 * never wipes out a value the applicant already has on file.
 */
function FixDetails({ applicationId, pan, full, onSaved }: { applicationId: string; pan: string; full: TplApplicationFull; onSaved: () => void }) {
  const [companyName, setCompanyName] = useState(full.company_name || '')
  const [contactName, setContactName] = useState(full.contact_name || '')
  const [panNumber, setPanNumber] = useState(full.pan_number || '')
  const [gst, setGst] = useState(full.gstin || '')
  const [entityType, setEntityType] = useState(full.entity_type || '')
  const [cin, setCin] = useState(full.cin || '')
  const [authorizedSignatoryName, setAuthorizedSignatoryName] = useState(full.authorized_signatory_name || '')
  const [bankAccount, setBankAccount] = useState(full.bank_account_no || '')
  const [bankIfsc, setBankIfsc] = useState(full.bank_ifsc || '')
  const [slaCommitment, setSlaCommitment] = useState(full.sla_commitment || '2 Hours')
  const [taxTreatment, setTaxTreatment] = useState(full.tax_treatment || '12% GTA (With ITC) - Forward Charge')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!companyName.trim() || !contactName.trim()) {
      toast.error('Company name and contact person are required.')
      return
    }
    if (!entityType.trim()) {
      toast.error('Choose the entity type.')
      return
    }
    if (!authorizedSignatoryName.trim()) {
      toast.error('Enter the authorized signatory name.')
      return
    }
    if (entityTypeRequiresCin(entityType) && !cin.trim()) {
      toast.error('CIN is required for this entity type.')
      return
    }
    if (cin.trim() && !isCinFormat(cin)) {
      toast.error('CIN looks incorrect (21 letters and digits, e.g. U74999DL2019PTC123456).')
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Company name" required value={companyName} onChange={e => setCompanyName(e.target.value)} />
        <Input label="Contact person" required value={contactName} onChange={e => setContactName(e.target.value)} />
        <Input label="PAN" value={panNumber} onChange={e => setPanNumber(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} className="font-mono" />
        <Input label="GSTIN" value={gst} onChange={e => setGst(e.target.value.toUpperCase())} placeholder="07ABCDE1234F1Z5" maxLength={15} className="font-mono" />
        <Select label="Entity type" required value={entityType} onChange={e => setEntityType(e.target.value)} options={ENTITY_TYPE_OPTIONS} placeholder="Choose the entity type" />
        {entityTypeRequiresCin(entityType) && (
          <Input label="CIN" required value={cin} onChange={e => setCin(e.target.value.toUpperCase())} placeholder="U74999DL2019PTC123456" maxLength={21} className="font-mono" />
        )}
        <Input label="Authorized signatory name" required value={authorizedSignatoryName} onChange={e => setAuthorizedSignatoryName(e.target.value)} />
        <Input label="Bank account number" value={bankAccount} onChange={e => setBankAccount(e.target.value)} className="font-mono" />
        <Input label="Bank IFSC" value={bankIfsc} onChange={e => setBankIfsc(e.target.value.toUpperCase())} placeholder="HDFC0001234" maxLength={11} className="font-mono" />
      </div>
      <OperationalTermsFields
        slaCommitment={slaCommitment}
        taxTreatment={taxTreatment}
        onSlaChange={setSlaCommitment}
        onTaxChange={setTaxTreatment}
      />
      <Button fullWidth loading={saving} onClick={save}>Save details</Button>
    </div>
  )
}

/**
 * Lets the applicant replace a flagged (or any, once resubmitting a rejected application) document
 * without going through the full onboarding form again.
 */
function FixDocumentsList({ applicationId, pan, full, onReplaced }: { applicationId: string; pan: string; full: TplApplicationFull; onReplaced: () => void }) {
  const [uploadingType, setUploadingType] = useState<string | null>(null)

  const replace = (doc: TplDocument) => async (file: File) => {
    setUploadingType(doc.doc_type)
    try {
      const path = await uploadTplDocument(file, doc.doc_type, { applicationId, verifyPan: pan })
      const documents = (full.tpl_documents ?? []).map(d => (d.id === doc.id ? { type: d.doc_type, url: path } : { type: d.doc_type, url: d.file_url }))
      await tplAPI.updateApplication(applicationId, { verify_pan: pan, documents })
      toast.success(full.status === 'rejected' ? 'Document replaced. Your application is back under review.' : 'Document replaced')
      onReplaced()
    } catch (err) {
      toast.error(errorMessage(err, 'We could not save this document. Try again.'))
    } finally {
      setUploadingType(null)
    }
  }

  if (!full.tpl_documents || full.tpl_documents.length === 0) {
    return <p className="text-sm text-muted">No documents uploaded yet.</p>
  }

  return (
    <div className="space-y-3">
      {full.tpl_documents.map(doc => {
        const issue = full.document_issues?.[doc.doc_type]
        return (
          <div key={doc.id} className={`rounded-control border p-3 ${issue ? 'border-warning bg-warning/5' : 'border-border'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-text">{doc.doc_type}</span>
              {issue && <StatusPill tone="warning" dot={false}>Fix requested</StatusPill>}
            </div>
            {issue && <p className="mt-1 text-xs text-warning">{issue}</p>}
            <div className="mt-2">
              <FileButton variant="link" icon={<Upload size={14} />} accept=".pdf,.jpg,.jpeg,.png" disabled={uploadingType === doc.doc_type} onFile={replace(doc)}>
                {uploadingType === doc.doc_type ? 'Uploading…' : 'Replace this document'}
              </FileButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Loads the full application once the PAN is verified, then shows one or both ways to fix it:
 * the company/tax/bank detail form ('full' mode, offered to a rejected application — it may
 * have been rejected for a non-document reason) and the per-document replace list (always).
 * Either can be saved on its own; both resubmit a rejected application.
 */
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

  if (loading) return <p className="text-center text-sm text-muted">Loading your application…</p>
  if (error || !full) return <Alert tone="danger">{error ?? 'Application not found'}</Alert>

  return (
    <div className="space-y-6">
      {mode === 'full' && <FixDetails applicationId={applicationId} pan={pan} full={full} onSaved={refresh} />}
      <div className={mode === 'full' ? 'border-t border-border pt-4' : ''}>
        {mode === 'full' && <p className="mb-3 text-xs font-medium text-muted">Documents</p>}
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
      setLookupError('Enter your tracking ID.')
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
    } catch { /* keep showing the current state */ }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md space-y-6">
        <Link to="/3pl/onboard" className="inline-block text-sm text-muted hover:text-text">
          ← Back to the application form
        </Link>

        <Card padded>
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-control bg-brand-soft text-brand">
              <Search size={22} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-text">Check your application</h1>
              <p className="text-sm text-muted">See where your 3PL application is, or edit it while it is under review.</p>
            </div>
          </div>

          {!application ? (
            <form noValidate onSubmit={handleTrack} className="space-y-4">
              {lookupError && <Alert tone="danger">{lookupError}</Alert>}
              <Input
                label="Your 3PL ID"
                required
                value={trackingId}
                onChange={e => setTrackingId(e.target.value)}
                placeholder="e.g. acme_3pl"
                hint="The ID you chose on the application form."
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              <Button type="submit" fullWidth loading={loading}>Check application</Button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="rounded-control border border-border bg-surface-subtle p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium text-text">{application.company_name}</h3>
                    <p className="mt-0.5 font-mono text-xs text-muted">{application.id}</p>
                  </div>
                  <StatusPill status={application.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Corridors requested</dt>
                    <dd className="mt-0.5 text-text">{application.corridor_count ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Documents provided</dt>
                    <dd className="mt-0.5 text-text">{application.document_count ?? 0}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-muted">Submitted on</dt>
                    <dd className="mt-0.5 text-text">{formatDateTime(application.created_at)}</dd>
                  </div>
                </dl>
              </div>

              {application.status === 'pending' ? (
                <div className="space-y-4">
                  <p className="text-center text-sm text-muted">
                    Your application is under review. We will email you when there is a decision. Until then you can change your details or upload missing documents.
                  </p>
                  {application.document_issues && Object.keys(application.document_issues).length > 0 && (
                    <Alert tone="warning" title="Fix these documents">
                      <ul className="list-disc space-y-0.5 pl-4">
                        {Object.entries(application.document_issues).map(([type, reason]) => (
                          <li key={type}><span className="font-medium">{type}</span>: {reason}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                  {fixingDocs ? (
                    <FixApplication applicationId={application.id} pan={editPan.trim()} mode="documents" onDone={refreshAfterFix} />
                  ) : (
                    <>
                      <Input
                        label="Company PAN"
                        hint="Enter the PAN from your application to edit it."
                        value={editPan}
                        onChange={e => setEditPan(e.target.value.toUpperCase())}
                        placeholder="ABCDE1234F"
                        maxLength={10}
                        className="font-mono"
                      />
                      <Button
                        variant="secondary"
                        fullWidth
                        disabled={!editPan.trim()}
                        onClick={() => setFixingDocs(true)}
                      >
                        {application.document_issues && Object.keys(application.document_issues).length > 0 ? 'Fix flagged documents' : 'Replace a document'}
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" fullWidth onClick={() => setApplication(null)}>Check another application</Button>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  {application.status === 'rejected' ? (
                    <>
                      <p className="text-sm text-text">This application was not approved.</p>
                      {application.rejection_reason && (
                        <p className="text-sm text-muted">Reason: {application.rejection_reason}</p>
                      )}
                      {fixingDocs ? (
                        <div className="text-left">
                          <FixApplication applicationId={application.id} pan={editPan.trim()} mode="full" onDone={refreshAfterFix} />
                        </div>
                      ) : (
                        <>
                          <Input
                            label="Company PAN"
                            hint="Enter the PAN from your application to fix it and resubmit."
                            value={editPan}
                            onChange={e => setEditPan(e.target.value.toUpperCase())}
                            placeholder="ABCDE1234F"
                            maxLength={10}
                            className="font-mono"
                          />
                          <Button fullWidth disabled={!editPan.trim()} onClick={() => setFixingDocs(true)}>
                            Fix your details and resubmit
                          </Button>
                        </>
                      )}
                      <Link to="/3pl/onboard" className="block text-sm text-muted hover:text-text">Or start a brand new application</Link>
                    </>
                  ) : (
                    <>
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
                        <CheckCircle2 size={24} />
                      </div>
                      <p className="text-sm text-text">Your application was approved. You can no longer edit it. Set up your partner login to open your dashboard.</p>
                      <Button onClick={() => navigate('/3pl/onboard/setup')}>Set up your partner login</Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
