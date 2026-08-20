import { Check, Loader2, Plus, Search } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { usePeoplePicker, type PickerCandidate } from '../hooks/use-people-picker'

interface PeoplePickerProps {
  selectedIds: Id[]
  /** Ids to hide — already in the group, or myself. */
  excludeIds?: Id[]
  onChange: (ids: Id[]) => void
  /** Narrow the list by name or login. Leave it out and the picker searches itself. */
  query?: string
  /**
   * `select` ticks people off and hands the whole list back on submit — how a
   * group is BUILT. `add` commits one person at a time against a group that
   * already exists, so each row carries its own "Add" instead of a tick.
   */
  variant?: 'select' | 'add'
  /**
   * `add` only: the row's action. The name rides along so a confirmation can
   * NAME the person without looking them up again. The row leaves the list once
   * the read returns.
   */
  onAdd?: (id: Id, name: string) => void
  /** `add` only: whoever is mid-flight, so their row shows a spinner. */
  pendingIds?: Id[]
  searchPlaceholder?: string
  className?: string
}

/**
 * Choosing people to add to a group, out of the directory. The pool, the
 * server-side search and the paging all live in `use-people-picker`; this file
 * is the markup.
 */
export function PeoplePicker({
  selectedIds,
  excludeIds = [],
  onChange,
  query,
  variant = 'select',
  onAdd,
  pendingIds = [],
  searchPlaceholder,
  className,
}: PeoplePickerProps) {
  const {
    candidates,
    toggle,
    isLoading,
    isSearching,
    isLoadingMore,
    hasMore,
    loadMore,
    search,
    setSearch,
    ownsSearch,
  } = usePeoplePicker({ selectedIds, excludeIds, onChange, query })
  const mediaUrl = useMediaUrl()

  const isBusy = isLoading || isSearching

  return (
    <div className={cn('grid gap-3', className)}>
      {ownsSearch && (
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder ?? 'Search people…'}
            aria-label="Search people"
            className="pl-9"
          />
        </div>
      )}

      {isBusy && candidates.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-1 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Looking for people…
        </p>
      ) : candidates.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">
          {search
            ? 'Nobody by that name or login. Try fewer letters.'
            : 'No one to show. Ask an administrator for access to a company or department.'}
        </p>
      ) : (
        <>
          <ul className="grid gap-0.5">
            {candidates.map((candidate) => (
              <PersonRow
                key={candidate.id}
                candidate={candidate}
                avatarSrc={mediaUrl(candidate.avatarKey)}
                variant={variant}
                isPending={pendingIds.includes(candidate.id)}
                onToggle={variant === 'add' ? (onAdd ?? toggle) : toggle}
              />
            ))}
          </ul>

          {hasMore && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void loadMore()}
              disabled={isLoadingMore}
            >
              {isLoadingMore && <Loader2 className="animate-spin" />}
              Show more people
            </Button>
          )}
        </>
      )}
    </div>
  )
}

function PersonRow({
  candidate,
  avatarSrc,
  variant,
  isPending,
  onToggle,
}: {
  candidate: PickerCandidate
  avatarSrc: string
  variant: 'select' | 'add'
  isPending: boolean
  onToggle: (id: Id, name: string) => void
}) {
  const isAdd = variant === 'add'

  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(candidate.id, candidate.name)}
        disabled={isPending}
        aria-pressed={isAdd ? undefined : candidate.isSelected}
        aria-label={isAdd ? `Add ${candidate.name}` : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
          'disabled:pointer-events-none disabled:opacity-60',
          !isAdd && candidate.isSelected ? 'bg-accent' : 'hover:bg-accent/60',
        )}
      >
        <Avatar name={candidate.name} src={avatarSrc || undefined} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{candidate.name}</span>
          {candidate.subtitle && (
            <span className="truncate text-xs text-muted-foreground">{candidate.subtitle}</span>
          )}
        </span>

        {isAdd ? (
          <span
            aria-hidden
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary"
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add
          </span>
        ) : (
          <span
            aria-hidden
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
              candidate.isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input',
            )}
          >
            {candidate.isSelected && <Check className="size-3.5" />}
          </span>
        )}
      </button>
    </li>
  )
}
