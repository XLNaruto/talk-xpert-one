import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/common/tip'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

/** Flips between the light and dark palettes. The choice persists in IndexedDB. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = `Switch to ${next} mode`

  return (
    <Tip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        aria-label={label}
        className={cn('rounded-full', className)}
      >
        {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </Button>
    </Tip>
  )
}
