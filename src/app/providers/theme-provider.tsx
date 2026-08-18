import { useEffect, type ReactNode } from 'react'
import { useUiStore } from '@/stores/ui-store'

/**
 * Applies the current theme to <html>: `.dark` for the surfaces, `data-accent`
 * for the brand colour painted over them. Two attributes because the axes are
 * independent — every accent has a light and a dark palette.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme)
  const accent = useUiStore((s) => s.accent)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.accent = accent
  }, [accent])

  return <>{children}</>
}
