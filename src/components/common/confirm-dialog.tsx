import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from './modal'

interface ConfirmDialogProps {
  title: string
  /** What the confirm button does, in one line. Say the consequence, not "Are you sure?". */
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** `destructive` for anything that takes something away. */
  tone?: 'default' | 'destructive'
  isPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The one "do you mean it?" panel — a centred `Modal` with a consequence and two
 * buttons. Every screen that guards a write reaches for this rather than
 * hand-rolling its own footer, so the wording and the button order stay the same
 * wherever the question is asked.
 *
 * The confirm button is disabled while the write is in flight rather than the
 * dialog closing straight away: a failed write leaves the question on screen,
 * with its toast, instead of quietly doing nothing.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={isPending ? () => {} : onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </Modal>
  )
}
