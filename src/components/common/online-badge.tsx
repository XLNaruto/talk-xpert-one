import { cn } from '@/lib/utils'

/** Presence dot, overlaid on an avatar. */
export function OnlineBadge({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      aria-label={online ? 'Online' : 'Offline'}
      className={cn(
        'size-2.5 rounded-full ring-2 ring-card',
        online ? 'bg-success' : 'bg-muted-foreground',
        className,
      )}
    />
  )
}
