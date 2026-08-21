import { useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/common/modal'
import { ACCENT_THEMES, type AccentTheme } from '@/lib/themes'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

/**
 * Picks the accent colour.
 *
 * The choice is held locally and only committed on "Apply theme", so the preview
 * below the grid is the whole point: a swatch says what colour it is, the two
 * bubbles say what the conversation will look like in it.
 *
 * Every colour here comes from the `[data-accent]` token blocks in
 * `globals.css` — each tile WRAPS itself in `data-accent`, so the dot is just
 * `bg-primary-fill` and the tile just `bg-card`, both re-resolved in that scope.
 * That is why an unselected tile already carries its own theme's surface tint,
 * and why no hex reaches this file. Light and dark are untouched: each block has
 * a value for both, so the grid reads correctly in either mode.
 *
 * The dot and the ring take `--primary-fill` rather than `--primary` on purpose:
 * a swatch has to predict the colour the theme will PAINT, and on a theme with
 * a deep fill those two are not the same shade.
 */
export function ThemePickerDialog({ onClose }: { onClose: () => void }) {
  const accent = useUiStore((s) => s.accent)
  const setAccent = useUiStore((s) => s.setAccent)
  const [selected, setSelected] = useState<AccentTheme>(accent)

  const apply = () => {
    setAccent(selected)
    onClose()
  }

  return (
    <Modal
      title="Colour theme"
      icon={<Palette />}
      onClose={onClose}
      className="max-w-lg"
      footer={
        <Button className="w-full" onClick={apply}>
          Apply theme
        </Button>
      }
    >
      <div className="grid gap-4">
        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Colour theme"
        >
          {ACCENT_THEMES.map((theme) => {
            const isSelected = theme.id === selected
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(theme.id)}
                data-accent={theme.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border-2 bg-card px-3 py-2.5 text-left transition-colors',
                  isSelected
                    ? 'border-primary-fill'
                    : 'border-border hover:border-primary-fill/40',
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-fill text-primary-fill-foreground">
                  {isSelected && <Check className="size-3.5" aria-hidden />}
                </span>
                <span className="truncate text-sm">{theme.label}</span>
              </button>
            )
          })}
        </div>

        {/* A column, not a grid: `self-end` in a grid moves a row down the block
            axis and leaves the bubble stretched full width. In a flex column it
            does what a chat needs — pushes the reply to the right, at the width
            of its own text. */}
        <section
          data-accent={selected}
          className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4"
        >
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Preview
          </h3>
          <p className="max-w-[80%] self-start rounded-2xl bg-bubble-in px-3.5 py-2 text-sm text-bubble-in-foreground">
            Hey, how are you doing?
          </p>
          <p className="max-w-[80%] self-end rounded-2xl bg-bubble-out px-3.5 py-2 text-sm text-bubble-out-foreground">
            I&apos;m great, thanks! 🎉
          </p>
        </section>
      </div>
    </Modal>
  )
}
