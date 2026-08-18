import { useEffect, useRef, useState } from 'react'
import { Ban, Camera, Loader2, ShieldOff, UserMinus, UserPlus } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/common/form-field'
import { Modal } from '@/components/common/modal'
import { OnlineBadge } from '@/components/common/online-badge'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore } from '@/stores/chat-store'
import { keyOf, type Id } from '@/types/api'
import { useChatActions } from '../api/use-chat-actions'
import { useMembers } from '../api/use-members'
import { useChatPresence } from '../api/use-presence'
import { useGroupDetailsForm } from '../hooks/use-group-details-form'
import { chatLabel, formatBytes, mediaLabel } from '../lib/chat-labels'
import { resolveTalkUser } from '../lib/talk-directory'
import * as chatApi from '../api/chat-api'
import { MediaThumb } from './message-media'
import { PeoplePicker } from './people-picker'
import type { Chat, ChatMember, MessageMedia } from '../types'
import { Tip } from '@/components/common/tip'

/**
 * Conversation details: the group's name and picture, its members, and the files
 * shared in it.
 *
 * Every write in here is owner-only server-side, so the controls are hidden for
 * anyone else rather than shown and then refused.
 */
export function ChatDetailsSheet({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const label = chatLabel(chat)
  const mediaUrl = useMediaUrl()
  const selfId = useAuthStore((s) => s.identity?.talkUserId ?? null)
  const isGroup = chat.type === 'group'
  const isOwner = chat.self.memberRole === 'owner'

  const { members, addMembers, removeMember, setMemberBlocked } = useMembers(chat.id, isGroup)
  // The rename lives in `useGroupDetailsForm`; only the picture is saved from here.
  const { uploadAvatar } = useChatActions()
  useChatPresence(chat.id, isGroup)

  const details = useGroupDetailsForm(chat)
  const [isAdding, setAdding] = useState(false)
  const [pendingIds, setPendingIds] = useState<Id[]>([])
  const avatarInput = useRef<HTMLInputElement>(null)

  const media = useChatMedia(chat.id)

  const confirmAdd = async () => {
    if (pendingIds.length === 0) return
    const ok = await addMembers(pendingIds)
    if (ok) {
      setPendingIds([])
      setAdding(false)
    }
  }

  // A right-hand sheet, matching "New group": this is the long panel that sits
  // beside the conversation — name, members and every shared file — not a short
  // centred panel asking for one decision.
  return (
    <Modal
      title={isGroup ? 'Group details' : 'Conversation details'}
      onClose={onClose}
      side="right"
    >
      <div className="grid gap-5">
        <div className="flex items-center gap-3">
          <span className="relative">
            <Avatar
              name={label.title}
              src={mediaUrl(label.avatarKey) || undefined}
              className="size-14 text-base"
            />
            {isGroup && isOwner && (
              <>
                <button
                  type="button"
                  onClick={() => avatarInput.current?.click()}
                  aria-label="Change group picture"
                  className="absolute -right-1 -bottom-1 rounded-full bg-primary p-1 text-primary-foreground"
                >
                  <Camera className="size-3" />
                </button>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void uploadAvatar(chat.id, file)
                    e.target.value = ''
                  }}
                />
              </>
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{label.title}</p>
            <p className="text-xs text-muted-foreground">
              {isGroup
                ? `${chat.memberCount} ${chat.memberCount === 1 ? 'member' : 'members'}`
                : 'Direct message'}
            </p>
          </div>
        </div>

        {/* A direct chat has no name and no picture of its own — it is named after
            the other person — so the rename form is groups only. */}
        {isGroup && isOwner && (
          <section className="grid gap-3">
            {/* Each message is passed to the Field that owns it, so it lands under
                its own box rather than at the foot of the section. */}
            <Field
              label="Group name"
              htmlFor="details-name"
              required
              error={details.errors.name}
            >
              <Input
                id="details-name"
                value={details.name}
                onChange={(e) => details.changeName(e.target.value)}
                aria-invalid={details.errors.name ? true : undefined}
              />
            </Field>
            <Field
              label="Description"
              htmlFor="details-description"
              error={details.errors.description}
            >
              <Textarea
                id="details-description"
                rows={2}
                value={details.description}
                onChange={(e) => details.changeDescription(e.target.value)}
                aria-invalid={details.errors.description ? true : undefined}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => void details.submit()}
                disabled={details.isPending}
              >
                {details.isPending && <Loader2 className="animate-spin" />}
                Save changes
              </Button>
            </div>
          </section>
        )}

        {isGroup && (
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide uppercase">Members</h3>
              {isOwner && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdding((open) => !open)}
                  aria-label="Add members"
                >
                  <UserPlus />
                  Add
                </Button>
              )}
            </div>

            {isAdding && (
              <div className="grid gap-2 rounded-md border border-border p-2">
                <PeoplePicker
                  selectedIds={pendingIds}
                  excludeIds={members.map((member) => member.talkUserId)}
                  onChange={setPendingIds}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void confirmAdd()}
                    disabled={pendingIds.length === 0}
                  >
                    Add {pendingIds.length > 0 ? pendingIds.length : ''}
                  </Button>
                </div>
              </div>
            )}

            <ul className="grid gap-1">
              {members.map((member) => (
                <MemberRow
                  key={member.talkUserId}
                  member={member}
                  role={member.memberRole}
                  isBlocked={member.isBlocked}
                  isSelf={member.talkUserId === selfId}
                  canManage={isOwner && member.talkUserId !== selfId}
                  onRemove={() => void removeMember(member.talkUserId)}
                  onToggleBlocked={() =>
                    void setMemberBlocked(member.talkUserId, !member.isBlocked)
                  }
                />
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-2">
          <h3 className="text-xs font-semibold tracking-wide uppercase">Shared files</h3>
          {media === null ? (
            <div className="flex justify-center py-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : media.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing shared here yet. Attach a file to a message and it will show up.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1">
                {media.slice(0, 8).map((item) => (
                  <MediaThumb key={item.id} media={item} siblings={media} />
                ))}
              </div>
              <ul className="grid gap-1">
                {media
                  .filter((item) => item.kind === 'document')
                  .slice(0, 5)
                  .map((item) => (
                    <li key={`doc-${item.id}`} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{mediaLabel(item)}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}

function MemberRow({
  member,
  role,
  isBlocked,
  isSelf,
  canManage,
  onRemove,
  onToggleBlocked,
}: {
  member: ChatMember
  role: string
  isBlocked: boolean
  isSelf: boolean
  canManage: boolean
  onRemove: () => void
  onToggleBlocked: () => void
}) {
  const mediaUrl = useMediaUrl()
  // `GET /talk/chats/:id/members` answers a name and a photo per row now, so
  // the sheet draws real people instead of ids.
  const person = resolveTalkUser(member.talkUserId, member.name, member.photo)
  const presence = useChatStore((s) => s.presence[keyOf(member.talkUserId)])

  return (
    <li className="flex items-center gap-2">
      <span className="relative shrink-0">
        <Avatar
          name={person.name}
          src={mediaUrl(person.avatarKey) || undefined}
          className="size-7 text-[10px]"
        />
        <OnlineBadge
          online={presence?.isOnline ?? false}
          className="absolute -right-0.5 bottom-0 size-2"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          {isSelf ? 'You' : person.name}
          {role !== 'member' && (
            <span className="ml-1 text-[10px] text-muted-foreground uppercase">{role}</span>
          )}
        </span>
        {isBlocked && (
          <span className="block text-[10px] text-destructive">Muted — cannot post</span>
        )}
      </span>

      {canManage && (
        <>
          <Tip label={isBlocked ? 'Let them post again' : 'Mute — they keep reading'}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleBlocked}
              aria-label={isBlocked ? `Let ${person.name} post again` : `Mute ${person.name}`}
            >
              {isBlocked ? <ShieldOff /> : <Ban />}
            </Button>
          </Tip>
          <Tip label="Remove from group">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              aria-label={`Remove ${person.name}`}
            >
              <UserMinus />
            </Button>
          </Tip>
        </>
      )}
    </li>
  )
}

/**
 * The chat's attachments. Read here rather than in an `api/` hook of its own
 * because this sheet is the only screen that shows them, and it is transient.
 */
function useChatMedia(chatId: Id): MessageMedia[] | null {
  const [media, setMedia] = useState<MessageMedia[] | null>(null)

  useEffect(() => {
    let cancelled = false
    chatApi
      .fetchChatMedia(chatId, { limit: 24 })
      .then((page) => {
        if (!cancelled) setMedia(page.items)
      })
      .catch(() => {
        if (!cancelled) setMedia([])
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  return media
}
