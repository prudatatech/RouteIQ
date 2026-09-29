import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3, Building2, Gavel, LayoutDashboard, MapPin, MapPinned, Package, Route, ShieldAlert, Truck, Waypoints,
  type LucideIcon,
} from 'lucide-react'
import { buttonClasses } from '@/components/ui'
import { publicAPI, type PublicStats } from '@/services/api'

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
    description: 'Create shipments, assign vehicles, plan and optimize routes, follow the fleet on a live map and respond to driver SOS alerts.',
    action: { to: '/login', label: 'Staff sign in' },
  },
  {
    icon: Package,
    title: 'Vendors',
    description: 'Search open truck capacity, bid on corridors or post a load, then track your shipments until they are delivered.',
    action: { to: '/vendor', label: 'Find capacity' },
    secondary: { to: '/login?as=vendor', label: 'Sign in or create an account' },
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
  { icon: Package, title: 'Shipments', description: 'Create shipments with route, cargo and vehicle, and see the status of every one.' },
  { icon: MapPinned, title: 'Live map', description: 'See where each vehicle is, from the location its driver shares.' },
  { icon: Route, title: 'Route optimization', description: 'Work out the best order of stops for a route before you dispatch it.' },
  { icon: Gavel, title: 'Bids', description: 'Offer spare truck capacity to vendors and approve the bids you accept.' },
  { icon: Waypoints, title: 'Backhaul pooling', description: 'Fill empty return trips with loads going the same way.' },
  { icon: ShieldAlert, title: 'Emergencies', description: 'Driver SOS alerts arrive with the vehicle and its location.' },
  { icon: Truck, title: 'Driver app', description: 'Drivers get their trips, share their location and confirm delivery from their phone.' },
  { icon: BarChart3, title: 'Analytics', description: 'See how your fleet, drivers and vendors are performing.' },
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
    <section aria-label="Platform in numbers" className="mx-auto max-w-content px-4 pb-12 sm:px-6 sm:pb-16">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {shown.map(({ key, label }) => (
          <div key={key} className="rounded-card border border-border bg-surface p-5">
            <dd className="text-3xl font-semibold tabular text-text">{data![key].toLocaleString('en-IN')}</dd>
            <dt className="mt-1 text-sm text-muted">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default function LandingPage() {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <img src="/margix-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
            <span className="text-lg font-semibold">MargixIndia</span>
            <span className="hidden text-sm text-muted sm:inline">by Prudata</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-2">
            <Link to="/track" className={`${buttonClasses({ variant: 'ghost', size: 'sm' })} hidden sm:inline-flex`}>
              Track a shipment
            </Link>
            <Link to="/login" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-content px-4 py-12 sm:px-6 sm:py-16 lg:py-24">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-semibold text-text sm:text-5xl">Freight operations, capacity and tracking in one place</h1>
            <p className="mt-4 text-base text-muted sm:text-lg">
              MargixIndia connects your operations team, vendors, 3PL partners and drivers. Plan shipments and routes, fill
              trucks through bidding and partners, and let everyone see where a load is.
            </p>
          </div>
        </section>

        <LiveNumbers />

        <section aria-labelledby="audiences-title" className="mx-auto max-w-content px-4 pb-12 sm:px-6 sm:pb-16">
          <h2 id="audiences-title" className="sr-only">Get started</h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {audiences.map(({ icon: AudienceIcon, title, description, action, secondary }) => (
              <li key={title} className="flex flex-col rounded-card border border-border bg-surface p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-control bg-brand-soft text-brand">
                  <AudienceIcon size={20} aria-hidden />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-text">{title}</h3>
                <p className="mt-2 flex-1 text-sm text-muted">{description}</p>
                <div className="mt-6 flex flex-col gap-2">
                  <Link to={action.to} className={buttonClasses({ variant: 'primary', fullWidth: true })}>{action.label}</Link>
                  {secondary && (
                    <Link to={secondary.to} className={buttonClasses({ variant: 'ghost', fullWidth: true })}>{secondary.label}</Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="features-title" className="border-t border-border bg-surface">
          <div className="mx-auto max-w-content px-4 py-12 sm:px-6 sm:py-16">
            <h2 id="features-title" className="text-2xl font-semibold text-text sm:text-3xl">What the console does</h2>
            <p className="mt-2 max-w-2xl text-base text-muted">The tools your operations team uses every day, in one place.</p>
            <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: FeatureIcon, title, description }) => (
                <li key={title} className="flex gap-3">
                  <FeatureIcon size={20} aria-hidden className="mt-0.5 shrink-0 text-brand" />
                  <div>
                    <h3 className="text-base font-semibold text-text">{title}</h3>
                    <p className="mt-1 text-sm text-muted">{description}</p>
                  </div>
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
            <Link to="/3pl/onboard" className="hover:text-text">Become a 3PL partner</Link>
            <Link to="/login" className="hover:text-text">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
