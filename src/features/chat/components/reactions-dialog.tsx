import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { useReactionBreakdown } from '../api/use-reactions'
import { formatDateTime } from '../lib/message-formatters'
import { resolveTalkUser } from '../lib/talk-directory'

/**
 * "View reactions" — an All tab and one per emoji, badged with the counts.
 *
 * Reactions are not anonymous: anyone who can read the message can see who
 * reacted, and I appear in the list like anyone else, labelled "You".
 */
export function ReactionsDialog({
  chatId,
  messageId,
  selfTalkUserId,
  onClose,
}: {
  chatId: Id
  messageId: Id
  selfTalkUserId: Id | null
  onClose: () => void
}) {
  // The open tab is purely visual; the read it drives lives in the hook.
  const [tab, setTab] = useState<string | null>(null)
  const { breakdown, error, isLoading } = useReactionBreakdown(chatId, messageId, tab)
  const mediaUrl = useMediaUrl()

  return (
    <Modal title="Reactions" onClose={onClose}>
      {breakdown && (
        <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1" role="tablist">
          <Tab isActive={tab === null} onClick={() => setTab(null)}>
            All <span className="tabular-nums opacity-70">{breakdown.total}</span>
          </Tab>
          {breakdown.reactions.map((chip) => (
            <Tab key={chip.emoji} isActive={tab === chip.emoji} onClick={() => setTab(chip.emoji)}>
              {chip.emoji} <span className="tabular-nums opacity-70">{chip.count}</span>
            </Tab>
          ))}
        </div>
      )}

      {error ? (
        <p className="text-xs text-muted-foreground">{error}</p>
      ) : isLoading && !breakdown ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : !breakdown || breakdown.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody has reacted to this yet.</p>
      ) : (
        <ul className={cn('grid gap-2', isLoading && 'opacity-60')}>
          {breakdown.items.map((item) => {
            const person = resolveTalkUser(item.talkUserId, item.name, item.photo)
            return (
              <li key={item.talkUserId} className="flex items-center gap-2">
                <Avatar
                  name={person.name}
                  src={mediaUrl(person.avatarKey) || undefined}
                  className="size-7 text-[10px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {item.talkUserId === selfTalkUserId ? 'You' : person.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {formatDateTime(item.reactedAt)}
                  </span>
                </span>
                <span className="text-lg" aria-label={`Reacted with ${item.emoji}`}>
                  {item.emoji}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

/** One tab of a people-by-choice sheet — reactions here, poll options too. */
export function Tab({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        'flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        isActive
          ? 'bg-primary-fill text-primary-fill-foreground'
          : 'border border-border bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
