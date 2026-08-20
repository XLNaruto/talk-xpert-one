import { ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScrollToBottomButtonProps {
  /** Hidden while the reader is already at the newest message. */
  isVisible: boolean
  /** Unread messages below the viewport. 0 hides the count, not the button. */
  unreadCount: number
  onClick: () => void
}

/**
 * The way back to the newest message, with what is waiting there.
 *
 * It floats over the thread rather than sitting in the composer: it belongs to
 * the scroll position, appears only when there is somewhere to go, and must not
 * take space from the log the rest of the time.
 */
export function ScrollToBottomButton({
  isVisible,
  unreadCount,
  onClick,
}: ScrollToBottomButtonProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-4 right-4 z-10 transition-all duration-200',
        isVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      )}
      // `inert`, not `aria-hidden`: the button keeps focus after being clicked —
      // clicking it is what makes it disappear — and `aria-hidden` over a focused
      // element hides the focus from assistive technology, which the browser
      // rightly refuses. `inert` blurs it and takes it out of the tree in one go.
      inert={!isVisible}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={
          unreadCount > 0
            ? `Jump to the newest message, ${unreadCount} unread`
            : 'Jump to the newest message'
        }
        className={cn(
          'pointer-events-auto relative flex size-10 items-center justify-center rounded-full',
          'border border-border bg-card text-foreground shadow-lg',
          'transition-transform hover:scale-105 active:scale-95',
        )}
      >
        <ArrowDown className="size-5" aria-hidden />
        {unreadCount > 0 && (
          <span
            className={cn(
              'absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center',
              'rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground',
            )}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  )
}
