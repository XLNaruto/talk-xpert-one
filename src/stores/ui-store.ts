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
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setAccent: (accent: AccentTheme) => void
  setSidebarOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      accent: 'default',
      sidebarOpen: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setAccent: (accent) => set({ accent }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
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
