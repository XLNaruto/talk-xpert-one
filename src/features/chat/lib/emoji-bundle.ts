/**
 * The emoji set and the picker code — about a megabyte, fetched on demand.
 *
 * Not a pure helper like the rest of this folder: it holds ONE in-flight import
 * for the session, so the prefetch on hover, the composer's picker and the
 * reaction picker share a single download instead of racing three. It lives
 * outside the components so a component file exports nothing but components.
 */
function importEmoji() {
  return Promise.all([import('emoji-mart'), import('@emoji-mart/data')])
}

let emojiBundle: ReturnType<typeof importEmoji> | null = null

export function loadEmojiBundle() {
  emojiBundle ??= importEmoji().catch((error: unknown) => {
    emojiBundle = null
    throw error
  })
  return emojiBundle
}

/** Start fetching before a picker is asked for — a hover is a strong hint. */
export function prefetchEmoji(): void {
  void loadEmojiBundle().catch(() => undefined)
}
