import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

/** Must match `API_PROXY_PREFIX` in `src/config/api-proxy.ts`. */
const API_PROXY_PREFIX = '/api'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  // Dev-only reverse proxy. With VITE_APP_API_TARGET set, the client talks to the
  // same-origin `/api` prefix and the dev server forwards to the real API — so the
  // browser never makes a cross-origin request and CORS rules don't apply locally.
  // `ws: true` matters here: the socket.io upgrade goes through the same proxy.
  const proxyTarget = (env.VITE_APP_API_TARGET || '').replace(/\/+$/, '')

  return {
    base: env.VITE_APP_BASE_URL || '/',
    plugins: [react(), tailwindcss(), tsconfigPaths()],
    server: {
      proxy: proxyTarget
        ? {
            [API_PROXY_PREFIX]: {
              target: proxyTarget,
              changeOrigin: true,
              secure: proxyTarget.startsWith('https://'),
              ws: true,
              rewrite: (path) => path.replace(new RegExp(`^${API_PROXY_PREFIX}`), ''),
            },
          }
        : undefined,
    },
  }
})
