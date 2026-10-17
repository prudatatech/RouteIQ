import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3, Building2, Gavel, IndianRupee, LayoutDashboard, MapPin, MapPinned, Package, PackageCheck, Route, Search,
  ShieldAlert, Truck, Waypoints, type LucideIcon,
} from 'lucide-react'
import { buttonClasses } from '@/components/ui'
import { publicAPI, type PublicStats } from '@/services/api'
import { useAuthStore } from '@/store/authStore'

interface Audience {
  icon: LucideIcon
  title: string
  description: string
  action: { to: string; label: string }
  secondary?: { to: string; label: string }
}

// One primary action per audience. Every line describes something the app does today.
const audiences: Audience[] = [
  {
    icon: LayoutDashboard,
    title: 'Operations teams',
    description: 'Create shipments, assign vehicles, plan and optimize trips, follow the fleet on a live map and respond to driver SOS alerts.',
    action: { to: '/login', label: 'Sign in' },
  },
  {
    icon: Package,
    title: 'Vendors',
    description: 'Post a load or bid on spare truck space on return trips, then follow your loads until they are delivered.',
    action: { to: '/vendor/request', label: 'Post a load' },
    secondary: { to: '/login', label: 'Sign in or create an account' },
  },
  {
    icon: Building2,
    title: '3PL partners',
    description: 'Apply online with your company details, documents and the corridors you serve. Once approved, manage your coverage and documents from your partner dashboard.',
    action: { to: '/3pl/onboard', label: 'Apply as a partner' },
    secondary: { to: '/3pl/onboard/track', label: 'Check your application' },
  },
  {
    icon: MapPin,
    title: 'Customers',
    description: 'Have a tracking ID? See where your shipment is and when it is expected.',
    action: { to: '/track', label: 'Track a shipment' },
  },
]

const features: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Package, title: 'Shipments', description: 'Create shipments with trip, cargo and vehicle, and see the status of every one.' },
  { icon: MapPinned, title: 'Live map', description: 'See where each vehicle is, from the location its driver shares.' },
  { icon: Route, title: 'Trip optimization', description: 'Work out the best order of stops for a trip before you dispatch it.' },
  { icon: Gavel, title: 'Bids', description: 'Offer spare truck capacity to vendors and approve the bids you accept.' },
  { icon: Waypoints, title: 'Return trips', description: 'Fill empty return trips with loads going the same way.' },
  { icon: ShieldAlert, title: 'Emergencies', description: 'Driver SOS alerts arrive with the vehicle and its location.' },
  { icon: Truck, title: 'Driver app', description: 'Drivers get their trips, share their location and confirm delivery from their phone.' },
  { icon: BarChart3, title: 'Analytics', description: 'See how your fleet, drivers and vendors are performing.' },
]

// The real steps a load takes, start to finish - no step here is aspirational; each is a feature that exists today.
const howItWorks: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Search, title: 'Post a load', description: 'Enter the pickup, drop and cargo. The platform works out a recommended price range for you.' },
  { icon: IndianRupee, title: 'A company takes it', description: "Any logistic company on the lane can book it at that price, or you take spare capacity on someone else's return trip." },
  { icon: PackageCheck, title: 'Track to delivery', description: 'Follow the vehicle on a live map and get status updates until it is delivered.' },
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
    <section aria-label="Platform in numbers" className="mx-auto -mt-8 max-w-content px-4 pb-4 sm:px-6 sm:pb-6">
      <dl className="grid grid-cols-2 gap-4 rounded-card border border-border bg-surface p-6 shadow-raised lg:grid-cols-4">
        {shown.map(({ key, label }) => (
          <div key={key}>
            <dd className="text-3xl font-semibold tabular text-text">{data![key].toLocaleString('en-IN')}</dd>
            <dt className="mt-1 text-sm text-muted">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default function LandingPage() {
  const tplPartnerId = useAuthStore(s => s.tplPartnerId)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border/10 bg-text">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-control text-white hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-fill">
            <img src="/margix-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
            <span className="truncate text-lg font-semibold">MargixIndia</span>
          </Link>
          <nav aria-label="Main" className="flex shrink-0 items-center gap-2">
            <Link to="/track" className="hidden rounded-control px-3 py-2 text-sm font-medium text-white/70 hover:text-white sm:inline-flex">
              Track a shipment
            </Link>
            <Link to="/login" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="bg-text">
          <div className="mx-auto max-w-content px-4 pb-20 pt-12 sm:px-6 sm:pb-28 sm:pt-16">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-fill">Freight operations platform</p>
              <h1 className="mt-3 text-3xl font-semibold text-white sm:text-5xl">Freight operations, capacity and tracking in one place</h1>
              <p className="mt-4 max-w-xl text-base text-white/70 sm:text-lg">
                MargixIndia connects your operations team, vendors, 3PL partners and drivers. Plan shipments and trips, fill
                trucks through bidding and partners, and let everyone see where a load is.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/vendor/request" className={buttonClasses({ variant: 'primary', size: 'lg' })}>Post a load</Link>
                <Link to="/login" className={buttonClasses({ variant: 'secondary', size: 'lg' })}>Sign in</Link>
              </div>
              <p className="mt-3 text-sm text-white/50">Fill in your load first. You sign in only when you submit.</p>
            </div>
          </div>
        </section>

        <LiveNumbers />

        <section aria-labelledby="how-it-works-title" className="mx-auto max-w-content px-4 pb-4 pt-12 sm:px-6 sm:pt-16">
          <h2 id="how-it-works-title" className="text-2xl font-semibold text-text sm:text-3xl">How it works</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {howItWorks.map(({ icon: StepIcon, title, description }, i) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">
                  {i + 1}
                </span>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-text">
                    <StepIcon size={16} className="text-brand" aria-hidden /> {title}
                  </h3>
                  <p className="mt-1 text-sm text-muted">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="audiences-title" className="mx-auto max-w-content px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-10">
          <h2 id="audiences-title" className="text-2xl font-semibold text-text sm:text-3xl">Get started</h2>
          <p className="mt-2 max-w-2xl text-base text-muted">Pick the one that's you — everyone signs in from the same place.</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {audiences.map(({ icon: AudienceIcon, title, description, action, secondary }) => {
              const to = title === '3PL partners' && tplPartnerId ? `/3pl-portal/${tplPartnerId}` : action.to
              const label = title === '3PL partners' && tplPartnerId ? 'Go to partner portal' : action.label
              return (
                <li key={title} className="flex flex-col rounded-card border border-border bg-surface p-6 shadow-raised transition-shadow hover:shadow-dialog">
                  <span className="flex h-10 w-10 items-center justify-center rounded-control bg-brand-soft text-brand">
                    <AudienceIcon size={20} aria-hidden />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-text">{title}</h3>
                  <p className="mt-2 flex-1 text-sm text-muted">{description}</p>
                  <div className="mt-6 flex flex-col gap-2">
                    <Link to={to} className={buttonClasses({ variant: 'primary', fullWidth: true })}>{label}</Link>
                    {secondary && (
                      <Link to={secondary.to} className={buttonClasses({ variant: 'ghost', fullWidth: true })}>{secondary.label}</Link>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-labelledby="features-title" className="border-t border-border bg-surface-subtle">
          <div className="mx-auto max-w-content px-4 py-12 sm:px-6 sm:py-16">
            <h2 id="features-title" className="text-2xl font-semibold text-text sm:text-3xl">What the console does</h2>
            <p className="mt-2 max-w-2xl text-base text-muted">The tools your operations team uses every day, in one place.</p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: FeatureIcon, title, description }) => (
                <li key={title} className="rounded-card border border-border bg-surface p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-control bg-brand-soft text-brand">
                    <FeatureIcon size={18} aria-hidden />
                  </span>
                  <h3 className="mt-3 text-base font-semibold text-text">{title}</h3>
                  <p className="mt-1 text-sm text-muted">{description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-content flex-col gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} MargixIndia by Prudata</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/track" className="hover:text-text">Track a shipment</Link>
            <Link to={tplPartnerId ? `/3pl-portal/${tplPartnerId}` : '/3pl/onboard'} className="hover:text-text">
              {tplPartnerId ? '3PL partner portal' : 'Become a 3PL partner'}
            </Link>
            <Link to="/login" className="hover:text-text">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
