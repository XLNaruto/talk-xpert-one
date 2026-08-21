import type { AccentTheme } from '@/lib/themes'
import type { Theme } from '@/stores/ui-store'

/**
 * Paint the theme onto `<html>`: `.dark` for the surfaces, `data-accent` for the
 * brand colour over them. Two attributes because the axes are independent —
 * every accent has a light and a dark palette.
 *
 * A function rather than an effect, because it has to run in two places: ONCE
 * before the app mounts (`main.tsx`, straight after the persisted store is
 * rehydrated) and again whenever the choice changes (`ThemeProvider`). Applying
 * it only from the effect meant the first paint used the DEFAULT palette and
 * flipped to the saved one a frame later — a sky-blue filter pill on an amber
 * app, for exactly as long as the first frame lasted.
 */
export function applyThemeToDocument(theme: Theme, accent: AccentTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.accent = accent
}
