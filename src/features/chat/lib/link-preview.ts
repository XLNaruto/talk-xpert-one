/**
 * Finding the link a card is for, and naming its site. Pure — no React.
 *
 * The SERVER builds every card; all the client ever does is say which URL, so
 * the one rule that matters here is the server's: `link_preview_url` must appear
 * in the message body EXACTLY as typed. So the match is returned as the user's
 * own characters, never normalised.
 */

/**
 * An http(s) link, ending where the prose around it does. A trailing `.`, `,`,
 * `)` or quote is far more often the sentence than the URL, so it is trimmed.
 */
const URL_PATTERN_ALL = /\bhttps?:\/\/[^\s<>"']+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/** The longest URL the server will build a card for. */
const MAX_URL_LENGTH = 2048

/**
 * The links in the text, as typed, in order and without repeats — at most
 * `limit` of them. The first is the one a SEND names; the rest are display-only.
 */
export function linkUrls(text: string, limit: number): string[] {
  const urls: string[] = []
  for (const match of text.matchAll(URL_PATTERN_ALL)) {
    const url = usableUrl(match[0])
    if (url && !urls.includes(url)) urls.push(url)
    if (urls.length >= limit) break
  }
  return urls
}

function usableUrl(raw: string): string | null {
  const url = raw.replace(TRAILING_PUNCTUATION, '')
  if (url.length > MAX_URL_LENGTH) return null
  try {
    // A bare scheme with no host ("https://") is not a link yet — the user is
    // still typing it.
    return new URL(url).hostname ? url : null
  } catch {
    return null
  }
}

/** A run of a message's text: plain words, or a link to draw as one. */
export type TextSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

/**
 * The text cut into words and links, for drawing the links clickable. Uses the
 * same pattern and the same trailing-punctuation rule as the cards, so the part
 * that is underlined is exactly the part a card was built for — and the full
 * stop after a link stays plain text.
 */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let at = 0
  for (const match of text.matchAll(URL_PATTERN_ALL)) {
    const start = match.index ?? 0
    const url = usableUrl(match[0])
    if (!url) continue
    if (start > at) segments.push({ kind: 'text', text: text.slice(at, start) })
    segments.push({ kind: 'link', text: url, href: url })
    at = start + url.length
  }
  if (at < text.length) segments.push({ kind: 'text', text: text.slice(at) })
  return segments
}

/** What a card says it is from when the site gave no name: the domain. */
export function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
