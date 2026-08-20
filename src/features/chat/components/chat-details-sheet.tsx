import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Ban, Camera, Loader2, Search, ShieldOff, UserMinus, UserPlus, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/common/form-field'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Modal } from '@/components/common/modal'
import { OnlineBadge } from '@/components/common/online-badge'
import { useMediaUrl } from '@/hooks/use-app-config'
import { AVATAR_CONTENT_TYPES } from '@/lib/uploads'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore } from '@/stores/chat-store'
import { keyOf, type Id } from '@/types/api'
import { useChatActions } from '../api/use-chat-actions'
import { useChatPresence } from '../api/use-presence'
import { useGroupDetailsForm } from '../hooks/use-group-details-form'
import { useGroupInfo, type GroupInfoTab, type MemberConfirm } from '../hooks/use-group-info'
import { chatLabel, formatBytes, mediaLabel, memberBlockCopy } from '../lib/chat-labels'
import { resolveTalkUser } from '../lib/talk-directory'
import * as chatApi from '../api/chat-api'
import { MediaThumb } from './message-media'
import { PeoplePicker } from './people-picker'
import type { Chat, ChatMember, MessageMedia } from '../types'
import { Tip } from '@/components/common/tip'

/**
 * Group info: the group's picture and name on one pane, everybody in it — and
 * everybody who could be — on the other.
 *
 * Two panes rather than one long column because the two jobs are different
 * lengths: renaming is three controls, while the member list runs to dozens of
 * rows and grows its own "add" list above it.
 *
 * Every write in here is owner-only server-side, so the controls are hidden for
 * anyone else rather than shown and then refused — which is why the profile pane
 * reads as a card for a member and as a form for the owner.
 */
export function ChatDetailsSheet({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const label = chatLabel(chat)
  const mediaUrl = useMediaUrl()
  const selfId = useAuthStore((s) => s.identity?.talkUserId ?? null)
  const isGroup = chat.type === 'group'
  const isOwner = chat.self.memberRole === 'owner'

  const group = useGroupInfo(chat.id, isGroup)
  // The rename lives in `useGroupDetailsForm`; only the picture is saved from here.
  const { uploadAvatar } = useChatActions()
  useChatPresence(chat.id, isGroup)

  const details = useGroupDetailsForm(chat)
  const avatarInput = useRef<HTMLInputElement>(null)

  const media = useChatMedia(chat.id)
  const memberCount = group.members.length || chat.memberCount

  const manageProps = {
    selfId,
    canManage: isOwner,
    onRemove: group.askRemove,
    onToggleBlocked: group.askToggleBlocked,
  }

  // A right-hand sheet, matching "New group": this is the long panel that sits
  // beside the conversation, not a short centred panel asking for one decision.
  return (
    <Modal
      title={isGroup ? 'Group info' : 'Contact info'}
      onClose={onClose}
      side="right"
    >
      <div className="grid gap-5">
        {isGroup && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-accent/40 p-1">
            <TabButton
              tab="profile"
              current={group.tab}
              onSelect={group.setTab}
              icon={<Users />}
              label="Profile"
            />
            <TabButton
              tab="members"
              current={group.tab}
              onSelect={group.setTab}
              icon={<UserPlus />}
              label="Members"
              badge={memberCount}
            />
          </div>
        )}

        {(!isGroup || group.tab === 'profile') && (
          <>
            <div className="grid justify-items-center gap-2 pt-1">
              <span className="relative">
                <Avatar
                  name={label.title}
                  src={mediaUrl(label.avatarKey) || undefined}
                  className="size-24 text-2xl"
                />
                {isGroup && isOwner && (
                  <>
                    <button
                      type="button"
                      onClick={() => avatarInput.current?.click()}
                      aria-label="Change group photo"
                      className="absolute right-0 bottom-0 rounded-full bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-primary-hover"
                    >
                      <Camera className="size-3.5" />
                    </button>
                    <input
                      ref={avatarInput}
                      type="file"
                      accept={AVATAR_CONTENT_TYPES.join(',')}
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

              {isGroup && isOwner ? (
                <p className="text-xs text-muted-foreground">Click to change photo</p>
              ) : (
                <>
                  <p className="truncate text-base font-semibold">{label.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {isGroup
                      ? `${memberCount} ${memberCount === 1 ? 'participant' : 'participants'}`
                      : 'Direct message'}
                  </p>
                </>
              )}
            </div>

            {/* A direct chat has no name and no picture of its own — it is named
                after the other person — so the rename form is groups only. */}
            {isGroup && isOwner && (
              <section className="grid gap-3">
                {/* Each message is passed to the Field that owns it, so it lands
                    under its own box rather than at the foot of the section. */}
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
                <Button
                  className="w-full"
                  onClick={() => void details.submit()}
                  disabled={details.isPending}
                >
                  {details.isPending && <Loader2 className="animate-spin" />}
                  Save
                </Button>
              </section>
            )}

            {isGroup && (
              <section className="grid gap-2">
                <SectionHeading count={memberCount}>Members</SectionHeading>

                <div className="relative">
                  <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={group.memberQuery}
                    onChange={(e) => group.setMemberQuery(e.target.value)}
                    placeholder="Search members…"
                    aria-label="Search members"
                    className="pl-9"
                  />
                </div>

                <MemberList
                  members={group.visibleMembers}
                  isLoading={group.isLoading}
                  isFiltered={group.memberQuery.trim().length > 0}
                  {...manageProps}
                />
              </section>
            )}

            <section className="grid gap-2">
              <SectionHeading>Shared files</SectionHeading>
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
                        <li
                          key={`doc-${item.id}`}
                          className="flex items-center gap-2 text-xs"
                        >
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
          </>
        )}

        {isGroup && group.tab === 'members' && (
          <>
            {isOwner && (
              <section className="grid gap-2">
                <SectionHeading>Add members</SectionHeading>
                {/* One tap picks one person, against a group that already
                    exists — so there is no selection to collect and no Add
                    button at the foot. The tap asks first: everyone in the group
                    sees the new arrival, and a stray tap on a dense list has
                    nothing to undo it. */}
                <PeoplePicker
                  variant="add"
                  selectedIds={[]}
                  excludeIds={group.memberIds}
                  onChange={() => {}}
                  onAdd={group.askAdd}
                  pendingIds={group.pendingIds}
                  searchPlaceholder="Search users to add…"
                />
              </section>
            )}

            <section className="grid gap-2">
              <SectionHeading count={memberCount}>Members</SectionHeading>
              <MemberList
                members={group.members}
                isLoading={group.isLoading}
                isFiltered={false}
                {...manageProps}
              />
            </section>
          </>
        )}
      </div>

      {/* Both membership writes come through here, so the wording and the button
          order are the same whichever way the group is changing. */}
      {group.confirm && (
        <MemberConfirmDialog
          confirm={group.confirm}
          groupName={label.title}
          isPending={group.isConfirming}
          onConfirm={() => void group.runConfirm()}
          onCancel={group.cancelConfirm}
        />
      )}
    </Modal>
  )
}

/**
 * The question behind every membership write. Blocking is its own pair of
 * sentences rather than "remove" reworded: the member stays and keeps READING,
 * which is the part an owner has to be told before they press it.
 */
function MemberConfirmDialog({
  confirm,
  groupName,
  isPending,
  onConfirm,
  onCancel,
}: {
  confirm: MemberConfirm
  groupName: string
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const copy =
    confirm.kind === 'add'
      ? {
          title: 'Add to the group?',
          message: `${confirm.name} will join ${groupName} and can read what is posted from now on.`,
          confirmLabel: 'Add',
          tone: 'default' as const,
        }
      : confirm.kind === 'remove'
        ? {
            title: 'Remove from the group?',
            message: `${confirm.name} loses access to ${groupName}. You can add them back later.`,
            confirmLabel: 'Remove',
            tone: 'destructive' as const,
          }
        : memberBlockCopy(confirm.name, groupName, confirm.kind === 'block')

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

function TabButton({
  tab,
  current,
  onSelect,
  icon,
  label,
  badge,
}: {
  tab: GroupInfoTab
  current: GroupInfoTab
  onSelect: (tab: GroupInfoTab) => void
  icon: ReactNode
  label: string
  badge?: number
}) {
  const isActive = tab === current
  return (
    <button
      type="button"
      onClick={() => onSelect(tab)}
      aria-pressed={isActive}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        isActive
          ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
      {badge !== undefined && (
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          {badge}
        </span>
      )}
    </button>
  )
}

function SectionHeading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </h3>
      {count !== undefined && (
        <span className="text-[11px] text-muted-foreground">{count}</span>
      )}
    </div>
  )
}

function MemberList({
  members,
  isLoading,
  isFiltered,
  selfId,
  canManage,
  onRemove,
  onToggleBlocked,
}: {
  members: ChatMember[]
  isLoading: boolean
  isFiltered: boolean
  selfId: Id | null
  canManage: boolean
  onRemove: (id: Id) => void
  onToggleBlocked: (id: Id, blocked: boolean) => void
}) {
  if (isLoading && members.length === 0) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <p className="px-1 py-4 text-xs text-muted-foreground">
        {isFiltered ? 'Nobody here by that name. Try fewer letters.' : 'Nobody here yet.'}
      </p>
    )
  }

  return (
    <ul className="grid gap-0.5">
      {members.map((member) => (
        <MemberRow
          key={member.talkUserId}
          member={member}
          role={member.memberRole}
          isBlocked={member.isBlocked}
          isSelf={member.talkUserId === selfId}
          canManage={canManage && member.talkUserId !== selfId}
          onRemove={() => onRemove(member.talkUserId)}
          onToggleBlocked={() => onToggleBlocked(member.talkUserId, !member.isBlocked)}
        />
      ))}
    </ul>
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
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40">
      <span className="relative shrink-0">
        <Avatar name={person.name} src={mediaUrl(person.avatarKey) || undefined} />
        <OnlineBadge
          online={presence?.isOnline ?? false}
          className="absolute -right-0.5 bottom-0 size-2.5"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{person.name}</span>
          {isSelf && <Pill tone="muted">You</Pill>}
          {role !== 'member' && <Pill tone="primary">{role === 'owner' ? 'Admin' : role}</Pill>}
        </span>
        {isBlocked && (
          <span className="block text-[11px] text-destructive">Muted — cannot post</span>
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

function Pill({ tone, children }: { tone: 'primary' | 'muted'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize',
        tone === 'primary'
          ? 'bg-primary/15 text-primary'
          : 'bg-accent text-muted-foreground',
      )}
    >
      {children}
    </span>
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
