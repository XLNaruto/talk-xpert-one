import { create } from 'zustand'
import { keyOf, type Id } from '@/types/api'

/**
 * Everyone we have seen a name for, keyed by `talk_user_id`.
 *
 * Talk now answers a `name` and a `photo` beside every person-shaped id — on
 * chats, members, messages, receipts, presence and blocks — so almost every
 * screen draws a person straight from the payload it already holds.
 *
 * TWO things still arrive as a bare id: `talk.typing.start` / `talk.typing.stop`
 * (`{ chat_id, talk_user_id }`) and `talk.presence` (`{ talk_user_id, is_online,
 * at }`). "Member 42 is typing…" is the one thing the API cannot fix, so this
 * remembers what the REST reads already told us and the indicator looks it up.
 *
 * A cache only, and not persisted: names live on the master record and change
 * behind our back, so a cold launch refills it from the first chat-list read
 * rather than painting a stale name from disk.
 */
export interface TalkPerson {
  talkUserId: Id
  /** Null when the master record is gone — the API reports that explicitly. */
  name: string | null
  /** Avatar storage KEY, never a URL. Render it through `useMediaUrl()`. */
  photo: string | null
}

interface TalkDirectoryState {
  people: Record<string, TalkPerson>
  /** Merge in whatever a response carried. Nulls never overwrite a known value. */
  remember: (entries: ReadonlyArray<TalkPerson | null | undefined>) => void
  clear: () => void
}

export const useTalkDirectoryStore = create<TalkDirectoryState>((set) => ({
  people: {},

  remember: (entries) =>
    set((s) => {
      let changed = false
      const people = { ...s.people }

      for (const entry of entries) {
        if (!entry || entry.talkUserId == null) continue
        const key = keyOf(entry.talkUserId)
        const held = people[key]
        // A response that omits the name — a deleted master record — must not
        // blank a name an earlier one gave us.
        const name = entry.name ?? held?.name ?? null
        const photo = entry.photo ?? held?.photo ?? null
        if (held && held.name === name && held.photo === photo) continue
        people[key] = { talkUserId: entry.talkUserId, name, photo }
        changed = true
      }

      return changed ? { people } : {}
    }),

  clear: () => set({ people: {} }),
}))

/** Merge from outside React — the `api/` layer and the socket handlers. */
export function rememberPeople(entries: ReadonlyArray<TalkPerson | null | undefined>): void {
  useTalkDirectoryStore.getState().remember(entries)
}

/** One person, outside React. Undefined when nothing has named them yet. */
export function knownPerson(talkUserId: Id): TalkPerson | undefined {
  return useTalkDirectoryStore.getState().people[keyOf(talkUserId)]
}
