import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface TipProps {
  /** What the control does. Sentence case, no full stop. */
  label: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Exactly one element — it becomes the trigger and keeps its own props. */
  children: ReactElement
}

/**
 * The app's tooltip, in the one line it takes to use.
 *
 * Wraps `Tooltip`/`TooltipTrigger`/`TooltipContent` so a control needs a `Tip`
 * around it and nothing else. Use this instead of the native `title` attribute:
 * `title` renders the OS tooltip, which ignores the theme, sits where the OS
 * decides and takes a second to appear.
 *
 * `asChild` means the trigger IS the child — no wrapper element, so button
 * layout and focus handling are untouched. A tooltip is never the only label:
 * keep `aria-label` on icon-only buttons, because a tooltip is not announced by
 * every screen reader.
 */
export function Tip({ label, side = 'bottom', children }: TipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
