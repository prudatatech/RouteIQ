import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { LogIn, LogOut, Menu, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { getKycDocumentUrl } from '@/services/kycDocuments'
import type { KycStatus, VendorOutletContext, VendorProfileSummary } from '@/components/vendor/vendorContext'
import { buttonClasses } from './buttonStyles'
import { IconButton } from './Button'
import { StatusPill } from './StatusPill'

const KYC_STATUSES: KycStatus[] = ['pending', 'submitted', 'approved', 'rejected']

const links = [
  { to: '/vendor', label: 'Find capacity', end: true, requiresSignIn: false },
  { to: '/vendor/corridor', label: 'Corridors', requiresSignIn: false },
  { to: '/vendor/shipments', label: 'My shipments', requiresSignIn: true },
  { to: '/vendor/tracking', label: 'Tracking', requiresSignIn: true },
  { to: '/vendor/documents', label: 'Company & KYC', requiresSignIn: true },
]

export default function VendorLayout() {
  const userId = useAuthStore(s => s.userId)
  const session = useAuthStore(s => s.session)
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
      .select('id, company_name, city, company_logo, kyc_status')
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
    })
  }, [userId])

  useEffect(() => {
    loadProfile()
    if (!userId) return
    const onUpdated = () => { loadProfile() }
    window.addEventListener('vendor-profile-updated', onUpdated)
    // KYC decisions made by staff arrive through realtime.
    const channel = supabase
      .channel('vendor-layout-profile')
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

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('Sign-out failed', e)
    }
    clearAuth()
    navigate('/vendor/login')
  }

  const target = (link: typeof links[number]) =>
    link.requiresSignIn && !session ? `/vendor/login?next=${encodeURIComponent(link.to)}` : link.to

  const context: VendorOutletContext = { vendorProfile, profileLoading, isSignedIn: !!session, refreshProfile: loadProfile }
  const needsKyc = !!session && vendorProfile?.kycStatus !== 'approved'

  const navLinks = (vertical: boolean) => links.map(link => (
    <NavLink
      key={link.to}
      to={target(link)}
      end={link.end}
      className={({ isActive }) => clsx(
        'relative flex items-center rounded-control text-sm transition-colors',
        vertical ? 'h-11 px-3' : 'h-9 px-3',
        isActive ? 'bg-brand-soft font-medium text-text' : 'text-muted hover:bg-surface-subtle hover:text-text',
      )}
    >
      {link.label}
      {link.to === '/vendor/documents' && needsKyc && (
        <span className="ml-2 h-2 w-2 rounded-full bg-warning" aria-label="Action needed" />
      )}
    </NavLink>
  ))

  const account = session ? (
    <div className="flex items-center gap-3">
      {vendorProfile && (
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          {logoUrl && <img src={logoUrl} alt="" className="h-8 w-8 rounded-full border border-border object-cover" />}
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-medium text-text">{vendorProfile.company_name || 'Your company'}</p>
            <StatusPill status={vendorProfile.kycStatus} className="mt-0.5">
              {vendorProfile.kycStatus === 'approved' ? 'Verified' : vendorProfile.kycStatus === 'submitted' ? 'KYC in review' : vendorProfile.kycStatus === 'rejected' ? 'KYC rejected' : 'KYC needed'}
            </StatusPill>
          </div>
        </div>
      )}
      <IconButton label="Sign out" icon={<LogOut size={18} />} onClick={signOut} />
    </div>
  ) : (
    <NavLink to="/vendor/login" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
      <LogIn size={16} aria-hidden="true" /> Sign in
    </NavLink>
  )

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <NavLink to="/vendor" className="flex items-center gap-2.5">
              <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
              <span className="text-lg font-semibold text-text">MargixIndia</span>
              <span className="hidden text-sm text-muted sm:inline">for shippers</span>
            </NavLink>
            <nav aria-label="Vendor" className="hidden items-center gap-1 lg:flex">{navLinks(false)}</nav>
          </div>
          <div className="hidden lg:block">{account}</div>
          <IconButton
            className="lg:hidden"
            label={menuOpen ? 'Close menu' : 'Open menu'}
            icon={menuOpen ? <X size={20} /> : <Menu size={20} />}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
          />
        </div>
        {menuOpen && (
          <div className="border-t border-border bg-surface px-4 py-3 lg:hidden">
            <nav aria-label="Vendor" className="flex flex-col gap-1">{navLinks(true)}</nav>
            <div className="mt-3 border-t border-border pt-3">{account}</div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-content flex-1 px-4 py-6 sm:px-6 lg:py-8">
        <Outlet context={context} />
      </main>
    </div>
  )
}
