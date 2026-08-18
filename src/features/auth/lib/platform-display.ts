/**
 * How a session slot is written and drawn.
 *
 * The API answers a bare enum (`WEB`, `IOS`), which is fine as a slot name and
 * poor as a label — "IOS" in a device list reads like a typo. Kept pure: the
 * shape of the icon is named here, and the component picks the glyph.
 */
import type { TalkPlatform } from '@/lib/platform'

export type PlatformIconKind = 'mobile' | 'desktop' | 'browser'

const LABELS: Record<TalkPlatform, string> = {
  ANDROID: 'Android',
  IOS: 'iPhone or iPad',
  MAC: 'Mac app',
  WINDOWS: 'Windows app',
  LINUX: 'Linux app',
  WEB: 'Web browser',
}

const ICONS: Record<TalkPlatform, PlatformIconKind> = {
  ANDROID: 'mobile',
  IOS: 'mobile',
  MAC: 'desktop',
  WINDOWS: 'desktop',
  LINUX: 'desktop',
  WEB: 'browser',
}

export function platformLabel(platform: TalkPlatform): string {
  return LABELS[platform] ?? platform
}

export function platformIconKind(platform: TalkPlatform): PlatformIconKind {
  return ICONS[platform] ?? 'desktop'
}

/**
 * The initials on the account avatar. Talk has no name for you, so the email's
 * local part is the only thing there is — `ada.lovelace@x.com` → `AL`.
 */
export function emailInitials(email: string | undefined): string {
  const local = (email ?? '').split('@')[0] ?? ''
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
