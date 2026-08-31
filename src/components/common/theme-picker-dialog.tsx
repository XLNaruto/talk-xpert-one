import { useState } from 'react'
import { Check, CheckCheck, Palette } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
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
/**
 * The bubble tail, the same art the thread draws — `currentColor` keeps it in
 * step with the fill it hangs off, in both themes and under every accent.
 */
function PreviewTail({ mine = false }: { mine?: boolean }) {
  return (
    <svg
      viewBox="0 1 8 12"
      className={cn(
        'absolute top-0 h-3 w-2',
        mine ? '-right-1.5 text-bubble-out' : '-left-1.5 text-bubble-in',
      )}
      aria-hidden
    >
      <path
        fill="currentColor"
        d={
          mine
            ? 'M6.467 3.568L0 12.193V1h5.188c1.77 0 2.338 1.156 1.279 2.568z'
            : 'M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z'
        }
      />
    </svg>
  )
}

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

        {/* The preview is the real thread in miniature — the same
            `thread-canvas` surface, the same bubble shapes with their tails, an
            avatar under the incoming run and a meta line with the read tick —
            because a colour only tells you what it will look like on the
            surfaces it will actually be painted on. Static markup on purpose:
            nothing here reads a message, so it stays in this file rather than
            pulling the chat feature into a shared dialog. */}
        <section
          data-accent={selected}
          className="thread-canvas flex flex-col gap-2 overflow-hidden rounded-xl border border-border p-4"
        >
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Preview
          </h3>

          <div className="flex justify-center">
            <span className="rounded-full border border-border/60 bg-card/85 px-2.5 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase shadow-xs backdrop-blur-sm">
              Today
            </span>
          </div>

          {/* Incoming: avatar, tail on the left, no tick — nobody reports back
              on somebody else's message. */}
          <div className="flex items-end gap-2">
            <Avatar name="Ada Lovelace" className="size-7 shrink-0 self-start text-[10px]" />
            <div className="relative max-w-[80%]">
              <PreviewTail />
              <div className="rounded-lg rounded-tl-none bg-bubble-in px-3 py-2 text-sm text-bubble-in-foreground shadow-xs">
                <p>Hey, how are you doing?</p>
                <span className="mt-1 flex justify-end text-[10px] tabular-nums opacity-70">
                  09:41
                </span>
              </div>
            </div>
          </div>

          {/* Outgoing: tail on the right, and the read tick in `--tick-read` —
              the one mark whose colour the accent changes on its own. */}
          <div className="flex justify-end">
            <div className="relative max-w-[80%]">
              <PreviewTail mine />
              <div className="rounded-lg rounded-tr-none bg-bubble-out px-3 py-2 text-sm text-bubble-out-foreground shadow-xs">
                <p>I&apos;m great, thanks! 🎉</p>
                <span className="mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums">
                  <span className="opacity-70">09:42</span>
                  <CheckCheck
                    className="size-3.5 text-tick-read"
                    strokeWidth={2.75}
                    aria-hidden
                  />
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  )
}
