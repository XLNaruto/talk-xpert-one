import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createIdbStorage } from '@/lib/idb-storage'
import { isAccentTheme, type AccentTheme } from '@/lib/themes'

export type Theme = 'light' | 'dark'

interface UiState {
  theme: Theme
  /** The brand colour painted over the light/dark surfaces. */
  accent: AccentTheme
  /** Mobile only — the conversation list slides over the thread. */
  sidebarOpen: boolean
  /**
   * Whether the "turn on notifications" offer has been waved away.
   *
   * Persisted, because the browser's own permission state cannot record a "no
   * thanks" — it stays `default` — and re-offering on every launch is the
   * behaviour that teaches people to click Block, which IS final.
   */
  pushPromptDismissed: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setAccent: (accent: AccentTheme) => void
  setSidebarOpen: (open: boolean) => void
  dismissPushPrompt: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      accent: 'default',
      sidebarOpen: false,
      pushPromptDismissed: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setAccent: (accent) => set({ accent }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      dismissPushPrompt: () => set({ pushPromptDismissed: true }),
    }),
    {
      name: 'xpertone-talk-ui',
      storage: createJSONStorage(createIdbStorage),
      skipHydration: true,
      // An accent that no longer exists would leave the app unpainted, so a
      // stale persisted id is dropped rather than written to <html>.
      merge: (persisted, current) => {
        const next = { ...current, ...(persisted as Partial<UiState>) }
        if (!isAccentTheme(next.accent)) next.accent = 'default'
        return next
      },
    },
  ),
)
