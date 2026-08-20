import { useRef } from 'react'
import { Camera, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/common/modal'
import { AVATAR_CONTENT_TYPES } from '@/lib/uploads'
import { useCreateGroupForm } from '../hooks/use-create-group-form'
import { PeoplePicker } from './people-picker'

/**
 * Create a group. Whoever creates it is its `owner` — the role that may later
 * rename it, add and remove members, block them from posting and delete it — so
 * that is never a form field.
 *
 * A right-hand sheet rather than a centred dialog: the member list is the part
 * that needs the room, so it takes the full height of the viewport and scrolls
 * under a fixed header and a fixed action, beside the conversation.
 */
export function CreateGroupDialog({ onClose }: { onClose: () => void }) {
  const form = useCreateGroupForm(onClose)
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <Modal
      title="Create group"
      description="Name it, then choose who is in it."
      onClose={onClose}
      side="right"
      footer={
        <Button
          className="w-full"
          onClick={() => void form.submit()}
          disabled={form.isPending}
        >
          {form.isPending && <Loader2 className="animate-spin" />}
          Create group
        </Button>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-col items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            aria-label="Upload group photo"
            className="relative size-20 overflow-hidden rounded-full bg-accent text-muted-foreground transition-colors hover:bg-accent/70"
          >
            {form.photoPreview ? (
              <img src={form.photoPreview} alt="" className="size-full object-cover" />
            ) : (
              <Camera className="absolute inset-0 m-auto size-7" />
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={AVATAR_CONTENT_TYPES.join(',')}
            className="hidden"
            onChange={(e) => {
              form.choosePhoto(e.target.files?.[0] ?? null)
              // Let the same file be re-picked after a rejected type.
              e.target.value = ''
            }}
          />
          <p className="text-xs text-muted-foreground">
            {form.photoPreview ? 'Change group photo' : 'Upload group photo'}
          </p>
          {form.errors.photo && (
            <p className="text-xs text-destructive" role="alert">
              {form.errors.photo}
            </p>
          )}
        </div>

        {/* Every message sits directly under the control it is about. These boxes
            are placeholder-labelled by design, so the error is rendered inline
            rather than through `Field`, which would add a visible label. */}
        <div className="grid gap-1.5">
          <Input
            value={form.name}
            onChange={(e) => form.changeName(e.target.value)}
            placeholder="Group name"
            aria-label="Group name"
            aria-invalid={form.errors.name ? true : undefined}
            autoFocus
          />
          {form.errors.name && (
            <p className="text-xs text-destructive" role="alert">
              {form.errors.name}
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <Textarea
            rows={2}
            value={form.description}
            onChange={(e) => form.changeDescription(e.target.value)}
            placeholder="What this group is for (optional)"
            aria-label="Group description"
            aria-invalid={form.errors.description ? true : undefined}
          />
          {form.errors.description && (
            <p className="text-xs text-destructive" role="alert">
              {form.errors.description}
            </p>
          )}
        </div>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={form.query}
            onChange={(e) => form.setQuery(e.target.value)}
            placeholder="Search members…"
            aria-label="Search members"
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
              {form.talkUserIds.length > 0
                ? `${form.talkUserIds.length} chosen — you are the owner and are added automatically.`
                : 'You are the owner and are added automatically.'}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
