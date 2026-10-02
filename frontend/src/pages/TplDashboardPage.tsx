import { useEffect, useMemo, useRef } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Lock, LogOut } from 'lucide-react'
import { Alert, Button, EmptyState, ErrorState, IconButton, Spinner, StatusPill } from '@/components/ui'
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

const LINKS = [
  { to: '', label: 'Orders' },
  { to: 'fleet', label: 'Fleet' },
  { to: 'drivers', label: 'Drivers' },
  { to: 'statements', label: 'Statements' },
  { to: 'earnings', label: 'Earnings' },
  { to: 'lanes', label: 'Lanes' },
  { to: 'documents', label: 'Documents' },
  { to: 'settings', label: 'Settings' },
] as const

function CenteredState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-bg p-6"><div className="w-full max-w-md">{children}</div></div>
}

/**
 * The 3PL partner portal at /3pl-portal/:id. It is the partner's own: an account may only open the portal of the
 * partner record linked to its sign-in, whatever id the address carries (the API enforces this too).
 * Orders is the home page; Earnings, Lanes, Documents and Settings are pages of their own.
 */
export default function TplDashboardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = useAuthStore(s => s.userId)

  const signOut = async () => {
    try { await supabase.auth.signOut() } catch (err) { console.error('Sign-out failed', err) }
    useAuthStore.getState().clearAuth()
    navigate('/3pl/login', { replace: true })
  }

  // Whose portal this account has: checked before anything of the address's partner is loaded
  const own = useQuery({
    queryKey: ['tpl-own-partner', userId],
    queryFn: () => tplAPI.byUser(userId!) as Promise<{ id: string } | null>,
    enabled: !!userId,
    retry: false,
  })
  const access = own.data !== undefined ? portalAccess(own.data?.id, id) : null

  const partnerQuery = useQuery({
    queryKey: ['tpl-portal-partner', id],
    queryFn: () => tplAPI.getPartner(id!) as Promise<PortalPartner>,
    enabled: access === 'own',
  })
  useRealtimeRefresh('tpl_portal_partner', ['tpl_partners', 'tpl_corridors', 'tpl_documents'], [['tpl-portal-partner', id]])
  const offers = useQuery({ queryKey: ['tpl-my-offers'], queryFn: tplNetworkAPI.myOffers, enabled: access === 'own', retry: false })
  const openOffers = (offers.data?.items ?? []).filter(o => o.status === 'offered').length

  const partner = partnerQuery.data
  // An approved settings request arrives through realtime
  const hadPending = useRef(false)
  useEffect(() => {
    if (!partner) return
    if (hadPending.current && !partner.pending_updates && partner.status === 'active') toast.success('Your pending updates have been approved')
    hadPending.current = !!partner.pending_updates
  }, [partner])

  // Old links used one page with ?tab=; each tab is a page now
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

  // The API only shows the full record to the partner's own account: anything else is not this account's portal
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

  const statusTitle: Record<string, string> = {
    pending: 'Your profile is in review',
    paused: 'Your account is paused',
    rejected: 'Your application was not approved',
  }

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
              {LINKS.map(link => (
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
                    {link.to === '' && openOffers > 0 && (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs tabular text-brand" aria-label={`${openOffers} offers waiting`}>{openOffers}</span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main className="mx-auto max-w-content space-y-6 px-4 py-6 sm:px-6 lg:py-8">
          {partner.status !== 'active' && (
            <Alert tone={partner.status === 'rejected' ? 'danger' : 'warning'} title={statusTitle[partner.status] ?? 'Your account is not active'}>
              {partner.status === 'pending'
                ? 'You cannot accept new loads until we approve it. Your existing orders stay open. We will notify you.'
                : partner.status === 'paused'
                  ? 'MargixIndia dispatch paused your account, so you cannot accept new loads. Your existing orders stay open. Contact dispatch to resume.'
                  : 'You cannot accept new loads. Contact MargixIndia dispatch to have your account reviewed.'}
            </Alert>
          )}
          <Routes>
            <Route index element={<OrdersPage />} />
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
