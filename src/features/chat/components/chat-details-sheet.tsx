import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Ban,
  Camera,
  Loader2,
  LogOut,
  MoreVertical,
  Search,
  Shield,
  ShieldMinus,
  ShieldOff,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/common/form-field'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Modal } from '@/components/common/modal'
import { OnlineBadge } from '@/components/common/online-badge'
import { Tip } from '@/components/common/tip'
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
import { useChatHeaderActions } from '../hooks/use-chat-header-actions'
import {
  canHideChat,
  chatLabel,
  formatBytes,
  leaveGroupCopy,
  mediaLabel,
  memberBlockCopy,
  memberRoleCopy,
  removeChatCopy,
} from '../lib/chat-labels'
import { canActOnMember, canEditGroup, canManageMembers, roleLabel } from '../lib/member-roles'
import { resolveTalkUser } from '../lib/talk-directory'
import * as chatApi from '../api/chat-api'
import { MediaThumb } from './message-media'
import { PeoplePicker } from './people-picker'
import type { Chat, ChatMember, ChatSelf, MemberRole, MessageMedia } from '../types'

/**
 * Group info: the group's picture and name on one pane, everybody in it — and
 * everybody who could be — on the other.
 *
 * Two panes rather than one long column because the two jobs are different
 * lengths: renaming is three controls, while the member list runs to dozens of
 * rows and grows its own "add" list above it.
 *
 * The controls are hidden for anybody the server would refuse, rather than shown
 * and then toasted — and the two kinds of authority are gated separately.
 * Membership (add, remove, mute, appoint) is the OWNER OR AN ADMIN; renaming,
 * re-picturing and disbanding stay OWNER-ONLY. Which is why the profile pane
 * reads as a card for an admin and as a form only for the creator.
 */
export function ChatDetailsSheet({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const label = chatLabel(chat)
  const mediaUrl = useMediaUrl()
  const selfId = useAuthStore((s) => s.identity?.talkUserId ?? null)
  const isGroup = chat.type === 'group'
  // Two different questions, and conflating them is the bug this screen had:
  // `canEdit` is the rename form and the photo, which succession does not share;
  // `canManage` is everything about WHO IS IN the group, which an admin holds in
  // full.
  // Both also go false once I have LEFT: the row keeps the role it was frozen
  // at, so an owner who left still reads `owner` here while the server refuses
  // every write on that group.
  const canEdit = canEditGroup(chat.self)
  const canManage = canManageMembers(chat.self)

  const group = useGroupInfo(chat.id, isGroup)
  // The rename lives in `useGroupDetailsForm`; only the picture is saved from here.
  const { uploadAvatar } = useChatActions()
  useChatPresence(chat.id, isGroup)

  const details = useGroupDetailsForm(chat)
  const avatarInput = useRef<HTMLInputElement>(null)

  // The same three endings the header's overflow menu offers, on the sheet that
  // is already open — the questions and their copy come from the one hook, so
  // the owner's leave still names the heir here.
  const ending = useChatHeaderActions(chat)
  const canLeave = isGroup && !chat.self.hasLeft
  // A left group's second step: leaving freezes the row, this is what removes it.
  const canRemove = isGroup && canHideChat(chat)

  const media = useChatMedia(chat.id)
  const memberCount = group.members.length || chat.memberCount

  const manageProps = {
    selfId,
    self: chat.self,
    // My own row holds no management verbs — they all refuse against me — but it
    // does hold the one thing only I can do, so the menu there is my exit.
    canLeave,
    onLeave: () => ending.ask('leave'),
    onRemove: group.askRemove,
    onToggleBlocked: group.askToggleBlocked,
    onSetRole: group.askSetRole,
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
                {isGroup && canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => avatarInput.current?.click()}
                      aria-label="Change group photo"
                      className="absolute right-0 bottom-0 rounded-full bg-primary-fill p-1.5 text-primary-fill-foreground transition-colors hover:bg-primary-fill-hover"
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

              {isGroup && canEdit ? (
                <p className="text-xs text-muted-foreground">Click to change photo</p>
              ) : (
                <>
                  <p className="truncate text-base font-semibold">{label.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {isGroup
                      ? `${memberCount} ${memberCount === 1 ? 'participant' : 'participants'}`
                      : 'Direct message'}
                  </p>
                  {/* What the group is FOR. The owner reads it out of the edit
                      box below; everybody else had nowhere to read it at all,
                      so a description was written and never seen. Straight off
                      the chat row, which `talk.chat.updated` patches in place. */}
                  {isGroup && chat.description && (
                    <p className="max-w-[42ch] text-center text-xs whitespace-pre-wrap text-muted-foreground">
                      {chat.description}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* A direct chat has no name and no picture of its own — it is named
                after the other person — so the rename form is groups only. */}
            {isGroup && canEdit && (
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
                    onKeyDown={(e) => {
                      // Esc clears the filter rather than closing the sheet —
                      // the field is inside a dialog, so the key has to be
                      // stopped or the whole panel goes with it.
                      if (e.key === 'Escape' && group.memberQuery.length > 0) {
                        e.preventDefault()
                        e.stopPropagation()
                        group.setMemberQuery('')
                      }
                    }}
                    placeholder="Search members…"
                    aria-label="Search members"
                    className={cn('pl-9', group.memberQuery.length > 0 && 'pr-9')}
                  />
                  {/* The field is always open here, so the clear button only
                      appears once there is something to clear. */}
                  {group.memberQuery.length > 0 && (
                    <Tip label="Clear search (Esc)">
                      <button
                        type="button"
                        onClick={() => group.setMemberQuery('')}
                        aria-label="Clear member search"
                        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </Tip>
                  )}
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

            {isGroup && (canLeave || canRemove || canEdit) && (
              <section className="grid gap-2 border-t border-border pt-4">
                <SectionHeading>Leave or delete</SectionHeading>
                {canLeave && (
                  <DangerButton icon={<LogOut />} onClick={() => ending.ask('leave')}>
                    Leave group
                  </DangerButton>
                )}
                {canRemove && (
                  <DangerButton icon={<Trash2 />} onClick={() => ending.ask('remove')}>
                    Remove from your list
                  </DangerButton>
                )}
                {/* Owner-only, and never inherited by an admin: this one takes
                    the conversation away from every member. */}
                {canEdit && (
                  <DangerButton icon={<Trash2 />} onClick={() => ending.ask('disband')}>
                    Delete for everyone
                  </DangerButton>
                )}
              </section>
            )}
          </>
        )}

        {isGroup && group.tab === 'members' && (
          <>
            {canManage && (
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
                  // Capped and scrolled in place: the directory can run to
                  // hundreds of rows, and unbounded it pushed the group's own
                  // Members list a page and a half down the sheet. No box drawn
                  // around it — with one result the border read as an outline on
                  // the PERSON; the rows carry their own hover instead.
                  listClassName="max-h-64 overflow-y-auto"
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
      {ending.confirmKind !== null && (
        <ConfirmDialog
          {...(ending.confirmKind === 'disband'
            ? {
                title: 'Delete this group for everyone?',
                message: `${label.title} and its messages go away for every member. This cannot be undone.`,
                confirmLabel: 'Delete for everyone',
              }
            : ending.confirmKind === 'leave'
              ? leaveGroupCopy(label.title, canEdit, ending.successorName)
              : removeChatCopy(label.title, isGroup))}
          tone="destructive"
          isPending={ending.isPending}
          onConfirm={() => void ending.run()}
          onCancel={ending.cancel}
        />
      )}

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
 * which is the part the person pressing it has to be told. Appointing an admin
 * gets its own pair for the same reason — the word "admin" does not say what
 * they will be able to do, or what they still cannot.
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
        : confirm.kind === 'promote' || confirm.kind === 'demote'
          ? memberRoleCopy(confirm.name, groupName, confirm.kind === 'promote')
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

/**
 * One ending, as a full-width row. The header offers these in a dropdown, where
 * a menu item is the shape; here there is no menu to open, so they are buttons
 * that read as a list — quiet until hovered, destructive on the way in.
 */
function DangerButton({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="h-9 w-full justify-start gap-2 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      {icon}
      {children}
    </Button>
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
  self,
  canLeave,
  onLeave,
  onRemove,
  onToggleBlocked,
  onSetRole,
}: {
  members: ChatMember[]
  isLoading: boolean
  isFiltered: boolean
  selfId: Id | null
  self: ChatSelf
  canLeave: boolean
  onLeave: () => void
  onRemove: (id: Id) => void
  onToggleBlocked: (id: Id, blocked: boolean) => void
  onSetRole: (id: Id, promote: boolean) => void
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
          // One answer for all three verbs, because they refuse together: the
          // creator's row is untouchable by everybody, my own row refuses on
          // mute, remove AND role, and a plain member holds none of them.
          canManage={canActOnMember(self, member, selfId)}
          canLeave={canLeave && member.talkUserId === selfId}
          onLeave={onLeave}
          onRemove={() => onRemove(member.talkUserId)}
          onToggleBlocked={() => onToggleBlocked(member.talkUserId, !member.isBlocked)}
          onSetRole={() => onSetRole(member.talkUserId, member.memberRole !== 'admin')}
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
  canLeave,
  onLeave,
  onRemove,
  onToggleBlocked,
  onSetRole,
}: {
  member: ChatMember
  role: MemberRole
  isBlocked: boolean
  isSelf: boolean
  canManage: boolean
  /** Only ever true on MY row, and only while I am still in the group. */
  canLeave: boolean
  onLeave: () => void
  onRemove: () => void
  onToggleBlocked: () => void
  onSetRole: () => void
}) {
  const mediaUrl = useMediaUrl()
  // `GET /talk/chats/:id/members` answers a name and a photo per row now, so
  // the sheet draws real people instead of ids.
  const person = resolveTalkUser(member.talkUserId, member.name, member.photo)
  const presence = useChatStore((s) => s.presence[keyOf(member.talkUserId)])

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40',
        // Your own row gets the faintest wash, so "where am I in this list" is
        // answered by scanning rather than by reading every name.
        isSelf && 'bg-primary/5',
      )}
    >
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
          {/* Two different kinds of label, so they are drawn differently: the
              role is a STATUS the group granted and takes brand paint; "You" is
              an identity, and a filled grey pill gave it the visual weight of a
              role nobody granted. It is a hairline outline instead. */}
          {isSelf && <Pill tone="outline">You</Pill>}
          {/* Owner and admin are now genuinely different — the same powers over
              the membership, but the creator's row is untouchable — so one chip
              cannot carry both. Without the distinction "why does my menu not
              work on Minato" becomes a support question. */}
          {roleLabel(role) && <Pill tone="primary">{roleLabel(role)}</Pill>}
        </span>
        {isBlocked && (
          <span className="block text-[11px] text-destructive">Muted — cannot post</span>
        )}
      </span>

      {/* My own row: nothing can be done TO me here — mute, demote and remove all
          refuse against myself — so there is no menu to open. The one act that
          IS mine is a door of its own, named by its tooltip. */}
      {canLeave && (
        <Tip label="Leave group">
          <Button
            variant="ghost"
            size="icon"
            onClick={onLeave}
            aria-label="Leave group"
            className="size-8 shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut />
          </Button>
        </Tip>
      )}

      {canManage && (
        <>
          {/* One menu instead of two bare icon buttons. A row of unlabelled
              glyphs made every member look like a pair of pending actions, and
              a mute and a removal a few pixels apart is a misclick that cannot
              be taken back — a menu makes both NAMED and deliberate.

              Drawn for the owner AND for any admin, and never on the creator's
              row: every item in it is refused against the owner, so a menu there
              would be three buttons that can only produce toasts. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 rounded-full text-muted-foreground data-[state=open]:bg-accent"
                aria-label={`Manage ${person.name}`}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem className="items-start" onSelect={onToggleBlocked}>
                {isBlocked ? <ShieldOff className="mt-0.5" /> : <Ban className="mt-0.5" />}
                {/* Muting is the half-measure people reach for and misread, so
                    the consequence rides under the label rather than in a
                    tooltip the menu has no room for. */}
                <span className="flex flex-col gap-0.5">
                  {isBlocked ? 'Let them post again' : 'Mute'}
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {isBlocked ? 'They can send messages again' : 'They keep reading, cannot post'}
                  </span>
                </span>
              </DropdownMenuItem>
              {/* The role write is idempotent server-side, so nothing here is
                  disabled after a tap: a second one answers 200 and announces
                  nothing rather than putting a duplicate line in the thread. */}
              <DropdownMenuItem className="items-start" onSelect={onSetRole}>
                {role === 'admin' ? (
                  <ShieldMinus className="mt-0.5" />
                ) : (
                  <Shield className="mt-0.5" />
                )}
                <span className="flex flex-col gap-0.5">
                  {role === 'admin' ? 'Remove as admin' : 'Make admin'}
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {role === 'admin'
                      ? 'They go back to an ordinary member'
                      : 'They can add, remove and mute members'}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <UserMinus />
                Remove from group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </li>
  )
}

function Pill({ tone, children }: { tone: 'primary' | 'outline'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold capitalize',
        tone === 'primary'
          ? 'bg-primary/15 text-primary'
          : 'border border-border text-muted-foreground',
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
  /**
   * A per-file delete drops a file from this gallery with no event of its own —
   * `talk.message.media_deleted` is about a MESSAGE — so the socket handler
   * bumps a number and the read is repeated. Only the endpoint knows what is
   * left, since the gallery is the whole chat rather than one bubble.
   */
  const revision = useChatStore((s) => s.mediaRevision[keyOf(chatId)] ?? 0)

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
  }, [chatId, revision])

  return media
}
