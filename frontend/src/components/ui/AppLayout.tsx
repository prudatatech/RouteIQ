import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Truck, Map, BarChart3, Zap,
  LogOut, Shield, Brain, Package, Network, ExternalLink, Briefcase, ShieldAlert, Building2
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import clsx from 'clsx'
import AddShipmentModal from '@/components/modals/AddShipmentModal'
import SOSListener from '@/components/SOSListener'
import { useState, useEffect } from 'react'

interface NavItem {
  to: string
  icon: any
  label: string
  roles?: string[]
  badge?: number
  external?: boolean
}

const navItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Control Tower', roles: ['admin', 'superadmin'] },
  { to: '/shipments', icon: Package, label: 'Cargo Manifest', roles: ['admin', 'superadmin'] },
  { to: '/fleet', icon: Truck, label: 'Fleet Assets', roles: ['admin', 'superadmin'] },
  { to: '/routes', icon: Map, label: 'Route Grid', roles: ['admin', 'superadmin'] },
  { to: '/emergency', icon: ShieldAlert, label: 'Emergency Alerts', roles: ['admin', 'superadmin'] },
  { to: '/optimize', icon: Zap, label: 'Neural Reroute', roles: ['admin', 'superadmin'] },
  { to: '/capacity-bidding', icon: Briefcase, label: 'Capacity Bidding', roles: ['admin', 'superadmin'] },
  { to: '/vendor', icon: Package, label: 'Vendor Portal', roles: ['vendor'] },
  { to: '/analytics', icon: BarChart3, label: 'Intel Dashboard', roles: ['admin', 'superadmin'] },
  { to: '/ai-hub', icon: Brain, label: 'Nexus AI Hub', roles: ['admin', 'superadmin'] },
  { to: '/cargo-network', icon: Network, label: 'Cargo Network', roles: ['admin', 'superadmin'] },
  { to: '/track', icon: Shield, label: 'Tracking Portal', external: true },
  { to: '/superadmin', icon: Shield, label: 'Superadmin', roles: ['superadmin'] },
  { to: '/3pl-network', icon: Building2, label: '3PL Network', roles: ['superadmin'] },
]

export default function AppLayout() {
  const clearAuth = useAuthStore(s => s.clearAuth)
  const role = useAuthStore(s => s.role)
  const navigate = useNavigate()
  const [vendorBadge, setVendorBadge] = useState(0)
  const [tplBadge, setTplBadge] = useState(0)

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
        setVendorBadge(data.length)
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
    <div className="flex min-h-screen bg-bg text-text">
      <div className="bg-mesh" />
      <div className="bg-grid opacity-20" />

      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-[260px] bg-surface border-r border-border flex flex-col z-[100] shadow-2xl shadow-black/5 overflow-hidden">
        {/* Logo */}
        <div className="px-6 py-5 flex-shrink-0 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary-dark rounded-xl flex items-center justify-center shadow-lg shadow-primary/20 flex-shrink-0">
              <div className="text-bg font-display font-black text-lg">RI</div>
            </div>
            <div>
              <div className="font-display font-black text-base text-text tracking-tight uppercase leading-tight">
                margixindia
              </div>
              <div className="font-display font-bold text-[9px] text-primary uppercase tracking-[0.12em]">
                by Prudata
              </div>
            </div>
          </div>
        </div>

        {/* Nav — scrollable so all items always visible */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1">
          {navItems
            .filter(item => !item.roles || item.roles.includes(role || ''))
            .map(({ to, icon: Icon, label, external }) => {
              // Compute badge for this nav item
              const itemBadge = (to === '/dashboard' && vendorBadge > 0) ? vendorBadge : 
                                (to === '/3pl-network' && tplBadge > 0) ? tplBadge : undefined
              if (external) {
                return (
                  <button
                    key={to}
                    onClick={() => window.open(to, '_blank')}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm transition-all relative group text-muted hover:text-text hover:bg-surface2"
                  >
                    <Icon size={18} className="text-muted group-hover:text-primary-dark transition-all duration-300 flex-shrink-0" />
                    <span className="flex-1 tracking-tight text-left">{label}</span>
                    <ExternalLink size={12} className="text-muted opacity-50" />
                  </button>
                )
              }
              return (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all relative group overflow-hidden',
                    isActive ? 'text-text font-bold bg-primary/10 shadow-sm shadow-primary/5' : 'text-muted hover:text-text hover:bg-surface2'
                  )}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <div className="absolute left-0 top-2 bottom-2 w-1 bg-primary rounded-r-full" />
                      )}
                      <Icon size={18} className={clsx('transition-all duration-300 flex-shrink-0', isActive ? 'text-primary scale-110' : 'text-muted group-hover:text-primary-dark')} />
                      <span className="flex-1 tracking-tight">{label}</span>
                      {itemBadge && (
                        <span className="bg-yellow-400 text-slate-900 text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                          {itemBadge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              )
            })
          }
        </nav>

        {/* Bottom: Sign Out */}
        <div className="px-4 pb-4 pt-2 border-t border-border flex-shrink-0">
          <button
            className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold text-muted hover:text-error hover:bg-error/10 transition-all group"
            onClick={handleLogout}
          >
            <LogOut size={18} className="group-hover:-translate-x-1 transition-transform" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-[260px] flex-1 p-8 min-h-screen relative z-10">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
      <AddShipmentModal />
      <SOSListener />
    </div>
  )
}
