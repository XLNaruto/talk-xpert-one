import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth-store'
import { AFTER_LOGIN_PATH } from '@/features/auth'

/** Keeps a signed-in user off the login screen. */
export function PublicRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to={AFTER_LOGIN_PATH} replace />
  return <Outlet />
}
