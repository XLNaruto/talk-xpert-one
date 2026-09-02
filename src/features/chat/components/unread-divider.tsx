/**
 * Where the reader left off.
 *
 * Drawn in the accent rather than the muted border of `DayDivider`, because the
 * two sit in the same column and mean opposite things: one is a date the reader
 * scrolls past, this one is the line they came back for.
 */
export function UnreadDivider({ count }: { count?: number }) {
  // `pt-3` rather than a margin — see `day-divider.tsx`.
  return (
    <div className="pt-3 flex items-center gap-3 px-3">
      <span className="h-px flex-1 bg-primary/40" />
      <span className="rounded-full bg-primary-fill px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary-fill-foreground">
        {count && count > 0 ? `${count} unread messages` : 'Unread messages'}
      </span>
      <span className="h-px flex-1 bg-primary/40" />
    </div>
  )
}
