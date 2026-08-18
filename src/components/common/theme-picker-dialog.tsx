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
 * `globals.css` — each option WRAPS its swatch in `data-accent`, so the dot is
 * just `bg-primary` re-resolved in that scope and no hex reaches this file.
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
      description="Pick the accent. Light and dark stay as they are."
      onClose={onClose}
      className="max-w-lg"
      footer={
        <Button className="w-full" onClick={apply}>
          <Palette />
          Apply theme
        </Button>
      }
    >
      <div className="grid gap-4">
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
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
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-accent/50'
                    : 'border-border hover:bg-accent/40',
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  {isSelected && <Check className="size-3.5" aria-hidden />}
                </span>
                <span className="truncate text-sm">{theme.label}</span>
              </button>
            )
          })}
        </div>

        <section data-accent={selected} className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Preview
          </h3>
          <p className="max-w-[80%] self-start rounded-xl bg-bubble-in px-3 py-2 text-sm text-bubble-in-foreground">
            Hey, how are you doing?
          </p>
          <p className="max-w-[80%] self-end rounded-xl bg-bubble-out px-3 py-2 text-sm text-bubble-out-foreground">
            Doing great, thanks!
          </p>
        </section>
      </div>
    </Modal>
  )
}
