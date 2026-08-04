import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'
import 'maplibre-gl/dist/maplibre-gl.css'

import toast from 'react-hot-toast'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      // Silently fail for network errors in background queries
    },
    mutations: {
      onError: (err: any) => {
        // Skip 401 errors — handled by auth interceptor
        if (err?.response?.status === 401) return

        // Network errors (backend down) — show a cleaner message
        if (!err?.response && err?.code === 'ERR_NETWORK') {
          toast.error('Backend unavailable. Please check your connection.', { id: 'network-error' })
          return
        }

        const detail = err?.response?.data?.detail
        let message: string
        if (Array.isArray(detail)) {
          message = detail.map((e: any) => `${e.loc?.join('.')}: ${e.msg}`).join(', ')
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
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1A1A2E',
              color: '#F4F4F5',
              border: '1px solid #3F3F46',
              borderRadius: '10px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              fontWeight: '600',
            },
            success: { iconTheme: { primary: '#10B981', secondary: '#1A1A2E' } },
            error: { iconTheme: { primary: '#EF4444', secondary: '#1A1A2E' } },
          }}
        />
    </QueryClientProvider>
  </React.StrictMode>
)
