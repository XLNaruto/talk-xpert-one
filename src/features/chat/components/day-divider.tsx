/**
 * The date a run of messages was written on.
 *
 * A centred pill rather than a rule with the date sitting in a gap in it: the
 * thread's canvas is textured now (`.thread-canvas` in globals.css), and a
 * hairline across a dot grid reads as part of the pattern. The pill carries its
 * own surface, so it holds the same weight over a photo as over the background,
 * and it matches the shape a system message is drawn in — both are notes ABOUT
 * the conversation rather than lines in it.
 */
export function DayDivider({ label }: { label: string }) {
  // `pt-3`, not `my-3`: a vertical margin inside a virtualised item is measured
  // wrong — see the note on the run spacing in `message-bubble.tsx`. The air
  // below comes from the next row's own top padding.
  return (
    <div className="pt-3 flex justify-center px-3">
      <span className="rounded-full border border-border/60 bg-card/85 px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase shadow-xs backdrop-blur-sm">
        {label}
      </span>
    </div>
  )
}
