import { useState } from 'react'
import { Globe, Loader2, LogOut, Monitor, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { CLIENT_PLATFORM, type TalkPlatform } from '@/lib/platform'
import { useAuthStore } from '@/stores/auth-store'
import { useActiveSessions, useLogout } from '../api/use-auth'
import { logoutCopy, logoutEverywhereCopy } from '../lib/logout-copy'
import { emailInitials, platformIconKind, platformLabel } from '../lib/platform-display'

/**
 * The account sheet: who you are signed in as, on which devices, and the two
 * ways out.
 *
 * Talk allows one live session per operating system, so "signed in on Android and
 * WEB" is normal rather than a warning — but it is worth showing, because it is
 * the only way to notice a session you did not open.
 */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const identity = useAuthStore((s) => s.identity)
  const mediaUrl = useMediaUrl()
  // `photo` is a storage KEY, so it goes through the media prefix like every
  // other `*_url` field the API answers.
  const photo = mediaUrl(identity?.photo)
  const { mutate: logout, isPending } = useLogout()
  const { platforms, isLoading, failed } = useActiveSessions()
  // Which sign-out was asked for, and is therefore waiting on an answer. Both
  // ways out end a session the user cannot get back without their password, so
  // neither fires on the first tap.
  const [confirming, setConfirming] = useState<'this' | 'everywhere' | null>(null)
  const otherPlatforms = (platforms ?? []).filter((p) => p !== CLIENT_PLATFORM).length

  // One panel at a time: the question REPLACES the sheet rather than stacking on
  // it, so the decision is the only thing on screen and Cancel comes straight
  // back to the account.
  if (confirming !== null) {
    return (
      <ConfirmDialog
        {...(confirming === 'everywhere' ? logoutEverywhereCopy(otherPlatforms) : logoutCopy())}
        isPending={isPending}
        onConfirm={() => void logout(confirming === 'everywhere')}
        onCancel={() => setConfirming(null)}
      />
    )
  }

  return (
    <Modal
      title="Your account"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {/* Signing out here ends only THIS platform's session — the phone stays
              in. "Everywhere" is the answer to a lost device, so it is set apart
              from the everyday button rather than sitting beside it. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirming('everywhere')}
          >
            Sign out everywhere
          </Button>
          <Button disabled={isPending} onClick={() => setConfirming('this')}>
            {isPending ? <Loader2 className="animate-spin" /> : <LogOut />}
            Sign out
          </Button>
        </div>
      }
    >
      <div className="grid gap-5">
        {/* Identity. `GET /talk/me` reports your name and your avatar key, so
            both are shown — with the email's initials as the fallback for a
            master record that carries neither. */}
        <div className="flex items-center gap-3">
          {photo ? (
            <img
              src={photo}
              alt=""
              className="size-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-fill text-base font-semibold text-primary-fill-foreground select-none"
              aria-hidden
            >
              {emailInitials(identity?.email)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={identity?.email}>
              {identity?.name?.trim() || identity?.email || 'Signed in'}
            </p>
            {identity?.name?.trim() && identity.email && (
              <p className="truncate text-xs text-muted-foreground">{identity.email}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Signed in on this {platformLabel(CLIENT_PLATFORM).toLowerCase()}
            </p>
          </div>
        </div>

        <section className="grid gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Signed in on
          </h3>

          {platforms === null || isLoading ? (
            <div className="grid gap-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : failed || platforms.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Your other sessions couldn&apos;t be read. Try again in a moment.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {platforms.map((platform) => (
                <DeviceRow key={platform} platform={platform} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}

function DeviceRow({ platform }: { platform: TalkPlatform }) {
  const kind = platformIconKind(platform)
  const isThisDevice = platform === CLIENT_PLATFORM
  const Icon = kind === 'mobile' ? Smartphone : kind === 'browser' ? Globe : Monitor

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{platformLabel(platform)}</p>
      </div>
      {isThisDevice && (
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          This device
        </span>
      )}
    </li>
  )
}
