import { useRef } from 'react'
import { Loader2, Paperclip, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ATTACHMENT_CONTENT_TYPES } from '@/lib/uploads'
import { chatLabel, quoteText } from '../lib/chat-labels'
import { resolveTalkUser } from '../lib/talk-directory'
import { useMessageInput } from '../hooks/use-message-input'
import { usePersonBlock } from '../hooks/use-person-block'
import { AttachmentStrip } from './attachment-strip'
import { EmojiPicker } from './emoji-picker'
import { PersonBlockDialog } from './person-block-dialog'
import { QuoteThumb } from './quote-thumb'
import type { Chat } from '../types'
import { Tip } from '@/components/common/tip'

/**
 * The composer. Markup only — every decision lives in `useMessageInput`.
 *
 * The whole thing is replaced by an explanation when posting is closed: the
 * presign and the send are refused for the same reasons, so offering a file
 * picker that cannot succeed would be worse than saying why.
 */
export function MessageInput({ chat }: { chat: Chat }) {
  const {
    draft,
    onChange,
    textareaRef,
    onKeyDown,
    onPaste,
    insertEmoji,
    files,
    addFiles,
    removeFile,
    replyTo,
    cancelReply,
    editing,
    cancelEditing,
    isSending,
    isOnline,
    blockedReason,
    canUnblock,
    canSend,
    submit,
    stopTyping,
  } = useMessageInput(chat)

  const fileInput = useRef<HTMLInputElement>(null)
  const block = usePersonBlock()
  const counterpartId = chat.counterpartTalkUserId

  if (blockedReason) {
    return (
      <div className="shrink-0 px-3 py-3">
        <p className="text-center text-xs text-muted-foreground">{blockedReason}</p>
        {canUnblock && counterpartId !== null && (
          <div className="mt-2 flex justify-center">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => block.ask(counterpartId, chatLabel(chat).title, false)}
            >
              Unblock
            </Button>
          </div>
        )}
        <PersonBlockDialog block={block} />
      </div>
    )
  }

  return (
    <div className="relative shrink-0 px-3 py-2.5">
      {editing && (
        <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-primary bg-secondary px-2 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Editing message</span>
            <span className="block truncate text-muted-foreground">{editing.body}</span>
          </span>
          <button type="button" onClick={cancelEditing} aria-label="Stop editing">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {replyTo && !editing && (
        <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-primary bg-secondary px-2 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">
              Replying to{' '}
              {replyTo.senderTalkUserId !== null
                ? resolveTalkUser(replyTo.senderTalkUserId, replyTo.senderName).name
                : 'a message'}
            </span>
            <span className="block truncate text-muted-foreground">
              {quoteText(replyTo)}
            </span>
          </span>
          {/* The picture of what is being replied to, not just the word for it:
              in a run of photos the thumbnail is the only thing that says WHICH
              one the reply will land under. */}
          <QuoteThumb quote={replyTo} className="bg-muted" />
          <button type="button" onClick={cancelReply} aria-label="Cancel reply">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* An edit never carries attachments — the file itself is immutable, and a
          PATCH only changes the caption. */}
      {!editing && <AttachmentStrip files={files} onRemove={removeFile} />}

      {/* One field-shaped box holds every control, so a click anywhere in it lands
          in the text — the same target Teams gives you. */}
      <div
        className="flex cursor-text items-end gap-1 rounded-xl bg-card/70 px-2 py-1.5 ring-1 ring-border backdrop-blur-sm transition-colors focus-within:ring-ring"
        onClick={() => textareaRef.current?.focus()}
      >
        {/* The picker stays during an edit — an edit rewrites TEXT, and an emoji
            is text. Only the attachment controls drop out. */}
        <EmojiPicker onSelect={insertEmoji} />

        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onBlur={stopTyping}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={isOnline ? 'Write a message' : 'You are offline'}
          disabled={!isOnline}
          className="min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ overflowY: 'hidden' }}
          aria-label="Message"
        />

        {!editing && (
          <>
            <Tip label="Attach a file (max 25 MB)" side="top">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => fileInput.current?.click()}
                aria-label="Attach a file"
              >
                <Paperclip />
              </Button>
            </Tip>
            <input
              ref={fileInput}
              type="file"
              multiple
              // The same enum the presign signs for, so the picker greys out what
              // the server would refuse. `.heic` by extension too: the OS often
              // reports no MIME type for one.
              accept={[...ATTACHMENT_CONTENT_TYPES, '.heic', '.heif'].join(',')}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files)
                // Reset, or picking the same file twice in a row does nothing.
                e.target.value = ''
              }}
            />
          </>
        )}

        <Button
          type="button"
          size="icon"
          className="size-8 shrink-0"
          disabled={!canSend || isSending}
          onClick={() => void submit()}
          aria-label={editing ? 'Save edit' : 'Send message'}
        >
          {isSending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
    </div>
  )
}
