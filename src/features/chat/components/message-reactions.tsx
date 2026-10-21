import { useEffect, useRef, useState } from 'react'
import { Plus, SmilePlus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { QUICK_REACTIONS } from '../constants'
import { myReaction } from '../lib/reactions'
import { prefetchEmoji } from '../lib/emoji-bundle'
import type { MessageReaction } from '../types'
import { EmojiPanel } from './emoji-picker'

/**
 * The chips under a bubble — one per emoji, the number only above one, mine
 * highlighted.
 *
 * Tapping a chip IS a reaction: mine comes off, anybody else's becomes mine
 * (moving my one reaction there). Where I may not react — a group I left, or
 * one an admin muted me in — the chips still show and do nothing.
 */
export function ReactionChips({
  reactions,
  isMine,
  canReact,
  onTap,
  onShowAll,
}: {
  reactions: MessageReaction[]
  isMine: boolean
  canReact: boolean
  /** The emoji tapped — the caller works out whether that adds or removes. */
  onTap: (emoji: string) => void
  onShowAll: () => void
}) {
  if (reactions.length === 0) return null
  const visible = reactions.slice(0, MAX_VISIBLE_CHIPS)
  const hidden = reactions.length - visible.length

  return (
    <div
      className={cn(
        // Their own row UNDER the bubble, clear of it — tucked up into the
        // edge, a chip sat on the time and the ticks and hid them.
        'mt-1 flex flex-wrap gap-1 px-0.5',
        isMine ? 'justify-end' : 'justify-start',
      )}
    >
      {visible.map((chip) => (
        <button
          key={chip.emoji}
          type="button"
          disabled={!canReact}
          onClick={() => onTap(chip.emoji)}
          aria-pressed={chip.reactedByMe}
          aria-label={
            chip.reactedByMe
              ? `Remove your ${chip.emoji} reaction`
              : `React with ${chip.emoji} (${chip.count})`
          }
          className={cn(chipClass, chip.reactedByMe ? 'border-primary/50 bg-primary/15' : 'border-border/60')}
        >
          <span className="text-sm leading-none">{chip.emoji}</span>
          {chip.count > 1 && (
            <span className="text-[10px] font-medium leading-none tabular-nums text-muted-foreground">
              {chip.count}
            </span>
          )}
        </button>
      ))}
      {/* Past five the rest fold into one "+N", which opens who reacted with
          what — the breakdown has every emoji, with names. */}
      {hidden > 0 && (
        <button
          type="button"
          onClick={onShowAll}
          aria-label={`${hidden} more reactions — see who reacted`}
          className={cn(chipClass, 'border-border/60 enabled:cursor-pointer')}
        >
          <Plus className="size-3 text-muted-foreground" aria-hidden />
          <span className="text-[10px] font-medium leading-none tabular-nums text-muted-foreground">
            {hidden}
          </span>
        </button>
      )}
    </div>
  )
}

/** Five chips, then "+N" — a wall of emoji under one message drowns the thread. */
const MAX_VISIBLE_CHIPS = 5

const chipClass = cn(
  'inline-flex h-6 items-center gap-0.5 rounded-full border bg-card/80 px-1.5 shadow-sm backdrop-blur-sm',
  'transition-transform enabled:cursor-pointer enabled:hover:scale-105 disabled:cursor-default',
)

/**
 * The quick-react control straddling the bubble's bottom corner — shown on hover and to
 * the keyboard.
 *
 * Pressing it lays the quick six out beside it, facing the middle of the
 * thread; the last button there opens the whole emoji set right above the bar.
 * Both are portalled popovers, so a bubble at the very top or edge of the log
 * never has them cut off by the scroller, and Radix flips them off the edge of
 * the window. Open/closed is purely visual, so it stays here.
 */
export function ReactButton({
  reactions,
  isMine,
  onReact,
}: {
  reactions: MessageReaction[]
  isMine: boolean
  /** The emoji to SEND — already `null` when it was the one I had. */
  onReact: (emoji: string | null) => void
}) {
  const [isOpen, setOpen] = useState(false)
  const [isPickerOpen, setPickerOpen] = useState(false)
  const mine = myReaction(reactions)

  const close = () => {
    setPickerOpen(false)
    setOpen(false)
  }
  // The one I already used is ringed, and picking it again takes it off: the
  // same rule as tapping my own chip. A reaction is one emoji, so picking closes.
  const pick = (emoji: string) => {
    onReact(mine === emoji ? null : emoji)
    close()
  }

  // Scrolling the thread closes both. They are portalled, so they would stay
  // put while their bubble slid away underneath — left floating over some
  // other message, or over the composer. Capture, because `scroll` does not
  // bubble; a scroll INSIDE the picker's own grid is its business, not a move.
  const bar = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && (bar.current?.contains(target) || picker.current?.contains(target))) {
        return
      }
      setPickerOpen(false)
      setOpen(false)
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [isOpen])

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => (open ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="React to this message"
          onPointerEnter={prefetchEmoji}
          onFocus={prefetchEmoji}
          className={cn(
            // Bare glyph, no disc — it sits on the corner, half on the bubble.
            'flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-opacity',
            'hover:text-foreground',
            // Out of the way until the row is pointed at — and always there for
            // the keyboard, and while its own bar is open.
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
          )}
        >
          <SmilePlus className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={bar}
        side={isMine ? 'left' : 'right'}
        align="center"
        sideOffset={6}
        className="flex w-auto items-center gap-0.5 rounded-full p-1 shadow-lg"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => pick(emoji)}
            aria-label={mine === emoji ? `Remove your ${emoji} reaction` : `React with ${emoji}`}
            aria-pressed={mine === emoji}
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-full text-lg transition-transform hover:scale-115',
              mine === emoji && 'bg-primary/15 ring-1 ring-primary/40',
            )}
          >
            {emoji}
          </button>
        ))}
        <Popover open={isPickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="More reactions"
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
            >
              <SmilePlus className="size-4" />
            </button>
          </PopoverTrigger>
          {/* The same panel, at the same size, as the composer's picker. */}
          <PopoverContent
            ref={picker}
            side="top"
            align={isMine ? 'end' : 'start'}
            sideOffset={8}
            className="h-108.75 w-88 overflow-hidden rounded-lg p-0"
          >
            <EmojiPanel onSelect={pick} />
          </PopoverContent>
        </Popover>
      </PopoverContent>
    </Popover>
  )
}
