import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Package, Search, LogOut, ShieldCheck } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

export default function VendorLayout() {
  const [vendorProfile, setVendorProfile] = useState<any>(null)
  const userId = useAuthStore(s => s.userId)
  const session = useAuthStore(s => s.session)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!userId) {
      setVendorProfile(null)
      return
    }

    const loadProfile = async () => {
      try {
        let profileData: any = {
          id: userId,
          company_name: 'New Vendor (Pending Setup)',
          city: ''
        }

        const { data: rawProfile, error } = await supabase
          .from('vendor_profiles')
          .select('id, company_name, city, dummy2')
          .eq('id', userId)
          .maybeSingle()
          
        const { data: kycProfile } = await supabase
          .from('kyc_profiles')
          .select('kyc_status')
          .eq('id', userId)
          .maybeSingle()
        
        if (rawProfile) {
          profileData = { ...profileData, ...rawProfile }
          if (rawProfile.dummy2) {
            try {
              const parsed = typeof rawProfile.dummy2 === 'string' ? JSON.parse(rawProfile.dummy2) : rawProfile.dummy2
              profileData.kycStatus = (parsed.status || 'pending').toLowerCase()
            } catch(e) {}
          } else {
            profileData.kycStatus = 'pending'
          }
        } else {
          profileData.kycStatus = 'pending'
        }
        
        // Override with dedicated KYC table if it exists
        if (kycProfile && kycProfile.kyc_status) {
          profileData.kycStatus = kycProfile.kyc_status.toLowerCase()
        }

        setVendorProfile(profileData)
      } catch (err) {
        console.error('Error fetching vendor layout profile:', err)
      }
    }
    loadProfile()
  }, [userId])

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error(e)
    }
    clearAuth()
    navigate('/login')
  }

  const requireAuth = (action: () => void) => {
    if (!session) {
      toast('Please log in to continue.', { icon: '🔒' })
      navigate('/vendor/login')
      return
    }
    action()
  }

  return (
    <div className="min-h-screen bg-bg text-text font-sans flex flex-col relative overflow-hidden">
      <div className="bg-mesh opacity-20 absolute inset-0 pointer-events-none" />

      {/* Modern Top Nav */}
      <header className="relative z-50 bg-surface/80 backdrop-blur-xl border-b border-border sticky top-0">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-12 h-20 flex items-center justify-between">
          <div className="flex items-center gap-12">
            {/* Logo */}
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/vendor')}>
              <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(79,172,254,0.4)]">
                <Package className="text-white" size={20} />
              </div>
              <div>
                <h1 className="text-2xl font-display font-black text-text tracking-tighter uppercase leading-none">
                  ROUTE<span className="text-primary">IQ</span>
                </h1>
                <span className="text-primary text-[10px] font-bold uppercase tracking-[0.2em]">Marketplace</span>
              </div>
            </div>
            
            {/* Desktop Navigation Links */}
            <nav className="hidden lg:flex items-center gap-8">
              <button 
                onClick={() => navigate('/vendor')} 
                className={`text-sm font-bold transition-colors ${location.pathname === '/vendor' ? 'text-primary hover:text-primary-dark' : 'text-muted hover:text-text'}`}
              >
                Discover
              </button>
              <button 
                onClick={() => requireAuth(() => navigate('/vendor/tracking'))} 
                className={`text-sm font-bold transition-colors ${location.pathname === '/vendor/tracking' ? 'text-primary hover:text-primary-dark' : 'text-muted hover:text-text'}`}
              >
                Tracking
              </button>
              <button 
                onClick={() => requireAuth(() => navigate('/vendor/shipments'))} 
                className={`text-sm font-bold transition-colors ${location.pathname === '/vendor/shipments' ? 'text-primary hover:text-primary-dark' : 'text-muted hover:text-text'}`}
              >
                My Shipments
              </button>
              <button 
                onClick={() => requireAuth(() => navigate('/vendor/corridor'))} 
                className={`text-sm font-bold transition-colors ${location.pathname === '/vendor/corridor' ? 'text-primary hover:text-primary-dark' : 'text-muted hover:text-text'}`}
              >
                Corridors
              </button>
              <button 
                onClick={() => requireAuth(() => navigate('/vendor/documents'))} 
                className={`text-sm font-bold transition-colors relative ${location.pathname === '/vendor/documents' ? 'text-primary hover:text-primary-dark' : 'text-muted hover:text-text'}`}
              >
                Documents
                {vendorProfile && vendorProfile.kycStatus?.toLowerCase() !== 'approved' && (
                  <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                )}
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-6">
            <button className="text-muted hover:text-text transition-colors">
              <Search size={20} />
            </button>
            <div className="flex items-center gap-4 border-l border-border pl-6">
              {vendorProfile && (
                <div className="hidden md:flex flex-col items-end cursor-pointer group" onClick={() => navigate('/vendor/documents')} title="View Documents & Profile">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-primary" />
                    <span className="text-sm font-bold text-text uppercase tracking-tight group-hover:text-primary transition-colors">{vendorProfile.company_name}</span>
                  </div>
                  <span className="text-[10px] text-muted font-mono uppercase tracking-widest flex items-center gap-1">
                    Verified Vendor <span className="w-1 h-1 rounded-full bg-primary mx-1" /> {vendorProfile.city || 'Profile'}
                  </span>
                </div>
              )}
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent p-[2px] cursor-pointer hover:scale-105 transition-transform shadow-lg shadow-primary/20" onClick={handleLogout} title="Logout">
                <div className="w-full h-full bg-surface rounded-full flex items-center justify-center">
                   <LogOut size={18} className="text-text" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex flex-col w-full">
        <Outlet context={{ vendorProfile }} />
      </div>
    </div>
  )
}
