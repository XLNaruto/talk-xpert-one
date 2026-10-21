import { Loader2, Megaphone, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/common/modal'
import { BROADCAST_MAX_RECIPIENTS, BROADCAST_MIN_RECIPIENTS, BROADCAST_NAME_MAX } from '../constants'
import { useBroadcastListForm } from '../hooks/use-broadcast-list-form'
import type { BroadcastListDetail } from '../types'
import { PeoplePicker } from './people-picker'

/**
 * Build a broadcast list, or change one: an optional name and 2–256 people from
 * the directory. The picker is the one a group is built with, so reach is the
 * same — only people I may start a chat with.
 *
 * A right-hand sheet, like New group: the people are the part that needs room.
 */
export function BroadcastListDialog({
  existing,
  onDone,
  onClose,
}: {
  /** The list being edited; absent when creating one. */
  existing?: BroadcastListDetail | null
  onDone: (list: BroadcastListDetail) => void
  onClose: () => void
}) {
  const form = useBroadcastListForm({ existing, onDone })
  const picked = form.talkUserIds.length
  const short = BROADCAST_MIN_RECIPIENTS - picked

  return (
    <Modal
      title={existing ? 'Edit broadcast' : 'New broadcast'}
      description="Only you can see this list. Nobody on it is told."
      icon={<Megaphone />}
      onClose={onClose}
      side="right"
      footer={
        <Button className="w-full" onClick={() => void form.submit()} disabled={form.isPending}>
          {form.isPending && <Loader2 className="animate-spin" />}
          {existing ? 'Save changes' : 'Create list'}
        </Button>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Input
            value={form.name}
            onChange={(e) => form.changeName(e.target.value)}
            placeholder="List name (optional)"
            aria-label="List name"
            maxLength={BROADCAST_NAME_MAX}
            aria-invalid={form.errors.name ? true : undefined}
            autoFocus
          />
          {form.errors.name && (
            <p className="text-xs text-destructive" role="alert">
              {form.errors.name}
            </p>
          )}
        </div>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={form.query}
            onChange={(e) => form.setQuery(e.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
            className="pl-9"
          />
        </div>

        <div className="grid gap-1.5">
          <PeoplePicker
            selectedIds={form.talkUserIds}
            excludeIds={form.excludeIds}
            onChange={form.changeTalkUserIds}
            query={form.query}
          />
          {form.errors.talkUserIds ? (
            <p className="text-xs text-destructive" role="alert">
              {form.errors.talkUserIds}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {short > 0
                ? `Pick at least ${short} more ${short === 1 ? 'person' : 'people'}.`
                : `${picked} of up to ${BROADCAST_MAX_RECIPIENTS} picked.`}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
