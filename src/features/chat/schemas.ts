import { z } from 'zod'
import { MAX_ATTACHMENT_BYTES } from '@/lib/uploads'
import { requiredText } from '@/lib/validation'
import {
  BROADCAST_MAX_RECIPIENTS,
  BROADCAST_MIN_RECIPIENTS,
  BROADCAST_NAME_MAX,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
} from './constants'

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

/**
 * A poll — the server's limits, said before a 400 does. Options are compared
 * without case, because the server treats "Same" and "same" as duplicates.
 */
export const pollFormSchema = z.object({
  question: requiredText('Question').max(
    POLL_QUESTION_MAX,
    `Keep the question under ${POLL_QUESTION_MAX} characters`,
  ),
  options: z
    .array(
      z.object({
        text: z
          .string()
          .trim()
          .min(1, 'Fill in this option or remove it')
          .max(POLL_OPTION_MAX, `Keep each option under ${POLL_OPTION_MAX} characters`),
      }),
    )
    .min(POLL_MIN_OPTIONS, `A poll needs at least ${POLL_MIN_OPTIONS} options`)
    .max(POLL_MAX_OPTIONS, `A poll can have up to ${POLL_MAX_OPTIONS} options`)
    .superRefine((options, ctx) => {
      const seen = new Set<string>()
      options.forEach((option, index) => {
        const key = option.text.trim().toLowerCase()
        if (!key) return
        if (seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            message: 'This option is already in the poll',
            path: [index, 'text'],
          })
        }
        seen.add(key)
      })
    }),
  allowMultiple: z.boolean(),
  durationMinutes: z.number().int().min(1).max(10080).nullable(),
})

export type PollFormValues = z.infer<typeof pollFormSchema>

/** A broadcast list: an optional name and 2–256 different people. */
export const broadcastListSchema = z.object({
  name: z
    .string()
    .max(BROADCAST_NAME_MAX, `Keep the name under ${BROADCAST_NAME_MAX} characters`)
    .optional(),
  talkUserIds: z
    .array(z.number())
    .min(BROADCAST_MIN_RECIPIENTS, `Pick at least ${BROADCAST_MIN_RECIPIENTS} people`)
    .max(BROADCAST_MAX_RECIPIENTS, `A list holds up to ${BROADCAST_MAX_RECIPIENTS} people`),
})

export type BroadcastListValues = z.infer<typeof broadcastListSchema>
