import { useEffect, useState } from 'react'
import { Check, CheckCheck, Loader2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { toApiError } from '@/lib/api-error'
import type { Id } from '@/types/api'
import * as chatApi from '../api/chat-api'
import { formatDateTime } from '../lib/message-formatters'
import { resolveTalkUser } from '../lib/talk-directory'
import type { MessageReceipt } from '../types'

/**
 * Who received and read one message.
 *
 * SENDER only — a non-sender gets a 404 rather than a 403, because read state is
 * the sender's information and answering at all would tell them the message
 * exists. So a failure here is reported as "not available", not as an error.
 */
export function MessageInfoDialog({
  chatId,
  messageId,
  onClose,
}: {
  chatId: Id
  messageId: Id
  onClose: () => void
}) {
  const mediaUrl = useMediaUrl()
  const [receipts, setReceipts] = useState<MessageReceipt[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    chatApi
      .fetchReceipts(chatId, messageId)
      .then((items) => {
        if (!cancelled) setReceipts(items)
      })
      .catch((cause) => {
        if (cancelled) return
        const { status } = toApiError(cause)
        setError(
          status === 404
            ? 'Message info is only available on your own messages.'
            : 'Could not load message info.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [chatId, messageId])

  return (
    <Modal title="Message info" onClose={onClose}>
      {error ? (
        <p className="text-xs text-muted-foreground">{error}</p>
      ) : receipts === null ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : receipts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody has received this yet.</p>
      ) : (
        <ul className="grid gap-2">
          {receipts.map((receipt) => {
            const person = resolveTalkUser(receipt.talkUserId, receipt.name, receipt.photo)
            return (
              <li key={receipt.talkUserId} className="flex items-center gap-2">
                <Avatar
                  name={person.name}
                  src={mediaUrl(person.avatarKey) || undefined}
                  className="size-7 text-[10px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{person.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {receipt.readAt
                      ? `Read ${formatDateTime(receipt.readAt)}`
                      : receipt.deliveredAt
                        ? `Delivered ${formatDateTime(receipt.deliveredAt)}`
                        : 'Not delivered yet'}
                  </span>
                </span>
                {receipt.readAt ? (
                  <CheckCheck className="size-4 shrink-0 text-info" aria-label="Read" />
                ) : (
                  <Check
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-label="Delivered"
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
