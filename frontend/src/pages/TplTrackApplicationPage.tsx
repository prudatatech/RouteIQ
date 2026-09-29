import { errorMessage } from '@/utils/display'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CheckCircle2 } from 'lucide-react'
import { tplAPI } from '@/services/api'
import { Button, Card, Input, StatusPill } from '@/components/ui'
import toast from 'react-hot-toast'

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
  const [trackingId, setTrackingId] = useState('')
  const [editPan, setEditPan] = useState('')
  const [loading, setLoading] = useState(false)
  const [application, setApplication] = useState<TplApplication | null>(null)

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = trackingId.trim()
    if (!cleaned) {
      toast.error('Enter your tracking ID.')
      return
    }
    setLoading(true)
    try {
      const data = await tplAPI.getPartner(cleaned)
      setApplication(data as TplApplication)
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Application not found. Check your tracking ID.'))
      setApplication(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md space-y-6">
        <button onClick={() => navigate('/3pl/onboard')} className="text-sm text-muted hover:text-text">
          ← Back to onboarding
        </button>

        <Card padded>
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-control bg-brand-soft text-brand">
              <Search size={22} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-text">Track application</h1>
              <p className="text-sm text-muted">Check status or edit your pending 3PL application.</p>
            </div>
          </div>

          {!application ? (
            <form onSubmit={handleTrack} className="space-y-4">
              <Input
                label="Application tracking ID / 3PL ID"
                required
                value={trackingId}
                onChange={e => setTrackingId(e.target.value)}
                placeholder="e.g. acme_3pl"
                className="font-mono"
              />
              <Button type="submit" fullWidth loading={loading}>Track application</Button>
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
                    <dd className="mt-0.5 text-text">{application.created_at ? new Date(application.created_at).toLocaleString('en-IN') : '—'}</dd>
                  </div>
                </dl>
              </div>

              {application.status === 'pending' ? (
                <div className="space-y-4">
                  <p className="text-center text-sm text-muted">
                    Your application is under review. You can still change your operational profile or upload missing documents.
                  </p>
                  <Input
                    label="Company PAN (to edit)"
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
                  <Button variant="ghost" fullWidth onClick={() => setApplication(null)}>Track another</Button>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  {application.status === 'rejected' ? (
                    <>
                      <p className="text-sm text-text">This application was rejected.</p>
                      {application.rejection_reason && (
                        <p className="text-sm text-muted">Reason: {application.rejection_reason}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
                        <CheckCircle2 size={24} />
                      </div>
                      <p className="text-sm text-text">This application has been processed. You can no longer make edits — check your email for access instructions.</p>
                    </>
                  )}
                  <Button onClick={() => navigate('/3pl/onboard/setup')}>Go to login</Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
