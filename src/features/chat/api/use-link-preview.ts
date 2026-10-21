import { useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { LINK_PREVIEW_DEBOUNCE_MS, MAX_LINK_CARDS } from '../constants'
import { linkUrls } from '../lib/link-preview'
import type { ChatMessage, LinkPreview } from '../types'
import * as chatApi from './chat-api'

/**
 * Answers already given this session, by URL. The server caches a card for a
 * day (a miss for an hour), so asking again is cheap for it — but a composer
 * that re-asks whenever the text around a link changes would still spend the
 * person's per-minute allowance of FRESH fetches on nothing.
 */
const answers = new Map<string, LinkPreview | null>()

/** Identical reads in flight share one request — a link repeated down a thread. */
const inflight = new Map<string, Promise<LinkPreview | null>>()

/**
 * The server's card for `url`, asked once per session. A failed read is "no
 * card" and is NOT remembered, so the next mount can try again.
 */
function readLinkPreview(url: string): Promise<LinkPreview | null> {
  if (answers.has(url)) return Promise.resolve(answers.get(url) ?? null)
  const pending = inflight.get(url)
  if (pending) return pending
  const request = chatApi
    .fetchLinkPreview(url)
    .then((card) => {
      answers.set(url, card)
      return card
    })
    .catch(() => null)
    .finally(() => inflight.delete(url))
  inflight.set(url, request)
  return request
}

/** What is already known for each of `urls`, from the session's answers. */
function known(urls: string[]): Record<string, LinkPreview | null> {
  const held: Record<string, LinkPreview | null> = {}
  for (const url of urls) if (answers.has(url)) held[url] = answers.get(url) ?? null
  return held
}

/**
 * The server's cards for several links at once — each asked once, together.
 *
 * `debounceMs` is the composer's: it asks only once the links have sat still,
 * so a URL being typed is not looked up at every character. A bubble's text is
 * final and asks straight away.
 */
function useLinkPreviewReads(urls: string[], debounceMs: number) {
  const key = urls.join('\n')
  const settledKey = useDebouncedValue(key, debounceMs)
  const settled = useMemo(() => (settledKey ? settledKey.split('\n') : []), [settledKey])
  const [read, setRead] = useState<Record<string, LinkPreview | null>>(() => known(urls))

  useEffect(() => {
    const missing = settled.filter((url) => !answers.has(url))
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(missing.map(readLinkPreview)).then(() => {
      if (!cancelled) setRead((held) => ({ ...held, ...known(settled) }))
    })
    return () => {
      cancelled = true
    }
  }, [settled])

  const cards = { ...read, ...known(urls) }
  // Still waiting on a link that is in the text NOW — the debounce counts.
  const isLoading = urls.some((url) => !(url in cards))
  return { cards, isLoading }
}

/**
 * The composer's cards: one per link in the text (the first `MAX_LINK_CARDS`),
 * minus the ones waved away. `null` for a link is a normal answer — no card for
 * that site — never an error.
 */
export function useLinkPreviews(urls: string[]) {
  return useLinkPreviewReads(urls, LINK_PREVIEW_DEBOUNCE_MS)
}

/**
 * The cards a bubble draws for the links in its text.
 *
 * The STORED card comes first — it is what every reader is meant to see. Every
 * other link (or every link, on a message stored without one) asks the same
 * `/talk/link-preview` the composer does: the server builds the card and caches
 * it for a day, so nobody's browser fetches the linked site. Never on a message
 * with attachments, which never gets a card.
 */
export function useMessageLinkPreviews(message: ChatMessage): LinkPreview[] {
  const stored = message.linkPreview ?? null
  const eligible =
    message.type === 'text' &&
    message.media.length === 0 &&
    !message.isDeletedForEveryone &&
    Boolean(message.body)
  const urls = useMemo(
    () =>
      eligible && message.body
        ? linkUrls(message.body, MAX_LINK_CARDS).filter((url) => url !== stored?.url)
        : [],
    [eligible, message.body, stored?.url],
  )
  const { cards } = useLinkPreviewReads(urls, 0)

  const fetched = urls.flatMap((url) => (cards[url] ? [cards[url]] : []))
  return (stored ? [stored, ...fetched] : fetched).slice(0, MAX_LINK_CARDS)
}
