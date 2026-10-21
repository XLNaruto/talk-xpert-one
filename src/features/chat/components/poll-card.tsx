import { BarChart3, Check, Loader2, Lock, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { usePollCard } from '../hooks/use-poll-card'
import { optionPercent, pollStatusLine } from '../lib/polls'
import { resolveTalkUser } from '../lib/talk-directory'
import type { ChatMessage } from '../types'

/** At most three faces inline; everybody else is behind "View votes". */
const INLINE_VOTERS = 3

/**
 * A poll, inside its bubble. The question is the message's `body`; everything
 * else is the `poll` block.
 *
 * Each option row IS its own result bar — the fill grows behind the label — and
 * the whole row is the vote button. Once closed the bars stay, the buttons stop,
 * and the leading option is drawn heavier so it reads as a result sheet. The
 * percentages divide by PEOPLE who voted (`total_voters`), so on a
 * multiple-choice poll they can add up to more than a hundred.
 *
 * The sent bubble is saturated with white text and the received one a light
 * surface, so every colour below comes in two: white washes on mine, primary
 * tints on theirs.
 */
export function PollCard({
  message,
  isMine,
  canVote,
  canClose,
  selfTalkUserId,
  onVote,
  onClosePoll,
  onShowVotes,
}: {
  message: ChatMessage
  isMine: boolean
  /** False in a group I left or was muted in — the results still show. */
  canVote: boolean
  canClose: boolean
  selfTalkUserId: Id | null
  onVote: (message: ChatMessage, optionIds: Id[]) => Promise<boolean>
  onClosePoll: (message: ChatMessage) => void
  onShowVotes: (message: ChatMessage) => void
}) {
  const poll = message.poll
  const mediaUrl = useMediaUrl()
  const { now, isClosed, pendingOptionId, tap } = usePollCard(message, onVote)
  if (!poll) return null

  const interactive = canVote && !isClosed
  const topCount = Math.max(0, ...poll.options.map((option) => option.voteCount))
  const muted = isMine ? 'text-white/70' : 'text-muted-foreground'
  const showClose = canClose && !isClosed

  return (
    // A width of its own, so a two-word question does not squeeze the options
    // into a column too narrow to read a bar in.
    <div className="grid w-[min(20rem,70vw)] gap-3">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-px flex size-7 shrink-0 items-center justify-center rounded-lg',
            isMine ? 'bg-white/20 text-white' : 'bg-primary/12 text-primary',
          )}
          aria-hidden
        >
          <BarChart3 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug wrap-anywhere">{message.body}</p>
          <p className={cn('mt-1 text-[11px] leading-none', muted)}>
            {isClosed
              ? 'Final results'
              : poll.allowMultiple
                ? 'Select one or more'
                : 'Select one'}
          </p>
        </div>
        {isClosed && (
          <span
            className={cn(
              'mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold tracking-wider uppercase',
              isMine ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
            )}
          >
            <Lock className="size-2.5" aria-hidden />
            Closed
          </span>
        )}
      </div>

      <ul className="grid gap-1.5" aria-label="Options">
        {poll.options.map((option) => {
          const picked = poll.myOptionIds.includes(option.id)
          const percent = optionPercent(option, poll)
          const isWinner = isClosed && option.voteCount > 0 && option.voteCount === topCount
          const lead = picked || isWinner
          const extra = Math.max(0, option.voteCount - INLINE_VOTERS)

          return (
            <li
              key={option.id}
              className={cn(
                'group/opt relative overflow-hidden rounded-xl transition-colors',
                isMine ? 'bg-white/14' : 'bg-foreground/5',
                interactive && (isMine ? 'hover:bg-white/20' : 'hover:bg-foreground/9'),
              )}
            >
              {/* The bar — a fill behind the row's content. */}
              <span
                aria-hidden
                className={cn(
                  'absolute inset-y-0 left-0 transition-[width] duration-500 ease-out',
                  isMine
                    ? lead
                      ? 'bg-white/35'
                      : 'bg-white/18'
                    : lead
                      ? 'bg-primary/25'
                      : 'bg-primary/12',
                )}
                style={{ width: `${percent}%` }}
              />

              {/* The vote target is the WHOLE row, tally and padding included.
                  The content above it lets clicks through, except the faces. */}
              <button
                type="button"
                disabled={!interactive || pendingOptionId !== null}
                onClick={() => void tap(option.id)}
                aria-pressed={picked}
                aria-label={`${option.text}, ${option.voteCount} ${option.voteCount === 1 ? 'vote' : 'votes'}, ${percent}%`}
                className={cn('absolute inset-0', interactive ? 'cursor-pointer' : 'cursor-default')}
              />

              <div className="pointer-events-none relative flex items-center gap-2 py-2.5 pr-3 pl-2.5">
                {/* A radio for single choice, a box for multiple — the shape
                    says which before the line above is read. */}
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4.5 shrink-0 items-center justify-center border-[1.5px] transition-colors',
                    poll.allowMultiple ? 'rounded-[5px]' : 'rounded-full',
                    picked
                      ? isMine
                        ? 'border-white bg-white text-primary'
                        : 'border-primary bg-primary text-white'
                      : isMine
                        ? 'border-white/55'
                        : 'border-muted-foreground/45',
                    // A closed poll is a result sheet, not a form.
                    !interactive && !picked && 'opacity-40',
                    interactive &&
                      !picked &&
                      (isMine ? 'group-hover/opt:border-white' : 'group-hover/opt:border-primary'),
                  )}
                >
                  {pendingOptionId === option.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    picked && <Check className="size-3" strokeWidth={3.5} />
                  )}
                </span>

                <span
                  className={cn(
                    'min-w-0 flex-1 text-[13.5px] leading-snug wrap-anywhere',
                    lead ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {option.text}
                </span>

                {option.voters.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onShowVotes(message)}
                    aria-label={`See who voted for ${option.text}`}
                    className="pointer-events-auto flex shrink-0 cursor-pointer -space-x-1.5 transition-opacity hover:opacity-80"
                  >
                    {option.voters.slice(0, INLINE_VOTERS).map((voter) => {
                      const person = resolveTalkUser(voter.talkUserId, voter.name, voter.photo)
                      return (
                        <Avatar
                          key={voter.talkUserId}
                          name={person.name}
                          src={mediaUrl(person.avatarKey) || undefined}
                          className={cn(
                            'size-4.5 text-[8px] ring-[1.5px]',
                            isMine ? 'ring-white/30' : 'ring-background',
                          )}
                        />
                      )
                    })}
                    {extra > 0 && (
                      <span
                        className={cn(
                          'flex h-4.5 items-center rounded-full px-1 text-[8px] font-bold ring-[1.5px]',
                          isMine
                            ? 'bg-white/30 text-white ring-white/25'
                            : 'bg-primary/15 text-primary ring-background',
                        )}
                      >
                        +{extra}
                      </span>
                    )}
                  </button>
                )}

                {/* The number people act on, with the share the bar is drawn from. */}
                <span className="flex w-7 shrink-0 flex-col items-end leading-none">
                  <span className="text-[13px] font-bold tabular-nums">{option.voteCount}</span>
                  <span className={cn('mt-0.5 text-[9px] tabular-nums', muted)}>{percent}%</span>
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      <p className={cn('flex items-center gap-1 text-[11px]', muted)}>
        {isClosed && <Lock className="size-3 shrink-0" aria-hidden />}
        {pollStatusLine(poll, now, selfTalkUserId)}
      </p>

      {(poll.totalVoters > 0 || showClose) && (
        <div className="flex items-center gap-1.5">
          {poll.totalVoters > 0 && (
            <button
              type="button"
              onClick={() => onShowVotes(message)}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-[11.5px] font-semibold transition-colors',
                isMine
                  ? 'bg-white/14 text-white hover:bg-white/25'
                  : 'bg-primary/10 text-primary hover:bg-primary/15',
              )}
            >
              <Users className="size-3.5" aria-hidden />
              View votes
            </button>
          )}
          {showClose && (
            <button
              type="button"
              onClick={() => onClosePoll(message)}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-[11.5px] font-semibold transition-colors',
                isMine
                  ? 'bg-white/14 text-white hover:bg-white/25'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
              )}
            >
              <Lock className="size-3.5" aria-hidden />
              Close poll
            </button>
          )}
        </div>
      )}
    </div>
  )
}
