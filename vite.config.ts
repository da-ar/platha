import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

const WORKER = 'http://localhost:8787'

// The Worker only accepts same-origin requests, so present proxied requests
// as coming from the Worker's own origin.
const asWorkerOrigin: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReq', (req) => req.setHeader('origin', WORKER))
  proxy.on('proxyReqWs', (req) => req.setHeader('origin', WORKER))
}

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    proxy: {
      '/api': { target: WORKER, changeOrigin: true, configure: asWorkerOrigin },
      '/ws': { target: WORKER, ws: true, changeOrigin: true, configure: asWorkerOrigin },
    },
  },
})
