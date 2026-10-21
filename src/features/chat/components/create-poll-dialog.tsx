import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/common/form-field'
import { Modal } from '@/components/common/modal'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { POLL_DURATIONS, POLL_OPTION_MAX, POLL_QUESTION_MAX } from '../constants'
import { useCreatePollForm } from '../hooks/use-create-poll-form'

/**
 * Create a poll. Markup only — the form and the post live in
 * `use-create-poll-form`.
 *
 * Stays open while it posts and on a failure, so nothing typed into eight
 * options is lost to a dropped connection.
 */
export function CreatePollDialog({ chatId, onClose }: { chatId: Id; onClose: () => void }) {
  const poll = useCreatePollForm(chatId, onClose)
  const { register, formState, setValue } = poll.form
  const errors = formState.errors

  return (
    <Modal
      title="Create poll"
      description="Ask a question and let everyone here vote."
      onClose={onClose}
      side="right"
      footer={
        <Button className="w-full" onClick={() => void poll.onSubmit()} disabled={poll.isPending}>
          {poll.isPending && <Loader2 className="animate-spin" />}
          Send poll
        </Button>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void poll.onSubmit()
        }}
      >
        <Field label="Question" htmlFor="poll-question" error={errors.question?.message}>
          <Input
            id="poll-question"
            autoFocus
            maxLength={POLL_QUESTION_MAX}
            placeholder="Which day suits everyone?"
            aria-invalid={errors.question ? true : undefined}
            {...register('question')}
          />
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium">Options</legend>
          {poll.options.map((field, index) => {
            const error = errors.options?.[index]?.text?.message
            return (
              <div key={field.id} className="grid gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    maxLength={POLL_OPTION_MAX}
                    placeholder={`Option ${index + 1}`}
                    aria-label={`Option ${index + 1}`}
                    aria-invalid={error ? true : undefined}
                    {...register(`options.${index}.text`)}
                  />
                  {poll.canRemoveOption && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      onClick={() => poll.removeOption(index)}
                      aria-label={`Remove option ${index + 1}`}
                    >
                      <X />
                    </Button>
                  )}
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
            )
          })}
          {errors.options?.root?.message && (
            <p className="text-xs text-destructive">{errors.options.root.message}</p>
          )}
          {poll.canAddOption && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={poll.addOption}
            >
              <Plus />
              Add option
            </Button>
          )}
        </fieldset>

        <label
          htmlFor="poll-allow-multiple"
          className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-accent/40"
        >
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">Allow multiple answers</span>
            <span className="text-xs text-muted-foreground">
              {poll.allowMultiple
                ? 'People can pick more than one option.'
                : 'People pick one option.'}
            </span>
          </span>
          <Switch
            id="poll-allow-multiple"
            checked={poll.allowMultiple}
            onCheckedChange={(checked) => setValue('allowMultiple', checked, { shouldDirty: true })}
          />
        </label>

        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium">Close automatically</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Close automatically">
            {POLL_DURATIONS.map((choice) => {
              const isPicked = poll.durationMinutes === choice.minutes
              return (
                <button
                  key={choice.label}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  onClick={() =>
                    setValue('durationMinutes', choice.minutes, { shouldDirty: true })
                  }
                  className={cn(
                    'cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    isPicked
                      ? 'bg-primary-fill text-primary-fill-foreground'
                      : 'border border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {choice.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {poll.durationMinutes === null
              ? 'Stays open until you close it.'
              : 'Closes on its own when the time is up. You can still close it sooner.'}
          </p>
        </fieldset>
      </form>
    </Modal>
  )
}
