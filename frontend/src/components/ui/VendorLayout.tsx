import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { LogIn, LogOut, Menu, X } from 'lucide-react'
import { supabase, openChannel } from '@/services/supabase'
import { useAccountKind } from '@/store/accountKind'
import { useAuthStore } from '@/store/authStore'
import { getKycDocumentUrl } from '@/services/kycDocuments'
import type { KycStatus, VendorOutletContext, VendorProfileSummary } from '@/components/vendor/vendorContext'
import { routePrefetch } from '@/config/lazyPages'
import { buttonClasses } from './buttonStyles'
import { Button, IconButton } from './Button'
import { StatusPill } from './StatusPill'
import { LoadingState } from './Spinner'
import { NotificationsBell } from './NotificationsBell'

const KYC_STATUSES: KycStatus[] = ['pending', 'submitted', 'info_requested', 'approved', 'rejected']

/** Warms a route's JS chunk on hover/focus of its nav link (see `AppLayout` for the same pattern). */
function prefetchRoute(to: string) {
  routePrefetch[to]?.().catch(() => { /* surfaced on navigation instead */ })
}

/** The vendor's menu, in the order the work happens. */
const links = [
  { to: '/vendor/loads', label: 'My loads', requiresSignIn: true },
  { to: '/vendor/request', label: 'Post a load', requiresSignIn: false },
  { to: '/vendor/return-trips', label: 'Return trips', requiresSignIn: false },
  { to: '/vendor/invoices', label: 'Invoices and proofs', requiresSignIn: true },
  { to: '/vendor/claims', label: 'Claims', requiresSignIn: true },
  { to: '/vendor/company', label: 'Company', requiresSignIn: true },
]

export default function VendorLayout() {
  const userId = useAuthStore(s => s.userId)
  const session = useAuthStore(s => s.session)
  const { kind } = useAccountKind()
  const clearAuth = useAuthStore(s => s.clearAuth)
  const navigate = useNavigate()
  const location = useLocation()
  const [vendorProfile, setVendorProfile] = useState<VendorProfileSummary | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setVendorProfile(null)
      return
    }
    setProfileLoading(true)
    const { data, error } = await supabase
      .from('vendor_profiles')
      .select('id, company_name, city, company_logo, kyc_status, kyc_rejection_reason, latitude, longitude')
      .eq('id', userId)
      .maybeSingle()
    setProfileLoading(false)
    if (error) {
      console.error('Failed to load vendor profile', error)
      return
    }
    if (!data) {
      setVendorProfile(null)
      return
    }
    const status = String(data.kyc_status ?? 'pending').toLowerCase() as KycStatus
    setVendorProfile({
      id: data.id,
      company_name: data.company_name,
      city: data.city,
      company_logo: data.company_logo,
      kycStatus: KYC_STATUSES.includes(status) ? status : 'pending',
      kycRejectionReason: data.kyc_rejection_reason ?? null,
      hasLocation: data.latitude != null && data.longitude != null,
    })
  }, [userId])

  useEffect(() => {
    loadProfile()
    if (!userId) return
    const onUpdated = () => { loadProfile() }
    window.addEventListener('vendor-profile-updated', onUpdated)
    // KYC decisions made by staff arrive through realtime.
    const channel = openChannel('vendor-layout-profile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_profiles', filter: `id=eq.${userId}` }, onUpdated)
      .subscribe()
    return () => {
      window.removeEventListener('vendor-profile-updated', onUpdated)
      supabase.removeChannel(channel)
    }
  }, [userId, loadProfile])

  useEffect(() => {
    let cancelled = false
    const path = vendorProfile?.company_logo
    if (!path) { setLogoUrl(null); return }
    getKycDocumentUrl(path)
      .then(url => { if (!cancelled) setLogoUrl(url) })
      .catch(() => { if (!cancelled) setLogoUrl(null) })
    return () => { cancelled = true }
  }, [vendorProfile?.company_logo])

  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('Sign-out failed', e)
    }
    clearAuth()
    navigate('/login')
  }

  // A visitor sees only the public sections; the account pages appear once they sign in.
  const visibleLinks = links.filter(link => !link.requiresSignIn || !!session)

  // A 3PL partner has the vendor role but its own portal: only a plain vendor account is a vendor here
  const isVendor = !!session && kind === 'vendor'
  const context: VendorOutletContext = { vendorProfile, profileLoading, isSignedIn: !!session, isVendor, refreshProfile: loadProfile }
  // The company page needs the vendor when the KYC is not approved, or the profile has no pickup location
  const needsKyc = isVendor && (vendorProfile ? vendorProfile.kycStatus !== 'approved' || !vendorProfile.hasLocation : !profileLoading)

  const navLinks = (vertical: boolean) => visibleLinks.map(link => (
    <NavLink
      key={link.to}
      to={link.to}
      onMouseEnter={() => prefetchRoute(link.to)}
      onFocus={() => prefetchRoute(link.to)}
      className={({ isActive }) => clsx(
        'relative flex items-center whitespace-nowrap rounded-control text-sm transition-colors',
        vertical ? 'h-11 px-3' : 'h-9 px-3',
        isActive ? 'bg-brand-soft font-medium text-text' : 'text-muted hover:bg-surface-subtle hover:text-text',
      )}
    >
      {link.label}
      {link.to === '/vendor/company' && needsKyc && (
        <span role="img" className="ml-2 h-2 w-2 rounded-full bg-warning" aria-label="Action needed" />
      )}
    </NavLink>
  ))

  // In the top bar the company name only shows on wide screens, so the nav links keep their room.
  const account = (inMenu: boolean) => session ? (
    <div className={clsx('flex items-center gap-3', inMenu && 'justify-between')}>
      {vendorProfile && (
        <div className={clsx('min-w-0 items-center gap-2', inMenu ? 'flex' : 'hidden xl:flex')}>
          {logoUrl && <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full border border-border object-cover" />}
          <div className={clsx('min-w-0', !inMenu && 'text-right')}>
            <p className="truncate text-sm font-medium text-text">{vendorProfile.company_name || 'Your company'}</p>
            <StatusPill status={vendorProfile.kycStatus} className="mt-0.5">
              {vendorProfile.kycStatus === 'approved' ? 'Verified' : vendorProfile.kycStatus === 'submitted' ? 'KYC in review' : vendorProfile.kycStatus === 'info_requested' ? 'More details needed' : vendorProfile.kycStatus === 'rejected' ? 'KYC rejected' : 'KYC needed'}
            </StatusPill>
          </div>
        </div>
      )}
      {inMenu
        ? <Button variant="secondary" icon={<LogOut size={16} />} onClick={signOut}>Sign out</Button>
        : <IconButton label="Sign out" icon={<LogOut size={18} />} onClick={signOut} />}
    </div>
  ) : (
    <NavLink to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
      <LogIn size={16} aria-hidden="true" /> Sign in / Sign up
    </NavLink>
  )

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4 xl:gap-6">
            <NavLink to={session ? '/vendor/loads' : '/vendor/request'} className="flex items-center gap-2.5">
              <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
              <span className="text-lg font-semibold text-text">MargixIndia</span>
              <span className="hidden text-sm text-muted xl:inline">for vendors</span>
            </NavLink>
            <nav aria-label="Vendor" className="hidden items-center gap-1 lg:flex">{navLinks(false)}</nav>
          </div>
          <div className="hidden items-center gap-3 lg:flex">
            {isVendor && <NotificationsBell placement="right" />}
            {account(false)}
          </div>
          <div className="flex items-center gap-1 lg:hidden">
            {isVendor && <NotificationsBell placement="right" />}
            <IconButton
              label={menuOpen ? 'Close menu' : 'Open menu'}
              icon={menuOpen ? <X size={20} /> : <Menu size={20} />}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(o => !o)}
            />
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-border bg-surface px-4 py-3 lg:hidden">
            <nav aria-label="Vendor" className="flex flex-col gap-1">{navLinks(true)}</nav>
            <div className="mt-3 border-t border-border pt-3">{account(true)}</div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-content flex-1 px-4 py-6 sm:px-6 lg:py-8">
        <Suspense fallback={<LoadingState label="Loading page…" className="min-h-[50vh]" />}>
          <Outlet context={context} />
        </Suspense>
      </main>
    </div>
  )
}
