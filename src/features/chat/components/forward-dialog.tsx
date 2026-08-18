import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useChatListStore } from '@/stores/chat-list-store'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { chatLabel } from '../lib/chat-labels'

interface ForwardDialogProps {
  messageIds: Id[]
  /** Where the messages came from — offering it back would just duplicate them. */
  fromChatId: Id
  onForward: (messageIds: Id[], toChatIds: Id[]) => Promise<boolean>
  onClose: () => void
}

/**
 * Pick destinations for a forward.
 *
 * A forward is a NEW message in each destination, not a pointer — the members
 * there generally cannot see the source chat, so the file is copied too.
 */
export function ForwardDialog({
  messageIds,
  fromChatId,
  onForward,
  onClose,
}: ForwardDialogProps) {
  const chats = useChatListStore((s) => s.chats)
  const mediaUrl = useMediaUrl()
  const [selected, setSelected] = useState<Id[]>([])
  const [filter, setFilter] = useState('')
  const [isPending, setPending] = useState(false)

  // Only chats we can actually post into, and never the one we forwarded from.
  const options = chats.filter(
    (chat) =>
      chat.id !== fromChatId &&
      !chat.self.hasLeft &&
      !chat.self.isBlocked &&
      chatLabel(chat).title.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  const toggle = (chatId: Id) =>
    setSelected((held) =>
      held.includes(chatId) ? held.filter((id) => id !== chatId) : [...held, chatId],
    )

  const submit = async () => {
    if (selected.length === 0) return
    setPending(true)
    const ok = await onForward(messageIds, selected)
    setPending(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title={messageIds.length === 1 ? 'Forward message' : `Forward ${messageIds.length} messages`}
      description="Choose where to send them."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={selected.length === 0 || isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            Forward
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
        />

        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No other conversation to forward into.
          </p>
        ) : (
          <ul className="grid gap-1">
            {options.map((chat) => {
              const label = chatLabel(chat)
              const isSelected = selected.includes(chat.id)
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => toggle(chat.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      isSelected ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <Avatar
                      name={label.title}
                      src={mediaUrl(label.avatarKey) || undefined}
                      className="size-7 text-[10px]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{label.title}</span>
                    {isSelected && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
