import { Loader2 } from 'lucide-react'

/** Full-viewport spinner for route-level suspense. */
export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-primary" aria-label={label} />
    </div>
  )
}
