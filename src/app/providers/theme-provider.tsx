import { useLayoutEffect, type ReactNode } from 'react'
import { applyThemeToDocument } from '@/lib/theme-dom'
import { useUiStore } from '@/stores/ui-store'

/**
 * Keeps <html> in step with the theme the user picks. The FIRST application
 * happens before the app mounts (`main.tsx`) — see `applyThemeToDocument`; this
 * only has to catch the changes after that, and it does so in a layout effect so
 * a toggle repaints in the same frame as the click.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme)
  const accent = useUiStore((s) => s.accent)

  useLayoutEffect(() => {
    applyThemeToDocument(theme, accent)
  }, [theme, accent])

  return <>{children}</>
}
