import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronsLeft, ChevronsRight, ExternalLink, LogOut, Menu, Search, X } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase, openChannel } from '@/services/supabase'
import { vendorAPI } from '@/services/api'
import { fullBleedPaths, navSections, trackingPageLink, type NavBadge, type NavItem } from '@/config/navigation'
import { routePrefetch } from '@/config/lazyPages'
import { useDraftStore } from '@/store/draftStore'
import SOSListener from '@/components/SOSListener'
import { CommandPalette } from './CommandPalette'
import { GlobalDeliveryCelebration } from './GlobalDeliveryCelebration'
import { NotificationsBell } from './NotificationsBell'
import { IconButton } from './Button'
import { LoadingState } from './Spinner'
import { useDialog } from './useDialog'

/** True on Mac (⌘) keyboards, so the search hint shows the right modifier key. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent ?? '')

/** Opens the global search palette on Ctrl/Cmd+K from anywhere in the app. */
function useSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpen()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onOpen])
}

// Pulls in the live map (maplibre) to place the shipment's stops, so it is
// only fetched once a "Create shipment" button is actually clicked.
const AddShipmentModal = lazy(() => import('@/components/modals/AddShipmentModal'))

const COLLAPSE_KEY = 'sidebar_collapsed'

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === 'true' } catch { return false }
}

/** Warms a route's JS chunk on hover/focus of its nav link, so the page has usually already
 * arrived by the time the click lands. A failed prefetch is silent; the real navigation (and
 * `ChunkErrorBoundary`) handles it if the chunk still can't be loaded. */
function prefetchRoute(to: string) {
  routePrefetch[to]?.().catch(() => { /* surfaced on navigation instead */ })
}

/** Counts for the navigation badges; each refreshes when its table changes. */
function useNavBadges(enabled: boolean, isSuperadmin: boolean) {
  const [counts, setCounts] = useState<Record<NavBadge, number>>({ vendorRequests: 0, pendingPartners: 0, pendingKyc: 0 })

  const loadVendorRequests = useCallback(async () => {
    try {
      const data = await vendorAPI.pendingRequests()
      setCounts(c => ({ ...c, vendorRequests: Array.isArray(data) ? data.length : 0 }))
    } catch {
      // Keep the previous count; the page itself reports load errors.
    }
  }, [])

  const loadPartners = useCallback(async () => {
    const { count, error } = await supabase.from('tpl_partners').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    if (!error) setCounts(c => ({ ...c, pendingPartners: count ?? 0 }))
  }, [])

  const loadKyc = useCallback(async () => {
    const { count, error } = await supabase.from('vendor_profiles').select('id', { count: 'exact', head: true }).eq('kyc_status', 'submitted')
    if (!error) setCounts(c => ({ ...c, pendingKyc: count ?? 0 }))
  }, [])

  useEffect(() => {
    if (!enabled) return
    loadVendorRequests()
    const channel = openChannel('nav_badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_shipment_requests' }, loadVendorRequests)
    if (isSuperadmin) {
      loadPartners()
      loadKyc()
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tpl_partners' }, loadPartners)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_profiles' }, loadKyc)
    }
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [enabled, isSuperadmin, loadVendorRequests, loadPartners, loadKyc])

  return counts
}

/** Opens the search palette; shown in the sidebar (desktop) and the phone top bar. */
function SearchButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? 'Search' : undefined}
      className={clsx(
        'flex h-10 min-w-0 flex-1 items-center rounded-control text-sm text-muted transition-colors hover:bg-surface-subtle hover:text-text',
        collapsed ? 'justify-center' : 'gap-3 px-3',
      )}
    >
      <Search size={18} aria-hidden="true" className="shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">Search</span>
          <span className="rounded-control border border-border px-1.5 py-0.5 text-xs text-muted">{isMac ? '⌘K' : 'Ctrl+K'}</span>
        </>
      )}
      {collapsed && <span className="sr-only">Search ({isMac ? 'Cmd+K' : 'Ctrl+K'})</span>}
    </button>
  )
}

function Brand({ collapsed, bordered = true }: { collapsed: boolean; bordered?: boolean }) {
  return (
    <div className={clsx('flex h-16 shrink-0 items-center gap-2.5', bordered && 'border-b border-border', collapsed ? 'justify-center px-2' : 'px-5')}>
      <img src="/margix-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
      {!collapsed && <span className="text-lg font-semibold text-text">MargixIndia</span>}
    </div>
  )
}

function NavList({ items, collapsed, badges, onNavigate }: {
  items: { title: string; items: NavItem[] }[]
  collapsed: boolean
  badges: Record<NavBadge, number>
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Main" className={clsx('flex-1 space-y-5 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
      {items.map(section => (
        <div key={section.title}>
          {collapsed
            ? <div className="mx-auto mb-2 h-px w-6 bg-border" aria-hidden="true" />
            : <p className="mb-1 px-3 text-xs font-medium text-muted">{section.title}</p>}
          <ul className="space-y-0.5">
            {section.items.map(({ to, label, icon: Icon, badge }) => {
              const count = badge ? badges[badge] : 0
              return (
                <li key={to}>
                  <NavLink
                    to={to}
                    onClick={onNavigate}
                    onMouseEnter={() => prefetchRoute(to)}
                    onFocus={() => prefetchRoute(to)}
                    title={collapsed ? label : undefined}
                    aria-label={collapsed ? (count ? `${label} (${count})` : label) : undefined}
                    className={({ isActive }) => clsx(
                      'relative flex h-10 items-center rounded-control text-sm transition-colors',
                      collapsed ? 'justify-center' : 'gap-3 px-3',
                      isActive ? 'bg-brand-soft font-medium text-text' : 'text-muted hover:bg-surface-subtle hover:text-text',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={18} aria-hidden="true" className={clsx('shrink-0', isActive && 'text-brand')} />
                        {!collapsed && <span className="flex-1 truncate">{label}</span>}
                        {count > 0 && (collapsed
                          ? <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand-fill" />
                          : <span className="rounded-full bg-brand-fill px-2 py-0.5 text-xs font-medium text-on-brand tabular">{count}</span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SidebarFooter({ collapsed, onSignOut, onToggle }: { collapsed: boolean; onSignOut: () => void; onToggle?: () => void }) {
  const item = clsx(
    'flex h-10 w-full items-center rounded-control text-sm text-muted transition-colors hover:bg-surface-subtle hover:text-text',
    collapsed ? 'justify-center' : 'gap-3 px-3',
  )
  const TrackingIcon = trackingPageLink.icon
  return (
    <div className={clsx('shrink-0 space-y-0.5 border-t border-border py-3', collapsed ? 'px-2' : 'px-3')}>
      <a
        href={trackingPageLink.to}
        target="_blank"
        rel="noreferrer"
        className={item}
        title={collapsed ? trackingPageLink.label : undefined}
        onMouseEnter={() => prefetchRoute(trackingPageLink.to)}
        onFocus={() => prefetchRoute(trackingPageLink.to)}
      >
        <TrackingIcon size={18} aria-hidden="true" className="shrink-0" />
        {collapsed ? <span className="sr-only">{trackingPageLink.label} (opens in a new tab)</span> : (
          <>
            <span className="flex-1 truncate">{trackingPageLink.label}</span>
            <ExternalLink size={14} aria-hidden="true" />
          </>
        )}
      </a>
      {onToggle && (
        <button type="button" onClick={onToggle} className={item} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight size={18} aria-hidden="true" /> : <ChevronsLeft size={18} aria-hidden="true" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      )}
      <button type="button" onClick={onSignOut} className={item} aria-label={collapsed ? 'Sign out' : undefined}>
        <LogOut size={18} aria-hidden="true" className="shrink-0" />
        {!collapsed && <span>Sign out</span>}
      </button>
    </div>
  )
}

export default function AppLayout() {
  const clearAuth = useAuthStore(s => s.clearAuth)
  const role = useAuthStore(s => s.role)
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // The modal (and the map it pulls in) is only fetched once a "Create shipment" button opens it.
  const isShipmentModalOpen = useDraftStore(s => s.isModalOpen)

  const isStaff = role === 'admin' || role === 'superadmin'
  const badges = useNavBadges(isStaff, role === 'superadmin')
  useSearchShortcut(useCallback(() => { if (isStaff) setSearchOpen(true) }, [isStaff]))
  const sections = navSections
    .map(s => ({ ...s, items: s.items.filter(i => role && (i.roles as string[]).includes(role)) }))
    .filter(s => s.items.length > 0)
  const fullBleed = fullBleedPaths.some(p => location.pathname.startsWith(p))

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(COLLAPSE_KEY, String(next)) } catch { /* storage unavailable: keep in memory only */ }
      return next
    })
  }

  // Close the phone menu after navigating. While it is open, focus stays inside it, Esc closes it,
  // the page behind does not scroll, and focus goes back to the menu button afterwards.
  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  const menuPanel = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMobileOpen(false), [])
  useDialog(mobileOpen, closeMenu, menuPanel)

  // Keep fleet data fresh everywhere so pages open with current positions.
  useEffect(() => {
    const invalidateFleet = () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
    }
    const channel = openChannel('global_fleet_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, invalidateFleet)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, invalidateFleet)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, invalidateFleet)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('Sign-out failed', e)
    }
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-raised">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <Brand collapsed={collapsed} />
        {isStaff && (
          <div className={clsx('flex shrink-0 items-center gap-1 border-b border-border py-2', collapsed ? 'flex-col px-2' : 'pl-3 pr-2')}>
            <SearchButton collapsed={collapsed} onClick={() => setSearchOpen(true)} />
            <NotificationsBell />
          </div>
        )}
        <NavList items={sections} collapsed={collapsed} badges={badges} />
        <SidebarFooter collapsed={collapsed} onSignOut={signOut} onToggle={toggleCollapsed} />
      </aside>

      {/* Phone and tablet top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-2 lg:hidden">
        <IconButton label="Open menu" icon={<Menu size={20} />} onClick={() => setMobileOpen(true)} aria-expanded={mobileOpen} />
        <img src="/margix-logo.png" alt="" className="h-7 w-7 object-contain" />
        <span className="min-w-0 flex-1 truncate text-base font-semibold">MargixIndia</span>
        {isStaff && (
          <>
            <IconButton label="Search" icon={<Search size={20} />} onClick={() => setSearchOpen(true)} />
            <NotificationsBell />
          </>
        )}
      </header>

      {/* Phone and tablet menu */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-overlay animate-fade-in" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div ref={menuPanel} role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1} className="absolute inset-y-0 left-0 focus:outline-none flex w-72 max-w-[85vw] flex-col bg-surface shadow-dialog animate-slide-in-left">
            <div className="flex items-center justify-between border-b border-border pr-2">
              <Brand collapsed={false} bordered={false} />
              <IconButton label="Close menu" icon={<X size={20} />} onClick={() => setMobileOpen(false)} />
            </div>
            <NavList items={sections} collapsed={false} badges={badges} onNavigate={() => setMobileOpen(false)} />
            <SidebarFooter collapsed={false} onSignOut={signOut} />
          </div>
        </div>
      )}

      <main
        id="main"
        tabIndex={-1}
        className={clsx('min-w-0 focus:outline-none transition-[padding] duration-200', collapsed ? 'lg:pl-16' : 'lg:pl-64')}
      >
        <Suspense fallback={<LoadingState label="Loading page…" className="min-h-[50vh]" />}>
          {fullBleed ? (
            <div className="h-[calc(100dvh-3.5rem)] lg:h-dvh"><Outlet /></div>
          ) : (
            <div className="mx-auto w-full max-w-content px-4 py-6 sm:px-6 lg:py-8">
              <Outlet />
            </div>
          )}
        </Suspense>
      </main>

      {isShipmentModalOpen && (
        <Suspense fallback={null}>
          <AddShipmentModal />
        </Suspense>
      )}
      <SOSListener />
      <GlobalDeliveryCelebration />
      {isStaff && <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
