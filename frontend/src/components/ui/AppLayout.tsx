import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Truck, Map, BarChart3, Zap,
  LogOut, Shield, Brain, Package, Network, ExternalLink, Briefcase, ShieldAlert, Building2,
  ChevronsLeft, ChevronsRight, Settings
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import clsx from 'clsx'
import AddShipmentModal from '@/components/modals/AddShipmentModal'
import SOSListener from '@/components/SOSListener'
import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { GlobalDeliveryCelebration } from './GlobalDeliveryCelebration'
interface NavItem {
  to: string
  icon: any
  label: string
  roles?: string[]
  badge?: number
  external?: boolean
}
interface NavSection {
  title: string
  shortTitle: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    title: 'Operations',
    shortTitle: 'OP',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Control Tower', roles: ['admin', 'superadmin'] },
      { to: '/shipments', icon: Package, label: 'Cargo Manifest', roles: ['admin', 'superadmin'] },
      { to: '/fleet', icon: Truck, label: 'Fleet Assets', roles: ['admin', 'superadmin'] },
      { to: '/emergency', icon: ShieldAlert, label: 'Emergency Alerts', roles: ['admin', 'superadmin'] },
      { to: '/vendor', icon: Package, label: 'Vendor Portal', roles: ['vendor'] },
      { to: '/3pl-network', icon: Building2, label: '3PL Network', roles: ['superadmin'] },
    ]
  },
  {
    title: 'Planning',
    shortTitle: 'PL',
    items: [
      { to: '/routes', icon: Map, label: 'Route Grid', roles: ['admin', 'superadmin'] },
      { to: '/optimize', icon: Zap, label: 'Neural Reroute', roles: ['admin', 'superadmin'] },
      { to: '/capacity-bidding', icon: Briefcase, label: 'Capacity Bidding', roles: ['admin', 'superadmin'] },
      { to: '/cargo-network', icon: Network, label: 'Cargo Network', roles: ['admin', 'superadmin'] },
    ]
  },
  {
    title: 'Intelligence',
    shortTitle: 'IN',
    items: [
      { to: '/analytics', icon: BarChart3, label: 'Intel Dashboard', roles: ['admin', 'superadmin'] },
      { to: '/ai-hub', icon: Brain, label: 'Nexus AI Hub', roles: ['admin', 'superadmin'] },
    ]
  },
  {
    title: 'System',
    shortTitle: 'SYS',
    items: [
      { to: '/track', icon: Shield, label: 'Tracking Portal', external: true },
      { to: '/superadmin', icon: Settings, label: 'Superadmin', roles: ['superadmin'] },
    ]
  }
]

export default function AppLayout() {
  const clearAuth = useAuthStore(s => s.clearAuth)
  const role = useAuthStore(s => s.role)
  const navigate = useNavigate()
  const [vendorBadge, setVendorBadge] = useState(0)
  const [tplBadge, setTplBadge] = useState(0)
  const queryClient = useQueryClient()

  // Collapsible sidebar state with localStorage persistence
  const [isPinnedCollapsed, setIsPinnedCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true'
    } catch { return false }
  })
  
  const [hoverExpanded, setHoverExpanded] = useState(false)
  const hoverTimer = useRef<any>(null)

  const collapsed = isPinnedCollapsed && !hoverExpanded

  const toggleCollapsed = () => {
    setIsPinnedCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('sidebar_collapsed', String(next)) } catch {}
      return next
    })
    setHoverExpanded(false)
  }

  const handleMouseEnter = () => {
    if (isPinnedCollapsed) {
      hoverTimer.current = setTimeout(() => {
        setHoverExpanded(true)
      }, 400) // Reduced from 2000ms to 400ms for better responsiveness
    }
  }

  const handleMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoverExpanded(false)
  }

  const handleSidebarClick = () => {
    if (isPinnedCollapsed && !hoverExpanded) {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      setHoverExpanded(true)
    }
  }

  const sidebarWidth = collapsed ? 78 : 264

  useEffect(() => {
    // Global fleet updates to eliminate latency when navigating to Fleet page
    const invalidateFleet = () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
    }
    const globalSub = supabase.channel('global_fleet_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, invalidateFleet)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, invalidateFleet)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, invalidateFleet)
      .subscribe()

    return () => {
      supabase.removeChannel(globalSub)
    }
  }, [queryClient])

  useEffect(() => {
    if (!['admin', 'superadmin'].includes(role || '')) return
    const fetchBadge = async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) return
      const res = await fetch('/api/v1/vendor/shipment-request/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setVendorBadge(Array.isArray(data) ? data.length : 0)
      }
    }
    fetchBadge()
    
    const fetchTplBadge = async () => {
      const { data } = await supabase.from('tpl_partners').select('id').eq('status', 'pending');
      setTplBadge(data?.length || 0);
    }
    fetchTplBadge()

    // Realtime subscription for new vendor requests
    const sub = supabase.channel('layout_vendor_badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_shipment_requests' }, fetchBadge)
      .subscribe()
      
    // Realtime subscription for 3PL onboarding
    const sub2 = supabase.channel('layout_tpl_badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tpl_partners' }, fetchTplBadge)
      .subscribe()

    return () => { 
      supabase.removeChannel(sub) 
      supabase.removeChannel(sub2)
    }
  }, [role])

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('Logout error', e)
    }
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">

      {/* ── Irish Purple Sidebar ─────────────────────────────────── */}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleSidebarClick}
        className="fixed left-0 top-0 bottom-0 flex flex-col z-[100] overflow-hidden"
        style={{
          width: sidebarWidth,
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          background: '#ffffff',
          boxShadow: '4px 0 24px rgba(0, 0, 0, 0.05)',
          borderRight: '1px solid #f1f5f9',
        }}
      >
        {/* Logo */}
        <div className={clsx("flex-shrink-0 border-b border-slate-100 overflow-hidden flex items-center gap-3", collapsed ? "h-[80px] justify-center" : "h-[80px] px-5")}>
          <img 
            src="/margix-logo.png" 
            alt="Margix" 
            className="transition-all duration-300 flex-shrink-0"
            style={{
              height: collapsed ? '32px' : '40px',
              width: 'auto',
              maxWidth: collapsed ? '50px' : '200px',
              objectFit: 'contain'
            }}
          />
          <div
            className="overflow-hidden whitespace-nowrap flex flex-col"
            style={{
              width: collapsed ? 0 : 'auto',
              opacity: collapsed ? 0 : 1,
              transition: 'opacity 0.2s ease, width 0.3s ease',
            }}
          >
            <div className="font-black text-xl text-slate-900 tracking-tight leading-tight">
              Margix
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className={clsx("flex-1 py-3 overflow-y-auto space-y-4", collapsed ? "px-2.5" : "px-3")}>
          {navSections.map((section) => {
            const sectionItems = section.items.filter(item => !item.roles || item.roles.includes(role || ''))
            if (sectionItems.length === 0) return null

            return (
              <div key={section.title} className="flex flex-col gap-0.5">
                <div className={clsx(
                  "flex items-center mb-1.5",
                  collapsed ? "justify-center mt-2" : "px-3 mt-1"
                )}>
                  {collapsed ? (
                    <span className="text-[10px] font-black uppercase text-slate-400/80 tracking-tighter" title={section.title}>
                      {section.shortTitle}
                    </span>
                  ) : (
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.15em]">
                      {section.title}
                    </span>
                  )}
                </div>

                {sectionItems.map(({ to, icon: Icon, label, external }) => {
                  const itemBadge = (to === '/dashboard' && vendorBadge > 0) ? vendorBadge : 
                                    (to === '/3pl-network' && tplBadge > 0) ? tplBadge : undefined
                  if (external) {
                    return (
                      <button
                        key={to}
                        onClick={() => window.open(to, '_blank')}
                        className={clsx(
                          "flex items-center w-full rounded-lg text-[13px] transition-all duration-200 relative group",
                          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3.5 py-2.5"
                        )}
                        style={{ color: '#64748b' }}
                        title={collapsed ? label : undefined}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = '#f8fafc'
                          e.currentTarget.style.color = '#0f172a'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = '#64748b'
                        }}
                      >
                        <Icon size={18} className="flex-shrink-0" />
                        {!collapsed && <span className="flex-1 text-left font-medium">{label}</span>}
                        {!collapsed && <ExternalLink size={11} style={{ opacity: 0.4 }} />}
                      </button>
                    )
                  }
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) => clsx(
                        'flex items-center rounded-lg text-[13px] transition-all duration-200 relative group overflow-hidden',
                        collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5',
                      )}
                      style={({ isActive }) => ({
                        background: isActive ? '#eff6ff' : 'transparent',
                        color: isActive ? '#1d4ed8' : '#64748b',
                        fontWeight: isActive ? 600 : 500,
                      })}
                      onMouseEnter={e => {
                        const link = e.currentTarget
                        if (!link.classList.contains('active')) {
                          link.style.background = '#f8fafc'
                          link.style.color = '#334155'
                        }
                      }}
                      onMouseLeave={e => {
                        const link = e.currentTarget
                        const isActive = link.getAttribute('aria-current') === 'page'
                        if (!isActive) {
                          link.style.background = 'transparent'
                          link.style.color = '#64748b'
                        }
                      }}
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <div
                              className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
                              style={{ background: '#1d4ed8' }}
                            />
                          )}
                          <Icon size={18} className="flex-shrink-0" style={{
                            color: isActive ? '#1d4ed8' : undefined,
                            transform: isActive ? 'scale(1.08)' : undefined,
                            transition: 'all 0.2s ease',
                          }} />
                          {!collapsed && <span className="flex-1 tracking-tight">{label}</span>}
                          {!collapsed && itemBadge && (
                            <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-sm">
                              {itemBadge}
                            </span>
                          )}
                          {collapsed && itemBadge && (
                            <span
                              className="absolute -top-0.5 -right-0.5 w-4 h-4 text-[8px] font-black rounded-full flex items-center justify-center shadow-sm"
                              style={{ background: '#a855f7', color: '#ffffff' }}
                            >
                              {itemBadge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            )
          })}
        </nav>

        {/* Bottom: Collapse + Sign Out */}
        <div className={clsx("pb-4 pt-2 flex-shrink-0 border-t border-slate-100", collapsed ? "px-2.5" : "px-3")}>
          {/* Collapse Toggle */}
          <button
            onClick={toggleCollapsed}
            className={clsx(
              "flex items-center w-full rounded-lg text-[13px] font-medium transition-all duration-200 group mb-1",
              collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3.5 py-2.5"
            )}
            style={{ color: '#64748b' }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#f8fafc'
              e.currentTarget.style.color = '#0f172a'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#64748b'
            }}
          >
            {collapsed
              ? <ChevronsRight size={18} className="flex-shrink-0" />
              : <ChevronsLeft size={18} className="flex-shrink-0" />
            }
            {!collapsed && <span>Collapse</span>}
          </button>

          {/* Sign Out */}
          <button
            className={clsx(
              "flex items-center w-full rounded-lg text-[13px] font-medium transition-all duration-200 group",
              collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3.5 py-2.5"
            )}
            onClick={handleLogout}
            title={collapsed ? 'Sign Out' : undefined}
            style={{ color: '#64748b' }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#fef2f2'
              e.currentTarget.style.color = '#ef4444'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#64748b'
            }}
          >
            <LogOut size={18} className="flex-shrink-0 group-hover:-translate-x-0.5 transition-transform" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        className="flex-1 p-8 min-h-screen relative z-10"
        style={{ marginLeft: sidebarWidth, transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
      >
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
      <AddShipmentModal />
      <SOSListener />
      <GlobalDeliveryCelebration />
    </div>
  )
}
