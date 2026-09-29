import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Alert, Button } from '@/components/ui'

const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk .* failed|Load failed/i

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return CHUNK_ERROR_PATTERN.test(message)
}

interface State {
  hasError: boolean
  isChunkError: boolean
}

/**
 * Wraps the lazy-loaded routes. After a deploy, a tab that has been open
 * since before it can still reference a JS chunk the new build no longer
 * ships; `React.lazy` then throws when it tries to fetch that chunk. Without
 * this boundary the screen would just go blank — instead this shows a
 * "new version available" banner with a reload button.
 *
 * Also listens for `vite:preloadError`, which fires when a chunk warmed up
 * by `routePrefetch` (hover/focus of a nav link) fails to load outside of
 * React's render — an error boundary alone does not see those.
 */
export class ChunkErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, isChunkError: false }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, isChunkError: isChunkLoadError(error) }
  }

  componentDidCatch(error: unknown) {
    if (!isChunkLoadError(error)) console.error('Unhandled error in a lazy-loaded route', error)
  }

  componentDidMount() {
    window.addEventListener('vite:preloadError', this.handlePreloadError)
  }

  componentWillUnmount() {
    window.removeEventListener('vite:preloadError', this.handlePreloadError)
  }

  handlePreloadError = (event: Event) => {
    event.preventDefault()
    this.setState({ hasError: true, isChunkError: true })
  }

  handleReload = () => window.location.reload()

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <Alert
            tone="info"
            className="max-w-md"
            title={this.state.isChunkError ? 'A new version is available' : 'Something went wrong'}
            action={<Button icon={<RefreshCw size={16} />} onClick={this.handleReload}>Reload</Button>}
          >
            {this.state.isChunkError
              ? 'MargixIndia was updated since this page loaded. Reload to get the latest version.'
              : 'Reload the page and try again.'}
          </Alert>
        </div>
      )
    }
    return this.props.children
  }
}
