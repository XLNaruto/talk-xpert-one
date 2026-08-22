import { Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui-store'
import type { PushStatus } from '../types'

interface PushPermissionPromptProps {
  status: PushStatus
  onEnable: () => void
}

/**
 * The one-time offer to turn notifications on.
 *
 * Shown for EXACTLY one status. `granted` needs nothing, `denied` is final and a
 * button that cannot work is worse than no button, and `unsupported` /
 * `unconfigured` are not the user's to fix. Waving it away is remembered, because
 * re-offering on every launch is what teaches people to click Block.
 */
export function PushPermissionPrompt({ status, onEnable }: PushPermissionPromptProps) {
  const dismissed = useUiStore((s) => s.pushPromptDismissed)
  const dismiss = useUiStore((s) => s.dismissPushPrompt)

  if (status !== 'prompt' || dismissed) return null

  return (
    <div className="pointer-events-auto fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-border bg-popover p-4 shadow-lg md:left-auto md:right-4 md:mx-0">
      <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Get notified about new messages</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your browser will alert you when a message arrives and this tab is closed.
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={onEnable}>
            Turn on
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification prompt"
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
