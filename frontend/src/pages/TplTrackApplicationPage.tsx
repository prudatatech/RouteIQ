import { errorMessage, formatDateTime } from '@/utils/display'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, CheckCircle2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { tplAPI } from '@/services/api'
import { uploadTplDocument } from '@/services/tplDocuments'
import { Alert, Button, Card, FileButton, Input, StatusPill } from '@/components/ui'

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
interface TplApplicationFull extends TplApplication { tpl_documents?: TplDocument[] }

/**
 * Lets the applicant replace a flagged (or any, once resubmitting a rejected application) document
 * without going through the full onboarding form again. Loaded only once the PAN is verified.
 */
function FixDocuments({ applicationId, pan, onDone }: { applicationId: string; pan: string; onDone: () => void }) {
  const [full, setFull] = useState<TplApplicationFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadingType, setUploadingType] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    tplAPI.getPartner(applicationId, pan)
      .then(data => { if (!cancelled) setFull(data as TplApplicationFull) })
      .catch(err => { if (!cancelled) setError(errorMessage(err, 'We could not load your application. Check the PAN and try again.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const replace = (doc: TplDocument) => async (file: File) => {
    setUploadingType(doc.doc_type)
    try {
      const path = await uploadTplDocument(file, doc.doc_type, { applicationId, verifyPan: pan })
      const documents = (full?.tpl_documents ?? []).map(d => (d.id === doc.id ? { type: d.doc_type, url: path } : { type: d.doc_type, url: d.file_url }))
      await tplAPI.updateApplication(applicationId, { verify_pan: pan, documents })
      toast.success(full?.status === 'rejected' ? 'Document replaced. Your application is back under review.' : 'Document replaced')
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, 'We could not save this document. Try again.'))
    } finally {
      setUploadingType(null)
    }
  }

  if (loading) return <p className="text-center text-sm text-muted">Loading your application…</p>
  if (error || !full) return <Alert tone="danger">{error ?? 'Application not found'}</Alert>

  return (
    <div className="space-y-3">
      {(full.tpl_documents ?? []).map(doc => {
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
                    <FixDocuments applicationId={application.id} pan={editPan.trim()} onDone={refreshAfterFix} />
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
                          <FixDocuments applicationId={application.id} pan={editPan.trim()} onDone={refreshAfterFix} />
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
                            Fix a document and resubmit
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
