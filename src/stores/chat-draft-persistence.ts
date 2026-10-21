import {
  readComposerDrafts,
  writeComposerDraftFiles,
  writeComposerDraftMeta,
} from '@/lib/composer-draft-storage'
import type { MessageQuote } from '@/features/chat/types'
import { useChatStore, type EditTarget } from './chat-store'

/**
 * Keeps the composer's unsent state in `chat-store` across a reload: the text,
 * the picked files, the reply target and an open edit — per chat, on this
 * device, for a day (`lib/composer-draft-storage.ts`).
 *
 * `chat-store` itself stays a plain in-memory store; this sits beside it,
 * restores into it once before the app mounts (`main.tsx`), and then watches it
 * and writes what changed after a short pause.
 *
 * Drafts are local only — nothing here calls the API, so a draft does not
 * follow me to another device.
 */

/** What the encrypted half of a stored draft carries. */
interface DraftPayload {
  text: string
  replyTo: MessageQuote | null
  editing: EditTarget | null
}

/** Long enough to coalesce a burst of keystrokes into one write. */
const PERSIST_DEBOUNCE_MS = 500

/** Restore every saved draft into `chat-store`, before the app mounts. */
export async function rehydrateComposerDrafts(): Promise<void> {
  const saved = await readComposerDrafts()
  if (saved.length === 0) return

  const ui = useChatStore.getState()

  for (const { chatKey, payload, files } of saved) {
    const chatId = Number(chatKey)
    if (!Number.isFinite(chatId)) continue
    const draft = payload as DraftPayload | null

    if (files.length > 0) ui.setAttachments(chatId, files)
    if (!draft) continue
    if (draft.replyTo) ui.setReplyTo(chatId, draft.replyTo)
    if (draft.editing) ui.setEditing(chatId, draft.editing)
    if (draft.text || draft.editing) ui.setDraft(chatId, draft.text)
  }
}

let started = false

/** Start writing `chat-store`'s composer state to IndexedDB. Idempotent. */
export function persistComposerDrafts(): void {
  if (started) return
  started = true

  const dirtyMeta = new Set<string>()
  const dirtyFiles = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    const s = useChatStore.getState()
    for (const key of dirtyMeta) {
      const text = s.drafts[key] ?? ''
      const replyTo = s.replyTo[key] ?? null
      const editing = s.editing[key] ?? null
      const empty = !text.trim() && !replyTo && !editing
      void writeComposerDraftMeta(key, empty ? null : ({ text, replyTo, editing } satisfies DraftPayload))
    }
    for (const key of dirtyFiles) void writeComposerDraftFiles(key, s.attachments[key] ?? [])
    dirtyMeta.clear()
    dirtyFiles.clear()
  }

  /** Every key whose entry is a different object in `next` than in `prev`. */
  const changed = <T>(next: Record<string, T>, prev: Record<string, T>, into: Set<string>) => {
    if (next === prev) return
    for (const key of new Set([...Object.keys(next), ...Object.keys(prev)])) {
      if (next[key] !== prev[key]) into.add(key)
    }
  }

  useChatStore.subscribe((next, prev) => {
    changed(next.drafts, prev.drafts, dirtyMeta)
    changed(next.replyTo, prev.replyTo, dirtyMeta)
    changed(next.editing, prev.editing, dirtyMeta)
    changed(next.attachments, prev.attachments, dirtyFiles)
    if (dirtyMeta.size === 0 && dirtyFiles.size === 0) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, PERSIST_DEBOUNCE_MS)
  })

  // Closing the tab inside the debounce would lose the last few keystrokes.
  window.addEventListener('pagehide', () => {
    if (timer) {
      clearTimeout(timer)
      flush()
    }
  })
}
