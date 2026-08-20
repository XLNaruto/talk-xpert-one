import { useState } from 'react'
import { Loader2, ShieldOff } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState } from '@/components/common/empty-state'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useBlockedPeople } from '../api/use-blocked-people'
import { personBlockCopy } from '../lib/chat-labels'
import { formatDateTime } from '../lib/message-formatters'
import { resolveTalkUser } from '../lib/talk-directory'
import type { BlockedPerson } from '../types'

/**
 * The people I have blocked, and the way back.
 *
 * A block is made from a conversation but is ACCOUNT-WIDE and outlives that
 * conversation — deleting the chat does not lift it — so without a list of its
 * own there is no way to undo one whose chat is gone. This is that list.
 *
 * One direction only: `GET /talk/blocks` answers who I blocked and never who
 * blocked me, so there is nothing here to reveal about the other side.
 */
export function BlockedPeopleDialog({ onClose }: { onClose: () => void }) {
  const mediaUrl = useMediaUrl()
  const { people, isLoading, pendingId, unblock } = useBlockedPeople(true)
  // Asked before the write, like every other block and unblock in the app —
  // this list is the one place a whole session's blocks sit one tap apart.
  const [confirming, setConfirming] = useState<BlockedPerson | null>(null)

  return (
    <Modal
      title="Blocked contacts"
      description="They cannot message you, and they are not told."
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isLoading && people.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-label="Loading" />
        </div>
      ) : people.length === 0 ? (
        <EmptyState
          className="h-auto py-8"
          icon={<ShieldOff className="size-8" />}
          title="Nobody is blocked"
          description="Block someone from their conversation and they will appear here."
        />
      ) : (
        <ul className="grid max-h-[50vh] gap-1 overflow-y-auto">
          {people.map((person) => {
            const who = resolveTalkUser(person.talkUserId, person.name, person.photo)
            return (
              <li key={person.talkUserId} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                <Avatar
                  name={who.name}
                  src={mediaUrl(who.avatarKey) || undefined}
                  className="size-10 shrink-0"
                />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{who.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Blocked {formatDateTime(person.blockedAt)}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingId === person.talkUserId}
                  onClick={() => setConfirming(person)}
                  aria-label={`Unblock ${who.name}`}
                >
                  {pendingId === person.talkUserId && <Loader2 className="animate-spin" />}
                  Unblock
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      {confirming && (
        <UnblockConfirm
          person={confirming}
          isPending={pendingId === confirming.talkUserId}
          onConfirm={() => {
            const person = confirming
            setConfirming(null)
            void unblock(person)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Modal>
  )
}

function UnblockConfirm({
  person,
  isPending,
  onConfirm,
  onCancel,
}: {
  person: BlockedPerson
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const who = resolveTalkUser(person.talkUserId, person.name, person.photo)
  const copy = personBlockCopy(who.name, false)
  return (
    <ConfirmDialog
      title={copy.title}
      message={copy.message}
      confirmLabel={copy.confirmLabel}
      tone={copy.tone}
      isPending={isPending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
