import { Link, useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'

/**
 * The catch-all route.
 *
 * A generic `EmptyState` sat here before — a bold line and a button on a flat
 * fill, which read as a screen that had failed to load rather than one telling
 * the user where they are. This is the same message drawn in the product's own
 * motif, the one `ChatEmpty` uses: the thread's dot-grid surface, two drifting
 * aurora blobs, and a floating medallion with a mini bubble either side. Here
 * the bubbles carry the status code, so "404" is decoration rather than the
 * headline, and the sentence stays the thing that is read first.
 *
 * Every decorative layer is `aria-hidden`, so a screen reader hears the heading,
 * the sentence and the two actions and nothing else. The animations all resolve
 * to their resting frame at 0%, so the global reduced-motion rule freezes this
 * into a clean static illustration.
 */
export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    // `h-full`, not `h-dvh` — this renders as the whole page and could sit
    // inside the chat shell, where a viewport height would overflow it.
    <div className="thread-canvas relative flex h-full flex-col items-center justify-center overflow-hidden p-8 text-center">
      <span aria-hidden className="chat-empty-aurora absolute -top-20 left-1/4 size-72" />
      <span
        aria-hidden
        className="chat-empty-aurora chat-empty-aurora-lag absolute -right-1/4 -bottom-24 size-80"
      />

      <div aria-hidden className="relative mb-8 flex size-24 items-center justify-center">
        <span className="chat-empty-ring" />
        <span className="chat-empty-ring" />
        <span className="chat-empty-ring" />

        <span className="chat-empty-medallion relative flex size-16 items-center justify-center rounded-[1.25rem] border border-border/70 bg-card text-primary shadow-sm">
          <Compass className="size-7" />
        </span>

        {/* The same asymmetry the composer uses — the incoming chip squares its
            bottom-left, the outgoing one its bottom-right — so the pair reads as
            a thread that lost its way rather than two floating badges. */}
        <span className="chat-empty-chip absolute -top-2 -left-10 rounded-full rounded-bl-sm border border-border/70 bg-card px-2.5 py-1 text-[0.7rem] font-semibold text-muted-foreground shadow-sm">
          404
        </span>
        <span className="chat-empty-chip chat-empty-chip-lag absolute -right-10 -bottom-2 rounded-full rounded-br-sm border border-primary/25 bg-primary/15 px-2.5 py-1 shadow-sm">
          <span className="block h-1 w-4 rounded-full bg-primary/60" />
        </span>
      </div>

      <h1 className="text-lg font-semibold text-foreground">This page isn't here</h1>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        The address you opened doesn't exist in XpertOne Talk. Head back to your
        conversations — everything is where you left it.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <Link to="/chat" className={buttonVariants({ size: 'lg' })}>
          Back to conversations
        </Link>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => void navigate(-1)}
        >
          Go back
        </Button>
      </div>
    </div>
  )
}
