import { useRef } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Id } from '@/types/api'
import { useCreatePoll } from '../api/use-polls'
import { EMPTY_POLL_FORM, POLL_MAX_OPTIONS, POLL_MIN_OPTIONS } from '../constants'
import { pollFormSchema, type PollFormValues } from '../schemas'

/**
 * The New poll screen: the question, the options, single or multiple choice,
 * and the timer — and the post behind it.
 *
 * One `client_message_id` per OPENING of the form rather than per submit, so a
 * second press after a timeout replays the same create instead of posting the
 * poll twice.
 */
export function useCreatePollForm(chatId: Id, onDone: () => void) {
  const { create, isPending } = useCreatePoll()
  const clientMessageId = useRef(crypto.randomUUID())

  const form = useForm<PollFormValues>({
    resolver: zodResolver(pollFormSchema),
    defaultValues: {
      ...EMPTY_POLL_FORM,
      options: EMPTY_POLL_FORM.options.map((option) => ({ ...option })),
    },
  })
  const options = useFieldArray({ control: form.control, name: 'options' })

  const onSubmit = form.handleSubmit(async (values) => {
    const ok = await create({
      chatId,
      question: values.question,
      options: values.options.map((option) => option.text),
      allowMultiple: values.allowMultiple,
      durationMinutes: values.durationMinutes,
      clientMessageId: clientMessageId.current,
    })
    if (ok) onDone()
  })

  return {
    form,
    options: options.fields,
    addOption: () => options.append({ text: '' }, { shouldFocus: true }),
    removeOption: options.remove,
    canAddOption: options.fields.length < POLL_MAX_OPTIONS,
    canRemoveOption: options.fields.length > POLL_MIN_OPTIONS,
    allowMultiple: form.watch('allowMultiple'),
    durationMinutes: form.watch('durationMinutes'),
    onSubmit,
    isPending,
  }
}
