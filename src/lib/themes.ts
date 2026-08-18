/**
 * The accent catalogue.
 *
 * An accent is the second theme axis: light/dark decides the surfaces, the
 * accent decides the brand colour painted on top of them. The colours themselves
 * live in `styles/globals.css` under `[data-accent="…"]` — this file holds only
 * the ids and the labels, so a new accent is a token block plus one line here
 * and never a hex in a component.
 */

export const ACCENT_THEMES = [
  { id: 'default', label: 'Default' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'lagoon', label: 'Lagoon' },
  { id: 'horizon', label: 'Horizon' },
  { id: 'blossom', label: 'Blossom' },
  { id: 'arctic', label: 'Arctic' },
  { id: 'forest', label: 'Forest' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'passion', label: 'Passion' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'velvet', label: 'Velvet' },
  { id: 'autumn', label: 'Autumn' },
] as const

export type AccentTheme = (typeof ACCENT_THEMES)[number]['id']

const IDS = new Set<string>(ACCENT_THEMES.map((theme) => theme.id))

/** Guards a persisted value — an accent dropped from the catalogue falls back. */
export function isAccentTheme(value: unknown): value is AccentTheme {
  return typeof value === 'string' && IDS.has(value)
}
