import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Everything in VITE_* is published in the site's JavaScript. Refuse to build or
 * serve with a privileged Supabase key: only the anon/publishable key belongs here,
 * row-level security does the rest.
 */
function assertPublicSupabaseKey(key: string | undefined) {
  if (!key) return
  if (key.startsWith('sb_secret_')) {
    throw new Error('VITE_SUPABASE_ANON_KEY is a secret key. Use the publishable (anon) key.')
  }
  const parts = key.split('.')
  if (parts.length !== 3) return
  let role: unknown
  try {
    role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role
  } catch {
    return
  }
  if (role !== 'anon') {
    throw new Error(`VITE_SUPABASE_ANON_KEY has role "${String(role)}". Use the publishable (anon) key.`)
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  assertPublicSupabaseKey(env.VITE_SUPABASE_ANON_KEY)

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api/v1/telemetry/ws': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
          ws: true,
          changeOrigin: true
        },
        '/api': { 
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000', 
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Only core React libs are force-grouped: they're needed by the entry on every
          // page, so one stable "vendor" chunk lets the browser cache it across deploys.
          // Everything else — recharts, maplibre-gl included — is left to Rollup's normal
          // per-chunk splitting, so it ships only with the lazy page/component that
          // actually imports it (see src/config/lazyPages.tsx) instead of being pinned
          // into a named chunk that the entry would then have to load up front.
          manualChunks(id) {
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
              return 'vendor'
            }
          },
        },
      },
    },
  }
})
