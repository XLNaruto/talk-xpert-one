import { Modal } from '@/components/common/modal'
import { EmojiPanel } from './emoji-picker'

/**
 * The full emoji set, for a reaction the quick six do not cover.
 *
 * A dialog rather than a popover hung off the bubble: the bubble lives inside a
 * virtualised scroller, which would clip a 400-pixel panel opened near either
 * edge of it. Picking closes the dialog — a reaction is one emoji, never several.
 */
export function ReactionPickerDialog({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void
  onClose: () => void
}) {
  return (
    <Modal title="React with any emoji" onClose={onClose} className="max-w-sm">
      <div className="-mx-4 -my-3 h-108.75">
        <EmojiPanel
          onSelect={(emoji) => {
            onPick(emoji)
            onClose()
          }}
        />
      </div>
    </Modal>
  )
}
