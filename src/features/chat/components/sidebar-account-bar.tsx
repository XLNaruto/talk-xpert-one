import { useEffect, useRef, useState } from 'react'
import { LogOut, Moon, Palette, Settings, ShieldOff, UserRound } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { OnlineBadge } from '@/components/common/online-badge'
import { useMediaUrl } from '@/hooks/use-app-config'
import { ThemePickerDialog } from '@/components/common/theme-picker-dialog'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { AccountSheet, logoutCopy, useLogout } from '@/features/auth'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { selfLabel } from '../lib/talk-directory'
import { BlockedPeopleDialog } from './blocked-people-dialog'
import { Tip } from '@/components/common/tip'

/**
 * The foot of the sidebar: who you are signed in as, and the settings that
 * belong to the person rather than to a conversation.
 *
 * The menu opens UPWARDS from the gear, because there is nothing below it — and
 * it is absolutely positioned inside the bar rather than portalled, since it is
 * small enough that it never needs to escape the 320px column.
 */
export function SidebarAccountBar() {
  const identity = useAuthStore((s) => s.identity)
  const mediaUrl = useMediaUrl()
  const isOnline = useOnlineStatus()
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const { mutate: logout, isPending } = useLogout()

  const [isMenuOpen, setMenuOpen] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [showThemes, setShowThemes] = useState(false)
  const [showBlocked, setShowBlocked] = useState(false)
  // Logging out cannot be undone without the password, so the item asks first.
  const [confirmLogout, setConfirmLogout] = useState(false)
  const bar = useRef<HTMLDivElement>(null)

  // A menu that only closes on its own items is a trap — Escape and a click
  // anywhere else have to dismiss it too.
  useEffect(() => {
    if (!isMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isMenuOpen])

  const self = selfLabel(
    identity?.talkUserId ?? 0,
    identity?.name,
    identity?.photo,
    identity?.email,
  )

  return (
    // A glass CARD floating over the list rather than a bar the list stops
    // above: it is positioned out of flow, so rows scroll on underneath and
    // blur through it. `bg-sidebar/60` needs the blur to be legible, so the
    // fallback for a browser without `backdrop-filter` is the opaque fill —
    // never the translucent one, which would leave text over moving rows.
    // The list carries the matching bottom padding (`chat-sidebar.tsx`) so its
    // last row can still be scrolled clear of the glass.
    <div
      ref={bar}
      className="absolute inset-x-2 bottom-2 z-20 rounded-full border border-sidebar-border/70 bg-sidebar/90 px-2 py-1 shadow-lg supports-[backdrop-filter]:bg-sidebar/60 supports-[backdrop-filter]:backdrop-blur-xl"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowAccount(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full py-0.5 pr-1 text-left"
          aria-label="Your account"
        >
          <span className="relative shrink-0">
            <Avatar
              name={self.name}
              src={mediaUrl(self.avatarKey) || undefined}
              className="size-9"
            />
            <OnlineBadge
              online={isOnline}
              className="absolute right-0 bottom-0 ring-sidebar"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{self.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </span>
        </button>

        <Tip label="Settings" side="top">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Settings"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
          >
            <Settings />
          </Button>
        </Tip>
      </div>

      {isMenuOpen && (
        <div
          role="menu"
          aria-label="Settings"
          className="absolute right-2 bottom-full z-30 mb-1 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={theme === 'dark'}
            onClick={toggleTheme}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-accent"
          >
            <Moon className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1 text-left">Dark mode</span>
            <span
              aria-hidden
              className={cn(
                'flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
                theme === 'dark' ? 'bg-primary-fill' : 'bg-muted-foreground/40',
              )}
            >
              {/* On, the knob sits on `--primary-fill`, so it takes that fill's own
                  ink rather than `--card` — which in the dark palette is a dark
                  tinted surface and disappeared into the track. */}
              <span
                className={cn(
                  'size-4 rounded-full transition-transform',
                  theme === 'dark'
                    ? 'translate-x-4 bg-primary-fill-foreground'
                    : 'bg-card',
                )}
              />
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              setShowThemes(true)
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-accent"
          >
            <Palette className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1 text-left">Colour theme</span>
            <span className="size-4 shrink-0 rounded-full bg-primary-fill" aria-hidden />
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              setShowAccount(true)
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-accent"
          >
            <UserRound className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1 text-left">Your account</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              setShowBlocked(true)
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-accent"
          >
            <ShieldOff className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1 text-left">Blocked contacts</span>
          </button>

          <div className="my-1 h-px bg-border" />

          <button
            type="button"
            role="menuitem"
            disabled={isPending}
            onClick={() => {
              setMenuOpen(false)
              setConfirmLogout(true)
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden />
            <span className="flex-1 text-left">Log out</span>
          </button>
        </div>
      )}

      {showAccount && <AccountSheet onClose={() => setShowAccount(false)} />}
      {showThemes && <ThemePickerDialog onClose={() => setShowThemes(false)} />}
      {showBlocked && <BlockedPeopleDialog onClose={() => setShowBlocked(false)} />}
      {confirmLogout && (
        <ConfirmDialog
          {...logoutCopy('Log out')}
          isPending={isPending}
          onConfirm={() => void logout(false)}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </div>
  )
}
