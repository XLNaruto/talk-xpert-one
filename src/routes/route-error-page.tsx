import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'
import { logger } from '@/lib/logger'

/**
 * The router's `errorElement`.
 *
 * Anything a screen throws while rendering lands here instead of react-router's
 * default stack-trace page. The stack is still useful, so it is kept — but only
 * in a dev build, behind a disclosure, under an explanation the user can act on.
 */
export function RouteErrorPage() {
  const error = useRouteError()
  logger.error('route error', error)

  const { title, description } = describe(error)

  return (
    // `h-full`, not `h-dvh` — this renders both as the whole page and inside the
    // chat pane, and a viewport height would overflow the shell in the second.
    <div className="h-full bg-background">
      <EmptyState
        icon={<AlertTriangle className="size-8" aria-hidden />}
        title={title}
        description={description}
        action={
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => window.location.reload()}>
                Reload the page
              </Button>
              {/* Navigating clears the router's error state, so this is enough —
                  no reload needed unless the crash is in the screen itself. */}
              <Link to="/chat" className={buttonVariants({ variant: 'secondary' })}>
                Back to conversations
              </Link>
            </div>
            {import.meta.env.DEV && <ErrorDetails error={error} />}
          </div>
        }
      />
    </div>
  )
}

/** What to say. A thrown `Response` knows its own status; anything else does not. */
function describe(error: unknown): { title: string; description: string } {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        title: 'Page not found',
        description: "That address doesn't exist in One Talk.",
      }
    }
    return {
      title: 'This screen could not be opened',
      description: `The server answered ${error.status}. Reload the page, or go back to your conversations.`,
    }
  }
  return {
    title: 'Something went wrong',
    description:
      'This screen stopped responding. Reload the page — your messages are safe, nothing was lost.',
  }
}

/** Dev only: the message and stack, collapsed so it never dominates the screen. */
function ErrorDetails({ error }: { error: unknown }) {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}\n\n${error.stack ?? ''}`
      : String(error)

  return (
    <details className="w-full max-w-xl text-left">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Developer details
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-secondary p-3 text-left text-xs whitespace-pre-wrap text-muted-foreground">
        {detail}
      </pre>
    </details>
  )
}
