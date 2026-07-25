import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const serviceWorkerRecoveryPlugin = () => ({
  name: 'sw-recovery',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.includes('main.jsx') || req.url?.includes('workbox-')) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(r => Promise.all(r.map(reg => reg.unregister()))).then(() => window.location.reload(true));
          }
        `);
        return;
      }
      next();
    });
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react(), serviceWorkerRecoveryPlugin()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api/v1/telemetry/ws': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8001',
          ws: true,
          changeOrigin: true
        },
        '/api': { 
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8001', 
          changeOrigin: true 
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            map: ['maplibre-gl'],
          },
        },
      },
    },
  }
})
