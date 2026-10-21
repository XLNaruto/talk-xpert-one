import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { usePollVotes } from '../api/use-polls'
import { formatDateTime } from '../lib/message-formatters'
import { resolveTalkUser } from '../lib/talk-directory'
import { Tab } from './reactions-dialog'

/**
 * "View votes" — an All tab and one per option, badged with the counts.
 *
 * A bubble names three voters per option at most; this is where everyone is.
 * Votes are not anonymous to anybody who can read the poll.
 */
export function PollVotesDialog({
  chatId,
  messageId,
  question,
  selfTalkUserId,
  onClose,
}: {
  chatId: Id
  /** The poll's MESSAGE id. */
  messageId: Id
  question: string | null
  selfTalkUserId: Id | null
  onClose: () => void
}) {
  const [optionId, setOptionId] = useState<Id | null>(null)
  const { votes, error, isLoading } = usePollVotes(chatId, messageId, optionId)
  const mediaUrl = useMediaUrl()

  return (
    <Modal title="Votes" description={question ?? undefined} onClose={onClose}>
      {votes && (
        <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1" role="tablist">
          <Tab isActive={optionId === null} onClick={() => setOptionId(null)}>
            All <span className="tabular-nums opacity-70">{votes.totalVoters}</span>
          </Tab>
          {votes.options.map((option) => (
            <Tab
              key={option.id}
              isActive={optionId === option.id}
              onClick={() => setOptionId(option.id)}
            >
              <span className="max-w-32 truncate">{option.text}</span>
              <span className="tabular-nums opacity-70">{option.voteCount}</span>
            </Tab>
          ))}
        </div>
      )}

      {error ? (
        <p className="text-xs text-muted-foreground">{error}</p>
      ) : isLoading && !votes ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : !votes || votes.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {optionId === null ? 'Nobody has voted yet.' : 'Nobody picked this option.'}
        </p>
      ) : (
        <ul className={cn('grid gap-2', isLoading && 'opacity-60')}>
          {votes.items.map((item) => {
            const person = resolveTalkUser(item.talkUserId, item.name, item.photo)
            return (
              // One person can appear once per option on a multiple-choice poll.
              <li key={`${item.talkUserId}:${item.optionId}`} className="flex items-center gap-2">
                <Avatar
                  name={person.name}
                  src={mediaUrl(person.avatarKey) || undefined}
                  className="size-7 text-[10px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {item.talkUserId === selfTalkUserId ? 'You' : person.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.optionText} · {formatDateTime(item.votedAt)}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
