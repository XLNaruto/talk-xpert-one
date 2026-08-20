import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { personBlockCopy } from '../lib/chat-labels'
import type { usePersonBlock } from '../hooks/use-person-block'

/**
 * The panel behind every private block and unblock. Renders nothing until
 * something asks, so a call site is one line beside its button.
 */
export function PersonBlockDialog({ block }: { block: ReturnType<typeof usePersonBlock> }) {
  if (!block.request) return null
  const copy = personBlockCopy(block.request.name, block.request.blocked)
  return (
    <ConfirmDialog
      title={copy.title}
      message={copy.message}
      confirmLabel={copy.confirmLabel}
      tone={copy.tone}
      isPending={block.isPending}
      onConfirm={() => void block.run()}
      onCancel={block.cancel}
    />
  )
}
