/**
 * A timeline of everything that moves the thread's scroll — TEMPORARY.
 *
 * The flicker after a send is a fight between several corrections, and the one
 * thing a console line per correction cannot show is the ORDER and the gaps: by
 * the time you read them the positions have moved. So every site that scrolls,
 * measures or resizes records a row here instead, and the whole run is printed
 * as one table once it has been quiet for `FLUSH_AFTER_MS`.
 *
 * Delete this file, and the `trace*` calls in `use-thread-scroll.ts`, once the
 * cause is settled. `ENABLED` is the switch in the meantime.
 */

/** Flip to `false` to silence the trace without unpicking the call sites. */
const ENABLED = import.meta.env.DEV

/** How long the timeline has to be quiet before it prints. */
const FLUSH_AFTER_MS = 900

interface Sample {
  /** Milliseconds since the first row of this run. */
  at: number
  label: string
  /** Where the scroller sat when the row was recorded. */
  top: number | null
  /** How far the view was from the true end — the number the flicker is IN. */
  gap: number | null
  /** The scrollable length, so a height change is visible as one. */
  height: number | null
  detail?: Record<string, unknown>
}

let element: HTMLElement | null = null
let samples: Sample[] = []
let startedAt = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** The scroller to measure on every row. Called from the hook's ref callback. */
export function traceScroller(next: HTMLElement | Window | null): void {
  if (!ENABLED) return
  element = next && !(next instanceof Window) ? next : null
}

/** Record one row. Cheap enough for a scroll handler: three reads, no writes. */
export function traceScroll(label: string, detail?: Record<string, unknown>): void {
  if (!ENABLED) return
  const now = performance.now()
  if (samples.length === 0) startedAt = now

  let top: number | null = null
  let gap: number | null = null
  let height: number | null = null
  if (element) {
    top = Math.round(element.scrollTop * 10) / 10
    height = element.scrollHeight
    gap = Math.round((element.scrollHeight - element.scrollTop - element.clientHeight) * 10) / 10
  }

  samples.push({
    at: Math.round(now - startedAt),
    label,
    top,
    gap,
    height,
    ...(detail ? { detail } : {}),
  })

  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, FLUSH_AFTER_MS)
}

function flush() {
  flushTimer = null
  const run = samples
  samples = []
  if (run.length === 0) return

  // The rows where the view actually MOVED, which is what the eye sees. A
  // reversal — down then up, or up then down — is the flicker itself.
  let previous: number | null = null
  const rows = run.map((sample) => {
    const moved = previous === null || sample.top === null ? 0 : sample.top - previous
    if (sample.top !== null) previous = sample.top
    return {
      ms: sample.at,
      what: sample.label,
      top: sample.top,
      moved: Math.round(moved * 10) / 10,
      dir: moved > 0.5 ? 'DOWN' : moved < -0.5 ? 'UP' : '',
      gap: sample.gap,
      height: sample.height,
      ...(sample.detail ?? {}),
    }
  })
  const reversals = rows.filter((row) => row.dir !== '').reduce((count, row, index, moves) => {
    const last = index > 0 ? moves[index - 1].dir : row.dir
    return count + (row.dir !== last ? 1 : 0)
  }, 0)

  console.info(
    `[xpertone-talk] thread scroll timeline — ${rows.length} rows, ${reversals} reversal(s)`,
  )
  console.table(rows)
}
