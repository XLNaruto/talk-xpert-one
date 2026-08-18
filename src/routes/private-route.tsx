import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Auth gate.
 *
 * Safe to read the store synchronously because `main.tsx` rehydrates every
 * persisted store from IndexedDB before mounting the router — without that, a
 * refresh would bounce a signed-in user to /login.
 *
 * Only the REFRESH token's absence signs someone out here. An expired access
 * token is normal — it lasts 30 minutes — and the api-client refreshes it, so
 * gating on that would sign the user out twice an hour.
 */
export function PrivateRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const location = useLocation()

  if (!isAuthenticated || !refreshToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
