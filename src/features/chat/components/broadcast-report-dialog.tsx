import { useState } from 'react'
import { Loader2, MessageCircle } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { useBroadcastReport } from '../api/use-broadcasts'
import { skipReasonText } from '../lib/broadcast-labels'
import { formatDateTime } from '../lib/message-formatters'
import { resolveTalkUser } from '../lib/talk-directory'
import type { BroadcastDeliveryStatus } from '../types'
import { Tab } from './reactions-dialog'

const TABS: Array<{ status: BroadcastDeliveryStatus | null; label: string; count: CountKey }> = [
  { status: null, label: 'All', count: 'total' },
  { status: 'delivered', label: 'Delivered', count: 'delivered' },
  { status: 'read', label: 'Read', count: 'read' },
  { status: 'skipped', label: 'Skipped', count: 'skipped' },
  { status: 'failed', label: 'Failed', count: 'failed' },
]

type CountKey = 'total' | 'delivered' | 'read' | 'skipped' | 'failed'

/**
 * Who got a broadcast, who read it, and who was skipped and why.
 *
 * "Delivered" means stored in their 1:1 chat with me — there is no device
 * receipt — and it INCLUDES the people who read it. Somebody who blocked me
 * shows as delivered and never as read, exactly as a direct message to them
 * would: the report never reveals a block.
 */
export function BroadcastReportDialog({
  broadcastId,
  onOpenChat,
  onClose,
}: {
  broadcastId: Id
  /** Their reply lands in the 1:1 chat, so a delivered row can open it. */
  onOpenChat: (chatId: Id) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<BroadcastDeliveryStatus | null>(null)
  const { report, error, isLoading } = useBroadcastReport(broadcastId, status)
  const mediaUrl = useMediaUrl()

  return (
    <Modal
      title="Delivery report"
      description={report?.broadcast.body ?? undefined}
      onClose={onClose}
    >
      {report && (
        <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1" role="tablist">
          {TABS.map((tab) => (
            <Tab key={tab.label} isActive={status === tab.status} onClick={() => setStatus(tab.status)}>
              {tab.label}
              <span className="tabular-nums opacity-70">{report.counts[tab.count]}</span>
            </Tab>
          ))}
        </div>
      )}

      {error ? (
        <p className="text-xs text-muted-foreground">{error}</p>
      ) : isLoading && !report ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : !report || report.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody here.</p>
      ) : (
        <ul className={cn('grid gap-1', isLoading && 'opacity-60')}>
          {report.items.map((item) => {
            const person = resolveTalkUser(item.talkUserId, item.name, item.photo)
            const line =
              item.status === 'delivered'
                ? item.isRead && item.readAt
                  ? `Read ${formatDateTime(item.readAt)}`
                  : 'Delivered'
                : skipReasonText(item.reason)
            return (
              <li key={item.talkUserId} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                <Avatar
                  name={person.name}
                  src={mediaUrl(person.avatarKey) || undefined}
                  className="size-7 text-[10px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{person.name}</span>
                  <span
                    className={cn(
                      'block text-[11px]',
                      item.status === 'delivered' ? 'text-muted-foreground' : 'text-destructive',
                    )}
                  >
                    {line}
                  </span>
                </span>
                {item.chatId !== null && (
                  <button
                    type="button"
                    onClick={() => item.chatId !== null && onOpenChat(item.chatId)}
                    aria-label={`Open your chat with ${person.name}`}
                    className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <MessageCircle className="size-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
