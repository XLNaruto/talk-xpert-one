import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import { chatLabel } from '../lib/chat-labels'
import type { Chat } from '../types'

/** Faces shown in a collapsed section before the count takes over. */
const STACK = 4

/**
 * One labelled, collapsible run of the conversation list.
 *
 * Pinned chats already sorted to the top of the list, but nothing SAID so —
 * the boundary between "kept" and "everything else" was a pin glyph on some
 * rows and nothing else. A header names the run and carries its total; folding
 * it away leaves the faces behind, so a collapsed section still says WHO is in
 * it rather than only how many.
 */
export function ChatSection({
  label,
  chats,
  collapsed,
  onToggle,
  children,
}: {
  label: string
  /** The section's rows — read for the collapsed avatar stack and the count. */
  chats: Chat[]
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const mediaUrl = useMediaUrl()
  const faces = chats.slice(0, STACK)
  const rest = chats.length - faces.length

  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/40"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            !collapsed && 'rotate-90',
          )}
        />
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground/60 tabular-nums">
          {chats.length}
        </span>
      </button>

      {collapsed ? (
        // The fold keeps its faces. A row of pictures is how you recognise the
        // run you folded away — a bare count reads as something removed.
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Expand ${label}`}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-accent/40"
        >
          <span className="flex items-center">
            {faces.map((chat, i) => {
              const face = chatLabel(chat)
              return (
                <Avatar
                  key={chat.id}
                  name={face.title}
                  src={mediaUrl(face.avatarKey) || undefined}
                  // Overlapped, each face ringed in the sidebar's own colour so
                  // the stack reads as a stack and not as one smeared picture.
                  className={cn('size-7 text-[9px] ring-2 ring-sidebar', i > 0 && '-ml-2.5')}
                />
              )
            })}
          </span>
          {rest > 0 && (
            <span className="text-xs font-medium text-muted-foreground tabular-nums">+{rest}</span>
          )}
        </button>
      ) : (
        <div className="space-y-px">{children}</div>
      )}
    </section>
  )
}
