import { useCallback, useMemo, useState } from 'react'
import { useTalkDirectoryStore } from '@/stores/talk-directory-store'
import { keyOf, type Id } from '@/types/api'
import { useContacts } from '../api/use-contacts'
import { contactSubtitle } from '../lib/chat-labels'
import { resolveTalkUser } from '../lib/talk-directory'
import type { Contact } from '../types'

interface UsePeoplePickerOptions {
  selectedIds: Id[]
  /** Ids to hide — already in the group, or myself. */
  excludeIds?: Id[]
  onChange: (ids: Id[]) => void
  /**
   * The search box, when the SCREEN owns it (the New group sheet has its own).
   * Leave it out and the picker keeps its own — `search`/`setSearch` below.
   */
  query?: string
}

export interface PickerCandidate {
  id: Id
  name: string
  /** A storage KEY — the component runs it through `useMediaUrl()`. */
  avatarKey: string | null
  /** Their role and where they work, or their login — how to tell two Ashas apart. */
  subtitle: string | null
  isSelected: boolean
}

/**
 * Who a group can be built from, and how they are found.
 *
 * `GET /talk/contacts` is the DIRECTORY, so the pool is no longer whoever we
 * happened to have seen: it is every Talk identity of the organisation an
 * administrator granted me reach to, read live, alphabetically. Reach is granted
 * rather than assumed, so an empty list is a real answer — nobody was granted —
 * and not a failed read.
 *
 * SEARCH IS SERVER-SIDE. The list pages, so filtering the loaded page in the
 * browser would search thirty names instead of the organisation, and it matches
 * the Talk login as well as the name, which the rows do not all carry.
 *
 * A person chosen and then searched away STAYS on screen and stays counted —
 * a selection that vanishes because the query moved reads as having been undone.
 */
export function usePeoplePicker({
  selectedIds,
  excludeIds = [],
  onChange,
  query,
}: UsePeoplePickerOptions) {
  const [ownQuery, setOwnQuery] = useState('')
  // Controlled when the screen passes a query; self-owned otherwise.
  const search = query ?? ownQuery

  const { contacts, total, isLoading, isSearching, isLoadingMore, hasMore, loadMore } =
    useContacts({ search })

  // Everyone the user has ticked, remembered as they were drawn — the next
  // search will not contain them and the row still has to render.
  const [picked, setPicked] = useState<Record<string, PickerCandidate>>({})
  const people = useTalkDirectoryStore((s) => s.people)

  // `excludeIds` and `selectedIds` are usually fresh arrays each render, so key
  // the memo on their contents or the list rebuilds on every keystroke.
  const excludeKey = excludeIds.join(',')
  const selectedKey = selectedIds.join(',')

  const candidates = useMemo<PickerCandidate[]>(() => {
    const excluded = new Set(excludeKey ? excludeKey.split(',').map(Number) : [])
    const selected = selectedKey ? selectedKey.split(',').map(Number) : []
    const isSelected = new Set(selected)

    const rows = contacts
      .filter((contact) => !excluded.has(contact.talkUserId))
      .map((contact) => toCandidate(contact, isSelected.has(contact.talkUserId)))

    const shown = new Set(rows.map((row) => row.id))
    // Chosen, but off the current page or outside the current search.
    const offscreen = selected
      .filter((id) => !shown.has(id) && !excluded.has(id))
      .map((id) => {
        const held = picked[keyOf(id)]
        if (held) return { ...held, isSelected: true }
        const entry = people[keyOf(id)]
        const person = resolveTalkUser(id, entry?.name, entry?.photo)
        return {
          id,
          name: person.name,
          avatarKey: person.avatarKey,
          subtitle: null,
          isSelected: true,
        }
      })

    return [...offscreen, ...rows]
  }, [contacts, excludeKey, people, picked, selectedKey])

  const toggle = useCallback(
    (id: Id) => {
      const isOn = selectedIds.includes(id)
      if (!isOn) {
        const contact = contacts.find((row) => row.talkUserId === id)
        if (contact) {
          setPicked((held) => ({ ...held, [keyOf(id)]: toCandidate(contact, true) }))
        }
      }
      onChange(isOn ? selectedIds.filter((held) => held !== id) : [...selectedIds, id])
    },
    [contacts, onChange, selectedIds],
  )

  return {
    candidates,
    toggle,
    /** How many the directory has for this search, not how many are drawn. */
    total,
    isLoading,
    /** True while the debounce still holds the newest keystroke. */
    isSearching,
    isLoadingMore,
    hasMore,
    loadMore,
    search,
    setSearch: setOwnQuery,
    /** False when the screen owns the search box, so the picker hides its own. */
    ownsSearch: query === undefined,
  }
}

function toCandidate(contact: Contact, isSelected: boolean): PickerCandidate {
  const person = resolveTalkUser(contact.talkUserId, contact.name, contact.photo)
  return {
    id: contact.talkUserId,
    name: person.name,
    avatarKey: person.avatarKey,
    subtitle: contactSubtitle(contact),
    isSelected,
  }
}
