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
   * Deliberately NOT persisted (see `partialize`): the dismissal lasts for this
   * tab only, and a refresh offers again as long as the browser's permission is
   * still `default`. Once it is `granted` or `denied` the offer stops on its own
   * — `use-push-notifications.ts` reports a status the prompt refuses to draw —
   * so nothing here has to remember a refusal for that.
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
      // The push offer's dismissal is session-scoped on purpose — persisting it
      // hid the card for good after one tap, on a browser that had never been
      // asked for permission.
      partialize: ({ pushPromptDismissed: _dismissed, ...rest }) => rest,
      // An accent that no longer exists would leave the app unpainted, so a
      // stale persisted id is dropped rather than written to <html>.
      merge: (persisted, current) => {
        const next = { ...current, ...(persisted as Partial<UiState>) }
        if (!isAccentTheme(next.accent)) next.accent = 'default'
        // A blob written before `partialize` existed still carries a `true`
        // here, which would keep the offer hidden on a browser that has never
        // been asked. It is session state now, so it always starts fresh.
        next.pushPromptDismissed = false
        return next
      },
    },
  ),
)
