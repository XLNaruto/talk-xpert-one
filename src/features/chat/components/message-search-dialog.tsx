import { Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/common/modal'
import { useChatListStore } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import type { Id } from '@/types/api'
import { useMessageSearch } from '../api/use-message-search'
import { chatLabel } from '../lib/chat-labels'
import { resolveTalkUser } from '../lib/talk-directory'

/**
 * Search messages — inside one conversation, or across all of them.
 *
 * A hit opens its conversation rather than scrolling to the message: the thread
 * pages by id from the newest end, so jumping to an arbitrary old message would
 * mean walking history back to it. Opening the chat is the honest affordance.
 */
export function MessageSearchDialog({
  chatId,
  onClose,
}: {
  /** Scope to this chat, or omit to search everything. */
  chatId?: Id
  onClose: () => void
}) {
  const { query, setQuery, hits, total, isSearching } = useMessageSearch(chatId)
  const chats = useChatListStore((s) => s.chats)
  const setActiveChat = useChatStore((s) => s.setActiveChat)

  const open = (hitChatId: Id) => {
    setActiveChat(hitChatId)
    onClose()
  }

  return (
    <Modal
      title={chatId ? 'Search this conversation' : 'Search messages'}
      description={total > 0 ? `${total} ${total === 1 ? 'match' : 'matches'}` : undefined}
      onClose={onClose}
    >
      <div className="grid gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What are you looking for?"
          aria-label="Search messages"
          autoFocus
        />

        {isSearching ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : query.trim().length < 2 ? (
          <p className="text-xs text-muted-foreground">Type at least two characters.</p>
        ) : hits.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing matched. Try a different word.
          </p>
        ) : (
          <ul className="grid gap-1">
            {hits.map((hit) => {
              const chat = chats.find((c) => c.id === hit.chatId)
              const where = chat ? chatLabel(chat).title : 'Conversation'
              const who =
                hit.senderTalkUserId !== null
                  ? resolveTalkUser(hit.senderTalkUserId, hit.senderName).name
                  : 'System'
              return (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => open(hit.chatId)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {!chatId && `${where} · `}
                        {who}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {format(new Date(hit.createdAt), 'd MMM, HH:mm')}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {hit.body?.trim() || 'Attachment'}
                    </span>
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
