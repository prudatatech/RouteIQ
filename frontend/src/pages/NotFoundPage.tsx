import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button, EmptyState, buttonClasses } from '@/components/ui'

/** Shown for any address that does not exist. */
export default function NotFoundPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const previous = document.title
    document.title = 'Page not found · MargixIndia'
    return () => { document.title = previous }
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="mx-auto flex w-full max-w-content items-center px-4 py-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <img src="/margix-logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-semibold">MargixIndia</span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4">
        <EmptyState
          icon={<Compass size={22} />}
          title="We could not find that page"
          description="The address may be mistyped, or the page may have moved."
          action={(
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/" className={buttonClasses({ variant: 'primary' })}>Go to the home page</Link>
              <Button variant="secondary" onClick={() => navigate(-1)}>Go back</Button>
            </div>
          )}
        />
      </main>
    </div>
  )
}
