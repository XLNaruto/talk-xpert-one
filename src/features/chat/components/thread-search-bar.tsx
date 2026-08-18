import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/common/tip'

interface ThreadSearchBarProps {
  query: string
  onQueryChange: (value: string) => void
  position: number
  total: number
  isSearching: boolean
  isSeeking: boolean
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

/**
 * Find-in-conversation, as a bar under the header rather than a dialog.
 *
 * A dialog would cover the thread it is searching. The bar leaves the messages
 * visible, so the banded hit and the counter are read together.
 */
export function ThreadSearchBar({
  query,
  onQueryChange,
  position,
  total,
  isSearching,
  isSeeking,
  onPrevious,
  onNext,
  onClose,
}: ThreadSearchBarProps) {
  const hasQuery = query.trim().length >= 2
  const noMatches = hasQuery && !isSearching && total === 0

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card px-3 py-2">
      <div className="relative min-w-0 flex-1">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            // Enter walks the matches, the way a browser's find bar does —
            // Shift+Enter backwards.
            if (event.key === 'Enter') {
              event.preventDefault()
              if (event.shiftKey) onPrevious()
              else onNext()
            }
          }}
          placeholder="Search this conversation"
          aria-label="Search this conversation"
          className="pr-24 pl-8"
        />

        <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1.5">
          {(isSearching || isSeeking) && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
          )}
          {hasQuery && !isSearching && (
            <span
              className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums"
              aria-live="polite"
            >
              {total === 0 ? 'No matches' : `${position} / ${total}`}
            </span>
          )}
        </span>
      </div>

      <Tip label="Previous match (Shift+Enter)">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onPrevious}
          disabled={total === 0}
          aria-label="Previous match"
        >
          <ChevronUp />
        </Button>
      </Tip>
      <Tip label="Next match (Enter)">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onNext}
          disabled={total === 0}
          aria-label="Next match"
        >
          <ChevronDown />
        </Button>
      </Tip>
      <Tip label="Close search (Esc)">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClose}
          aria-label="Close search"
        >
          <X />
        </Button>
      </Tip>

      {noMatches && <span className="sr-only">Nothing matched. Try a different word.</span>}
    </div>
  )
}
