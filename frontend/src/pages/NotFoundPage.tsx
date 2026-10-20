import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Compass, Home, ArrowLeft, Search, Truck, Shield } from 'lucide-react'
import { Button, buttonClasses } from '@/components/ui'

/** Shown for any address that does not exist. */
export default function NotFoundPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const previous = document.title
    document.title = 'Page not found · MargixIndia'
    return () => { document.title = previous }
  }, [])

  return (
    <div className="relative flex min-h-screen flex-col bg-bg text-text selection:bg-brand/20">
      {/* Subtle background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-brand/5 blur-[120px] rounded-full pointer-events-none" />

      <header className="relative z-10 mx-auto flex w-full max-w-content items-center justify-between px-4 py-5 sm:px-6 border-b border-border">
        <Link to="/" className="flex items-center gap-2.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <img src="/margix-logo.png" alt="Margix" className="h-8 w-8 object-contain shrink-0" />
          <span className="text-lg font-bold tracking-tight text-text">
            Margix<span className="text-brand">India</span>
          </span>
        </Link>
        <Link to="/track" className="text-xs font-semibold text-muted hover:text-text transition-colors">
          Track a shipment
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-card border border-border bg-surface p-6 sm:p-8 shadow-raised text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-brand shadow-xs">
            <Compass size={32} className="animate-spin-slow" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-subtle border border-border text-xs font-bold text-muted uppercase tracking-wider">
              404 · Error
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text">
              We could not find that page
            </h1>
            <p className="text-sm text-muted leading-relaxed">
              The address may be mistyped, or the page may have moved.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link to="/" className={buttonClasses({ variant: 'primary', fullWidth: true })}>
              <Home size={16} /> Go to the home page
            </Link>
            <Button variant="secondary" fullWidth onClick={() => navigate(-1)}>
              <ArrowLeft size={16} /> Go back
            </Button>
          </div>

          <div className="pt-4 border-t border-border">
            <p className="text-xs font-semibold text-muted mb-3 uppercase tracking-wider">Quick links</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/today" className="px-2.5 py-1 rounded-control bg-surface-subtle hover:bg-surface text-xs font-medium text-text border border-border transition-colors">
                Dashboard
              </Link>
              <Link to="/shipments" className="px-2.5 py-1 rounded-control bg-surface-subtle hover:bg-surface text-xs font-medium text-text border border-border transition-colors">
                Shipments
              </Link>
              <Link to="/fleet" className="px-2.5 py-1 rounded-control bg-surface-subtle hover:bg-surface text-xs font-medium text-text border border-border transition-colors">
                Fleet
              </Link>
              <Link to="/track" className="px-2.5 py-1 rounded-control bg-surface-subtle hover:bg-surface text-xs font-medium text-text border border-border transition-colors">
                Track
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
