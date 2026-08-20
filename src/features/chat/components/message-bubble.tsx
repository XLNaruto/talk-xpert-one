import { memo } from 'react'
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  CornerUpLeft,
  Forward,
  Info,
  Bookmark,
  BookmarkX,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  SquareCheck,
  Trash2,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Tip } from '@/components/common/tip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { toastSuccess } from '@/lib/api-toast'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { quoteLine } from '../lib/chat-labels'
import { countJumboEmoji, formatMessageTime } from '../lib/message-formatters'
import { systemMessageText } from '../lib/system-messages'
import { resolveTalkUser } from '../lib/talk-directory'
import { MessageMediaGrid } from './message-media'
import type { ChatMessage } from '../types'

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
  /** Deletes this one message at once — `true` withdraws it for everyone. */
  onDelete: (message: ChatMessage, forEveryone: boolean) => void
  /** `forEveryone` picks the audience: the chat's pin, or my own bookmark. */
  onPin: (messageId: Id, pinned: boolean, forEveryone: boolean) => void
  onForward: (message: ChatMessage) => void
  onShowInfo: (message: ChatMessage) => void
  onRetry: (message: ChatMessage) => void
  /** Go to the quoted message. Absent where there is no thread to scroll. */
  onJumpToMessage?: (messageId: Id) => void
}

/**
 * One bubble.
 *
 * `memo`'d, and that is load-bearing rather than a micro-optimisation: Virtuoso
 * re-runs `itemContent` for every mounted row on each scroll frame, and the
 * bubble is the expensive part of a row — a date format, an emoji scan and a
 * Radix context menu apiece. Every prop below is stable across a scroll (the
 * message object comes from the cache by identity, the handlers are
 * `useCallback`s), so the whole subtree is skipped unless the message itself
 * changed. Keep it that way: an inline arrow passed in from a parent undoes it.
 */
function MessageBubbleBase({
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
  onJumpToMessage,
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
  // A refusal (blocked, gone, rejected) is final: it states why and offers no
  // button, because replaying it is refused identically every time.
  const refused = failed && message.canRetry === false
  const sending = message.status === 'sending'
  // Anything drawn ABOVE the album INSIDE the bubble — the "Forwarded" tag — is
  // bubble chrome, and chrome needs the bubble's own padding to sit on.
  // Otherwise the label hugs the corner while the photos below it look inset by
  // a hair. The run author is NOT chrome any more: it sits above the bubble.
  const hasHeader = message.isForwarded
  // A bubble that is nothing but an album drops its padding and floats the
  // timestamp over the last tile, so the photos meet the bubble's own corners.
  const mediaOnly =
    message.media.length > 0 &&
    !message.body &&
    !message.replyTo &&
    !hasHeader &&
    !message.isDeletedForEveryone
  /**
   * An album WITH chrome around it — a "Forwarded" tag, the run author, a quote,
   * a caption — sits in ONE even frame: the same inset on all four sides, so the
   * label, the photos and the timestamp share every edge instead of stepping in
   * and out. The inset lives on the bubble alone; nothing inside adds its own.
   */
  const framedMedia = message.media.length > 0 && !mediaOnly
  /**
   * A message that is nothing but a handful of emoji is drawn large and WITHOUT
   * a bubble — the emoji is the whole message, and a chrome-heavy container
   * around three glyphs reads as an afterthought rather than as the point.
   *
   * Only when there is nothing else in the bubble to compete with it: a quote, a
   * "Forwarded" tag or an attachment all mean the emoji is a caption, and a
   * caption stays at reading size.
   */
  const jumboEmoji =
    message.media.length === 0 &&
    !message.replyTo &&
    !message.isForwarded &&
    !message.isDeletedForEveryone
      ? countJumboEmoji(message.body)
      : null
  // Right-click does nothing while a selection is running, on a tombstone, or on
  // a bubble the server has not acknowledged — the same rule the hover row uses.
  const actionable = !selecting && !message.isDeletedForEveryone && !sending
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
        // The whole row is the hit target while a selection is running.
        selecting && 'cursor-pointer',
      )}
      onClick={selecting ? () => onToggleSelected(message.id) : undefined}
    >
      {/* An avatar column only under a group's incoming runs; a spacer keeps the
          following bubbles of the run aligned with it. Top-aligned, because the
          name sits on the run's first line and the two read as one heading. */}
      {!isMine && showAuthor && author && (
        <Avatar
          name={author.name}
          src={mediaUrl(author.avatarKey) || undefined}
          className="size-7 shrink-0 self-start text-[10px]"
        />
      )}
      {!isMine && !showAuthor && <span className="w-7 shrink-0" aria-hidden />}

      {/* The column hugs its widest child, so it must NOT stretch: a two-line
          failure note under a one-word message used to drag the bubble out to
          the note's width. The bubble now sizes to its own text and the note
          wraps beneath it. */}
      <div
        className={cn(
          'flex max-w-[75%] flex-col',
          isMine ? 'items-end' : 'items-start',
        )}
      >
        {/* The run author is a heading ABOVE the bubble, on the same line as the
            top of the avatar — not a first line inside the bubble, which pushed
            the message down and read as part of the text. */}
        {showAuthor && !isMine && author && (
          // The name row is exactly the avatar's height, so the two are centred
          // on one line instead of the avatar hanging below the text.
          <p className="flex h-7 items-center px-1 text-xs font-semibold text-foreground/85">
            {author.name}
          </p>
        )}

        {/* The bubble clips its own overflow, for the media corners — so the
            pin lives on a wrapper OUTSIDE that clip and hangs over the corner
            instead of being cut in half by it. */}
        <div className="relative">
        <ContextMenu>
        <ContextMenuTrigger asChild disabled={!actionable}>
        <div
          className={cn(
            'relative overflow-hidden rounded-2xl text-sm',
            mediaOnly ? 'p-1' : framedMedia ? 'p-1.5' : 'px-3 py-2',
            // The bubble steps aside entirely, so the emoji sits on the thread's
            // own background the way it would in any other messenger.
            jumboEmoji
              ? 'bg-transparent px-0 py-0 text-foreground shadow-none'
              : cn(
                  'shadow-xs',
                  // Every corner keeps the full curve — the tighter tail-side
                  // corner read as a clipped bubble next to its neighbours.
                  isMine
                    ? 'bg-bubble-out text-bubble-out-foreground'
                    : 'bg-bubble-in text-bubble-in-foreground',
                ),
            // The corner the tail grows out of goes square, so the two read as
            // one shape instead of a bubble with a sticker beside it.
            startsGroup &&
              !jumboEmoji &&
              (isMine ? 'rounded-tr-none' : 'rounded-tl-none'),
          )}
        >
          {message.isForwarded && (
            <p
              className={cn(
                'mb-1.5 flex items-center gap-1.5 text-[11px] italic opacity-70',
              )}
            >
              <Forward className="size-3 shrink-0" aria-hidden />
              Forwarded
            </p>
          )}

          {/* The quote is INLINE on the message — rendered directly, with no
              second request for the message it points at. Clicking it goes to
              that message, which is the only way back to the context a reply
              was written against; history is walked back to it if need be. */}
          {message.replyTo && (
            <button
              type="button"
              disabled={message.replyToMessageId === null || !onJumpToMessage}
              onClick={() => {
                if (message.replyToMessageId !== null) onJumpToMessage?.(message.replyToMessageId)
              }}
              aria-label="Go to the replied message"
              className={cn(
                'mb-1 block w-full rounded-md border-l-2 px-2 py-1 text-left text-xs',
                framedMedia && 'mb-1.5',
                'transition-opacity enabled:cursor-pointer enabled:hover:opacity-80',
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
            </button>
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
                <p
                  className={cn(
                    'whitespace-pre-wrap wrap-break-word',
                    // A caption under an album keeps the album's own edge.
                    framedMedia && 'mt-1.5',
                    // Fewer emoji, bigger each — one on its own is the whole
                    // message and can afford the room; three need to still fit.
                    jumboEmoji === 1 && 'text-[3.5rem] leading-tight',
                    jumboEmoji === 2 && 'text-[2.75rem] leading-tight',
                    jumboEmoji === 3 && 'text-4xl leading-tight',
                    jumboEmoji !== null && (isMine ? 'text-right' : 'text-left'),
                  )}
                >
                  {message.body}
                </p>
              )}
            </>
          )}

          <span
            className={cn(
              'flex items-center gap-1 text-[10px]',
              mediaOnly
                ? 'absolute right-2.5 bottom-2.5 rounded-full bg-black/55 px-1.5 py-0.5 text-white'
                : 'mt-1 justify-end opacity-70',
              framedMedia && 'mt-1.5',
              // No bubble behind it any more, so the meta line takes the muted
              // colour rather than the bubble's foreground.
              jumboEmoji && 'text-muted-foreground opacity-100',
            )}
          >
            {message.isEdited && <span>edited</span>}
            {formatMessageTime(message.createdAt)}
            {isMine && <StatusTick message={message} />}
          </span>
        </div>
        </ContextMenuTrigger>

        {/* Radix anchors the menu to the pointer, so it opens where the click
            landed and flips itself away from the viewport edge. */}
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => onReply(message)}>
            <CornerUpLeft />
            Reply
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onForward(message)}>
            <Forward />
            Forward
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggleSelected(message.id)}>
            <SquareCheck />
            Select
          </ContextMenuItem>
          {message.body && (
            <ContextMenuItem
              onSelect={() => {
                navigator.clipboard
                  .writeText(message.body ?? '')
                  .then(() => toastSuccess('Copied'))
                  .catch(() => undefined)
              }}
            >
              <Copy />
              Copy
            </ContextMenuItem>
          )}
          {/* Editing is the SENDER's right alone, and only over text. */}
          {isMine && message.body && (
            <ContextMenuItem onSelect={() => onEdit(message)}>
              <Pencil />
              Edit
            </ContextMenuItem>
          )}
          {/* Two pins, two audiences, and they are never folded into one word:
              the first changes what the whole conversation sees, the second is
              a private bookmark nobody is told about. Both are offered at once
              because a message can carry both at the same time. */}
          <ContextMenuItem onSelect={() => onPin(message.id, !message.isPinned, true)}>
            {message.isPinned ? <PinOff /> : <Pin />}
            {message.isPinned ? 'Unpin for everyone' : 'Pin for everyone'}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onPin(message.id, !message.isPinnedForMe, false)}>
            {message.isPinnedForMe ? <BookmarkX /> : <Bookmark />}
            {message.isPinnedForMe ? 'Unpin for me' : 'Pin for me'}
          </ContextMenuItem>
          {isMine && (
            <ContextMenuItem onSelect={() => onShowInfo(message)}>
              <Info />
              Message info
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {/* The two deletions are named rather than hidden behind one word:
              "for me" hides the row and tells nobody, "for everyone" withdraws
              it and leaves a tombstone the whole chat sees. Only the SENDER can
              do the second, and only while the message still has a body. */}
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(message, false)}>
            <Trash2 />
            Delete for me
          </ContextMenuItem>
          {isMine && !message.isDeletedForEveryone && (
            <ContextMenuItem variant="destructive" onSelect={() => onDelete(message, true)}>
              <Trash2 />
              Delete for everyone
            </ContextMenuItem>
          )}
        </ContextMenuContent>
        </ContextMenu>

        {/* The tail — only on the FIRST bubble of a run, pointing back at the
            avatar. It hangs outside the bubble's own clip, which is why it is
            drawn here on the wrapper. `currentColor` keeps it exactly in step
            with the bubble fill in both themes. */}
        {startsGroup && !jumboEmoji && (
          <svg
            // The art starts at y=1, so the viewBox crops that row off and the
            // tail's flat top lands exactly on the bubble's top edge.
            viewBox="0 1 8 12"
            className={cn(
              // Tucked 2px UNDER the bubble, so antialiasing on the squared
              // corner can never leave a hairline between the two shapes.
              'absolute top-0 h-3 w-2',
              isMine ? '-right-1.5 text-bubble-out' : '-left-1.5 text-bubble-in',
            )}
            aria-hidden
          >
            <path
              fill="currentColor"
              // The STRAIGHT edge of each path has to sit against the bubble:
              // x=0 for a tail hanging off the right, x=8 for one on the left.
              // Swap them and the tail floats away from the corner it belongs to.
              d={
                isMine
                  ? 'M6.467 3.568L0 12.193V1h5.188c1.77 0 2.338 1.156 1.279 2.568z'
                  : 'M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z'
              }
            />
          </svg>
        )}

        {/* Tilted like a pin pushed into the bubble, and lifted clear of the
            thread background by its own disc so it reads on a photo too. */}
        {message.isPinned ? (
          <Pin
            // Opposite corner from the tail, so the two never sit on top of
            // each other: left on my own bubbles, right on incoming ones.
            className={cn(
              'absolute -top-1.5 size-4 rounded-full bg-background p-0.5 text-muted-foreground shadow-xs',
              // The tilt mirrors with the corner, so the pin always leans INTO
              // the bubble rather than away from it.
              isMine ? '-left-1.5 -rotate-45' : '-right-1.5 rotate-45',
            )}
            aria-label="Pinned"
          />
        ) : (
          // The private bookmark gets a bookmark, not a pin: the two mean
          // different things — one is on the conversation, one is on my copy —
          // and a reader must be able to tell at a glance which they are looking
          // at. A message carrying both shows the pin, the stronger claim.
          message.isPinnedForMe && (
            <Bookmark
              className={cn(
                'absolute -top-1.5 size-4 rounded-full bg-background p-0.5 text-muted-foreground shadow-xs',
                isMine ? '-left-1.5' : '-right-1.5',
              )}
              aria-label="Pinned for me"
            />
          )
        )}
        </div>

        {/* The reason states itself and the action sits beside it as its own
            button — a whole line that is also a link reads like a warning you
            have to click to dismiss. Resending is offered on a refusal too:
            whatever refused it may have changed since. */}
        {failed && (
          <span className="mt-1 flex items-start gap-1 self-end text-left text-[10px] leading-snug text-destructive">
            <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
            <span className="min-w-0">
              {message.failureReason ??
                (refused
                  ? 'This message could not be delivered.'
                  : 'Not sent. Check your connection.')}
            </span>
            <Tip label="Resend" side="top">
              <button
                type="button"
                onClick={() => onRetry(message)}
                aria-label="Resend this message"
                className="-mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-destructive/10"
              >
                <RotateCcw className="size-3" />
              </button>
            </Tip>
          </span>
        )}
      </div>
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleBase)

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
    return (
      <AlertCircle
        className="size-3"
        aria-label={message.canRetry === false ? 'Not delivered' : 'Not sent'}
      />
    )
  if (message.isReadByAll) return <CheckCheck className="size-3" aria-label="Read" />
  if (message.readCount > 0)
    return <CheckCheck className="size-3 opacity-60" aria-label="Read by some" />
  return <Check className="size-3" aria-label="Sent" />
}
