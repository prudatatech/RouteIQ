import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3, Building2, Gavel, IndianRupee, LayoutDashboard, MapPin, MapPinned, Package, PackageCheck, Route, Search,
  ShieldAlert, Truck, Waypoints, ArrowRight, CheckCircle2, Sparkles, Clock, ShieldCheck, Menu, X, Zap,
  Navigation, Activity, Phone, ChevronRight, type LucideIcon,
} from 'lucide-react'
import { buttonClasses } from '@/components/ui'
import { publicAPI, type PublicStats } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import clsx from 'clsx'

interface Audience {
  icon: LucideIcon
  title: string
  description: string
  tag: string
  highlights: string[]
  action: { to: string; label: string }
  secondary?: { to: string; label: string }
}

// One primary action per audience. Every line describes something the app does today.
const audiences: Audience[] = [
  {
    icon: LayoutDashboard,
    title: 'Operations teams',
    tag: 'Enterprise Control',
    description: 'Create shipments, assign vehicles, plan and optimize trips, follow the fleet on a live map and respond to driver SOS alerts.',
    highlights: ['Multi-stop route optimizer', 'Live GPS fleet telemetry', 'Driver SOS incident response'],
    action: { to: '/login', label: 'Sign in' },
  },
  {
    icon: Package,
    title: 'Vendors',
    tag: 'Shippers & Cargo',
    description: 'Post a load or bid on spare truck space on return trips, then follow your loads until they are delivered.',
    highlights: ['Instant lane price intelligence', 'Zero broker commission', 'Verified carrier capacity'],
    action: { to: '/vendor/request', label: 'Post a load' },
    secondary: { to: '/login', label: 'Sign in or create an account' },
  },
  {
    icon: Building2,
    title: '3PL partners',
    tag: 'Fleet & Carriers',
    description: 'Apply online with your company details, documents and the corridors you serve. Once approved, manage your coverage and documents from your partner dashboard.',
    highlights: ['Direct shipper contracts', 'Return-trip empty mile fill', 'Guaranteed direct settlements'],
    action: { to: '/3pl/onboard', label: 'Apply as a partner' },
    secondary: { to: '/3pl/onboard/track', label: 'Check your application' },
  },
  {
    icon: MapPin,
    title: 'Customers',
    tag: 'Public Tracking',
    description: 'Have a tracking ID? See where your shipment is and when it is expected.',
    highlights: ['Real-time vehicle position', 'Milestone checkpoint alerts', 'Digital proof of delivery'],
    action: { to: '/track', label: 'Track a shipment' },
  },
]

const features: { icon: LucideIcon; title: string; category: string; description: string }[] = [
  { icon: Package, title: 'Shipments', category: 'Dispatch', description: 'Create shipments with trip, cargo and vehicle, and see the status of every one.' },
  { icon: MapPinned, title: 'Live map', category: 'Telemetry', description: 'See where each vehicle is, from the location its driver shares.' },
  { icon: Route, title: 'Trip optimization', category: 'Routing', description: 'Work out the best order of stops for a trip before you dispatch it.' },
  { icon: Gavel, title: 'Bids', category: 'Capacity', description: 'Offer spare truck capacity to vendors and approve the bids you accept.' },
  { icon: Waypoints, title: 'Return trips', category: 'Efficiency', description: 'Fill empty return trips with loads going the same way.' },
  { icon: ShieldAlert, title: 'Emergencies', category: 'Safety', description: 'Driver SOS alerts arrive with the vehicle and its location.' },
  { icon: Truck, title: 'Driver app', category: 'Mobile', description: 'Drivers get their trips, share their location and confirm delivery from their phone.' },
  { icon: BarChart3, title: 'Analytics', category: 'Intelligence', description: 'See how your fleet, drivers and vendors are performing.' },
]

// The real steps a load takes, start to finish - no step here is aspirational; each is a feature that exists today.
const howItWorks: { icon: LucideIcon; title: string; stepNumber: string; description: string }[] = [
  { icon: Search, title: 'Post a load', stepNumber: '01', description: 'Enter the pickup, drop and cargo. The platform works out a recommended price range for you.' },
  { icon: IndianRupee, title: 'A company takes it', stepNumber: '02', description: "Any logistic company on the lane can book it at that price, or you take spare capacity on someone else's return trip." },
  { icon: PackageCheck, title: 'Track to delivery', stepNumber: '03', description: 'Follow the vehicle on a live map and get status updates until it is delivered.' },
]

const statLabels: { key: keyof PublicStats; label: string }[] = [
  { key: 'vehicles', label: 'Vehicles on the platform' },
  { key: 'deliveries_completed', label: 'Deliveries completed' },
  { key: 'active_partners', label: 'Active partners' },
  { key: 'cities_served', label: 'Cities served' },
]

/** Live counts from the platform. Only figures above zero are shown; with none, or if they cannot be loaded, the section is left out. */
function LiveNumbers() {
  const { data } = useQuery({ queryKey: ['public-stats'], queryFn: publicAPI.stats, staleTime: 10 * 60_000, retry: false })
  const shown = data ? statLabels.filter(s => data[s.key] > 0) : []
  if (shown.length === 0) return null
  return (
    <section aria-label="Platform in numbers" className="mx-auto -mt-10 relative z-20 max-w-content px-4 pb-6 sm:px-6 sm:pb-8">
      <dl className="grid grid-cols-2 gap-4 sm:gap-6 rounded-card border border-border bg-surface/95 backdrop-blur-md p-6 sm:p-8 shadow-dialog lg:grid-cols-4">
        {shown.map(({ key, label }) => (
          <div key={key} className="flex flex-col justify-center border-l-2 border-brand/60 pl-4 py-1">
            <dd className="text-3xl sm:text-4xl font-extrabold tabular text-text tracking-tight">{data![key].toLocaleString('en-IN')}</dd>
            <dt className="mt-1 text-xs sm:text-sm font-medium text-muted">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  const tplPartnerId = useAuthStore(s => s.tplPartnerId)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [quickTrackId, setQuickTrackId] = useState('')

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const handleQuickTrack = (e: FormEvent) => {
    e.preventDefault()
    if (quickTrackId.trim()) {
      navigate(`/track?id=${encodeURIComponent(quickTrackId.trim())}`)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text selection:bg-brand/20">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0e0e11]/90 backdrop-blur-md transition-all">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-fill">
              <img src="/margix-logo.png" alt="Margix" className="h-8 w-8 shrink-0 object-contain" />
              <span className="text-lg font-bold tracking-tight text-white">
                Margix<span className="text-brand-fill">India</span>
              </span>
            </Link>
            <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold text-white/70">
              <Truck size={12} className="text-brand-fill" /> Freight Operating System
            </span>
          </div>

          <nav aria-label="Main" className="hidden md:flex items-center gap-6 text-sm font-medium text-white/75">
            <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
            <a href="#audiences" className="hover:text-white transition-colors">Solutions</a>
            <a href="#features" className="hover:text-white transition-colors">Console Features</a>
            <Link to="/3pl/onboard" className="hover:text-white transition-colors">Carrier Network</Link>
          </nav>

          <div className="flex items-center gap-3">
            <a href="tel:+9102248901234" className="hidden lg:flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors">
              <Phone size={13} className="text-brand-fill" /> +91 (022) 4890-1234
            </a>
            <div className="hidden lg:block h-4 w-px bg-white/15" />
            <Link to="/track" className="hidden sm:inline-flex text-xs font-semibold text-white/80 hover:text-white transition-colors px-2.5 py-1.5 rounded-control">
              Track a shipment
            </Link>
            <Link
              to="/login"
              className="px-3.5 py-1.5 rounded-control text-xs font-semibold text-white bg-white/10 hover:bg-white/15 border border-white/15 transition-all"
            >
              Sign in
            </Link>
            <Link
              to="/vendor/request"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-control text-xs font-bold text-on-brand bg-brand-fill hover:bg-brand-fill-hover shadow-xs transition-all"
            >
              Post a load <ArrowRight size={13} />
            </Link>

            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden flex h-9 w-9 items-center justify-center rounded-control text-white/80 hover:text-white hover:bg-white/10"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-[#121216] px-4 py-5 space-y-4 animate-fade-in text-sm">
            <div className="flex flex-col gap-2.5 text-white/80 font-medium">
              <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 rounded-control hover:bg-white/5 hover:text-white">How it works</a>
              <a href="#audiences" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 rounded-control hover:bg-white/5 hover:text-white">Solutions & Roles</a>
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 rounded-control hover:bg-white/5 hover:text-white">Console Features</a>
              <Link to="/3pl/onboard" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 rounded-control hover:bg-white/5 hover:text-white">3PL Carrier Program</Link>
              <Link to="/track" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 rounded-control hover:bg-white/5 hover:text-white">Track a shipment</Link>
            </div>
            <div className="pt-3 border-t border-white/10 flex flex-col gap-2">
              <Link to="/vendor/request" className={clsx(buttonClasses({ variant: 'primary', fullWidth: true }), 'justify-center font-bold')}>
                Post a load
              </Link>
              <Link to="/login" className={clsx(buttonClasses({ variant: 'secondary', fullWidth: true }), 'justify-center bg-white/10 text-white border-white/15')}>
                Sign in
              </Link>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-gradient-to-b from-[#0a0a0d] via-[#131318] to-[#0a0a0d] text-white pt-12 pb-20 sm:pt-16 sm:pb-28 lg:pt-20 lg:pb-32">
          {/* Subtle grid pattern & radial accent glow */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-brand-fill/10 blur-[130px] rounded-full pointer-events-none" />

          <div className="relative mx-auto max-w-content px-4 sm:px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
              {/* Left Column: Heading, Subtitle & CTAs */}
              <div className="lg:col-span-7 space-y-6">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-fill/10 border border-brand-fill/25 text-xs font-semibold text-brand-fill tracking-wide shadow-xs">
                  <Sparkles size={13} className="text-brand-fill" />
                  <span>Freight operations platform</span>
                </div>

                <div className="space-y-4">
                  <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.12]">
                    Freight operations, capacity and tracking in one place
                  </h1>
                  <p className="max-w-xl text-base sm:text-lg text-white/75 leading-relaxed">
                    MargixIndia connects your operations team, vendors, 3PL partners and drivers. Plan shipments and trips, fill
                    trucks through bidding and partners, and let everyone see where a load is.
                  </p>
                </div>

                {/* Primary & Secondary Action Buttons */}
                <div className="pt-2">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link
                      to="/vendor/request"
                      className={clsx(
                        buttonClasses({ variant: 'primary', size: 'lg' }),
                        'px-7 py-3.5 font-bold shadow-raised flex items-center justify-center gap-2'
                      )}
                    >
                      Post a load <ArrowRight size={16} />
                    </Link>
                    <Link
                      to="/login"
                      className={clsx(
                        buttonClasses({ variant: 'secondary', size: 'lg' }),
                        'px-7 py-3.5 bg-white/10 hover:bg-white/15 text-white border-white/20 font-semibold justify-center'
                      )}
                    >
                      Sign in
                    </Link>
                  </div>
                  <p className="mt-2.5 text-xs text-white/50">
                    Fill in your load first. You sign in only when you submit.
                  </p>
                </div>

                {/* Quick Consignment Search Input */}
                <div className="pt-3 max-w-md">
                  <form onSubmit={handleQuickTrack} className="flex items-center gap-2 rounded-control bg-white/5 border border-white/15 p-1.5 backdrop-blur-md shadow-xs focus-within:border-brand-fill focus-within:ring-2 focus-within:ring-brand-fill/20 transition-all">
                    <Search size={16} className="text-white/50 ml-2.5 shrink-0" />
                    <input
                      type="text"
                      value={quickTrackId}
                      onChange={e => setQuickTrackId(e.target.value)}
                      placeholder="Enter Tracking ID (e.g. TRK-98124)"
                      className="bg-transparent border-0 text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none flex-1 font-mono uppercase px-1"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-control text-xs font-bold text-white bg-white/15 hover:bg-brand-fill hover:text-on-brand transition-colors shrink-0 cursor-pointer"
                    >
                      Track
                    </button>
                  </form>
                </div>

                {/* Key Platform Trust Anchors */}
                <div className="pt-2 flex flex-wrap items-center gap-5 sm:gap-7 text-xs text-white/60 font-medium">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={15} className="text-brand-fill shrink-0" />
                    <span>Direct Shipper Rates</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={15} className="text-brand-fill shrink-0" />
                    <span>Zero Broker Margin</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={15} className="text-brand-fill shrink-0" />
                    <span>Live GPS Telemetry</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Console Simulator Graphic */}
              <div className="lg:col-span-5">
                <div className="rounded-card border border-white/15 bg-[#17171d]/90 backdrop-blur-xl p-5 sm:p-6 shadow-2xl space-y-5 relative overflow-hidden">
                  {/* Subtle top indicator bar */}
                  <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                      </span>
                      <span className="text-[11px] font-bold tracking-wider text-emerald-400 uppercase">
                        Live Dispatch Console
                      </span>
                    </div>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/70">
                      BOM-DEL Corridor
                    </span>
                  </div>

                  {/* Route Telemetry Visual */}
                  <div className="rounded-control bg-black/40 border border-white/10 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Origin Departure</span>
                        <p className="text-xs font-bold text-white flex items-center gap-1.5">
                          <MapPin size={13} className="text-brand-fill" /> Bhiwandi Terminal, Mumbai
                        </p>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        08:30 AM
                      </span>
                    </div>

                    {/* Progress Track Line */}
                    <div className="relative py-1">
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="w-[68%] h-full bg-gradient-to-r from-brand-fill to-amber-300 rounded-full" />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/50 font-mono">
                        <span>NH-48 Corridor · In Transit (58 km/h)</span>
                        <span className="text-white/80 font-bold">ETA 18h 40m</span>
                      </div>
                    </div>

                    <div className="flex items-start justify-between gap-2 pt-1 border-t border-white/5">
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Destination Hub</span>
                        <p className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Navigation size={13} className="text-amber-400" /> Okhla Industrial Phase III, Delhi
                        </p>
                      </div>
                      <span className="text-[10px] font-mono text-white/60">650 km left</span>
                    </div>
                  </div>

                  {/* Shipment Capacity & Pricing Specs */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-control bg-white/5 border border-white/10 space-y-1">
                      <span className="text-[10px] uppercase font-semibold text-white/40 block">Assigned Fleet</span>
                      <p className="font-bold text-white truncate">32ft Multi-Axle SXL</p>
                      <p className="text-[10px] text-white/50 font-mono">MH-04-AB-8819</p>
                    </div>

                    <div className="p-3 rounded-control bg-white/5 border border-white/10 space-y-1">
                      <span className="text-[10px] uppercase font-semibold text-white/40 block">Payload Allocation</span>
                      <p className="font-bold text-white">16.8 / 18.0 Tons</p>
                      <span className="inline-block text-[10px] font-semibold text-emerald-400">93% Capacity</span>
                    </div>
                  </div>

                  {/* Return Trip Bonus Pill */}
                  <div className="p-3 rounded-control bg-brand-fill/10 border border-brand-fill/30 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-white">
                      <Zap size={15} className="text-brand-fill shrink-0" />
                      <span className="font-medium text-[11px]">Return Trip Match Activated</span>
                    </div>
                    <span className="text-[11px] font-bold text-brand-fill">0% Deadhead</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Live Numbers Strip (Shown only when platform stats > 0) */}
        <LiveNumbers />

        {/* How It Works Section */}
        <section id="how-it-works" aria-labelledby="how-it-works-title" className="mx-auto max-w-content px-4 pb-12 pt-14 sm:px-6 sm:pt-20">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider text-brand block mb-1">Simple 3-Step Execution</span>
            <h2 id="how-it-works-title" className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-text">
              How it works
            </h2>
            <p className="mt-2 text-sm sm:text-base text-muted">
              End-to-end freight fulfillment: smart pricing, capacity matching, and real-time live monitoring.
            </p>
          </div>

          <ol className="mt-10 grid gap-6 sm:grid-cols-3">
            {howItWorks.map(({ icon: StepIcon, title, stepNumber, description }) => (
              <li
                key={title}
                className="relative flex flex-col p-6 rounded-card border border-border bg-surface shadow-xs hover:shadow-raised hover:-translate-y-1 transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-card bg-brand-soft font-mono font-bold text-brand text-base shadow-xs">
                    {stepNumber}
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-subtle text-muted border border-border">
                    <StepIcon size={16} className="text-brand" aria-hidden />
                  </div>
                </div>

                <h3 className="text-base sm:text-lg font-bold text-text mb-2">
                  {title}
                </h3>
                <p className="text-xs sm:text-sm text-muted leading-relaxed flex-1">
                  {description}
                </p>

                <div className="mt-4 pt-3 border-t border-border flex items-center text-xs font-semibold text-brand">
                  <span>Learn more</span>
                  <ChevronRight size={14} className="ml-0.5" />
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Get Started / Audience Solutions Section */}
        <section id="audiences" aria-labelledby="audiences-title" className="mx-auto max-w-content px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-12">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider text-brand block mb-1">Role-Based Gateways</span>
            <h2 id="audiences-title" className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-text">
              Get started
            </h2>
            <p className="mt-2 text-sm sm:text-base text-muted">
              Pick the one that's you — everyone signs in from the same place.
            </p>
          </div>

          <ul className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {audiences.map(({ icon: AudienceIcon, title, tag, description, highlights, action, secondary }) => {
              const to = title === '3PL partners' && tplPartnerId ? `/3pl-portal/${tplPartnerId}` : action.to
              const label = title === '3PL partners' && tplPartnerId ? 'Go to partner portal' : action.label
              return (
                <li
                  key={title}
                  className="flex flex-col rounded-card border border-border bg-surface p-6 sm:p-7 shadow-xs hover:shadow-raised hover:border-brand/40 transition-all duration-200"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="flex h-11 w-11 items-center justify-center rounded-control bg-brand-soft text-brand">
                      <AudienceIcon size={22} aria-hidden />
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-surface-subtle border border-border text-muted">
                      {tag}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-text tracking-tight mb-2">
                    {title}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted leading-relaxed mb-5">
                    {description}
                  </p>

                  {/* Role Features List */}
                  <ul className="space-y-2 mb-6 text-xs text-muted">
                    {highlights.map(h => (
                      <li key={h} className="flex items-center gap-2">
                        <CheckCircle2 size={13} className="text-success shrink-0" />
                        <span className="truncate">{h}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Card Actions */}
                  <div className="mt-auto pt-4 border-t border-border flex flex-col gap-2.5">
                    <Link
                      to={to}
                      className={clsx(
                        buttonClasses({ variant: 'primary', fullWidth: true }),
                        'py-2.5 font-bold shadow-xs text-center justify-center'
                      )}
                    >
                      {label}
                    </Link>
                    {secondary && (
                      <Link
                        to={secondary.to}
                        className={clsx(
                          buttonClasses({ variant: 'ghost', fullWidth: true }),
                          'py-2 text-xs font-semibold text-center justify-center hover:bg-surface-subtle'
                        )}
                      >
                        {secondary.label}
                      </Link>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Feature Matrix: What the Console Does */}
        <section id="features" aria-labelledby="features-title" className="border-t border-border bg-surface-subtle">
          <div className="mx-auto max-w-content px-4 py-16 sm:px-6 sm:py-24">
            <div className="max-w-2xl">
              <span className="text-xs font-bold uppercase tracking-wider text-brand block mb-1">Platform Architecture</span>
              <h2 id="features-title" className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-text">
                What the console does
              </h2>
              <p className="mt-2 text-sm sm:text-base text-muted">
                The tools your operations team uses every day, in one place.
              </p>
            </div>

            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: FeatureIcon, title, category, description }) => (
                <li
                  key={title}
                  className="rounded-card border border-border bg-surface p-5 sm:p-6 shadow-xs hover:shadow-raised hover:border-brand/40 transition-all duration-200 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3.5">
                      <span className="flex h-10 w-10 items-center justify-center rounded-control bg-brand-soft text-brand">
                        <FeatureIcon size={19} aria-hidden />
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-subtle border border-border text-muted">
                        {category}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-text">{title}</h3>
                    <p className="mt-1.5 text-xs sm:text-sm text-muted leading-relaxed">{description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Bottom Call to Action Banner */}
        <section className="relative overflow-hidden bg-gradient-to-r from-[#0e0e11] via-[#1a1a22] to-[#0e0e11] text-white py-14 sm:py-18 border-t border-white/10">
          <div className="mx-auto max-w-content px-4 sm:px-6 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-fill/10 border border-brand-fill/30 text-xs font-semibold text-brand-fill">
              <Zap size={13} /> Immediate Capacity Available
            </div>
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white max-w-2xl mx-auto">
              Ready to streamline your freight dispatch &amp; transport network?
            </h2>
            <p className="text-sm sm:text-base text-white/70 max-w-xl mx-auto">
              Join enterprise logistics shippers and top 3PL carriers executing reliable, profitable loads every day.
            </p>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/vendor/request" className={clsx(buttonClasses({ variant: 'primary', size: 'lg' }), 'px-8 font-bold shadow-raised')}>
                Post a load today
              </Link>
              <Link to="/3pl/onboard" className={clsx(buttonClasses({ variant: 'secondary', size: 'lg' }), 'px-8 bg-white/10 hover:bg-white/15 text-white border-white/20 font-semibold')}>
                Apply as a 3PL carrier
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Global Footer */}
      <footer className="border-t border-border bg-surface text-muted">
        <div className="mx-auto max-w-content px-4 py-12 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10 pb-10 border-b border-border">
            <div className="md:col-span-2 space-y-3">
              <Link to="/" className="flex items-center gap-2.5">
                <img src="/margix-logo.png" alt="" className="h-7 w-7 object-contain" />
                <span className="text-lg font-bold tracking-tight text-text">
                  Margix<span className="text-brand">India</span>
                </span>
              </Link>
              <p className="text-xs text-muted max-w-sm leading-relaxed">
                Enterprise logistics operating system connecting dispatch teams, vendors, 3PL fleets, and drivers across India.
              </p>
              <p className="text-xs text-muted font-mono pt-1">
                Headquarters: Mumbai, Maharashtra · Operations Support: +91 (022) 4890-1234
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <p className="font-bold text-text uppercase tracking-wider">Quick Navigation</p>
              <ul className="space-y-2">
                <li><Link to="/track" className="hover:text-text transition-colors">Track a shipment</Link></li>
                <li><Link to="/vendor/request" className="hover:text-text transition-colors">Post a load</Link></li>
                <li><Link to="/login" className="hover:text-text transition-colors">Sign in</Link></li>
              </ul>
            </div>

            <div className="space-y-3 text-xs">
              <p className="font-bold text-text uppercase tracking-wider">Partners & Network</p>
              <ul className="space-y-2">
                <li>
                  <Link to={tplPartnerId ? `/3pl-portal/${tplPartnerId}` : '/3pl/onboard'} className="hover:text-text transition-colors">
                    {tplPartnerId ? '3PL partner portal' : 'Become a 3PL partner'}
                  </Link>
                </li>
                <li><Link to="/3pl/onboard/track" className="hover:text-text transition-colors">Track partner application</Link></li>
                <li><a href="mailto:support@margixindia.com" className="hover:text-text transition-colors">support@margixindia.com</a></li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
            <p>© {new Date().getFullYear()} MargixIndia by Prudata Technologies. All rights reserved.</p>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
              <Link to="/track" className="hover:text-text">Track a shipment</Link>
              <Link to={tplPartnerId ? `/3pl-portal/${tplPartnerId}` : '/3pl/onboard'} className="hover:text-text">
                {tplPartnerId ? '3PL partner portal' : 'Become a 3PL partner'}
              </Link>
              <Link to="/login" className="hover:text-text">Sign in</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}

