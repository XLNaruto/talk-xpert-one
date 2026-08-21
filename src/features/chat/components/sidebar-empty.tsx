import { CheckCheck, MessageSquareDashed, MessagesSquare, SearchX, UserRoundPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatFilter } from '../hooks/use-chat-list'

/**
 * The list with nothing in it.
 *
 * The generic `EmptyState` centres itself in the scroll area, which in a
 * full-height sidebar drops two lines of grey text into the middle of a very
 * tall void with no glyph to anchor them. This sits the copy in the upper
 * third, gives each reason its own icon, and — where the list is empty because
 * nothing exists YET rather than because a filter excluded it — draws three
 * ghost rows so the column still reads as a list waiting to fill.
 *
 * Every state answers a DIFFERENT question, so each gets its own sentence:
 * a fruitless search is about reach, an empty `unread` is good news, and an
 * empty `direct` has no "new group" to offer.
 */
function copyFor(search: string, filter: ChatFilter) {
  if (search) {
    return {
      icon: SearchX,
      title: 'No matches',
      body: 'Try a different name, or ask an administrator for access to more people.',
      // A search result is not a list waiting to fill, so no ghost rows.
      ghosts: false,
      newGroup: false,
    }
  }
  if (filter === 'unread') {
    return {
      icon: CheckCheck,
      title: 'Nothing unread',
      body: 'You are caught up. Every conversation has been read.',
      ghosts: false,
      newGroup: false,
    }
  }
  if (filter === 'direct') {
    return {
      icon: MessageSquareDashed,
      title: 'No direct chats',
      body: 'Search for a name above to start talking to someone one to one.',
      ghosts: true,
      newGroup: false,
    }
  }
  if (filter === 'group') {
    return {
      icon: Users,
      title: 'No groups yet',
      body: 'Start one, add the people you work with, and talk in one place.',
      ghosts: true,
      newGroup: true,
    }
  }
  return {
    icon: MessagesSquare,
    title: 'No conversations yet',
    body: 'Search for a name to message someone, or start a group.',
    ghosts: true,
    newGroup: true,
  }
}

export function SidebarEmpty({
  search,
  filter,
  onNewGroup,
}: {
  search: string
  filter: ChatFilter
  onNewGroup: () => void
}) {
  const { icon: Icon, title, body, ghosts, newGroup } = copyFor(search, filter)

  return (
    // Centred in the column, not pinned near the top: the sidebar is full
    // height, so top-aligned copy left a screen of dead space under it and read
    // as a list that had failed to render its rows.
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 text-center">
      <span className="relative mb-5 flex size-16 items-center justify-center">
        <span aria-hidden className="absolute inset-0 -z-10 rounded-full bg-primary/8 blur-md" />

        {/* The tile floats on the same cycle as the empty thread's medallion, so
            the two empty screens read as one family. */}
        <span className="chat-empty-medallion chat-empty-tile relative flex size-12 items-center justify-center rounded-[1.05rem] border border-sidebar-border text-primary shadow-sm">
          <Icon className="size-5" />
        </span>
      </span>

      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1.5 max-w-[15rem] text-xs leading-relaxed text-muted-foreground">{body}</p>

      {newGroup && (
        <Button size="sm" className="mt-5" onClick={onNewGroup}>
          <UserRoundPlus />
          New group
        </Button>
      )}

      {ghosts && (
        // Row-shaped placeholders, fading out down the column: the shape of what
        // belongs here. Static and `aria-hidden` — a skeleton animation would
        // claim something is loading, and nothing is.
        <div aria-hidden className="mt-7 w-full space-y-2">
          {['opacity-50', 'opacity-30', 'opacity-15'].map((fade) => (
            <div
              key={fade}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-dashed border-sidebar-border px-3 py-2.5',
                fade,
              )}
            >
              <span className="size-9 shrink-0 rounded-full bg-muted-foreground/15" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="h-2 w-1/2 rounded-full bg-muted-foreground/20" />
                <span className="h-2 w-4/5 rounded-full bg-muted-foreground/12" />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
