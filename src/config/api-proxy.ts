/**
 * Same-origin prefix used by the dev-server reverse proxy.
 *
 * `config/env.ts` points the axios baseURL here when the proxy is on. The Vite
 * config declares the matching `server.proxy` rule with its own copy of the
 * literal (it can't import from `src/`) — change both together.
 */
export const API_PROXY_PREFIX = '/api'
