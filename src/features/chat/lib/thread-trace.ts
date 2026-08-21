import { logger } from '@/lib/logger'

/**
 * Counters for diagnosing a thread that will not sit still.
 *
 * TEMPORARY — this exists to find the cause of the scroll flicker and comes out
 * once it is found. It is here rather than inline `console.log`s because the
 * question is never "did this run" but "how MANY times, and what changed": a
 * render loop and a healthy render look identical one at a time, and a hundred
 * log lines a second push the answer off the top of the console.
 *
 * So nothing is logged as it happens. Everything is counted, and once every
 * `FLUSH_MS` the totals go out as ONE line that can be pasted whole. A counter
 * that reads `render:MessageList: 240` over two seconds says "loop" without any
 * further reading; one that reads `4` says the renders are not the problem.
 *
 * Dev-only, via `logger.debug` — silent in a production build.
 */

/** Long enough that a loop is unmistakable, short enough to still feel live. */
const FLUSH_MS = 2000

/** How many changed props to name per component — the rest are counted. */
const NAMED_PROPS = 4

const counts = new Map<string, number>()
/** Worst duration seen for a label this window, in whole milliseconds. */
const worst = new Map<string, number>()
/** Last props per label, for the identity comparison in `traceRender`. */
const previous = new Map<string, Record<string, unknown>>()

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Start the flush timer lazily, and stop it again once a window comes back
 * empty — a permanent 2 s timer is itself a thing that wakes the main thread up,
 * which is exactly what is being measured here.
 */
function schedule(): void {
  if (timer !== null) return
  timer = setTimeout(() => {
    timer = null
    if (counts.size === 0 && worst.size === 0) return

    const summary: Record<string, number | string> = {}
    for (const [key, value] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      summary[key] = value
    }
    for (const [key, ms] of worst.entries()) summary[`ms:${key}`] = ms

    logger.debug(`trace ${FLUSH_MS}ms`, summary)
    counts.clear()
    worst.clear()
    schedule()
  }, FLUSH_MS)
}

/** One occurrence of something worth counting. */
export function traceCount(event: string, by = 1): void {
  if (!import.meta.env.DEV) return
  counts.set(event, (counts.get(event) ?? 0) + by)
  schedule()
}

/** The longest this label has taken in the current window. */
export function traceMs(label: string, ms: number): void {
  if (!import.meta.env.DEV) return
  const rounded = Math.round(ms)
  if (rounded > (worst.get(label) ?? 0)) worst.set(label, rounded)
  schedule()
}

/**
 * Count a render AND name what changed to cause it.
 *
 * The count alone proves a loop exists; the changed prop names say what is
 * driving it, which is the part that cannot be worked out by reading the code —
 * a prop that is a fresh object or arrow on every render looks identical in the
 * source to one that is stable.
 */
export function traceRender(label: string, props: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return
  traceCount(`render:${label}`)

  const held = previous.get(label)
  previous.set(label, props)
  if (!held) return

  const changed: string[] = []
  for (const key of Object.keys(props)) {
    if (props[key] !== held[key]) changed.push(key)
  }
  if (changed.length === 0) {
    traceCount(`${label}:no-prop-changed`)
    return
  }
  for (const key of changed.slice(0, NAMED_PROPS)) traceCount(`${label}:Δ${key}`)
}
