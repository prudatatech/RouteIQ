import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import 'maplibre-gl/dist/maplibre-gl.css'

import toast from 'react-hot-toast'

interface ValidationIssue {
  loc?: (string | number)[]
  msg?: string
}

// The global mutation error handler runs for every mutation in the app, so it can't
// assume a specific AxiosError generic; these fields are read defensively instead.
type MutationError = Error & {
  code?: string
  response?: { status?: number; data?: { detail?: string | ValidationIssue[] } }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      // Silently fail for network errors in background queries
    },
    mutations: {
      onError: (err: MutationError) => {
        // Skip 401 errors — handled by auth interceptor
        if (err?.response?.status === 401) return

        // Network errors (backend down) — show a cleaner message
        if (!err?.response && err?.code === 'ERR_NETWORK') {
          toast.error('We could not reach the server. Check your connection and try again.', { id: 'network-error' })
          return
        }

        const detail = err?.response?.data?.detail
        let message: string
        if (Array.isArray(detail)) {
          message = detail.map((e) => `${e.loc?.join('.')}: ${e.msg}`).join(', ')
        } else if (typeof detail === 'string') {
          message = detail
        } else {
          message = err?.message || 'Something went wrong'
        }
        toast.error(message)
      },
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
        <App />
    </QueryClientProvider>
  </React.StrictMode>
)
