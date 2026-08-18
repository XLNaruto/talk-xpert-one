import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  Forward,
  Info,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { quoteLine } from '../lib/chat-labels'
import { formatMessageTime } from '../lib/message-formatters'
import { systemMessageText } from '../lib/system-messages'
import { resolveTalkUser } from '../lib/talk-directory'
import { MessageMediaGrid } from './message-media'
import type { ChatMessage } from '../types'
import { Tip } from '@/components/common/tip'

interface MessageBubbleProps {
  message: ChatMessage
  isMine: boolean
  /** First of a run by the same person — carries the author name in groups. */
  startsGroup: boolean
  showAuthor: boolean
  selfTalkUserId: Id | null
  /** Non-null while a bulk selection is in progress. */
  isSelected: boolean | null
  onToggleSelected: (messageId: Id) => void
  onReply: (message: ChatMessage) => void
  onEdit: (message: ChatMessage) => void
  onDelete: (message: ChatMessage) => void
  onPin: (messageId: Id, pinned: boolean) => void
  onForward: (message: ChatMessage) => void
  onShowInfo: (message: ChatMessage) => void
  onRetry: (message: ChatMessage) => void
}

export function MessageBubble({
  message,
  isMine,
  startsGroup,
  showAuthor,
  selfTalkUserId,
  isSelected,
  onToggleSelected,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onForward,
  onShowInfo,
  onRetry,
}: MessageBubbleProps) {
  const mediaUrl = useMediaUrl()

  /**
   * A system message belongs to the conversation, not to a person — so it is a
   * centred line rather than a bubble, and carries none of the actions.
   */
  if (message.type === 'system') {
    return (
      <div className="flex justify-center px-3 py-1.5">
        <p className="rounded-full bg-secondary px-3 py-1 text-center text-[11px] text-muted-foreground">
          {systemMessageText(message, selfTalkUserId)}
        </p>
      </div>
    )
  }

  const selecting = isSelected !== null
  const failed = message.status === 'failed'
  // `sender_name` and `sender_photo` ride along with every message, so the run's
  // author is drawn from the message itself rather than from a second lookup.
  const author =
    message.senderTalkUserId !== null
      ? resolveTalkUser(message.senderTalkUserId, message.senderName, message.senderPhoto)
      : null

  return (
    <div
      className={cn(
        'group flex gap-2 px-3',
        isMine ? 'justify-end' : 'justify-start',
        startsGroup ? 'mt-2' : 'mt-0.5',
        isSelected && 'bg-primary/10',
      )}
      onClick={selecting ? () => onToggleSelected(message.id) : undefined}
    >
      {/* An avatar column only under a group's incoming runs; a spacer keeps the
          following bubbles of the run aligned with it. */}
      {!isMine && showAuthor && author && (
        <Avatar
          name={author.name}
          src={mediaUrl(author.avatarKey) || undefined}
          className="mt-auto size-7 shrink-0 text-[10px]"
        />
      )}
      {!isMine && !showAuthor && <span className="w-7 shrink-0" aria-hidden />}

      <div className="flex max-w-[75%] flex-col items-stretch">
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm shadow-xs',
            isMine
              ? 'rounded-br-md bg-bubble-out text-bubble-out-foreground'
              : 'rounded-bl-md bg-bubble-in text-bubble-in-foreground',
            failed && 'ring-1 ring-destructive',
          )}
        >
          {showAuthor && !isMine && author && (
            <p className="mb-0.5 text-xs font-semibold opacity-80">{author.name}</p>
          )}

          {message.isForwarded && (
            <p className="mb-1 flex items-center gap-1 text-[10px] italic opacity-70">
              <Forward className="size-3" aria-hidden />
              Forwarded
            </p>
          )}

          {/* The quote is INLINE on the message — rendered directly, with no
              second request for the message it points at. */}
          {message.replyTo && (
            <div
              className={cn(
                'mb-1 rounded-md border-l-2 px-2 py-1 text-xs',
                isMine ? 'border-white/50 bg-black/15' : 'border-primary bg-accent',
              )}
            >
              <p className="font-medium opacity-80">
                {message.replyTo.senderTalkUserId === selfTalkUserId
                  ? 'You'
                  : message.replyTo.senderTalkUserId !== null
                    ? resolveTalkUser(
                        message.replyTo.senderTalkUserId,
                        message.replyTo.senderName,
                      ).name
                    : 'Message'}
              </p>
              <p className="truncate opacity-80">{quoteLine(message)}</p>
            </div>
          )}

          {message.isDeletedForEveryone ? (
            // The tombstone. The bubble SURVIVES a delete-for-everyone, because
            // replies still point at it.
            <p className="text-xs italic opacity-70">This message was deleted</p>
          ) : (
            <>
              <MessageMediaGrid
                media={message.media}
                isMine={isMine}
                uploadProgress={message.uploadProgress}
              />
              {message.body && (
                <p className="whitespace-pre-wrap wrap-break-word">{message.body}</p>
              )}
            </>
          )}

          <span className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
            {message.isPinned && <Pin className="size-2.5" aria-label="Pinned" />}
            {message.isEdited && <span>edited</span>}
            {formatMessageTime(message.createdAt)}
            {isMine && <StatusTick message={message} />}
          </span>
        </div>

        {failed && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="mt-1 flex items-center gap-1 self-end text-[10px] text-destructive underline"
          >
            <RotateCcw className="size-3" />
            Not sent — tap to retry
          </button>
        )}

        {/* Actions appear on hover, and never during a selection or on a
            tombstone, where none of them would do anything. */}
        {!selecting && !message.isDeletedForEveryone && message.status !== 'sending' && (
          <div
            className={cn(
              'mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
              isMine ? 'justify-end' : 'justify-start',
            )}
          >
            <BubbleAction label="Reply" onClick={() => onReply(message)}>
              <CornerUpLeft />
            </BubbleAction>
            <BubbleAction label="Forward" onClick={() => onForward(message)}>
              <Forward />
            </BubbleAction>
            <BubbleAction
              label={message.isPinned ? 'Unpin' : 'Pin for everyone'}
              onClick={() => onPin(message.id, !message.isPinned)}
            >
              {message.isPinned ? <PinOff /> : <Pin />}
            </BubbleAction>
            {/* Editing is the SENDER's right alone, and only over text. */}
            {isMine && (
              <BubbleAction label="Edit" onClick={() => onEdit(message)}>
                <Pencil />
              </BubbleAction>
            )}
            {isMine && (
              <BubbleAction label="Message info" onClick={() => onShowInfo(message)}>
                <Info />
              </BubbleAction>
            )}
            <BubbleAction label="Delete" onClick={() => onDelete(message)}>
              <Trash2 />
            </BubbleAction>
          </div>
        )}
      </div>
    </div>
  )
}

function BubbleAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tip label={label} side="top">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:size-3.5"
      >
        {children}
      </button>
    </Tip>
  )
}

/**
 * The sender's ticks.
 *
 * `is_read_by_all` and `read_count` are populated ONLY on your own messages —
 * always false and 0 on someone else's, because a reader is not shown who else
 * has read. So this renders for outgoing bubbles alone.
 */
function StatusTick({ message }: { message: ChatMessage }) {
  if (message.status === 'sending') return <Clock className="size-3" aria-label="Sending" />
  if (message.status === 'failed')
    return <AlertCircle className="size-3" aria-label="Not sent" />
  if (message.isReadByAll) return <CheckCheck className="size-3" aria-label="Read" />
  if (message.readCount > 0)
    return <CheckCheck className="size-3 opacity-60" aria-label="Read by some" />
  return <Check className="size-3" aria-label="Sent" />
}
