import { clear, createStore, delMany, entries, setMany } from 'idb-keyval'
import { env } from '@/config/env'
import { decryptText, encryptText } from './crypto'
import { logger } from './logger'

/**
 * The composer's unsent state, kept on THIS device across a reload.
 *
 * Everything I was in the middle of — the text, the files I picked, the message
 * I was replying to, and an edit I had open — lives here, in IndexedDB, per
 * chat. Drafts never go to the server.
 *
 * A database of its own rather than a key in the persisted-store one: it holds
 * `File` blobs, which a JSON-serialising Zustand storage cannot carry.
 *
 * Two keys per chat, so typing never rewrites the attachments:
 *  - `<chat>:meta`  — `{ savedAt, sealed }`, the text/reply/edit as encrypted JSON;
 *  - `<chat>:files` — `{ savedAt, files }`, the `File` objects as they are.
 *
 * A draft older than `COMPOSER_DRAFT_EXPIRY_MS` is dropped on the next read.
 */
const store = createStore(`${env.VITE_APP_COOKIE_PREFIX}-drafts`, 'drafts')

/** A day: long enough to survive a restart, short enough not to haunt a chat. */
export const COMPOSER_DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000

interface MetaRecord {
  savedAt: number
  sealed: string
}

interface FilesRecord {
  savedAt: number
  files: File[]
}

export interface StoredComposerDraft {
  chatKey: string
  /** Epoch ms of the newer of the two halves. */
  savedAt: number
  /** The decrypted JSON payload, or null when only files were saved. */
  payload: unknown
  files: File[]
}

const META = ':meta'
const FILES = ':files'

/** Every live draft on this device. Expired and unreadable records are deleted. */
export async function readComposerDrafts(): Promise<StoredComposerDraft[]> {
  try {
    const rows = await entries<string, MetaRecord | FilesRecord>(store)
    const now = Date.now()
    const byChat = new Map<string, StoredComposerDraft>()
    const stale: string[] = []

    for (const [key, value] of rows) {
      const isMeta = key.endsWith(META)
      const isFiles = key.endsWith(FILES)
      if ((!isMeta && !isFiles) || !value || now - value.savedAt > COMPOSER_DRAFT_EXPIRY_MS) {
        stale.push(key)
        continue
      }
      const chatKey = key.slice(0, -(isMeta ? META : FILES).length)
      const held = byChat.get(chatKey) ?? { chatKey, savedAt: 0, payload: null, files: [] }
      held.savedAt = Math.max(held.savedAt, value.savedAt)

      if (isMeta) {
        const plain = decryptText((value as MetaRecord).sealed)
        if (!plain) {
          stale.push(key)
          continue
        }
        held.payload = JSON.parse(plain)
      } else {
        held.files = (value as FilesRecord).files ?? []
      }
      byChat.set(chatKey, held)
    }

    if (stale.length > 0) void delMany(stale, store)
    return [...byChat.values()]
  } catch (error) {
    // Private mode, a full disk, a corrupt row — a draft is a convenience and
    // must never stop the app from starting.
    logger.warn('could not read composer drafts', error)
    return []
  }
}

/** Save the text/reply/edit half of a chat's draft, or drop it with `null`. */
export async function writeComposerDraftMeta(chatKey: string, payload: unknown | null) {
  try {
    if (payload === null) await delMany([chatKey + META], store)
    else {
      const record: MetaRecord = { savedAt: Date.now(), sealed: encryptText(JSON.stringify(payload)) }
      await setMany([[chatKey + META, record]], store)
    }
  } catch (error) {
    logger.warn('could not save composer draft', error)
  }
}

/** Save the attachments half of a chat's draft; an empty list drops it. */
export async function writeComposerDraftFiles(chatKey: string, files: File[]) {
  try {
    if (files.length === 0) await delMany([chatKey + FILES], store)
    else {
      const record: FilesRecord = { savedAt: Date.now(), files }
      await setMany([[chatKey + FILES, record]], store)
    }
  } catch (error) {
    logger.warn('could not save draft attachments', error)
  }
}

/** Forget every draft on this device — on sign-out. */
export async function clearComposerDrafts() {
  try {
    await clear(store)
  } catch (error) {
    logger.warn('could not clear composer drafts', error)
  }
}
