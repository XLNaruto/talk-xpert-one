import { useCallback, useEffect, useState } from 'react'
import { AVATAR_CONTENT_TYPES } from '@/lib/uploads'
import { fieldErrors } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth-store'
import type { Id } from '@/types/api'
import { useChatActions } from '../api/use-chat-actions'
import { groupFormSchema } from '../schemas'

/**
 * Which field each message belongs under. `photo` is not a schema field — a
 * rejected file type is caught at the moment of picking, not on submit — but it
 * is reported the same way so the sheet has one place to look.
 */
export type CreateGroupErrors = Partial<
  Record<'name' | 'description' | 'talkUserIds' | 'photo', string>
>

/**
 * Everything the New group screen holds: the name, the picture, who is in it,
 * and the two-step save behind it.
 *
 * Errors are keyed by field rather than kept as one string: "Group name is
 * required" belongs under the name box, and "Add at least one person" under the
 * member list — collapsed into one line at the bottom of the sheet, both read as
 * being about whatever control they happen to sit below.
 *
 * The picture cannot ride along with the create call — the avatar presign is
 * addressed to a chat that does not exist yet — so it is uploaded straight
 * after, against the id the create answers. A group that saved but whose picture
 * did not is still a group: the upload failing toasts and the dialog still
 * closes, rather than stranding the user in a form whose submit already worked.
 */
export function useCreateGroupForm(onDone: () => void) {
  const selfId = useAuthStore((s) => s.identity?.talkUserId)
  const { createGroup, uploadAvatar, isPending } = useChatActions()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [talkUserIds, setTalkUserIds] = useState<Id[]>([])
  const [query, setQuery] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [errors, setErrors] = useState<CreateGroupErrors>({})

  // An object URL is a live handle on the file — released when the choice
  // changes or the dialog goes away, or every re-pick leaks one.
  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  // Typing in a field clears its own message — leaving it up while the person is
  // fixing it is what makes a form feel like it is arguing.
  const clear = useCallback((field: keyof CreateGroupErrors) => {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }, [])

  const changeName = useCallback(
    (value: string) => {
      setName(value)
      clear('name')
    },
    [clear],
  )

  const changeDescription = useCallback(
    (value: string) => {
      setDescription(value)
      clear('description')
    },
    [clear],
  )

  const changeTalkUserIds = useCallback(
    (ids: Id[]) => {
      setTalkUserIds(ids)
      clear('talkUserIds')
    },
    [clear],
  )

  const choosePhoto = useCallback(
    (file: File | null) => {
      if (
        file &&
        !AVATAR_CONTENT_TYPES.includes(file.type as (typeof AVATAR_CONTENT_TYPES)[number])
      ) {
        setErrors((current) => ({ ...current, photo: 'Choose a JPEG, PNG or WebP image' }))
        return
      }
      clear('photo')
      setPhoto(file)
    },
    [clear],
  )

  const submit = useCallback(async () => {
    const parsed = groupFormSchema.safeParse({ name, description, talkUserIds })
    if (!parsed.success) {
      // The photo message survives a failed submit: the file it is about was
      // never accepted, so the box is still empty and the reason still applies.
      setErrors((current) => ({
        ...fieldErrors<keyof CreateGroupErrors>(parsed.error),
        photo: current.photo,
      }))
      return
    }
    setErrors({})

    const chatId = await createGroup({
      name: parsed.data.name,
      description: parsed.data.description || null,
      talkUserIds: parsed.data.talkUserIds,
    })
    if (chatId == null) return

    if (photo) await uploadAvatar(chatId, photo, false)
    onDone()
  }, [createGroup, description, name, onDone, photo, talkUserIds, uploadAvatar])

  return {
    name,
    changeName,
    description,
    changeDescription,
    talkUserIds,
    changeTalkUserIds,
    query,
    setQuery,
    photoPreview,
    choosePhoto,
    /** Myself — the owner is added by the server, so never offered as a member. */
    excludeIds: selfId != null ? [selfId] : [],
    errors,
    isPending,
    submit,
  }
}
