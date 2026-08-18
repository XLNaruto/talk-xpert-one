import { useCallback, useState } from 'react'
import { fieldErrors } from '@/lib/validation'
import { useChatActions } from '../api/use-chat-actions'
import { groupSettingsSchema } from '../schemas'
import type { Chat } from '../types'

/** Which field each message belongs under. */
export type GroupDetailsErrors = Partial<Record<'name' | 'description', string>>

/**
 * The rename form in the conversation details sheet.
 *
 * Errors are keyed by field rather than kept as one string, so "Group name is
 * required" sits under the group name box instead of at the foot of the section
 * where it reads as being about the description. Typing in a field clears its own
 * message — leaving it up while the person fixes it is what makes a form feel
 * like it is arguing.
 */
export function useGroupDetailsForm(chat: Chat) {
  const { updateChat, isPending } = useChatActions()

  const [name, setName] = useState(chat.name ?? '')
  const [description, setDescription] = useState(chat.description ?? '')
  const [errors, setErrors] = useState<GroupDetailsErrors>({})

  const clear = useCallback((field: keyof GroupDetailsErrors) => {
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

  const submit = useCallback(async () => {
    const parsed = groupSettingsSchema.safeParse({ name, description })
    if (!parsed.success) {
      setErrors(fieldErrors<keyof GroupDetailsErrors>(parsed.error))
      return
    }
    setErrors({})
    await updateChat(chat.id, {
      name: parsed.data.name,
      description: parsed.data.description || null,
    })
  }, [chat.id, description, name, updateChat])

  return { name, changeName, description, changeDescription, errors, isPending, submit }
}
