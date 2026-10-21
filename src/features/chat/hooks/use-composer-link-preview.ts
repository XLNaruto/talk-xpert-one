import { useCallback, useMemo, useState } from 'react'
import { useLinkPreviews } from '../api/use-link-preview'
import { MAX_LINK_CARDS } from '../constants'
import { linkUrls } from '../lib/link-preview'
import type { LinkPreview } from '../types'

/**
 * The cards above a composer: one per link in the text, which ones the person
 * waved away, and what the send should therefore ask for.
 *
 * Shared by the chat composer and the broadcast composer, which follow the same
 * rules: no card at all once a file is attached (the server ignores
 * `link_preview_url` on a message with attachments), and a ✕ that is remembered
 * per URL — dismissing one link must not hide the card for another.
 *
 * Several cards show, but the message STORES one: the first link still kept.
 * The others are what the person will see under the bubble too, looked up the
 * same way — so the composer shows what the thread will.
 */
export function useComposerLinkPreview(text: string, { enabled }: { enabled: boolean }) {
  const urls = useMemo(() => (enabled ? linkUrls(text, MAX_LINK_CARDS) : []), [enabled, text])
  const [dismissed, setDismissed] = useState<string[]>([])
  // Not even asked for once dismissed — the card is not wanted, and a fresh
  // fetch spends the per-minute allowance.
  const kept = useMemo(() => urls.filter((url) => !dismissed.includes(url)), [urls, dismissed])
  const { cards, isLoading } = useLinkPreviews(kept)

  const previews = kept.flatMap((url) => {
    const card = cards[url]
    return card ? [{ url, card }] : []
  })

  const dismiss = useCallback((url: string) => {
    setDismissed((held) => (held.includes(url) ? held : [...held, url]))
  }, [])

  /** A fresh message starts with no link waved away. */
  const reset = useCallback(() => setDismissed([]), [])

  /**
   * What a SEND carries: the first kept link with a card, exactly as typed —
   * else the first kept link at all. Sent even when no card has shown yet: a
   * link pasted and sent inside the debounce still deserves one, and the server
   * builds it at send time (or answers null, which costs nothing).
   */
  const sendUrl = previews[0]?.url ?? kept[0] ?? null
  const preview: LinkPreview | null = sendUrl ? (cards[sendUrl] ?? null) : null

  return {
    /** Every link in the text that could have a card, dismissed ones included. */
    urls,
    previews,
    /** Waiting on a card, with none to show yet. */
    isLoading: isLoading && previews.length === 0,
    dismiss,
    reset,
    sendUrl,
    /** The card the send keeps — drawn on the bubble until the server answers. */
    preview,
  }
}
