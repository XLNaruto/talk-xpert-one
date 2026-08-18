export function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3 px-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
