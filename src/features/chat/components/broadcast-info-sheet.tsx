import { Megaphone, Pencil, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { broadcastListTitle, recipientCountLine } from '../lib/broadcast-labels'
import { resolveTalkUser } from '../lib/talk-directory'
import type { BroadcastListDetail } from '../types'

/**
 * A list's info — who is on it — with the two things that change it. The
 * broadcast pane's equivalent of a group's details sheet.
 */
export function BroadcastInfoSheet({
  list,
  onEdit,
  onDelete,
  onClose,
}: {
  list: BroadcastListDetail
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const mediaUrl = useMediaUrl()

  return (
    <Modal
      title={broadcastListTitle(list, list.recipients)}
      description={recipientCountLine(list.recipientCount)}
      icon={<Megaphone />}
      onClose={onClose}
      side="right"
      footer={
        <>
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 />
            Delete broadcast
          </Button>
          <Button onClick={onEdit}>
            <Pencil />
            Edit broadcast
          </Button>
        </>
      }
    >
      <ul className="grid gap-1">
        {list.recipients.map((recipient) => {
          const person = resolveTalkUser(recipient.talkUserId, recipient.name, recipient.photo)
          return (
            <li key={recipient.talkUserId} className="flex items-center gap-3 px-1 py-1.5">
              <Avatar name={person.name} src={mediaUrl(person.avatarKey) || undefined} />
              <span className="truncate text-sm">{person.name}</span>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
