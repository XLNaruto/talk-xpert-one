import { useEffect, useRef } from 'react'
import {
  AlertCircle,
  Check,
  Clock,
  Eye,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/common/tip'
import { ATTACHMENT_CONTENT_TYPES } from '@/lib/uploads'
import { useChatStore } from '@/stores/chat-store'
import { keyOf } from '@/types/api'
import type { PendingBroadcast } from '../api/use-broadcasts'
import { useBroadcastComposer } from '../hooks/use-broadcast-composer'
import { deliveredLine } from '../lib/broadcast-labels'
import { formatDateTime } from '../lib/message-formatters'
import { AttachmentStrip } from './attachment-strip'
import { LinkPreviewCard, LinkPreviewStrip } from './link-preview-card'
import { MessageMediaGrid } from './message-media'
import type { Broadcast, LinkPreview } from '../types'

/**
 * The bubbles of a list's thread — what I sent, oldest at the top, each with its
 * delivery line. Tapping one opens its delivery report.
 *
 * Every bubble is MINE, so they all sit on the right in the outgoing colour; a
 * broadcast has no replies here — those happen in each 1:1 chat.
 */
export function BroadcastBubbles({
  items,
  pending,
  showListName = false,
  hasMore,
  isLoadingMore,
  onLoadEarlier,
  onOpenReport,
  onRetry,
  onDiscard,
}: {
  items: Broadcast[]
  pending: PendingBroadcast[]
  /** The history across lists names where each one went. */
  showListName?: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadEarlier: () => void
  onOpenReport: (broadcastId: number) => void
  onRetry?: (clientMessageId: string) => void
  onDiscard?: (clientMessageId: string) => void
}) {
  // Kept at the newest end as sends land, the way a chat thread is. Visual
  // only, so it stays in the component.
  const end = useRef<HTMLDivElement>(null)
  const count = items.length + pending.length
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [count])

  return (
    <div className="grid gap-2">
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-center"
          onClick={onLoadEarlier}
          disabled={isLoadingMore}
        >
          {isLoadingMore && <Loader2 className="animate-spin" />}
          Load earlier broadcasts
        </Button>
      )}
      {items.map((broadcast) => (
        <BroadcastBubble
          key={broadcast.id}
          broadcast={broadcast}
          showListName={showListName}
          onOpenReport={onOpenReport}
        />
      ))}
      {pending.map((item) => (
        <PendingBubble
          key={item.clientMessageId}
          item={item}
          onRetry={onRetry}
          onDiscard={onDiscard}
        />
      ))}
      <div ref={end} />
    </div>
  )
}

function BroadcastBubble({
  broadcast,
  showListName,
  onOpenReport,
}: {
  broadcast: Broadcast
  showListName: boolean
  onOpenReport: (broadcastId: number) => void
}) {
  // `talk.broadcast.read` carries the new TOTAL, laid over the last read.
  const liveReads = useChatStore((s) => s.broadcastReads[keyOf(broadcast.id)]?.readCount)
  const readCount = Math.max(broadcast.readCount, liveReads ?? 0)

  return (
    <div className="flex flex-col items-end">
      {showListName && (
        <p className="px-1 pb-0.5 text-[11px] text-muted-foreground">
          To {broadcast.listName ?? 'an unnamed list'}
          {broadcast.listDeleted && ' · list deleted'}
        </p>
      )}
      <button
        type="button"
        onClick={() => onOpenReport(broadcast.id)}
        aria-label="Open the delivery report"
        className="grid max-w-[65%] min-w-0 cursor-pointer gap-1.5 rounded-lg rounded-tr-none bg-bubble-out p-2 text-left text-sm text-bubble-out-foreground shadow-xs transition-opacity hover:opacity-95"
      >
        <MessageMediaGrid media={broadcast.media} isMine />
        {broadcast.body && (
          <p className="whitespace-pre-wrap leading-[1.45] wrap-anywhere px-1">{broadcast.body}</p>
        )}
        {broadcast.linkPreview && broadcast.media.length === 0 && (
          <LinkPreviewCard preview={broadcast.linkPreview} isMine />
        )}
        <span className="flex items-center justify-end gap-2 px-1 text-[10px] tabular-nums">
          <span className="opacity-70">{formatDateTime(broadcast.createdAt)}</span>
          {/* Delivered means STORED in their 1:1 chat — there is no device
              receipt, so no grey double tick. */}
          <span className="flex items-center gap-0.5" aria-label={`Delivered to ${deliveredLine(broadcast)}`}>
            <Check className="size-3" />
            {deliveredLine(broadcast)}
          </span>
          <span className="flex items-center gap-0.5" aria-label={`Read by ${readCount}`}>
            <Eye className="size-3" />
            {readCount}
          </span>
        </span>
      </button>
    </div>
  )
}

function PendingBubble({
  item,
  onRetry,
  onDiscard,
}: {
  item: PendingBroadcast
  onRetry?: (clientMessageId: string) => void
  onDiscard?: (clientMessageId: string) => void
}) {
  const failed = item.status === 'failed'
  return (
    <div className="flex flex-col items-end">
      <div className="grid max-w-[65%] min-w-0 gap-1.5 rounded-lg rounded-tr-none bg-bubble-out p-2 text-sm text-bubble-out-foreground opacity-80 shadow-xs">
        {item.files.length > 0 && (
          <p className="flex items-center gap-1.5 px-1 text-xs">
            <Paperclip className="size-3" aria-hidden />
            {item.files.length === 1 ? item.files[0].name : `${item.files.length} files`}
            {!failed && item.progress < 1 && ` · ${Math.round(item.progress * 100)}%`}
          </p>
        )}
        {item.body && (
          <p className="whitespace-pre-wrap leading-[1.45] wrap-anywhere px-1">{item.body}</p>
        )}
        {item.linkPreview && <LinkPreviewCard preview={item.linkPreview} isMine />}
        <span className="flex items-center justify-end gap-1 px-1 text-[10px]">
          {failed ? (
            <AlertCircle className="size-3 text-destructive" aria-label="Not sent" />
          ) : (
            // Up to 256 copies are written before the answer comes, so this
            // can take a few seconds — said rather than left to look stuck.
            <>
              <Clock className="size-3 opacity-60" aria-hidden />
              <span className="opacity-70">Sending to everyone…</span>
            </>
          )}
        </span>
      </div>
      {failed && (
        <span className="mt-1 flex items-center gap-1 text-[10px] text-destructive">
          <span>{item.failureReason ?? 'Not sent. Check your connection.'}</span>
          {onRetry && (
            <Tip label="Resend" side="top">
              <button
                type="button"
                onClick={() => onRetry(item.clientMessageId)}
                aria-label="Resend this broadcast"
                className="flex size-4.5 items-center justify-center rounded-full hover:bg-destructive/10"
              >
                <RotateCcw className="size-3" />
              </button>
            </Tip>
          )}
          {onDiscard && (
            <Tip label="Discard" side="top">
              <button
                type="button"
                onClick={() => onDiscard(item.clientMessageId)}
                aria-label="Discard this broadcast"
                className="flex size-4.5 items-center justify-center rounded-full hover:bg-destructive/10"
              >
                <Trash2 className="size-3" />
              </button>
            </Tip>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * Writing a broadcast. Markup only — `use-broadcast-composer` decides.
 *
 * The same composer shape as a chat's, minus what a broadcast has no use for:
 * no reply, no edit, no typing signal, no poll.
 */
export function BroadcastComposer({
  onSend,
}: {
  onSend: (draft: {
    body: string
    files: File[]
    linkPreviewUrl: string | null
    linkPreview: LinkPreview | null
  }) => void
}) {
  const composer = useBroadcastComposer(onSend)
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="w-full">
      <AttachmentStrip files={composer.files} onRemove={composer.removeFile} />
      <LinkPreviewStrip
        previews={composer.linkPreviews}
        isLoading={composer.isLinkPreviewLoading}
        onDismiss={composer.dismissLinkPreview}
      />
      <div className="flex items-end gap-1 rounded-xl bg-card/70 px-2 py-1.5 ring-1 ring-border backdrop-blur-sm transition-colors focus-within:ring-ring">
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
          accept={[...ATTACHMENT_CONTENT_TYPES, '.heic', '.heif'].join(',')}
          className="hidden"
          onChange={(e) => {
            void composer.addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <textarea
          rows={1}
          value={composer.text}
          onChange={(e) => composer.setText(e.target.value)}
          onKeyDown={composer.onKeyDown}
          placeholder="Write a broadcast"
          aria-label="Broadcast message"
          className="max-h-36 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <Button
          type="button"
          size="icon"
          className="size-8 shrink-0"
          disabled={!composer.canSend}
          onClick={composer.submit}
          aria-label="Send broadcast"
        >
          <Send />
        </Button>
      </div>
    </div>
  )
}
