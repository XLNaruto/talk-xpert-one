import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { keyOf, type Id } from '@/types/api'
import type { Chat, Contact } from '../types'

/**
 * The key that names one row of the search results.
 *
 * Two sources are stacked under one cursor — conversations, then directory
 * people — and an integer index alone could not tell "chat 7" from "person 7".
 * The cursor is held as this key rather than as a position so that a row keeps
 * the highlight while the lists re-rank underneath it: the term is searched
 * server-side and every keystroke can reorder both halves.
 */
type CursorKey = `chat:${string}` | `contact:${string}`

export const chatCursorKey = (chatId: Id): CursorKey => `chat:${keyOf(chatId)}`
export const contactCursorKey = (talkUserId: Id): CursorKey =>
  `contact:${keyOf(talkUserId)}`

interface SearchCursorOptions {
  /** The conversation hits, in the order the sidebar draws them. */
  chats: Chat[]
  /** The directory hits, drawn under the conversations. */
  contacts: Contact[]
  /** Only while the search field is open — the list is not keyboard-driven otherwise. */
  enabled: boolean
  onPickChat: (chatId: Id) => void
  onPickContact: (contact: Contact) => void
}

/**
 * Arrow-key navigation over the sidebar's search results.
 *
 * Down and up walk the two lists as ONE run and wrap at both ends; Enter opens
 * whatever is highlighted, and with nothing highlighted it opens the first hit —
 * so the common case ("type a name, press Enter") costs no arrow press at all.
 * Nothing is highlighted until an arrow is pressed: a pre-selected first row
 * would make Enter feel like it picked something the user never aimed at.
 */
export function useSearchCursor({
  chats,
  contacts,
  enabled,
  onPickChat,
  onPickContact,
}: SearchCursorOptions) {
  const [cursorKey, setCursorKey] = useState<CursorKey | null>(null)

  /** The two halves, flattened into the order they are rendered in. */
  const rows = useMemo(
    () => [
      ...chats.map((chat) => ({ key: chatCursorKey(chat.id), open: () => onPickChat(chat.id) })),
      ...contacts.map((contact) => ({
        key: contactCursorKey(contact.talkUserId),
        open: () => onPickContact(contact),
      })),
    ],
    [chats, contacts, onPickChat, onPickContact],
  )

  // A highlighted row that the newest results no longer contain would leave the
  // cursor pointing at nothing, and Enter would do nothing with it.
  useEffect(() => {
    if (cursorKey !== null && !rows.some((row) => row.key === cursorKey)) setCursorKey(null)
  }, [cursorKey, rows])

  useEffect(() => {
    if (!enabled) setCursorKey(null)
  }, [enabled])

  const move = useCallback(
    (step: 1 | -1) => {
      if (rows.length === 0) return
      setCursorKey((held) => {
        const at = held === null ? -1 : rows.findIndex((row) => row.key === held)
        // From nowhere, down lands on the first row and up on the last.
        const next = at === -1 ? (step === 1 ? 0 : rows.length - 1) : at + step
        return rows[(next + rows.length) % rows.length].key
      })
    },
    [rows],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return
      if (event.key === 'ArrowDown') {
        // Otherwise the caret jumps to the end of the term on every press.
        event.preventDefault()
        move(1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        move(-1)
        return
      }
      if (event.key === 'Enter') {
        const row = rows.find((candidate) => candidate.key === cursorKey) ?? rows[0]
        if (!row) return
        event.preventDefault()
        row.open()
      }
    },
    [cursorKey, enabled, move, rows],
  )

  return { cursorKey, setCursorKey, onKeyDown }
}
