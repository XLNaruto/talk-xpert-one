import { useCallback, useState } from 'react'
import { fieldErrors } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth-store'
import type { Id } from '@/types/api'
import { useBroadcastListActions } from '../api/use-broadcasts'
import { broadcastListSchema } from '../schemas'
import type { BroadcastListDetail } from '../types'

export type BroadcastListErrors = Partial<Record<'name' | 'talkUserIds', string>>

/**
 * Building a list, or changing who is on one.
 *
 * Create sends the name and the people together. Edit sends the WHOLE new set of
 * people — the server replaces the recipients with exactly what the picker
 * shows, so adding and removing are one call — and only renames when the name
 * actually changed, since the two are separate routes.
 */
export function useBroadcastListForm({
  existing,
  onDone,
}: {
  /** The list being edited; absent when creating one. */
  existing?: BroadcastListDetail | null
  onDone: (list: BroadcastListDetail) => void
}) {
  const selfId = useAuthStore((s) => s.identity?.talkUserId)
  const { create, rename, setRecipients, isPending } = useBroadcastListActions()
  const [name, setName] = useState(existing?.name ?? '')
  const [talkUserIds, setTalkUserIds] = useState<Id[]>(
    existing?.recipients.map((recipient) => recipient.talkUserId) ?? [],
  )
  const [query, setQuery] = useState('')
  const [errors, setErrors] = useState<BroadcastListErrors>({})

  const changeName = useCallback((value: string) => {
    setName(value)
    setErrors((held) => (held.name ? { ...held, name: undefined } : held))
  }, [])

  const changeTalkUserIds = useCallback((ids: Id[]) => {
    setTalkUserIds(ids)
    setErrors((held) => (held.talkUserIds ? { ...held, talkUserIds: undefined } : held))
  }, [])

  const submit = useCallback(async () => {
    const parsed = broadcastListSchema.safeParse({ name, talkUserIds })
    if (!parsed.success) {
      setErrors(fieldErrors<keyof BroadcastListErrors>(parsed.error))
      return
    }
    setErrors({})
    const cleanName = parsed.data.name?.trim() || null
    const ids = [...new Set(parsed.data.talkUserIds)]

    if (!existing) {
      const created = await create(cleanName, ids)
      if (created) onDone(created)
      return
    }

    let latest: BroadcastListDetail | null = existing
    if (cleanName !== (existing.name ?? null)) {
      latest = await rename(existing.id, cleanName)
      if (!latest) return
    }
    const before = new Set(existing.recipients.map((recipient) => recipient.talkUserId))
    const changed = ids.length !== before.size || ids.some((id) => !before.has(id))
    if (changed) {
      latest = await setRecipients(existing.id, ids)
      if (!latest) return
    }
    onDone(latest)
  }, [name, talkUserIds, existing, create, rename, setRecipients, onDone])

  return {
    name,
    changeName,
    talkUserIds,
    changeTalkUserIds,
    query,
    setQuery,
    errors,
    isPending,
    submit,
    /** Myself — a list of my own cannot hold me. */
    excludeIds: selfId != null ? [selfId] : [],
  }
}
