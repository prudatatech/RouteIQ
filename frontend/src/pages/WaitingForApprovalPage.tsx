import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock, LogOut, XCircle } from 'lucide-react'
import { orgAPI } from '@/services/api'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { selectActiveMembership, useOrgStore } from '@/store/orgStore'
import { Button, buttonClasses, Card, LoadingState, StatusPill } from '@/components/ui'
import { OrgSwitcher } from '@/components/ui/OrgSwitcher'
import { gateFor, waitingCopy } from '@/utils/orgAccess'
import { decisionReason, ORG_STATUS_LABELS } from '@/utils/platformOrgs'
import type { OrgStatus } from '@/utils/orgs'

/**
 * What a company sees while its organisation is pending, rejected or suspended: no menu, only what
 * happens next. Leaves for the app as soon as the organisation is active.
 */
export default function WaitingForApprovalPage() {
  const navigate = useNavigate()
  const loaded = useOrgStore(s => s.loaded)
  const memberships = useOrgStore(s => s.memberships)
  const active = useOrgStore(selectActiveMembership)
  const clearAuth = useAuthStore(s => s.clearAuth)
  // The reason lives in the organisation's profile; a pending logistic company's KYC progress does too.
  const profile = useQuery({
    queryKey: ['org', active?.org.id], queryFn: () => orgAPI.get(), enabled: !!active, retry: false,
  })

  const signOut = async () => {
    try { await supabase.auth.signOut() } catch (err) { console.error('Sign-out failed', err) }
    clearAuth()
    navigate('/login')
  }

  if (!loaded) return <div className="flex min-h-screen items-center justify-center bg-bg"><LoadingState label="Loading" /></div>
  // Nothing to wait for: register a company first
  if (!active) return <Navigate to="/register-company" replace />
  if (gateFor(true, active) === 'open') return <Navigate to="/today" replace />

  const status = active.org.status as OrgStatus
  const reason = decisionReason({ status, profile: profile.data?.profile })
  const copy = waitingCopy(status, reason)
  const Icon = status === 'pending' ? Clock : XCircle
  const isCompany = active.org.kind === 'logistic_company'
  const submitted = !!profile.data?.kyc_submitted_at
  const issueCount = Object.keys(profile.data?.kyc_document_issues ?? {}).length

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="mx-auto flex w-full max-w-content items-center gap-3 px-4 py-4 sm:px-6">
        <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
        <span className="flex-1 text-lg font-semibold">MargixIndia</span>
        {memberships.length > 1 && <OrgSwitcher className="w-56" />}
        <Button variant="ghost" size="sm" icon={<LogOut size={16} />} onClick={signOut}>Sign out</Button>
      </header>
      <main className="mx-auto w-full max-w-form flex-1 px-4 pb-12 pt-6 sm:px-6">
        <Card padded>
          <div className="flex items-start gap-4">
            <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"><Icon size={20} aria-hidden="true" /></span>
            <div className="min-w-0 space-y-3">
              <div>
                <h1 className="text-2xl font-semibold">{copy.title}</h1>
                <p className="mt-1 text-sm text-muted">
                  <span className="font-medium text-text">{active.org.name}</span>{' '}
                  <StatusPill status={status} tone={status === 'pending' ? 'warning' : 'danger'}>{ORG_STATUS_LABELS[status]}</StatusPill>
                </p>
              </div>
              <p className="text-sm sm:text-base">{copy.body}</p>
              {copy.reason && (
                <p className="rounded-control border border-border bg-surface-subtle px-3 py-2 text-sm">
                  <span className="font-medium">Reason:</span> {copy.reason}
                </p>
              )}
              {status === 'pending' && isCompany && !submitted && (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                    <li>Submit your GSTIN, PAN, bank details and documents.</li>
                    <li>We check them and notify you once your company is approved.</li>
                    <li>Then this page opens your company dashboard.</li>
                  </ol>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link to="/company/kyc" className={buttonClasses({ variant: 'primary' })}>
                      {issueCount > 0 ? `Fix ${issueCount} flagged document${issueCount > 1 ? 's' : ''}` : 'Complete your company KYC'}
                    </Link>
                  </div>
                </>
              )}
              {status === 'pending' && isCompany && submitted && (
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                  <li>Your documents are with the MargixIndia team.</li>
                  <li>You get a notification once your company is approved.</li>
                  <li>Then this page opens your company dashboard.</li>
                </ol>
              )}
              {status === 'pending' && !isCompany && (
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                  <li>We check your GSTIN, PAN and company details.</li>
                  <li>You get a notification when your company is approved.</li>
                  <li>Then this page opens your company dashboard.</li>
                </ol>
              )}
              {status === 'rejected' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {isCompany
                    ? <Link to="/company/kyc" className={buttonClasses({ variant: 'primary' })}>Fix your details and resubmit</Link>
                    : <Link to="/register-company" className={buttonClasses({ variant: 'primary' })}>Register again with corrected details</Link>}
                </div>
              )}
              {status !== 'pending' && <p className="text-sm text-muted">Need to talk to someone? Contact MargixIndia support and mention the company name above.</p>}
            </div>
          </div>
        </Card>
      </main>
    </div>
  )
}
