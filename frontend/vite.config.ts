import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Everything in VITE_* is published in the site's JavaScript, so only the
 * anon/publishable Supabase key belongs there; row-level security does the rest.
 * Returns why a key is privileged (a secret or non-anon JWT), or null when it is public.
 */
function privilegedKeyReason(key: string): string | null {
  if (key.startsWith('sb_secret_')) return 'it is a secret key'
  const parts = key.split('.')
  if (parts.length !== 3) return null
  let role: unknown
  try {
    role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role
  } catch {
    return null
  }
  return role === 'anon' ? null : `it has role "${String(role)}"`
}

/**
 * The Supabase key the site is built with. VITE_SUPABASE_ANON_KEY wins when it is
 * public. A privileged value there is never shipped: the build falls back to
 * VITE_SUPABASE_PUBLISHABLE_KEY (committed in .env.production) with a warning,
 * and fails when there is no public key to use.
 */
function publicSupabaseKey(env: Record<string, string>): string | undefined {
  const configured = env.VITE_SUPABASE_ANON_KEY
  const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (publishable && privilegedKeyReason(publishable)) {
    throw new Error(`VITE_SUPABASE_PUBLISHABLE_KEY is not public: ${privilegedKeyReason(publishable)}.`)
  }
  if (!configured) return publishable
  const reason = privilegedKeyReason(configured)
  if (!reason) return configured
  if (!publishable) {
    throw new Error(`VITE_SUPABASE_ANON_KEY is not public: ${reason}. Use the publishable (anon) key.`)
  }
  console.warn(
    `\n[supabase] VITE_SUPABASE_ANON_KEY is ignored because ${reason}; building with VITE_SUPABASE_PUBLISHABLE_KEY instead. ` +
    'Replace it with the publishable key in the hosting settings, and rotate the leaked key.\n',
  )
  return publishable
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseKey = publicSupabaseKey(env)

  return {
    plugins: [react()],
    define: {
      // Replaces the configured value everywhere, so a privileged key can never reach the bundle.
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseKey ?? ''),
    },
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
      // No error tracker uploads maps, so none are published (UAT-019).
      sourcemap: false,
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
