import type { ReactNode } from 'react'
import { History, Loader2, Megaphone, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { useBroadcastLists } from '../api/use-broadcasts'
import { BROADCAST_MIN_RECIPIENTS } from '../constants'
import { broadcastListTitle, broadcastPreview } from '../lib/broadcast-labels'
import { formatChatTime } from '../lib/message-formatters'

/**
 * The Broadcast tab of the sidebar: my lists, drawn like conversation rows, and
 * opening one in the main pane the way a chat opens.
 *
 * Only I can see these — a list never appears in anybody's conversation list,
 * mine included, which is why it has a tab of its own rather than mixing into
 * the chats above.
 */
export function BroadcastListPanel({
  activeId,
  onOpen,
  onCreate,
}: {
  /** The list open in the main pane, or `'all'` for the full history. */
  activeId: Id | 'all' | null
  onOpen: (target: Id | 'all') => void
  onCreate: () => void
}) {
  const { lists, isLoading, isLoadingMore, hasMore, loadMore, error } = useBroadcastLists()

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" className="mb-1 w-full bg-card" onClick={onCreate}>
        <Plus />
        New broadcast
      </Button>

      <Row
        isActive={activeId === 'all'}
        onClick={() => onOpen('all')}
        icon={<History className="size-4" />}
        title="All broadcasts"
        line="Including deleted lists"
      />

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="px-2 py-4 text-center text-xs text-muted-foreground">{error}</p>
      ) : lists.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {`No lists yet. Make one with ${BROADCAST_MIN_RECIPIENTS} or more people to send them the same message at once — each reply comes back in your own chat with that person.`}
        </p>
      ) : (
        lists.map((list) => (
          <Row
            key={list.id}
            isActive={activeId === list.id}
            onClick={() => onOpen(list.id)}
            icon={<Megaphone className="size-4" />}
            title={broadcastListTitle(list)}
            time={formatChatTime(list.lastBroadcast?.createdAt ?? list.createdAt)}
            line={broadcastPreview(list.lastBroadcast)}
          />
        ))
      )}

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => void loadMore()}
          disabled={isLoadingMore}
        >
          {isLoadingMore && <Loader2 className="animate-spin" />}
          Show more lists
        </Button>
      )}
    </div>
  )
}

/** One row — the same paint as a conversation row, so the tab reads as one list. */
function Row({
  isActive,
  onClick,
  icon,
  title,
  time,
  line,
}: {
  isActive: boolean
  onClick: () => void
  icon: ReactNode
  title: string
  time?: string
  line: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive}
      className={cn(
        'relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left',
        'transition-[background-color,transform] duration-150 active:scale-[0.995]',
        'hover:bg-sidebar-accent/60',
        isActive && 'chat-row-active text-sidebar-accent-foreground hover:bg-transparent',
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary',
          isActive && 'ring-2 ring-primary/45',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm tracking-[-0.01em]',
              isActive ? 'font-semibold' : 'font-normal',
            )}
          >
            {title}
          </span>
          {time && <span className="shrink-0 text-[11px] text-muted-foreground">{time}</span>}
        </span>
        <span
          className={cn(
            'mt-0.5 flex min-w-0 items-center text-xs',
            isActive ? 'text-sidebar-accent-foreground/85' : 'text-muted-foreground',
          )}
        >
          <span className="truncate">{line}</span>
        </span>
      </span>
    </button>
  )
}
