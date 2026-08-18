import { useEffect, useRef, useState } from 'react'
import { Loader2, Smile } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui-store'

/**
 * The emoji set and the picker code, imported once per session.
 *
 * Module-level rather than per-open so the prefetch on hover and the real open
 * share one in-flight promise instead of racing two imports — and so the second
 * open costs nothing. A failure clears the cache, or a dropped connection would
 * leave the picker permanently broken for the rest of the session.
 */
function importEmoji() {
  return Promise.all([import('emoji-mart'), import('@emoji-mart/data')])
}

let emojiBundle: ReturnType<typeof importEmoji> | null = null

function loadEmojiBundle() {
  emojiBundle ??= importEmoji().catch((error: unknown) => {
    emojiBundle = null
    throw error
  })
  return emojiBundle
}

/**
 * The composer's emoji button and its emoji-mart panel.
 *
 * The picker and its data are imported ONLY when the button is first pressed —
 * the emoji set is about a megabyte of JSON, and a chat that nobody opens the
 * picker in should never pay for it. `emoji-mart` is a custom element rather
 * than a React component, so it is constructed and adopted by hand: the React
 * wrapper package still pins peer deps at React 18 and this repo is on 19.
 *
 * Open/closed is the one piece of state here and it is purely visual, so it
 * stays in the component. The chosen emoji goes to the caller, which inserts it
 * at the caret — the picker never touches the draft itself.
 */
export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const [isReady, setReady] = useState(false)
  const theme = useUiStore((s) => s.theme)
  const wrapper = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)

  // The panel outlives any one render of the callback, so it reads the latest
  // one from a ref instead of being rebuilt whenever the draft changes.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Captured now: by cleanup time the ref may already point elsewhere, and the
    // element to empty is the one this effect filled.
    const mount = host.current

    void (async () => {
      const [{ Picker }, data] = await loadEmojiBundle()
      if (cancelled || !mount) return
      const picker = new Picker({
        data: data.default,
        theme,
        previewPosition: 'none',
        navPosition: 'top',
        // Re-flows the grid to the width of the panel instead of sizing the
        // panel to a whole number of emoji. The reserved box is then always
        // right, whatever the emoji button size is.
        dynamicWidth: true,
        emojiButtonSize: 30,
        emojiSize: 18,
        autoFocus: true,
        onEmojiSelect: (emoji: { native?: string }) => {
          if (emoji.native) selectRef.current(emoji.native)
          setOpen(false)
        },
      })
      mount.replaceChildren(picker as unknown as Node)
      setReady(true)
    })()

    return () => {
      cancelled = true
      setReady(false)
      mount?.replaceChildren()
    }
  }, [open, theme])

  // Click-away and Escape both close: the panel sits above the message list, so
  // leaving it open would swallow the next click on a bubble.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapper} className="relative shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => setOpen((was) => !was)}
        // The emoji data is about a megabyte, so the wait is real the first
        // time. Starting it on hover or focus usually means it has landed by
        // the time the button is actually pressed.
        onPointerEnter={() => void loadEmojiBundle()}
        onFocus={() => void loadEmojiBundle()}
        aria-label="Add an emoji"
        aria-expanded={open}
      >
        <Smile />
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Emoji"
          className="absolute bottom-12 left-0 z-30 h-108.75 w-88 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          // The composer's wrapper refocuses the textarea on click. Without this
          // the picker's own search box would lose focus on its first keystroke.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* The panel reserves the final size up front and the picker is told to
              fill it, so loading and loaded occupy exactly the same rectangle.
              Sizing the panel to the picker instead made it jump the moment the
              emoji data landed — the picker's own width is `min-content`, which
              is narrower than any box we can reserve for it. */}
          {!isReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2
                className="size-5 animate-spin text-muted-foreground"
                aria-label="Loading emoji"
              />
            </div>
          )}
          <div ref={host} className="size-full" />
        </div>
      )}
    </div>
  )
}
