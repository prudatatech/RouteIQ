import { useEffect, useState } from 'react'
import { Package, Search, PlusCircle, XCircle, ArrowRight, Zap, TrendingUp, LogOut, MapPin, Loader2 } from 'lucide-react'
import { supabase } from '@/services/supabase'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import { formatEta } from '@/utils/timeFormat'

export default function VendorPortalPage() {
  const [windows, setWindows] = useState<any[]>([])
  const [myBids, setMyBids] = useState<any[]>([])
  const [showBidModal, setShowBidModal] = useState(false)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [selectedWindow, setSelectedWindow] = useState<any>(null)
  const [myRequests, setMyRequests] = useState<any[]>([])
  const [passingRoutes, setPassingRoutes] = useState<any[]>([])
  const [vendorProfile, setVendorProfile] = useState<any>(null)
  
  // Bid Form
  const [bidAmount, setBidAmount] = useState('')
  const [ewayBill, setEwayBill] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [loadConfig, setLoadConfig] = useState('Loose Cartons')
  const [upcomingStops, setUpcomingStops] = useState<any[]>([])

  // Mapbox Search State
  const [searchTerm, setSearchTerm] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedDestination, setSelectedDestination] = useState<any>(null)

  
  // Request Form
  const [reqPickup, setReqPickup] = useState('')
  const [reqPickupLat, setReqPickupLat] = useState('')
  const [reqPickupLng, setReqPickupLng] = useState('')
  const [reqDrop, setReqDrop] = useState('')
  const [reqDropLat, setReqDropLat] = useState('')
  const [reqDropLng, setReqDropLng] = useState('')
  const [reqCapacity, setReqCapacity] = useState('')
  const userId = useAuthStore(s => s.userId)
  const session = useAuthStore(s => s.session)
  const navigate = useNavigate()

  // Mapbox search effect
  useEffect(() => {
    const searchMapbox = async () => {
      if (!searchTerm || searchTerm.length < 3 || selectedDestination?.name === searchTerm) {
        setSuggestions([])
        return
      }
      setIsSearching(true)
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchTerm)}.json?country=in&types=place,locality,address&limit=5&access_token=${token}`)
        const data = await res.json()
        setSuggestions(data.features || [])
      } catch (e) {
        console.error(e)
      } finally {
        setIsSearching(false)
      }
    }
    const timer = setTimeout(searchMapbox, 500)
    return () => clearTimeout(timer)
  }, [searchTerm, selectedDestination])

  useEffect(() => {
    fetchData()

    // Realtime Subscriptions
    const subW = supabase.channel('vendor_windows')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_windows' }, fetchData)
      .subscribe()
      
      const subB = supabase.channel('vendor_bids')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_bids' }, fetchData)
      .subscribe()

      const subV = supabase.channel('vendor_vehicles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, fetchData)
      .subscribe()

    return () => {
      supabase.removeChannel(subW)
      supabase.removeChannel(subB)
      supabase.removeChannel(subV)
    }
  }, [userId])

  const fetchData = async () => {
    if (!userId) return

    let profileData = null;
    try {
      const pRes = await fetch('/api/v1/vendor/profile', {
        headers: { 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` }
      });
      if (pRes.ok) {
        profileData = await pRes.json();
      }
    } catch (e) {
      console.warn('Profile fetch error:', e)
    }

    if (!profileData) {
      profileData = {
        id: userId,
        company_name: 'Apex Logistics & Freight',
        gst_number: '27AABCU9603R1ZM',
        city: 'Mumbai',
        address: 'Plot 42, MIDC Industrial Area, Andheri East, Mumbai 400093'
      };
    }
    setVendorProfile(profileData);

    const [resW, resB, resR, resP] = await Promise.all([
      supabase.from('capacity_windows').select('*, vehicles(plate_number, available_capacity_kg, vehicle_type)').gt('closes_at', new Date().toISOString()).is('winning_bid_id', null).order('opens_at', { ascending: false }),
      supabase.from('capacity_bids').select('*, capacity_windows!capacity_bids_window_id_fkey(trigger_type, vehicles(plate_number, vehicle_type))').eq('vendor_id', profileData?.id || userId).order('submitted_at', { ascending: false }),
      supabase.from('vendor_shipment_requests').select('*').eq('vendor_id', profileData?.id || userId).order('created_at', { ascending: false }),
      fetch('/api/v1/vendor/passing-routes', { headers: { 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` } }).then(r => r.json().catch(() => []))
    ])
    
    if (resW.data) setWindows(resW.data)
    if (resB.data) setMyBids(resB.data)
    if (resR.data) setMyRequests(resR.data)
    if (Array.isArray(resP)) setPassingRoutes(resP)
  }

  const openBidModal = async (w: any) => {
    setSelectedWindow(w)
    setShowBidModal(true)
    setUpcomingStops([])
    try {
      const res = await fetch(`/api/v1/capacity/windows/${w.id}/upcoming-stops`, {
        headers: { 'Authorization': `Bearer ${useAuthStore.getState().token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setUpcomingStops(data)
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(`Error loading stops: ${err.error || res.statusText}. Please log out and log back in if your session expired.`)
      }
    } catch (err: any) {
      toast.error(`Network error loading stops: ${err.message}`)
    }
  }

  const handleBidSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedWindow || !bidAmount || !ewayBill || !selectedDestination) return

    try {
      const res = await fetch('/api/v1/capacity/bids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().token}`
        },
        body: JSON.stringify({
          vendor_id: userId,
          window_id: selectedWindow.id,
          bid_amount: Number(bidAmount),
          eway_bill_ref: ewayBill,
          dropoff_name: selectedDestination.name,
          dropoff_address: selectedDestination.address,
          dropoff_lat: selectedDestination.lat,
          dropoff_lng: selectedDestination.lng,
          weight_kg: Number(weightKg),
          load_configuration: loadConfig
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to submit bid')
      }

      const newBid = await res.json()
      
      toast.success('Bid placed successfully!')
      setShowBidModal(false)
      setBidAmount('')
      setEwayBill('')
      setSearchTerm('')
      setSelectedDestination(null)
      setLoadConfig('Loose Cartons')
      
      // Instantly update local state to reflect bid
      setMyBids(prev => [newBid, ...prev])
      
      // Refresh windows to trigger UI changes if needed
      fetchData()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reqPickup || !reqDrop || !reqCapacity) return

    try {
      const res = await fetch('/api/v1/vendor/shipment-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          pickup: { address: reqPickup, lat: parseFloat(reqPickupLat) || 0, lng: parseFloat(reqPickupLng) || 0 },
          drop: { address: reqDrop, lat: parseFloat(reqDropLat) || 0, lng: parseFloat(reqDropLng) || 0 },
          capacity: Number(reqCapacity)
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to submit request')
      }

      toast.success('Shipment request sent to admin!', { icon: '🚛' })
      setShowRequestModal(false)
      setReqPickup('')
      setReqDrop('')
      setReqCapacity('')
      fetchData()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    useAuthStore.getState().setSession(null)
    navigate('/login')
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <span className="bg-orange-50 text-orange-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-orange-200">⏳ Pending</span>
      case 'approved': return <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-blue-200">✓ Approved</span>
      case 'assigned': return <span className="bg-yellow-50 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-yellow-300">🚛 Vehicle Assigned</span>
      case 'won': return <span className="bg-green-50 text-green-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-green-200">Awarded</span>
      case 'lost': return <span className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-red-200">Lost</span>
      default: return <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-gray-200">{status}</span>
    }
  }

  const getTriggerLabel = (trigger: string) => {
    if (trigger === 'mid_route') {
      return <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-primary/20 flex items-center gap-1"><Zap size={10} /> Mid-Route Fill</span>
    }
    return <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-blue-200 flex items-center gap-1"><TrendingUp size={10} /> Empty Return</span>
  }

  return (
    <div className="min-h-screen bg-bg text-text font-sans selection:bg-primary/20 selection:text-primary pb-20 relative overflow-hidden">
      {/* Background Decor */}
      <div className="bg-mesh" />
      <div className="bg-grid" />

      {/* Header */}
      <header className="relative z-10 border-b border-border bg-surface/50 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              <Package className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-xl font-display font-black text-text tracking-tight uppercase leading-none">
                RouteIQ
              </h1>
              <span className="text-primary text-xs font-bold uppercase tracking-widest">Exchange</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {vendorProfile && (
              <div className="hidden md:flex flex-col items-end mr-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-text uppercase tracking-tight">{vendorProfile.company_name}</span>
                  <span className="bg-primary/10 text-primary text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-primary/20">
                    VND-{vendorProfile.id?.slice(0, 8).toUpperCase()}
                  </span>
                </div>
                <span className="text-[10px] text-muted font-mono uppercase tracking-widest flex items-center gap-1">
                  <MapPin size={10} /> {vendorProfile.city} <span className="opacity-50 mx-1">|</span> GST: {vendorProfile.gst_number}
                </span>
                <span className="text-[9px] text-muted mt-0.5 max-w-[220px] truncate">{vendorProfile.address || 'No address set'}</span>
              </div>
            )}
            <button 
              onClick={() => navigate('/vendor/onboarding')} 
              className="bg-surface2 hover:bg-surface border border-border text-text px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              title="Edit Profile & Registered Address"
            >
              <MapPin size={14} className="text-primary" /> Update Address
            </button>
            <button onClick={handleLogout} className="text-muted hover:text-text transition-colors flex items-center gap-2 text-sm font-bold">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-12 space-y-12">
        {/* Welcome Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-4xl md:text-5xl font-display font-black tracking-tight mb-4">
              Live <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">Capacity Markets</span>
            </h2>
            <p className="text-muted text-lg max-w-2xl">
              Real-time backhaul and mid-route opportunities. Bid competitively to secure empty space from our returning fleet.
            </p>
          </div>
          <button onClick={() => navigate('/vendor/request')} className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-primary/20">
                <PlusCircle size={18} /> New Shipment Request
              </button>
        </div>

        {/* Vendor Profile & Registered Address Card */}
        {vendorProfile && (
          <div className="glass-card rounded-2xl p-6 border-primary/20 bg-primary/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="space-y-2 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="bg-primary text-white font-mono text-xs font-bold px-3 py-1 rounded-lg uppercase tracking-wider shadow-sm">
                  Vendor ID: VND-{vendorProfile.id?.slice(0, 8).toUpperCase()}
                </span>
                <span className="text-xs text-muted font-mono bg-surface2 px-2.5 py-1 rounded-md border border-border">
                  DB Ref: {vendorProfile.id}
                </span>
                <span className="bg-surface2 text-text px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border border-border">
                  GST: {vendorProfile.gst_number || 'N/A'}
                </span>
              </div>

              <div className="text-xl font-bold text-text flex items-center gap-2">
                {vendorProfile.company_name === 'New Vendor (Pending Setup)' || vendorProfile.company_name.includes('Enterprise') ? session?.user?.email || 'Vendor' : vendorProfile.company_name}
                <span className="text-xs font-normal text-muted font-mono">({vendorProfile.city})</span>
              </div>

              <div className="text-sm text-muted flex items-start gap-1.5 pt-1">
                <MapPin size={16} className="text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-text font-bold">Registered Address:</strong> {vendorProfile.address || 'No address configured. Click Update Address below to set your warehouse address.'}
                </span>
              </div>
            </div>

            <div className="shrink-0 flex gap-3">
              <button
                onClick={() => navigate('/vendor/onboarding')}
                className="bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center gap-2"
              >
                <MapPin size={16} /> Edit Address / Profile
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Active Markets */}
          <div className="lg:col-span-8 space-y-8">
            
            {/* Passing Trucks Section */}
            {passingRoutes.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center gap-2 text-primary">
                    <MapPin size={20} /> Passing Trucks Near You
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-xs font-bold text-primary uppercase tracking-widest">Route Match</span>
                  </div>
                </div>

                {passingRoutes.map(pr => (
                  <div key={pr.id} className="group glass-card border-primary/30 hover:border-primary rounded-2xl p-6 transition-all relative overflow-hidden bg-primary/5">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                      <div className="space-y-3 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-primary/30 flex items-center gap-1">
                            <Zap size={10} /> Route Match
                          </span>
                          <span className="bg-surface2 text-text px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border border-border">
                            {pr.routes?.vehicles?.vehicle_type || 'Truck'}
                          </span>
                          <span className="text-xs text-muted font-mono bg-surface2 px-2 py-0.5 rounded border border-border">
                            {pr.routes?.vehicles?.plate_number}
                          </span>
                        </div>
                        
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-display font-black tracking-tight text-text">{pr.available_capacity_kg}</span>
                          <span className="text-primary font-bold">KG AVAILABLE</span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-sm text-muted">
                          <span className="font-bold text-text">ETA:</span> ~{formatEta(pr.eta_minutes)} to your area
                        </div>
                      </div>
                      
                      <div className="w-full md:w-auto shrink-0 flex flex-col gap-2">
                        <button 
                          onClick={() => {
                            setReqCapacity(pr.available_capacity_kg.toString());
                            setShowRequestModal(true);
                          }}
                          className="bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-primary/20 transition-all active:scale-95 flex items-center justify-center gap-2 w-full md:w-auto"
                        >
                          Add Cargo <ArrowRight size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Bidding Market */}
            <div className="space-y-6">
              <h3 className="text-xl font-bold flex items-center gap-2 text-text mt-4">
                <Search size={20} className="text-primary" /> Open Bid Markets
              </h3>
              <div className="flex items-center gap-2 mt-4">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-bold text-muted uppercase tracking-widest">Live Updates</span>
              </div>
            </div>

            <div className="space-y-4">
              {windows.length === 0 && (
                <div className="glass-card rounded-2xl p-12 text-center">
                  <div className="w-16 h-16 bg-surface2 rounded-full flex items-center justify-center mx-auto mb-4 border border-border">
                    <Package size={24} className="text-muted" />
                  </div>
                  <h4 className="text-lg font-bold text-text mb-2">Market Quiet</h4>
                  <p className="text-muted">No open bid windows currently broadcasting.</p>
                </div>
              )}

              
              {windows.map(w => {
                const alreadyBid = myBids.find(b => b.window_id === w.id)
                const matchingRoute = passingRoutes.find(pr => pr.routes?.vehicle_id === w.vehicle_id)
                const eta = matchingRoute ? matchingRoute.eta_minutes : null;

                return (
                  <div key={w.id} className="group glass-card hover:border-primary/50 rounded-2xl p-6 transition-all relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                      <div className="space-y-4 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          {getTriggerLabel(w.trigger_type)}
                          <span className="bg-surface2 text-text px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border border-border">{w.vehicles?.vehicle_type || 'Truck'}</span>
                          <span className="text-xs text-muted font-mono bg-surface2 px-2 py-0.5 rounded border border-border">{w.vehicles?.plate_number}</span>
                          {eta !== null && (
                            <span className="bg-primary/10 text-primary px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border border-primary/20">
                              ETA: ~{formatEta(eta)}
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-display font-black tracking-tight text-text">{w.vehicles?.available_capacity_kg}</span>
                          <span className="text-primary font-bold">KG AVAILABLE</span>
                        </div>
                      </div>
                      
                      <div className="w-full md:w-auto bg-surface2 rounded-xl p-4 border border-border flex flex-col gap-3 min-w-[200px]">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted font-medium">Floor Price</span>
                          <span className="text-text font-mono font-bold">₹{w.floor_price}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted font-medium">Closes At</span>
                          <span className="text-error font-mono font-bold animate-pulse">{new Date(w.closes_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        </div>
                        
                        <div className="pt-3 border-t border-border">
                          {alreadyBid ? (
                            <div className="w-full bg-primary/10 text-primary py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 border border-primary/20">
                              Bid Active
                            </div>
                          ) : (
                            <button 
                              onClick={() => openBidModal(w)}
                              className="w-full bg-primary hover:bg-primary-dark text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20 group-hover:shadow-primary/40"
                            >
                              Place Bid <ArrowRight size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Your Portfolio */}
          <div className="lg:col-span-4 space-y-6">
            <h3 className="text-xl font-bold flex items-center gap-2 text-text">
              <Package size={20} className="text-primary" /> Your Bids
            </h3>
            
            <div className="glass-card rounded-2xl p-4 space-y-3 max-h-[800px] overflow-y-auto custom-scrollbar">
              {myBids.length === 0 && (
                <div className="text-center py-8 text-muted text-sm border-2 border-dashed border-border rounded-xl">
                  Your bid history is empty.
                </div>
              )}
              
              {myBids.map(b => (
                  <div key={b.id} className="bg-surface2 border border-border hover:border-border-bright rounded-xl p-4 transition-colors">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="text-xs text-muted mb-1">{new Date(b.submitted_at).toLocaleDateString()}</div>
                        <div className="font-bold text-text text-lg font-mono">₹{b.bid_amount}</div>
                      </div>
                      <div>{getStatusBadge(b.status)}</div>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-3">
                      {getTriggerLabel(b.capacity_windows?.trigger_type)}
                      <span className="text-xs text-muted font-mono">{b.capacity_windows?.vehicles?.plate_number}</span>
                    </div>

                    <div className="text-[10px] text-muted uppercase tracking-widest font-mono bg-surface border border-border px-2 py-1 rounded inline-block">
                      EWB: {b.eway_bill_ref}
                    </div>
                  </div>
              ))}
            </div>

            <h3 className="text-xl font-bold flex items-center gap-2 text-text mt-8">
              <PlusCircle size={20} className="text-primary" /> Your Requests
            </h3>
            
            <div className="glass-card rounded-2xl p-4 space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
              {myRequests.length === 0 && (
                <div className="text-center py-8 text-muted text-sm border-2 border-dashed border-border rounded-xl">
                  No custom requests submitted.
                </div>
              )}
              
              {myRequests.map(r => (
                  <div key={r.id} className="bg-surface2 border border-border hover:border-border-bright rounded-xl p-4 transition-colors">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="text-xs text-muted mb-1">{new Date(r.created_at).toLocaleDateString()}</div>
                        <div className="font-bold text-text text-sm flex items-center gap-1">
                          {r.pickup_location.split(',')[0]} <ArrowRight size={12} className="text-primary" /> {r.drop_location.split(',')[0]}
                        </div>
                      </div>
                      <div>{getStatusBadge(r.status)}</div>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-text font-mono font-bold bg-primary/10 text-primary px-2 py-1 rounded">
                        {r.required_capacity_kg} KG
                      </span>
                    </div>
                  </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Bid Modal */}
      {showBidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-text/20 backdrop-blur-sm" onClick={() => setShowBidModal(false)} />
          
          <div className="relative bg-surface border border-border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl transform transition-all animate-fade-in">
            <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-surface2">
              <h2 className="font-display font-black text-xl text-text uppercase tracking-tight flex items-center gap-2">
                <Zap className="text-primary" size={20} /> Submit Binding Bid
              </h2>
              <button onClick={() => setShowBidModal(false)} className="text-muted hover:text-text transition-colors"><XCircle size={24} /></button>
            </div>
            
            <form onSubmit={handleBidSubmit} className="p-6 space-y-6">
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6">
                <div className="text-xs text-primary font-bold uppercase tracking-widest mb-1">Target Capacity</div>
                <div className="text-2xl font-display font-black text-text">{selectedWindow?.vehicles?.available_capacity_kg} KG</div>
                <div className="text-sm text-muted mt-1 font-mono">Vehicle: {selectedWindow?.vehicles?.plate_number}</div>
              </div>

              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2 flex justify-between">
                  <span>Bid Amount (₹)</span>
                  <span className="text-primary">Min: ₹{selectedWindow?.floor_price}</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-lg">₹</span>
                  <input 
                    type="number" 
                    required
                    min={selectedWindow?.floor_price}
                    value={bidAmount}
                    onChange={e => setBidAmount(e.target.value)}
                    className="w-full bg-surface2 border border-border focus:border-primary rounded-xl pl-10 pr-4 py-3 text-text font-mono text-lg focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="relative">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">
                  Drop-off Destination <span className="text-error">*</span>
                </label>
                <div className="relative">
                  <input 
                    type="text"
                    required
                    value={searchTerm}
                    onChange={e => {
                      setSearchTerm(e.target.value)
                      if (selectedDestination) setSelectedDestination(null)
                    }}
                    placeholder="Search any location in India..."
                    className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all pr-10"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 size={16} className="animate-spin text-primary" />
                    </div>
                  )}
                </div>
                
                {suggestions.length > 0 && !selectedDestination && (
                  <div className="absolute z-50 w-full mt-2 bg-surface2 border border-border rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                    {suggestions.map((f: any) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setSelectedDestination({
                            name: f.text,
                            address: f.place_name,
                            lat: f.center[1],
                            lng: f.center[0]
                          })
                          setSearchTerm(f.place_name)
                          setSuggestions([])
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-bg border-b border-border/50 last:border-0 transition-colors"
                      >
                        <div className="font-bold text-text text-sm">{f.text}</div>
                        <div className="text-[10px] text-muted truncate">{f.place_name}</div>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-primary mt-2 font-bold uppercase tracking-wider flex items-center gap-1">
                  <MapPin size={10} /> PAN-India Delivery Network Active
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">
                  E-Way Bill Ref <span className="text-error">*</span>
                </label>
                <input 
                  type="text" 
                  required
                  value={ewayBill}
                  onChange={e => setEwayBill(e.target.value)}
                  className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary transition-all uppercase"
                  placeholder="EWB-XXXXXXXXX"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">
                    Total Weight (KG) <span className="text-error">*</span>
                  </label>
                  <input 
                    type="number" 
                    required
                    value={weightKg}
                    onChange={e => setWeightKg(e.target.value)}
                    className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                    placeholder="e.g. 500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">
                    Load Config <span className="text-error">*</span>
                  </label>
                  <select 
                    required
                    value={loadConfig}
                    onChange={e => setLoadConfig(e.target.value)}
                    className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                  >
                    <option value="Loose Cartons">Loose Cartons</option>
                    <option value="Palletized">Palletized</option>
                    <option value="Fragile">Fragile / Special</option>
                    <option value="IBC Totes">IBC Totes</option>
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-error mt-2 font-bold uppercase tracking-wider">Compliance Gate: Must provide valid EWB.</p>
              
              <div className="pt-6 flex justify-end gap-3 border-t border-border">
                <button type="button" onClick={() => setShowBidModal(false)} className="px-5 py-3 rounded-xl font-bold text-muted hover:text-text hover:bg-surface2 transition-colors border border-transparent hover:border-border">Cancel</button>
                <button type="submit" className="bg-primary hover:bg-primary-dark text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-primary/20 transition-all active:scale-95">Confirm Bid</button>
              </div>
            </form>
          </div>
        </div>
      )}


    </div>
  )
}
