import type { AppConfig } from '@/types/config'

/** Raw `GET /config` payload — snake_case, exactly as the API sends it. */
export interface AppConfigDto {
  media_path: string
  realtime_url: string
  realtime_path: string
}

/**
 * Pure mapping, server shape to UI shape. No React, no store reads here — when
 * the API renames a field, only this file changes.
 *
 * Every field is defended: this response is read before the app can render
 * anything, so a missing key must degrade (empty string = "not offered") rather
 * than throw on a property access three layers up.
 */
export function toAppConfig(dto: AppConfigDto): AppConfig {
  return {
    mediaPath: stripTrailingSlash(dto?.media_path ?? ''),
    realtimeUrl: stripTrailingSlash(dto?.realtime_url ?? ''),
    realtimePath: dto?.realtime_path || DEFAULT_REALTIME_PATH,
  }
}

/** What the server reports today; used when the field comes back blank. */
export const DEFAULT_REALTIME_PATH = '/socket.io'

/** Where the Socket.IO client should dial, or null when there is nowhere. */
export interface RealtimeTarget {
  url: string
  path: string
}

/**
 * Resolve the realtime coordinates — the one place this rule is written.
 *
 * With config loaded, the server decides: an explicit empty `realtime_url` is a
 * deliberate "no realtime service here", so it resolves to null and the app
 * polls instead of retrying a host that will never answer. Only when config has
 * not loaded at all does the build-time fallback apply.
 */
export function resolveRealtimeTarget(
  config: AppConfig | null,
  fallbackUrl: string,
): RealtimeTarget | null {
  if (config) {
    if (!config.realtimeUrl) return null
    return { url: config.realtimeUrl, path: config.realtimePath || DEFAULT_REALTIME_PATH }
  }
  if (!fallbackUrl) return null
  return { url: fallbackUrl, path: DEFAULT_REALTIME_PATH }
}

/**
 * Join `media_path` with a stored file key. The API returns bare keys, so every
 * `<img src>` in the app goes through this rather than concatenating by hand.
 *
 * An absolute URL is passed through untouched — some records already carry one.
 * So is a `blob:` object URL: an optimistic attachment preview is a local handle
 * on the file being uploaded, and prefixing it with the media path would make it
 * a path that resolves to nothing — the broken tile a send used to draw while
 * the bytes were still going up.
 */
export function joinMediaPath(mediaPath: string, key: string | null | undefined): string {
  if (!key) return ''
  if (PASSTHROUGH_URL.test(key)) return key
  if (!mediaPath) return key
  return `${stripTrailingSlash(mediaPath)}/${key.replace(/^\/+/, '')}`
}

/** Already a usable src: absolute http(s), protocol-relative, blob or data. */
const PASSTHROUGH_URL = /^(https?:)?\/\/|^(blob|data):/i

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
