import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ModalProps {
  title: string
  description?: string
  /** A glyph shown before the title — for a dialog that is a place, not a step. */
  icon?: ReactNode
  onClose: () => void
  footer?: ReactNode
  /**
   * `center` is a dialog — a short panel for a decision. `right` is a sheet:
   * full height against the right edge, for work that needs the room and sits
   * beside the conversation rather than on top of it.
   */
  side?: 'center' | 'right'
  className?: string
  /**
   * The stacking layer of the scrim, for the one caller that needs more than the
   * app's default `z-50`: the media lightbox renders its own portal at 9999, so
   * a confirmation opened from INSIDE it would otherwise be drawn behind the
   * photo it is asking about. Same reason the lightbox's tooltips declare a
   * layer of their own.
   */
  layerClassName?: string
  children: ReactNode
}

/**
 * The one dialog shell — a panel over a scrim, centred or anchored right.
 *
 * Hand-written rather than pulled from shadcn because Talk needs exactly this
 * much: a labelled panel, Escape to close, focus moved in on open and the page
 * behind it inert. A dialog library would add a dependency for the parts we
 * don't use.
 *
 * Rendered into `document.body` rather than in place: the sidebar slides on a
 * `transform`, which makes it the containing block for `position: fixed`, so a
 * dialog opened from it would be trapped inside the 320px column instead of
 * covering the viewport.
 */
export function Modal({
  title,
  description,
  icon,
  onClose,
  footer,
  side = 'center',
  className,
  layerClassName,
  children,
}: ModalProps) {
  const isSheet = side === 'right'
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    // Move focus into the dialog, or a keyboard user is left behind it.
    panel.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className={cn(
        'scrim-enter fixed inset-0 z-50 flex bg-black/40',
        isSheet ? 'justify-end' : 'items-center justify-center p-4',
        layerClassName,
      )}
      // A click on the scrim closes; a click inside must not bubble out to it.
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'flex w-full flex-col border-border bg-card shadow-lg',
          isSheet
            ? 'sheet-enter h-full max-w-md border-l'
            : 'max-h-[85vh] max-w-md rounded-xl border',
          className,
        )}
      >
        {/* One line of title centres against the close button; a title plus a
            description is taller than the button, so that case aligns to the top.
            The button carries a negative margin because a ghost icon button insets
            its glyph — without it the ✕ reads as further from the edge than the
            title is. */}
        <header
          className={cn(
            'flex shrink-0 gap-3 border-b border-border px-4 py-3',
            description && !icon ? 'items-start' : 'items-center',
          )}
        >
          {icon && (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary [&_svg]:size-4"
              aria-hidden
            >
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            className="-my-1 -mr-1.5 shrink-0"
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>

        {footer && (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
