import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'



export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
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
