/**
 * The chat feature's public surface. Everything outside `features/chat`
 * imports from here — never from a deep path.
 */
export { ChatPage } from './pages/chat-page'
export { ChatSidebar } from './components/chat-sidebar'
export { MediaLightbox } from './components/media-lightbox'
export { useChatList } from './hooks/use-chat-list'
export { useActiveChatRoute } from './hooks/use-active-chat-route'
export { useMessageStream } from './hooks/use-message-stream'
export type {
  Chat,
  ChatMember,
  ChatMessage,
  ChatSelf,
  ChatType,
  MediaKind,
  MemberRole,
  MessageMedia,
  MessageQuote,
  MessageStatus,
  MessageType,
  PinnedMessage,
  Presence,
  SendMessageInput,
  SystemEvent,
} from './types'
