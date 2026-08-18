import { Outlet } from 'react-router-dom'
import { ThemeToggle } from '@/components/common/theme-toggle'
import { WebCanvas } from '@/components/common/web-canvas'

/**
 * Full-bleed shell for the sign-in screens. `.auth-canvas` paints the sky and
 * the breathing glow, the three orbs are the moving colour the glass card
 * refracts, and `WebCanvas` draws the drifting web and the shooting stars over
 * them. All of it is decorative — see `styles/globals.css`.
 */
export function AuthLayout() {
  return (
    <div className="auth-canvas flex h-full w-full items-center justify-center p-4 sm:p-6">
      <span className="auth-orb auth-orb-a" aria-hidden />
      <span className="auth-orb auth-orb-b" aria-hidden />
      <span className="auth-orb auth-orb-c" aria-hidden />
      <WebCanvas />
      <ThemeToggle className="auth-theme-toggle absolute right-4 top-4 sm:right-6 sm:top-6" />
      <Outlet />
    </div>
  )
}
