import { errorMessage, formatDateTime } from '@/utils/display'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, CheckCircle2 } from 'lucide-react'
import { tplAPI } from '@/services/api'
import { Alert, Button, buttonClasses, Card, Input, StatusPill } from '@/components/ui'

interface TplApplication {
  id: string
  company_name: string
  status: string
  corridor_count?: number
  document_count?: number
  created_at?: string
  rejection_reason?: string | null
}

export default function TplTrackApplicationPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [trackingId, setTrackingId] = useState(searchParams.get('id') ?? '')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [editPan, setEditPan] = useState('')
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
                    onClick={() => navigate(`/3pl/onboard?edit=${application.id}&pan=${encodeURIComponent(editPan.trim())}`)}
                  >
                    Edit application details
                  </Button>
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
                      <Link to="/3pl/onboard" className={buttonClasses({ variant: 'primary' })}>Apply again</Link>
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
