import { MessageSquarePlus } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import { contactSubtitle } from '../lib/chat-labels'
import { resolveTalkUser } from '../lib/talk-directory'
import type { Contact } from '../types'

/**
 * One directory hit in the sidebar's search results.
 *
 * Deliberately quieter than a `ChatListItem` — there is no conversation behind
 * it yet, so there is no preview line, no time and no unread badge to draw.
 */
export function ContactRow({
  contact,
  isPending,
  onOpen,
}: {
  contact: Contact
  isPending: boolean
  onOpen: (contact: Contact) => void
}) {
  const mediaUrl = useMediaUrl()
  const person = resolveTalkUser(contact.talkUserId, contact.name, contact.photo)
  const subtitle = contactSubtitle(contact)

  return (
    <button
      type="button"
      onClick={() => onOpen(contact)}
      disabled={isPending}
      aria-label={`Message ${person.name}`}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
        'hover:bg-sidebar-accent disabled:pointer-events-none disabled:opacity-60',
      )}
    >
      <Avatar
        name={person.name}
        src={mediaUrl(person.avatarKey) || undefined}
        className="size-10 shrink-0"
      />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm font-medium">{person.name}</span>
        {subtitle && (
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
      <MessageSquarePlus
        className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden
      />
    </button>
  )
}
