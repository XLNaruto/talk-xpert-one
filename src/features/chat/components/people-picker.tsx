import { Check, Plus } from 'lucide-react'
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
  /** Narrow the list by name; the search box itself belongs to the screen. */
  query?: string
  /** Hide the type-an-id row when the screen offers its own. */
  showManualEntry?: boolean
  className?: string
}

/**
 * Choosing people to add to a group. The pool and the rules behind it live in
 * `use-people-picker`; this file is the markup.
 */
export function PeoplePicker({
  selectedIds,
  excludeIds = [],
  onChange,
  query,
  showManualEntry = true,
  className,
}: PeoplePickerProps) {
  const { candidates, toggle, manualId, setManualId, addManual } = usePeoplePicker({
    selectedIds,
    excludeIds,
    onChange,
    query,
  })
  const mediaUrl = useMediaUrl()

  return (
    <div className={cn('grid gap-3', className)}>
      {showManualEntry && (
        <div className="flex items-end gap-2">
          <Input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addManual()
              }
            }}
            placeholder="Add by Talk ID"
            inputMode="numeric"
            aria-label="Add someone by Talk ID"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={addManual}
            disabled={!manualId}
            aria-label="Add this Talk ID"
          >
            <Plus />
          </Button>
        </div>
      )}

      {candidates.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">
          {query
            ? 'Nobody by that name. Try a different search, or add someone by their Talk ID.'
            : 'Nobody to show yet. Add someone by their Talk ID to start a group with them.'}
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {candidates.map((candidate) => (
            <PersonRow
              key={candidate.id}
              candidate={candidate}
              avatarSrc={mediaUrl(candidate.avatarKey)}
              onToggle={toggle}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function PersonRow({
  candidate,
  avatarSrc,
  onToggle,
}: {
  candidate: PickerCandidate
  avatarSrc: string
  onToggle: (id: Id) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(candidate.id)}
        aria-pressed={candidate.isSelected}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
          candidate.isSelected ? 'bg-accent' : 'hover:bg-accent/60',
        )}
      >
        <Avatar name={candidate.name} src={avatarSrc || undefined} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{candidate.name}</span>
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
      </button>
    </li>
  )
}
