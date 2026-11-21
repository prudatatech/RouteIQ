import { useEffect, useMemo, useRef } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { AlertCircle, Clock, Lock, LogOut } from 'lucide-react'
import { Alert, Button, Card, CardHeader, EmptyState, ErrorState, IconButton, PageHeader, Spinner, StatusPill } from '@/components/ui'
import { NotificationsBell } from '@/components/ui/NotificationsBell'
import { supabase } from '@/services/supabase'
import { tplAPI, tplNetworkAPI } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { legacyTabPage, portalAccess } from '@/components/tpl/portal/access'
import { PortalContext, type PortalContextValue, type PortalPartner } from '@/components/tpl/portal/portalContext'
import OrdersPage from '@/components/tpl/portal/OrdersPage'
import FleetPage from '@/components/tpl/portal/FleetPage'
import DriversPage from '@/components/tpl/portal/DriversPage'
import StatementsPage from '@/components/tpl/portal/StatementsPage'
import EarningsPage from '@/components/tpl/portal/EarningsPage'
import LanesPage from '@/components/tpl/portal/LanesPage'
import DocumentsPage from '@/components/tpl/portal/DocumentsPage'
import SettingsPage from '@/components/tpl/portal/SettingsPage'

function CenteredState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-bg p-6"><div className="w-full max-w-md">{children}</div></div>
}

function ApplicationOverview({ partner, base }: { partner: PortalPartner; base: string }) {
  const docIssueCount = partner.document_issues ? Object.keys(partner.document_issues).length : 0
  const fieldIssueCount = partner.field_issues ? Object.keys(partner.field_issues).length : 0
  const hasIssues = docIssueCount > 0 || fieldIssueCount > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Application Status"
        description="Track the verification and review of your 3PL carrier application."
        actions={<StatusPill status={partner.status} />}
      />

      {hasIssues ? (
        <Card padded className="border-warning/40 bg-warning/5">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-warning/20 text-warning">
              <AlertCircle size={20} />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-text">Action Required: Compliance Review Updates</h2>
              <p className="mt-1 text-sm text-muted">
                Our compliance team reviewed your application and requested revisions. Please update the flagged items below so your account can be approved.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {docIssueCount > 0 && (
                  <div className="rounded-control border border-border bg-surface p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-text">Documents</span>
                        <StatusPill tone="warning" dot={false}>{docIssueCount} flagged</StatusPill>
                      </div>
                      <p className="mt-1.5 text-xs text-muted">
                        Flagged: {Object.keys(partner.document_issues!).join(', ')}
                      </p>
                    </div>
                    <div className="mt-4">
                      <NavLink
                        to={`${base}/documents?highlight=flagged`}
                        className="inline-flex items-center justify-center w-full rounded-control bg-brand text-brand-fill px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity"
                      >
                        Re-upload Documents
                      </NavLink>
                    </div>
                  </div>
                )}

                {fieldIssueCount > 0 && (
                  <div className="rounded-control border border-border bg-surface p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-text">Company &amp; Bank Details</span>
                        <StatusPill tone="warning" dot={false}>{fieldIssueCount} flagged</StatusPill>
                      </div>
                      <p className="mt-1.5 text-xs text-muted">
                        Flagged: {Object.keys(partner.field_issues!).map(k => k.replace(/_/g, ' ')).join(', ')}
                      </p>
                    </div>
                    <div className="mt-4">
                      <NavLink
                        to={`${base}/settings?highlight=flagged`}
                        className="inline-flex items-center justify-center w-full rounded-control bg-brand text-brand-fill px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity"
                      >
                        Edit Details
                      </NavLink>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card padded className="border-border">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
              <Clock size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text">
                {partner.status === 'rejected' ? 'Application Not Approved' : 'Application Under Review'}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {partner.status === 'rejected'
                  ? 'Your application could not be approved at this time. You can review your details and documents.'
                  : 'Your application has been received and is currently being verified by our compliance team. Once approved, you will be able to accept load offers, manage your fleet, and track payouts.'}
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card padded>
        <CardHeader title="Application Summary" />
        <div className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-muted block">Company</span>
            <span className="font-semibold text-text text-sm">{partner.company_name}</span>
          </div>
          <div>
            <span className="text-muted block">3PL ID</span>
            <span className="font-mono font-semibold text-text text-sm">{partner.custom_id || '—'}</span>
          </div>
          <div>
            <span className="text-muted block">Company PAN</span>
            <span className="font-mono font-semibold text-text text-sm">{partner.pan_number || '—'}</span>
          </div>
          <div>
            <span className="text-muted block">Documents on File</span>
            <span className="font-semibold text-text text-sm">{partner.tpl_documents?.length ?? 0} uploaded</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

/**
 * The 3PL partner portal at /3pl-portal/:id.
 */
export default function TplDashboardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = useAuthStore(s => s.userId)

  const signOut = async () => {
    try { await supabase.auth.signOut() } catch (err) { console.error('Sign-out failed', err) }
    useAuthStore.getState().clearAuth()
    navigate('/login', { replace: true })
  }

  // Whose portal this account has: checked before anything of the address's partner is loaded
  const own = useQuery({
    queryKey: ['tpl-own-partner', userId],
    queryFn: () => tplAPI.byUser(userId!) as Promise<{ id: string; custom_id?: string } | null>,
    enabled: !!userId,
    retry: false,
  })
  const access = own.data !== undefined ? portalAccess(own.data, id) : null

  const partnerQuery = useQuery({
    queryKey: ['tpl-portal-partner', id],
    queryFn: () => tplAPI.getPartner(id!) as Promise<PortalPartner>,
    enabled: access === 'own',
  })
  useRealtimeRefresh('tpl_portal_partner', ['tpl_partners', 'tpl_corridors', 'tpl_documents'], [['tpl-portal-partner', id]])
  const offers = useQuery({ queryKey: ['tpl-my-offers'], queryFn: tplNetworkAPI.myOffers, enabled: access === 'own', retry: false })
  const openOffers = (offers.data?.items ?? []).filter(o => o.status === 'offered').length

  const partner = partnerQuery.data
  const hadPending = useRef(false)
  useEffect(() => {
    if (!partner) return
    if (hadPending.current && !partner.pending_updates && partner.status === 'active') toast.success('Your pending updates have been approved')
    hadPending.current = !!partner.pending_updates
  }, [partner])

  const base = `/3pl-portal/${id}`
  const legacy = legacyTabPage(new URLSearchParams(location.search).get('tab'))
  const atBase = location.pathname.replace(/\/$/, '') === base
  const legacyTarget = atBase && legacy !== null && legacy !== '' ? `${base}/${legacy}` : null
  const value = useMemo<PortalContextValue | null>(() => partner ? {
    partner,
    corridors: partner.tpl_corridors ?? [],
    documents: partner.tpl_documents ?? [],
    reload: () => { partnerQuery.refetch() },
  } : null, [partner, partnerQuery])

  if (!userId || own.isLoading || (access === 'own' && partnerQuery.isLoading)) {
    return <CenteredState><div className="flex justify-center"><Spinner size={32} /></div></CenteredState>
  }

  if (own.error) {
    return (
      <CenteredState>
        <ErrorState title="We could not open your portal" description="Check your connection and try again." onRetry={() => own.refetch()} />
        <div className="mt-4 flex justify-center"><Button variant="ghost" icon={<LogOut size={16} />} onClick={signOut}>Sign out</Button></div>
      </CenteredState>
    )
  }

  if (access === 'no-partner' || access === 'other') {
    return (
      <CenteredState>
        <EmptyState
          icon={<Lock size={22} />}
          title={access === 'other' ? 'This portal belongs to another partner' : 'This account is not a 3PL partner'}
          description={access === 'other'
            ? 'You can only open your own partner portal.'
            : 'Sign in with the account you set up when your 3PL application was approved.'}
          action={access === 'other' && own.data
            ? <Button onClick={() => navigate(`/3pl-portal/${own.data!.id}`, { replace: true })}>Open my portal</Button>
            : undefined}
        />
        <div className="mt-4 flex justify-center"><Button variant="ghost" icon={<LogOut size={16} />} onClick={signOut}>Sign out and use another account</Button></div>
      </CenteredState>
    )
  }

  if (partnerQuery.error || !partner || !value || partner.user_id !== userId) {
    return (
      <CenteredState>
        <ErrorState
          title="We could not open this portal"
          description="This partner profile could not be loaded, or you do not have access to it."
          onRetry={() => partnerQuery.refetch()}
        />
        <div className="mt-4 flex justify-center"><Button variant="ghost" icon={<LogOut size={16} />} onClick={signOut}>Sign out and use another account</Button></div>
      </CenteredState>
    )
  }

  if (legacyTarget) return <Navigate to={legacyTarget} replace />

  const isPendingOrRejected = partner.status === 'pending' || partner.status === 'rejected'
  const docIssueCount = partner.document_issues ? Object.keys(partner.document_issues).length : 0
  const fieldIssueCount = partner.field_issues ? Object.keys(partner.field_issues).length : 0

  const links = isPendingOrRejected ? [
    { to: '', label: 'Overview' },
    { to: 'documents', label: 'Documents', badge: docIssueCount },
    { to: 'settings', label: 'Company & Bank Details', badge: fieldIssueCount },
  ] : [
    { to: '', label: 'Orders' },
    { to: 'fleet', label: 'Fleet' },
    { to: 'drivers', label: 'Drivers' },
    { to: 'statements', label: 'Statements' },
    { to: 'earnings', label: 'Earnings' },
    { to: 'lanes', label: 'Lanes' },
    { to: 'documents', label: 'Documents', badge: docIssueCount },
    { to: 'settings', label: 'Settings', badge: fieldIssueCount },
  ]

  const currentPath = location.pathname.replace(/\/$/, '')
  const isOnDocuments = currentPath.endsWith('/documents')
  const isOnSettings = currentPath.endsWith('/settings')
  const isOnOverview = currentPath === base

  return (
    <PortalContext.Provider value={value}>
      <div className="min-h-screen bg-bg text-text">
        <header className="sticky top-0 z-40 border-b border-border bg-surface">
          <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <img src="/margix-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-none text-text">MargixIndia 3PL</p>
                <p className="mt-1 truncate text-xs leading-none text-muted">{partner.company_name}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusPill status={partner.status} className="hidden sm:inline-flex" />
              <NotificationsBell placement="right" />
              <IconButton label="Sign out" icon={<LogOut size={18} />} onClick={signOut} />
            </div>
          </div>
          <nav aria-label="Partner portal" className="mx-auto max-w-content overflow-x-auto px-4 sm:px-6">
            <ul className="flex min-w-max gap-0.5 sm:gap-1">
              {links.map(link => (
                <li key={link.label}>
                  <NavLink
                    to={link.to ? `${base}/${link.to}` : base}
                    end
                    className={({ isActive }) => clsx(
                      '-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-sm sm:gap-2 sm:px-3 font-medium transition-colors',
                      isActive ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text',
                    )}
                  >
                    {link.label}
                    {link.badge !== undefined && link.badge > 0 && (
                      <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-xs font-semibold tabular text-warning" aria-label={`${link.badge} flagged items`}>
                        {link.badge}
                      </span>
                    )}
                    {link.to === '' && !isPendingOrRejected && openOffers > 0 && (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs tabular text-brand" aria-label={`${openOffers} offers waiting`}>{openOffers}</span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main className="mx-auto max-w-content space-y-6 px-4 py-6 sm:px-6 lg:py-8">
          {/* Subtle cross-page notices for pending partner (only shown when not on the relevant page or overview) */}
          {isPendingOrRejected && fieldIssueCount > 0 && !isOnSettings && !isOnOverview && (
            <Alert
              tone="warning"
              title="Action required: Correct flagged details"
              action={
                <NavLink to={`${base}/settings?highlight=flagged`} className="inline-flex items-center justify-center rounded-control border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-subtle transition-colors">
                  Edit details
                </NavLink>
              }
            >
              Compliance also flagged company/bank details for revision: {Object.keys(partner.field_issues!).map(k => k.replace(/_/g, ' ')).join(', ')}.
            </Alert>
          )}

          {isPendingOrRejected && docIssueCount > 0 && !isOnDocuments && !isOnOverview && (
            <Alert
              tone="warning"
              title="Action required: Flagged document(s)"
              action={
                <NavLink to={`${base}/documents?highlight=flagged`} className="inline-flex items-center justify-center rounded-control border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-subtle transition-colors">
                  View documents
                </NavLink>
              }
            >
              Compliance also requested updates on {docIssueCount} document(s): {Object.keys(partner.document_issues!).join(', ')}.
            </Alert>
          )}

          {/* Active/paused partner notices */}
          {!isPendingOrRejected && partner.status !== 'active' && (
            <Alert tone="warning" title="Your account is paused">
              MargixIndia dispatch paused your account, so you cannot accept new loads. Contact dispatch to resume.
            </Alert>
          )}
          {!isPendingOrRejected && docIssueCount > 0 && !isOnDocuments && (
            <Alert
              tone="warning"
              title="Document update required"
              action={
                <NavLink to={`${base}/documents?highlight=flagged`} className="inline-flex items-center justify-center rounded-control border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-subtle transition-colors">
                  View documents
                </NavLink>
              }
            >
              Compliance requested updates on {docIssueCount} document(s): {Object.keys(partner.document_issues!).join(', ')}.
            </Alert>
          )}
          {!isPendingOrRejected && fieldIssueCount > 0 && !isOnSettings && (
            <Alert
              tone="warning"
              title="Detail update required"
              action={
                <NavLink to={`${base}/settings?highlight=flagged`} className="inline-flex items-center justify-center rounded-control border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-subtle transition-colors">
                  Edit details
                </NavLink>
              }
            >
              Compliance flagged details for revision: {Object.keys(partner.field_issues!).map(k => k.replace(/_/g, ' ')).join(', ')}.
            </Alert>
          )}

          <Routes>
            <Route index element={isPendingOrRejected ? <ApplicationOverview partner={partner} base={base} /> : <OrdersPage />} />
            <Route path="fleet" element={<FleetPage />} />
            <Route path="drivers" element={<DriversPage />} />
            <Route path="statements" element={<StatementsPage />} />
            <Route path="earnings" element={<EarningsPage />} />
            <Route path="lanes" element={<LanesPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={base} replace />} />
          </Routes>
        </main>
      </div>
    </PortalContext.Provider>
  )
}
