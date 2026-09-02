import { memo } from 'react'
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  CornerUpLeft,
  Download,
  Forward,
  Image as ImageIcon,
  Info,
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
import { toastProblem, toastSuccess } from '@/lib/api-toast'
import { canCopyImages, copyImageToClipboard } from '@/lib/copy-image'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { quoteText, DELETED_MESSAGE_TEXT } from '../lib/chat-labels'
import { downloadMedia } from '../lib/media-download'
import { countJumboEmoji, formatMessageTime } from '../lib/message-formatters'
import { systemMessageText } from '../lib/system-messages'
import { resolveTalkUser } from '../lib/talk-directory'
import { MessageMediaGrid } from './message-media'
import { QuoteThumb } from './quote-thumb'
import type { ChatMessage, MessageQuote } from '../types'

interface MessageBubbleProps {
  message: ChatMessage
  /**
   * The inline quote, with its attachment resolved — `row.replyTo`, not
   * `message.replyTo`: the server's quote carries no media, so the thread fills
   * it in from its own copy of the message being replied to.
   */
  replyTo: MessageQuote | null
  isMine: boolean
  /** First of a run by the same person — carries the author name in groups. */
  startsGroup: boolean
  /** Last of that run — the bubble that closes the stack's shape and spacing. */
  endsGroup: boolean
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
  replyTo,
  isMine,
  startsGroup,
  endsGroup,
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
      <div className="flex min-w-0 justify-center px-3 py-1.5">
        {/* Capped and breakable: the sentence is built from names the server
            gives us — a group renamed to one unbroken 200-character run is a
            legal rename, and uncapped it pushed the pill out past both edges of
            the thread. `rounded-2xl` rather than a pill once it wraps, because a
            full pill radius on two lines reads as a lozenge. */}
        <p className="max-w-[85%] rounded-2xl bg-secondary px-3 py-1 text-center text-[11px] wrap-anywhere text-muted-foreground">
          {systemMessageText(message, selfTalkUserId)}
        </p>
      </div>
    )
  }

  const selecting = isSelected !== null
  // Shared by the plain mark and the unpin button, so the two cannot drift.
  //
  // The mark sits ON the bubble's corner, so half of it is over the fill and
  // half over the canvas — bare, one colour had to lose on one of the two, and
  // over a saturated bubble it lost badly. It carries a small `bg-background`
  // disc again: the canvas colour reads as a bite taken out of the corner, the
  // pin stays legible over either half, and it works over a photo too. No
  // shadow and no padding to spare, which is what made the old one a button.
  const pinMarkClass = cn(
    'absolute -top-1.5 size-3.5 rounded-full bg-background p-px text-muted-foreground',
    isMine ? '-rotate-45' : 'rotate-45',
    !message.isPinned && 'opacity-60',
  )
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
   * The one photo "Copy image" can mean.
   *
   * Offered for a lone image only: on an album of four, a single menu item
   * cannot say WHICH tile it would copy, and the reader would find out by
   * pasting. The lightbox copies per photo, which is where a specific tile is
   * already the thing in view.
   */
  const copyableImage =
    message.media.length === 1 && message.media[0].kind === 'image' && canCopyImages()
      ? message.media[0]
      : null
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
  // Right-click does nothing while a selection is running, or on a bubble the
  // server has not acknowledged. A TOMBSTONE still opens a menu — a withdrawn
  // message can be cleared from my own view like any other row — but only the
  // two actions that still mean something on one: see `deletedOnly`.
  const actionable = !selecting && !sending
  /**
   * A tombstone has nothing left to reply to, quote, copy, edit, pin or report
   * receipts for. What survives is hiding it and picking it, so the menu is cut
   * down to those rather than offering actions the server would refuse.
   */
  const deletedOnly = message.isDeletedForEveryone
  // `sender_name` and `sender_photo` ride along with every message, so the run's
  // author is drawn from the message itself rather than from a second lookup.
  const author =
    message.senderTalkUserId !== null
      ? resolveTalkUser(message.senderTalkUserId, message.senderName, message.senderPhoto)
      : null

  return (
    <div
      className={cn(
        'group flex gap-2 px-3 transition-colors',
        isMine ? 'justify-end' : 'justify-start',
        // A run is one block: its rows sit CLOSE, and the air goes between
        // blocks. A single pixel between rows was too little: a stack of
        // one-word messages read as one striped slab, with no seam to tell
        // where a message ended, so the within-run gap is a visible hairline of
        // background while staying well under the gap between runs.
        //
        // PADDING, and above only. A vertical MARGIN here is measured wrong by
        // the virtualised list: this row is the only child of Virtuoso's item
        // element, which has no padding, border or overflow of its own, so a
        // margin collapses straight through it. The item is then measured
        // WITHOUT the margin while the page lays it out WITH it, and — because
        // collapsing depends on what a row is adjacent to — the list's height
        // changes by this many pixels depending on which row happens to be
        // first in the rendered window. It flipped 16 px back and forth as the
        // view moved, and the thread's scroll correction chased it: eight
        // visible bounces after a send. Padding cannot collapse, so the height
        // the list reports is the height it occupies.
        //
        // Air BELOW a run comes from the next run's `pt-4` (margins collapsed
        // to the larger of the two, so this is the same gap it always was) and,
        // for the last row in the thread, from the list's footer.
        startsGroup ? 'pt-4' : 'pt-1',
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
          // `min-w-0` is load-bearing, not tidying: a flex item's automatic
          // minimum size is its MIN-CONTENT width, and that beats `max-w`. One
          // unbroken 60-digit run therefore stretched the column past 75% and
          // out under the sidebar. Zeroing the floor lets the cap hold, and
          // `wrap-anywhere` on the text below is what makes min-content small
          // enough to honour it.
          // Two caps, whichever bites first, and they are deliberately on TWO
          // elements rather than one `min()`: 65% of the thread here keeps the
          // asymmetry that tells incoming from outgoing at a glance, and the
          // bubble's own 34rem ceiling (below) holds the line length readable on
          // a wide window — past roughly 90 characters the eye loses the line it
          // came from.
          'flex min-w-0 max-w-[65%] flex-col',
          isMine ? 'items-end' : 'items-start',
        )}
      >
        {/* The run author is a heading ABOVE the bubble, on the same line as the
            top of the avatar — not a first line inside the bubble, which pushed
            the message down and read as part of the text. */}
        {showAuthor && !isMine && author && (
          // The name row is exactly the avatar's height, so the two are centred
          // on one line instead of the avatar hanging below the text.
          <p className="flex h-7 items-center px-1 text-xs font-semibold tracking-[-0.01em] text-foreground/80">
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
            // The readable ceiling — see the column above. On a narrow window
            // the column's 65% bites first and this never applies.
            'relative max-w-[34rem] min-w-0 overflow-hidden rounded-lg text-sm',
            // A quote is a two-line block with a picture beside it, and it is
            // capped at whatever the message below it needs (see the quote's own
            // note). Under a one-word reply that would leave a sliver, so a
            // bubble carrying one gets a floor to lay the quote out in.
            replyTo && 'min-w-[11rem]',
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
            // The stack's shape. On the tail side, the run reads as one column
            // of paper: the FIRST bubble squares off where the tail grows out of
            // it, so the two are one shape rather than a bubble with a sticker
            // beside it; the bubbles under it keep a tight corner top AND bottom
            // so the seams between them stay visible without a gap; and the LAST
            // one takes the full curve back to close the stack. A message on its
            // own is both first and last, and comes out with the tail corner
            // square and the rest round — exactly as before.
            !jumboEmoji &&
              (isMine
                ? cn(
                    startsGroup ? 'rounded-tr-none' : 'rounded-tr-sm',
                    !endsGroup && 'rounded-br-sm',
                  )
                : cn(
                    startsGroup ? 'rounded-tl-none' : 'rounded-tl-sm',
                    !endsGroup && 'rounded-bl-sm',
                  )),
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
          {replyTo && (
            <button
              type="button"
              disabled={message.replyToMessageId === null || !onJumpToMessage}
              onClick={() => {
                if (message.replyToMessageId !== null) onJumpToMessage?.(message.replyToMessageId)
              }}
              aria-label="Go to the replied message"
              className={cn(
                // The thumbnail sits on the END of the quote and the words run
                // beside it — the picture is the recognisable half, so it takes
                // the edge where the eye lands, and the text keeps its own line
                // to truncate on. One even inset on all four sides: a tile bled
                // to the right edge only left the words pinned to the left one
                // and the gaps above and below the picture reading as a mistake.
                'mb-1 flex w-full items-center gap-2 overflow-hidden rounded-md border-l-2 p-1.5 text-left text-xs',
                framedMedia && 'mb-1.5',
                'transition-opacity enabled:cursor-pointer enabled:hover:opacity-80',
                isMine ? 'border-white/50 bg-black/15' : 'border-primary bg-accent',
              )}
            >
              {/* `w-0`, not merely `min-w-0`. The quote line below is
                  `truncate`, which is `white-space: nowrap` — so its MAX-content
                  width is the whole quoted message, and the bubble, which sizes
                  to its widest child, was stretched to the full length of the
                  message being replied to instead of ellipsing it. A zero base
                  width contributes nothing to that measurement: the bubble sizes
                  to the reply's OWN text and the quote takes the width it lands
                  on. */}
              <span className="w-0 min-w-0 flex-1">
                <span className="block truncate font-medium opacity-80">
                  {replyTo.senderTalkUserId === selfTalkUserId
                    ? 'You'
                    : replyTo.senderTalkUserId !== null
                      ? resolveTalkUser(replyTo.senderTalkUserId, replyTo.senderName).name
                      : 'Message'}
                </span>
                <span className="block truncate opacity-80">{quoteText(replyTo)}</span>
              </span>
              <QuoteThumb quote={replyTo} />
            </button>
          )}

          {message.isDeletedForEveryone ? (
            // The tombstone. The bubble SURVIVES a delete-for-everyone, because
            // replies still point at it.
            <p className="text-xs italic opacity-70">{DELETED_MESSAGE_TEXT}</p>
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
                    // Message text is the one thing on the screen that is read
                    // rather than scanned, so it gets the looser line height —
                    // everything else in the bubble stays at the default.
                    // `wrap-anywhere`, not `wrap-break-word`: both break a long
                    // word once it overflows, but only `anywhere` also shrinks
                    // the element's min-content size — which is the number the
                    // flex row measures the bubble by.
                    'whitespace-pre-wrap wrap-anywhere leading-[1.45]',
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
              'flex items-center gap-1 text-[10px] tabular-nums',
              mediaOnly
                ? 'absolute right-2.5 bottom-2.5 rounded-full bg-black/55 px-1.5 py-0.5 text-white'
                : 'mt-1 justify-end',
              framedMedia && 'mt-1.5',
              // No bubble behind it any more, so the meta line takes the muted
              // colour rather than the bubble's foreground.
              jumboEmoji && 'text-muted-foreground',
            )}
          >
            {/* The wash lives on the TIME, not on the whole line: a container
                opacity capped the tick as well, so "read" could never be drawn
                brighter than "sent" no matter what it asked for. */}
            <span className={cn('flex items-center gap-1', !mediaOnly && !jumboEmoji && 'opacity-70')}>
              {message.isEdited && !message.isDeletedForEveryone && <span>edited</span>}
              {formatMessageTime(message.createdAt)}
            </span>
            {isMine && <StatusTick message={message} onFill={!jumboEmoji} />}
          </span>
        </div>
        </ContextMenuTrigger>

        {/* Radix anchors the menu to the pointer, so it opens where the click
            landed and flips itself away from the viewport edge. */}
        {/* Radix returns focus to the trigger when a menu closes, which would
            take it straight back off the composer that "Reply" and "Edit" just
            handed it to. */}
        <ContextMenuContent className="w-48" onCloseAutoFocus={(event) => event.preventDefault()}>
          {!deletedOnly && (
            <>
              <ContextMenuItem onSelect={() => onReply(message)}>
                <CornerUpLeft />
                Reply
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onForward(message)}>
                <Forward />
                Forward
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem onSelect={() => onToggleSelected(message.id)}>
            <SquareCheck />
            Select
          </ContextMenuItem>
          {message.body && !deletedOnly && (
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
          {copyableImage && !deletedOnly && (
            <ContextMenuItem
              onSelect={() => {
                void copyImageToClipboard(mediaUrl(copyableImage.fileUrl))
                  .then(() => toastSuccess('Image copied'))
                  // A media object served without a CORS header cannot be read
                  // at all, so the copy is genuinely impossible — say what does
                  // work instead of failing silently.
                  .catch(() => toastProblem('That image could not be copied. Download it instead.'))
              }}
            >
              <ImageIcon />
              Copy image
            </ContextMenuItem>
          )}
          {/* Every attachment, not only photos: a document, a voice note and a
              video are all things a reader wants off the thread and onto their
              disk, and the lightbox — which has its own download — never opens
              for those. Saved one after another rather than all at once, since
              a browser blocks a burst of simultaneous saves. */}
          {message.media.length > 0 && !deletedOnly && (
            <ContextMenuItem
              onSelect={() => {
                void (async () => {
                  for (const item of message.media) {
                    await downloadMedia(mediaUrl(item.fileUrl), item.fileName ?? undefined)
                  }
                })()
              }}
            >
              <Download />
              {message.media.length === 1
                ? 'Download'
                : `Download ${message.media.length} files`}
            </ContextMenuItem>
          )}
          {/* Editing is the SENDER's right alone, and only over text. */}
          {isMine && message.body && !deletedOnly && (
            <ContextMenuItem onSelect={() => onEdit(message)}>
              <Pencil />
              Edit
            </ContextMenuItem>
          )}
          {/* Two pins, two audiences, and they are never folded into one word:
              the first changes what the whole conversation sees, the second is
              a private bookmark nobody is told about. Both are offered at once
              because a message can carry both at the same time. */}
          {!deletedOnly && (
            <>
              <ContextMenuItem onSelect={() => onPin(message.id, !message.isPinned, true)}>
                {message.isPinned ? <PinOff /> : <Pin />}
                {message.isPinned ? 'Unpin for everyone' : 'Pin for everyone'}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => onPin(message.id, !message.isPinnedForMe, false)}
              >
                {message.isPinnedForMe ? <PinOff /> : <Pin />}
                {message.isPinnedForMe ? 'Unpin for me' : 'Pin for me'}
              </ContextMenuItem>
              {isMine && (
                <ContextMenuItem onSelect={() => onShowInfo(message)}>
                  <Info />
                  Message info
                </ContextMenuItem>
              )}
            </>
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
          {isMine && !deletedOnly && (
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

        {/* Tilted like a pin pushed into the bubble, and drawn bare on the
            thread canvas — the disc it used to sit on read as a button.
            A message carrying BOTH pins shows the chat-wide one, the stronger
            claim; the private one is dimmer, which is now the only thing
            separating them since both lean the same way.
            It is also the UNPIN button: pinning took a right-click to undo,
            which is a menu away from the thing you are looking at. It unpins
            the scope it is SHOWING — the chat-wide pin when that is what is
            drawn, my private one otherwise — so the glyph and the action never
            disagree. While a selection is running it goes back to being a plain
            mark: the whole row is the hit target then, and a button inside it
            would swallow the tap that ticks the message. */}
        {(message.isPinned || message.isPinnedForMe) &&
          (selecting ? (
            <Pin
              // Opposite corner from the tail, so the two never sit on top of
              // each other: left on my own bubbles, right on incoming ones. The
              // tilt mirrors with the corner, so the pin always leans INTO the
              // bubble rather than away from it.
              className={cn(pinMarkClass, isMine ? '-left-1.5' : '-right-1.5')}
              aria-label={message.isPinned ? 'Pinned' : 'Pinned for me'}
            />
          ) : (
            <Tip label={message.isPinned ? 'Unpin for everyone' : 'Unpin for me'} side="top">
              <button
                type="button"
                // The row behind it opens the context menu and, in a selection,
                // ticks the message — neither should fire from this tap.
                onClick={(event) => {
                  event.stopPropagation()
                  onPin(message.id, false, message.isPinned)
                }}
                aria-label={message.isPinned ? 'Unpin for everyone' : 'Unpin for me'}
                // The target is bigger than the mark: a 12px glyph is under the
                // 24px floor for a pointer, and far under it for a thumb. The
                // padding is transparent, so the pin still looks bare.
                className={cn(
                  'absolute -top-3 cursor-pointer p-1.5 transition-transform hover:scale-110',
                  isMine ? '-left-3' : '-right-3',
                )}
              >
                <Pin className={cn(pinMarkClass, 'static')} aria-hidden />
              </button>
            </Tip>
          ))}
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
 * The sender's ticks, one weight per state.
 *
 * `is_read_by_all` and `read_count` are populated ONLY on your own messages —
 * always false and 0 on someone else's, because a reader is not shown who else
 * has read. So this renders for outgoing bubbles alone.
 *
 * The outgoing bubble is a saturated brand fill with near-white text, so HUE
 * cannot carry the state here — a blue "read" tick the way a light-bubble app
 * draws it would disappear into the paint. The states are separated by weight
 * instead, and they climb in one direction: sending is the faintest, sent a
 * notch up, read-by-some brighter, read-by-all the only one at full strength
 * with a heavier stroke. Failure is the exception and takes a hue, because it
 * is the one state that is not a step along that ladder.
 */
function StatusTick({ message, onFill }: { message: ChatMessage; onFill: boolean }) {
  if (message.status === 'sending')
    return <Clock className="size-3 opacity-50" aria-label="Sending" />
  if (message.status === 'failed')
    return (
      <AlertCircle
        className="size-3 text-destructive"
        aria-label={message.canRetry === false ? 'Not delivered' : 'Not sent'}
      />
    )
  // The DOUBLE tick means EVERYONE — in a group it waits for the last member,
  // which is the only reading of it people already hold. A partial read used to
  // draw the same two ticks a shade fainter, so a five-person group looked fully
  // read the moment one person opened it. Partial reads keep a SINGLE tick.
  //
  // Read is the one state that also changes COLOUR, and the colour depends on
  // what it is sitting on: `--tick-read` — the theme's own hue lightened, so it
  // reads on the deeper bubble fill — over the bubble and over the media chip's
  // scrim, and `--info` when the bubble has stepped aside and the tick sits on
  // the thread canvas (an emoji-only message), where a pastel would vanish.
  if (message.isReadByAll)
    return (
      <CheckCheck
        className={cn('size-3.5', onFill ? 'text-tick-read' : 'text-info')}
        strokeWidth={2.75}
        aria-label="Read by everyone"
      />
    )
  if (message.readCount > 0)
    return (
      <Check
        className={cn('size-3', onFill ? 'text-tick-read/85' : 'text-info/85')}
        strokeWidth={2.5}
        aria-label={`Read by ${message.readCount}`}
      />
    )
  return <Check className="size-3 opacity-60" aria-label="Sent" />
}
