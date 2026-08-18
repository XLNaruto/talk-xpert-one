import { useCallback } from 'react'
import { socketUrl } from '@/config/env'
import { useConfigStore } from '@/stores/config-store'
import { joinMediaPath, resolveRealtimeTarget } from '@/lib/config-mappers'
import type { AppConfig, ConfigStatus } from '@/types/config'

/**
 * The bootstrap config, as components should read it. Selects narrowly — a
 * component that only needs the media prefix must not re-render when the
 * realtime status changes.
 */
export function useAppConfig(): AppConfig | null {
  return useConfigStore((s) => s.config)
}

export function useConfigStatus(): { status: ConfigStatus; error: string | null } {
  const status = useConfigStore((s) => s.status)
  const error = useConfigStore((s) => s.error)
  return { status, error }
}

/**
 * Builds URLs for stored file keys. Returns a stable callback keyed on the media
 * prefix, so it can sit in a dependency array.
 */
export function useMediaUrl(): (key: string | null | undefined) => string {
  const mediaPath = useConfigStore((s) => s.config?.mediaPath ?? '')
  return useCallback((key: string | null | undefined) => joinMediaPath(mediaPath, key), [mediaPath])
}

/**
 * False when this deployment reports no realtime service — the app should poll
 * for new messages instead of waiting on a socket that will never connect.
 *
 * Shares `resolveRealtimeTarget` with `socket-client`, so what this reports and
 * what `connectSocket` will actually do can never drift apart.
 */
export function useHasRealtime(): boolean {
  const config = useConfigStore((s) => s.config)
  return resolveRealtimeTarget(config, socketUrl) !== null
}
