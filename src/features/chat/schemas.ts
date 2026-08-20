import { z } from 'zod'
import { MAX_ATTACHMENT_BYTES } from '@/lib/uploads'
import { requiredText } from '@/lib/validation'

/**
 * A message needs text, attachments, or both — the API answers 400 for neither,
 * so the composer says so before spending a request. The body itself is
 * unbounded: the server sets whatever ceiling exists, not the composer.
 */
export const messageInputSchema = z
  .object({
    body: z.string(),
    files: z
      .array(
        z
          .instanceof(File)
          .refine((f) => f.size <= MAX_ATTACHMENT_BYTES, 'Attachments must be under 25 MB'),
      )
      .default([]),
  })
  .refine((v) => v.body.trim().length > 0 || v.files.length > 0, {
    message: 'Type a message or attach a file',
    path: ['body'],
  })

export type MessageInputValues = z.infer<typeof messageInputSchema>

/** Creating a group. The owner is whoever creates it — never a form field. */
export const groupFormSchema = z.object({
  name: requiredText('Group name').max(120, 'Keep the name under 120 characters'),
  description: z.string().max(500, 'Keep the description under 500 characters').optional(),
  talkUserIds: z.array(z.number()).min(1, 'Add at least one person'),
})

export type GroupFormValues = z.infer<typeof groupFormSchema>

/** Renaming an existing group. Owner only — the API enforces it too. */
export const groupSettingsSchema = z.object({
  name: requiredText('Group name').max(120, 'Keep the name under 120 characters'),
  description: z.string().max(500, 'Keep the description under 500 characters').optional(),
})

export type GroupSettingsValues = z.infer<typeof groupSettingsSchema>
