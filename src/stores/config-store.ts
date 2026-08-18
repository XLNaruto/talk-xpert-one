import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { fetchAppConfig } from '@/lib/config-api'
import { joinMediaPath } from '@/lib/config-mappers'
import { createIdbStorage } from '@/lib/idb-storage'
import { toApiError } from '@/lib/api-error'
import { logger } from '@/lib/logger'
import type { AppConfig, ConfigStatus } from '@/types/config'

interface ConfigState {
  config: AppConfig | null
  status: ConfigStatus
  error: string | null
  /** When the last successful read landed — ISO string, so it survives IndexedDB. */
  fetchedAt: string | null
  /** Fetch `/config`. Resolves to the config, or null when the read failed. */
  load: () => Promise<AppConfig | null>
  reset: () => void
}

/**
 * Server-reported bootstrap config — media prefix and realtime coordinates.
 *
 * Persisted (unencrypted; it holds no credentials) so a cold launch with no
 * network still paints with the last known values instead of broken image URLs.
 * IndexedDB is async, so this store sets `skipHydration` and is rehydrated in
 * `main.tsx` before the app mounts.
 */
export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      config: null,
      status: 'idle',
      error: null,
      fetchedAt: null,

      load: async () => {
        if (get().status === 'loading') return get().config
        set({ status: 'loading', error: null })
        try {
          const config = await fetchAppConfig()
          set({ config, status: 'ready', error: null, fetchedAt: new Date().toISOString() })
          return config
        } catch (error) {
          // A failed read must not block launch: keep whatever was persisted and
          // let the app run on env fallbacks.
          const { message } = toApiError(error)
          logger.warn('config read failed, using last known values', message)
          set({ status: 'error', error: message })
          return get().config
        }
      },

      reset: () => set({ config: null, status: 'idle', error: null, fetchedAt: null }),
    }),
    {
      name: 'xpertone-talk-config',
      storage: createJSONStorage(createIdbStorage),
      skipHydration: true,
      // `status` is per-launch, not something to restore from disk.
      partialize: (s) => ({ config: s.config, fetchedAt: s.fetchedAt }),
    },
  ),
)

/**
 * Launch-time read, called from `main.tsx` after rehydration.
 *
 * With nothing persisted the fetch is awaited, because `media_path` and the
 * realtime origin decide what the first paint can even show. With a persisted
 * copy it refreshes in the background so a stale value never delays the app.
 */
export async function bootstrapAppConfig(): Promise<void> {
  const { config, load } = useConfigStore.getState()
  if (config) {
    void load()
    return
  }
  await load()
}

/** Read the config outside React (socket-client, mappers). */
export function getAppConfig(): AppConfig | null {
  return useConfigStore.getState().config
}

/** Absolute URL for a stored file key, using the server's `media_path`. */
export function mediaUrl(key: string | null | undefined): string {
  return joinMediaPath(useConfigStore.getState().config?.mediaPath ?? '', key)
}
