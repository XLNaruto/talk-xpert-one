import { useChatStore } from '@/stores/chat-store'
import { useChat } from '../api/use-chats'
import { BroadcastArea } from '../components/broadcast-area'
import { ChatArea } from '../components/chat-area'

/**
 * The chat screen.
 *
 * The open chat is read from the store. It is MIRRORED to the URL as an
 * encrypted `?data=` token by `use-active-chat-route.ts` so a refresh reopens
 * it — a record id never appears in a path, and never in the clear.
 *
 * The realtime stream is mounted by `chat-layout.tsx`, above this, so it
 * survives while the thread changes.
 */
export function ChatPage() {
  const activeChatId = useChatStore((s) => s.activeChatId)
  const activeBroadcastId = useChatStore((s) => s.activeBroadcastId)
  const chat = useChat(activeChatId)

  // A broadcast list takes the pane the same way a chat does — the store keeps
  // the two exclusive, so only one of them is ever set.
  if (activeBroadcastId !== null) {
    return <BroadcastArea key={String(activeBroadcastId)} target={activeBroadcastId} />
  }
  return <ChatArea chat={chat} />
}
